import { pathToFileURL } from 'node:url';
import pLimit from 'p-limit';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { pool } from '../db/pool.js';
import * as repos from '../db/repos.js';
import { construirUrlRss, descargarRss, parsearRss } from './rss.js';
import { cargarRubro, filtrarCandidatos, itemsCoinciden, type Candidato } from './filtro.js';
import { abrirBrowser, scrapeLlamado, type ResultadoScrape } from './scraper.js';
import { analizarPendientes } from './analyze.js';
import { hoyEnZona } from '../utils/fechas.js';

export interface OpcionesCorrida {
  origen?: string;
  soloIngesta?: boolean;
  soloAnalisis?: boolean;
  limiteAnalisis?: number;
}

export interface EstadoPipeline {
  enCurso: boolean;
  iniciadaEn: string | null;
  ultimaCorrida: (repos.ResumenCorrida & { origen: string; estado: string; iniciada_en: string; finalizada_en: string | null }) | null;
}

let enCurso = false;
let iniciadaEn: string | null = null;
let ultima: EstadoPipeline['ultimaCorrida'] = null;

// Llamados descartados por el filtro de ítems: no se insertan, así que se recordarían como "nuevos"
// en cada corrida. Se memorizan por día para no re-scrapearlos.
const rechazadosPorItems = new Map<string, string>();

export function estadoPipeline(): EstadoPipeline {
  return { enCurso, iniciadaEn, ultimaCorrida: ultima };
}

export function pipelineEnCurso(): boolean {
  return enCurso;
}

/** Ingesta: RSS → filtro → scraper → BD. Devuelve conteos para el resumen. */
async function ingestar(log: typeof logger): Promise<{ rss_total: number; candidatos: number; scrapeados: number; nuevos: number; rechazados_items: number; errores_scrape: number; descartados: Record<string, number> }> {
  const rubro = cargarRubro(config.RUBRO);
  const hoy = hoyEnZona(config.TZ_LOCAL);

  const vencidos = await repos.marcarVencidos();
  const archivados = await repos.archivarAntiguos(120);
  await repos.refrescarDiasRestantes();
  if (vencidos || archivados) log.info({ vencidos, archivados }, 'estados actualizados');

  const url = construirUrlRss(config.RSS_DIAS, config.TZ_LOCAL);
  log.info({ url }, 'descargando RSS');
  const xml = await descargarRss(url);
  const items = parsearRss(xml, config.TZ_LOCAL);
  const { candidatos, descartados } = filtrarCandidatos(items, rubro, hoy);
  const porcentaje = items.length ? Math.round((candidatos.length / items.length) * 1000) / 10 : 0;
  log.info({ rss_total: items.length, candidatos: candidatos.length, porcentaje, descartados }, 'filtro de candidatos');
  if (items.length > 0 && (candidatos.length === 0 || porcentaje > 30)) {
    log.warn({ porcentaje }, 'proporción de candidatos fuera del rango esperado (0 < % < 30)');
  }

  const yaVistosHoy = await repos.idsActualizadosHoy();
  const aScrapear: Candidato[] = [];
  let rechazadosItems = 0;
  for (const c of candidatos) {
    if (yaVistosHoy.has(c.id)) {
      await repos.upsertLlamado(c); // refresca días restantes / urgencia
      continue;
    }
    if (rechazadosPorItems.get(c.id) === hoy) {
      rechazadosItems++;
      continue;
    }
    aScrapear.push(c);
  }
  log.info({ a_scrapear: aScrapear.length, ya_vistos_hoy: candidatos.length - aScrapear.length - rechazadosItems }, 'scraping');

  let scrapeados = 0;
  let nuevos = 0;
  let erroresScrape = 0;
  if (aScrapear.length > 0) {
    const browser = await abrirBrowser();
    try {
      const limit = pLimit(config.SCRAPER_CONCURRENCIA);
      const resultados = await Promise.all(
        aScrapear.map((c) =>
          limit(async (): Promise<[Candidato, ResultadoScrape]> => {
            const r = await scrapeLlamado(browser, c.url_detalle, c.id);
            return [c, r];
          }),
        ),
      );
      for (const [c, r] of resultados) {
        if (r.error) {
          erroresScrape++;
          log.warn({ id: c.id, error: r.error }, 'error de scraping; se guarda el llamado sin detalle');
        } else {
          scrapeados++;
        }
        const ev = itemsCoinciden(r.items_extraidos, rubro);
        if (!ev.ok) {
          rechazadosPorItems.set(c.id, hoy);
          rechazadosItems++;
          log.debug({ id: c.id, items: r.items_extraidos.length }, 'descartado: ítems sin keywords del rubro');
          continue;
        }
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await repos.upsertLlamado(c, client);
          await repos.upsertAclaraciones(c.id, r.aclaraciones, client);
          await repos.upsertAdjuntos(c.id, r.archivos_adjuntos, client);
          await repos.insertItems(c.id, r.items_extraidos, client);
          await client.query('COMMIT');
          nuevos++;
        } catch (err) {
          await client.query('ROLLBACK');
          erroresScrape++;
          log.error({ id: c.id, err }, 'error guardando llamado');
        } finally {
          client.release();
        }
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  }
  // Limpieza del mapa de rechazados de días anteriores
  for (const [id, dia] of rechazadosPorItems) if (dia !== hoy) rechazadosPorItems.delete(id);

  return { rss_total: items.length, candidatos: candidatos.length, scrapeados, nuevos, rechazados_items: rechazadosItems, errores_scrape: erroresScrape, descartados };
}

export async function runPipeline(opciones: OpcionesCorrida = {}): Promise<{ ok: boolean; motivo?: string; resumen?: repos.ResumenCorrida }> {
  if (enCurso) return { ok: false, motivo: 'ya hay una corrida en curso' };
  enCurso = true;
  iniciadaEn = new Date().toISOString();
  const origen = opciones.origen ?? 'manual';
  const log = logger.child({ corrida: origen });
  const t0 = Date.now();
  const corridaId = await repos.iniciarCorrida(origen);
  const resumen: repos.ResumenCorrida = { rss_total: 0, candidatos: 0, scrapeados: 0, analizados: 0, errores: 0, detalle: {} };
  let estado: 'ok' | 'error' = 'ok';
  try {
    log.info({ rubro: config.RUBRO, soloIngesta: !!opciones.soloIngesta, soloAnalisis: !!opciones.soloAnalisis }, 'inicio de corrida');
    if (!opciones.soloAnalisis) {
      const ing = await ingestar(log);
      resumen.rss_total = ing.rss_total;
      resumen.candidatos = ing.candidatos;
      resumen.scrapeados = ing.scrapeados;
      resumen.errores += ing.errores_scrape;
      resumen.detalle.ingesta = ing;
    }
    if (!opciones.soloIngesta) {
      const an = await analizarPendientes(log, opciones.limiteAnalisis ?? config.MAX_ANALISIS_POR_CORRIDA);
      resumen.analizados = an.analizados + an.fallback;
      resumen.errores += an.errores;
      resumen.detalle.analisis = an;
    }
  } catch (err) {
    estado = 'error';
    resumen.errores++;
    resumen.detalle.error = (err as Error).message;
    log.error({ err }, 'corrida fallida');
  } finally {
    resumen.detalle.duracion_ms = Date.now() - t0;
    await repos.finalizarCorrida(corridaId, estado, resumen).catch((err) => log.error({ err }, 'no se pudo cerrar la corrida'));
    ultima = { ...resumen, origen, estado, iniciada_en: iniciadaEn, finalizada_en: new Date().toISOString() };
    enCurso = false;
    iniciadaEn = null;
    log.info({ ...resumen, detalle: undefined, duracion_s: Math.round((Date.now() - t0) / 1000) }, 'fin de corrida');
  }
  return { ok: estado === 'ok', resumen };
}

// Ejecución directa: npm run pipeline:once [-- --solo-ingesta | --solo-analisis] [--limite N]
const esMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (esMain) {
  const args = process.argv.slice(2);
  const limiteArg = args.find((a) => a.startsWith('--limite='));
  const { runMigrations } = await import('../db/migrate.js');
  await runMigrations(pool);
  const r = await runPipeline({
    origen: 'cli',
    soloIngesta: args.includes('--solo-ingesta'),
    soloAnalisis: args.includes('--solo-analisis'),
    ...(limiteArg ? { limiteAnalisis: Number(limiteArg.split('=')[1]) } : {}),
  });
  console.log(JSON.stringify(r, null, 2));
  await pool.end();
  process.exit(r.ok ? 0 : 1);
}
