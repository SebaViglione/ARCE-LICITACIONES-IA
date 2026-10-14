import { z } from 'zod';
import type pg from 'pg';
import { config } from '../config.js';
import { pool as poolDefault } from '../db/pool.js';
import { getProveedor, resumenError, type MetaLlm, type ProveedorLlm } from '../llm/index.js';
import { logger } from '../logger.js';
import * as consultas from './consultas.js';
import { hashCanonico, normalizarTexto } from './normalizar.js';

// El analista: un modelo de lenguaje (Ollama local o la API de Anthropic, según LLM_PROVIDER) lee las
// estadísticas ya calculadas y las convierte en conclusiones de negocio. Tres usos:
//   1. informe del mercado (qué vender, tendencias, competencia, compradores, alertas sobre los datos)
//   2. veredicto por producto (¿conviene entrar?, a qué precio, a quién venderle, cómo ganar)
//   3. pregunta libre, respondida con los datos relevantes que se le acercan (búsqueda + fichas)
// El modelo nunca ve la base: recibe un paquete de texto acotado y responde con JSON validado.
// Cada respuesta se guarda con el paquete que la originó (mercado.informes), para auditarla.

// ---------------------------------------------------------------------------
// Esquemas de respuesta
// ---------------------------------------------------------------------------

// Sin restricciones numéricas ni de largo en el JSON Schema (no todos los proveedores las aceptan);
// los topes se aplican en `validar`.
export const OportunidadIaSchema = z.object({
  producto: z.string().describe('Nombre del producto tal como figura en los datos'),
  articulo_id: z.number().nullable().describe('El id entre corchetes que acompaña al producto en los datos'),
  prioridad: z.enum(['alta', 'media', 'baja']),
  por_que: z.string().describe('Argumento con cifras: volumen, frecuencia, compradores, concentración, tendencia'),
  precio_de_entrada: z.string().nullable().describe('Rango de precio unitario sugerido para ganar, en pesos sin impuestos, con la unidad'),
  competidores_a_vigilar: z.array(z.string()),
  riesgos: z.string().nullable(),
});

export const InformeMercadoSchema = z.object({
  resumen_ejecutivo: z.string().describe('3 a 5 oraciones para la dirección: dónde está la plata, qué conviene y qué no'),
  oportunidades: z.array(OportunidadIaSchema).describe('Hasta 8, de mayor a menor prioridad'),
  tendencias: z.array(z.string()).describe('Observaciones sobre precios y volúmenes con cifras'),
  competencia: z.array(z.string()).describe('Quiénes dominan qué, concentración, tasa de éxito'),
  compradores_clave: z.array(z.string()).describe('Organismos que más compran y qué'),
  alertas_de_datos: z.array(z.string()).describe('Cobertura, sesgos, datos sintéticos o parciales'),
  preguntas_abiertas: z.array(z.string()).describe('Qué habría que investigar o qué dato falta'),
});
export type InformeMercado = z.infer<typeof InformeMercadoSchema>;

export const AnalisisProductoSchema = z.object({
  veredicto: z.enum(['entrar', 'explorar', 'evitar']),
  confianza: z.number().describe('0 a 100'),
  resumen: z.string().describe('2 a 4 oraciones con el porqué del veredicto'),
  precio_recomendado: z.object({
    desde: z.number().nullable(),
    hasta: z.number().nullable(),
    unidad: z.string(),
    justificacion: z.string(),
  }),
  a_quien_venderle: z.array(z.string()),
  competidores: z.array(z.object({ nombre: z.string(), por_que_importa: z.string() })),
  como_ganar: z.array(z.string()),
  riesgos: z.array(z.string()),
  datos_faltantes: z.array(z.string()),
});
export type AnalisisProducto = z.infer<typeof AnalisisProductoSchema>;

export const RespuestaPreguntaSchema = z.object({
  respuesta: z.string().describe('Respuesta directa a la pregunta, con cifras; párrafos separados por saltos de línea'),
  datos_usados: z.array(z.string()).describe('Qué datos concretos sostienen la respuesta'),
  limitaciones: z.array(z.string()).describe('Qué no se pudo responder con los datos disponibles'),
  sugerencias: z.array(z.string()).describe('Qué mirar a continuación en el tablero'),
});
export type RespuestaPregunta = z.infer<typeof RespuestaPreguntaSchema>;

function jsonSchemaDe(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _omitido, ...resto } = z.toJSONSchema(schema) as Record<string, unknown>;
  return resto;
}

const recortar = (s: string, max: number) => s.trim().slice(0, max);
const lista = (v: unknown, max: number, largo = 400): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => recortar(x, largo)).slice(0, max) : []);

/** Un id que vino como texto ("25", "id 25") o con decimales se lleva a entero; cualquier otra cosa, a null. */
function idEntero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v === 'string') {
    const m = /\d+/.exec(v);
    return m ? Number(m[0]) : null;
  }
  return null;
}

function numeroLaxo(v: unknown): unknown {
  if (typeof v === 'string') {
    const n = Number(v.replace(',', '.').replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : v;
  }
  return v;
}

/** Tolerancias antes de validar: ids y números que el modelo mandó como texto. */
function prenormalizar(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const o = { ...(raw as Record<string, unknown>) };
  if (Array.isArray(o.oportunidades)) o.oportunidades = o.oportunidades.map((x) => (x && typeof x === 'object' ? { ...(x as Record<string, unknown>), articulo_id: idEntero((x as Record<string, unknown>).articulo_id) } : x));
  if ('confianza' in o) o.confianza = numeroLaxo(o.confianza);
  if (o.precio_recomendado && typeof o.precio_recomendado === 'object') {
    const p = o.precio_recomendado as Record<string, unknown>;
    o.precio_recomendado = { ...p, desde: p.desde === null || p.desde === undefined ? null : numeroLaxo(p.desde), hasta: p.hasta === null || p.hasta === undefined ? null : numeroLaxo(p.hasta) };
  }
  return o;
}

export function validarInforme(raw: unknown): InformeMercado {
  const r = InformeMercadoSchema.parse(prenormalizar(raw));
  return {
    resumen_ejecutivo: recortar(r.resumen_ejecutivo, 2000),
    oportunidades: r.oportunidades.slice(0, 8).map((o) => ({
      producto: recortar(o.producto, 200),
      articulo_id: Number.isInteger(o.articulo_id) ? o.articulo_id : null,
      prioridad: o.prioridad,
      por_que: recortar(o.por_que, 800),
      precio_de_entrada: o.precio_de_entrada ? recortar(o.precio_de_entrada, 200) : null,
      competidores_a_vigilar: lista(o.competidores_a_vigilar, 5, 120),
      riesgos: o.riesgos ? recortar(o.riesgos, 500) : null,
    })),
    tendencias: lista(r.tendencias, 6),
    competencia: lista(r.competencia, 6),
    compradores_clave: lista(r.compradores_clave, 6),
    alertas_de_datos: lista(r.alertas_de_datos, 5),
    preguntas_abiertas: lista(r.preguntas_abiertas, 5),
  };
}

export function validarAnalisisProducto(raw: unknown): AnalisisProducto {
  const r = AnalisisProductoSchema.parse(prenormalizar(raw));
  const num = (v: number | null) => (v === null || !Number.isFinite(v) || v < 0 ? null : Math.round(v * 100) / 100);
  return {
    veredicto: r.veredicto,
    confianza: Math.max(0, Math.min(100, Math.round(r.confianza <= 1 ? r.confianza * 100 : r.confianza))),
    resumen: recortar(r.resumen, 1500),
    precio_recomendado: { desde: num(r.precio_recomendado.desde), hasta: num(r.precio_recomendado.hasta), unidad: recortar(r.precio_recomendado.unidad, 40) || 'unidad', justificacion: recortar(r.precio_recomendado.justificacion, 600) },
    a_quien_venderle: lista(r.a_quien_venderle, 5),
    competidores: r.competidores.slice(0, 5).map((c) => ({ nombre: recortar(c.nombre, 120), por_que_importa: recortar(c.por_que_importa, 300) })),
    como_ganar: lista(r.como_ganar, 5),
    riesgos: lista(r.riesgos, 5),
    datos_faltantes: lista(r.datos_faltantes, 4),
  };
}

export function validarRespuesta(raw: unknown): RespuestaPregunta {
  const r = RespuestaPreguntaSchema.parse(raw);
  return { respuesta: recortar(r.respuesta, 4000), datos_usados: lista(r.datos_usados, 8), limitaciones: lista(r.limitaciones, 5), sugerencias: lista(r.sugerencias, 5) };
}

// ---------------------------------------------------------------------------
// Formato de los datos para el modelo
// ---------------------------------------------------------------------------

const fmt0 = new Intl.NumberFormat('es-UY', { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat('es-UY', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt2 = new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function n(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

export function monto(v: unknown): string {
  const x = n(v);
  if (x === null) return 's/d';
  const a = Math.abs(x);
  if (a >= 1e9) return `$ ${fmt1.format(x / 1e9)} mil M`;
  if (a >= 1e6) return `$ ${fmt1.format(x / 1e6)} M`;
  if (a >= 1e4) return `$ ${fmt1.format(x / 1e3)} k`;
  return `$ ${fmt0.format(x)}`;
}

export function precio(v: unknown): string {
  const x = n(v);
  if (x === null) return 's/d';
  return Math.abs(x) < 100 ? `$ ${fmt2.format(x)}` : `$ ${fmt0.format(x)}`;
}

export function pct(v: unknown, signo = false): string {
  const x = n(v);
  if (x === null) return 's/d';
  const p = Math.round(x * 100);
  return `${signo && p > 0 ? '+' : ''}${p} %`;
}

const mes = (v: unknown) => (typeof v === 'string' ? v.slice(0, 7) : 's/d');
const fecha = (v: unknown) => (typeof v === 'string' ? v.slice(0, 10) : 's/d');

function describirRango(r: consultas.Rango): string {
  if (!r.desde && !r.hasta) return 'todo el histórico disponible';
  return `${r.desde ?? 'inicio'} a ${r.hasta ?? 'fin'}`;
}

export interface FiltrosMercado extends consultas.Rango {
  categoria: number | null;
}

export interface DatosMercado {
  resumen: pg.QueryResultRow;
  fuentes: Array<{ fuente: string; llamados: number }>;
  categoria: string | null;
  rango: consultas.Rango;
  oportunidades: pg.QueryResultRow[];
  competencia: Map<number, pg.QueryResultRow>;
  productos: pg.QueryResultRow[];
  proveedores: pg.QueryResultRow[];
  organismos: pg.QueryResultRow[];
}

export async function obtenerDatosMercado(f: FiltrosMercado, pool: pg.Pool = poolDefault): Promise<DatosMercado> {
  const rango: consultas.Rango = { desde: f.desde, hasta: f.hasta };
  const [resumen, fuentes, categoria, oportunidades, productos, proveedores, organismos] = await Promise.all([
    consultas.resumen(pool),
    pool.query<{ fuente: string; llamados: number }>(`SELECT fuente, count(*)::int AS llamados FROM mercado.llamados GROUP BY fuente ORDER BY llamados DESC`),
    f.categoria ? pool.query<{ ruta: string }>(`SELECT ruta FROM mercado.categorias WHERE id = $1`, [f.categoria]) : null,
    consultas.oportunidades(15, f.categoria, pool),
    consultas.productos({ ...rango, q: null, categoria: f.categoria, orden: 'monto', limit: 12, offset: 0 }, pool),
    consultas.proveedores({ ...rango, q: null, articulo: null, orden: 'monto', limit: 10, offset: 0 }, pool),
    consultas.organismos({ ...rango, q: null, limit: 8, offset: 0 }, pool),
  ]);
  const ids = oportunidades.map((o) => o.articulo_id as number);
  const comp = ids.length
    ? await pool.query(
        `SELECT DISTINCT ON (articulo_id) articulo_id, anio, items_con_cuadro, oferentes_promedio, descuento_mediano
           FROM mercado.mv_producto_ofertas_anio WHERE articulo_id = ANY($1::int[]) ORDER BY articulo_id, anio DESC`,
        [ids],
      )
    : { rows: [] as pg.QueryResultRow[] };
  return {
    resumen,
    fuentes: fuentes.rows,
    categoria: categoria?.rows[0]?.ruta ?? null,
    rango,
    oportunidades,
    competencia: new Map(comp.rows.map((c) => [Number(c.articulo_id), c])),
    productos: productos.filas,
    proveedores: proveedores.filas,
    organismos: organismos.filas,
  };
}

interface Limites {
  oportunidades: number;
  productos: number;
  proveedores: number;
  organismos: number;
}

/** Texto compacto y legible para el modelo. Puro: sin acceso a la base. */
export function armarTextoMercado(d: DatosMercado, lim: Limites = { oportunidades: 15, productos: 12, proveedores: 10, organismos: 8 }): string {
  const r = d.resumen;
  const lineas: string[] = [];
  const sinteticos = d.fuentes.some((f) => /demo|sint|prueba|test/i.test(f.fuente));
  lineas.push(`DATOS: histórico de adjudicaciones de ARCE (Compras Estatales, Uruguay). Fuentes: ${d.fuentes.map((f) => `${f.fuente} (${fmt0.format(f.llamados)} llamados)`).join(', ') || 'ninguna'}${sinteticos ? ' — ATENCIÓN: hay datos SINTÉTICOS de demostración, no son compras reales' : ''}.`);
  lineas.push(`Cobertura: ${fmt0.format(n(r.llamados) ?? 0)} llamados, ${fmt0.format(n(r.hechos) ?? 0)} adjudicaciones con fecha (${fmt0.format(n(r.adjudicaciones_excluidas) ?? 0)} excluidas por anuladas/sin fecha), de ${fecha(r.primera_fecha)} a ${fecha(r.ultima_fecha)}; ${pct(r.cobertura_precio)} con precio comparable; ${pct(r.cobertura_monto)} con monto en pesos; ${fmt0.format(n(r.items_sin_articulo) ?? 0)} ítems sin artículo de catálogo; ${fmt0.format(n(r.ofertas) ?? 0)} ofertas de cuadros comparativos.`);
  lineas.push(`Monto total adjudicado: ${monto(r.monto_uyu_total)} (pesos uruguayos sin impuestos). Período analizado: ${describirRango(d.rango)}${d.categoria ? `; categoría: ${d.categoria}` : ''}.`);
  const tipos = (r.tipos_compra as pg.QueryResultRow[]) ?? [];
  const totalTipos = tipos.reduce((s, t) => s + (n(t.monto_uyu) ?? 0), 0);
  if (tipos.length) lineas.push(`Cómo se compra (por monto): ${tipos.map((t) => `${t.tipo_compra} ${pct(totalTipos ? (n(t.monto_uyu) ?? 0) / totalTipos : null)}`).join(', ')}.`);

  lineas.push('', `OPORTUNIDADES (índice 0-100 sobre los últimos 24 meses de datos; componentes 0-100: vol = volumen, frec = frecuencia de llamados, amp = cantidad de organismos compradores, apert = apertura competitiva, 1 − HHI):`);
  if (d.oportunidades.length === 0) lineas.push('- ningún producto llega a 3 adjudicaciones en 24 meses');
  d.oportunidades.slice(0, lim.oportunidades).forEach((o, i) => {
    const c = d.competencia.get(Number(o.articulo_id));
    const comp = c && c.descuento_mediano !== null ? ` · cuadro comparativo ${c.anio}: ${c.items_con_cuadro} ítems, ${fmt1.format(n(c.oferentes_promedio) ?? 0)} oferentes promedio, ganador ${pct(c.descuento_mediano, true)} vs. mediana de perdedoras` : '';
    lineas.push(
      `${i + 1}. [id ${o.articulo_id}] ${o.nombre} (${o.categoria ?? 'sin categoría'}) · índice ${o.indice_oportunidad} (vol ${Math.round((n(o.comp_volumen) ?? 0) * 100)}, frec ${Math.round((n(o.comp_recurrencia) ?? 0) * 100)}, amp ${Math.round((n(o.comp_amplitud) ?? 0) * 100)}, apert ${Math.round((n(o.comp_apertura) ?? 0) * 100)}) · 24 m: ${monto(o.monto_uyu_24m)}, ${o.llamados_24m} llamados, ${o.organismos_24m} organismos, ${o.proveedores_24m} proveedores, HHI ${fmt2.format(n(o.hhi_24m) ?? 0)}${o.lider ? `, líder ${o.lider} ${pct(o.lider_share_24m)}` : ''} · precio mediano 12 m ${precio(o.precio_mediano_uyu_12m)}/${o.unidad} (p25 ${precio(o.precio_p25_uyu_12m)}, p75 ${precio(o.precio_p75_uyu_12m)}), precio interanual ${pct(o.variacion_precio_12m, true)}, monto interanual ${pct(o.variacion_12m, true)}${comp}`,
    );
  });

  lineas.push('', `PRODUCTOS POR MONTO EN EL PERÍODO (${describirRango(d.rango)}):`);
  d.productos.slice(0, lim.productos).forEach((p) => {
    lineas.push(`- [id ${p.articulo_id}] ${p.nombre} (${p.categoria ?? 'sin categoría'}): ${monto(p.monto_uyu)}, ${p.adjudicaciones} adjudicaciones, ${p.organismos} organismos, ${p.proveedores} proveedores, precio mediano ${precio(p.precio_mediano_uyu)}/${p.unidad}${p.lider ? `, líder ${p.lider} ${pct(p.lider_share_24m)} (24 m)` : ''}, monto 12 m ${pct(p.variacion_12m, true)}`);
  });

  lineas.push('', 'PROVEEDORES POR MONTO EN EL PERÍODO:');
  d.proveedores.slice(0, lim.proveedores).forEach((p) => {
    lineas.push(`- ${p.nombre}${p.rut ? ` (RUT ${p.rut})` : ''}: ${monto(p.monto_uyu)}, ${p.adjudicaciones} adjudicaciones, ${p.articulos} productos, ${p.organismos} organismos${p.tasa_exito !== null && p.tasa_exito !== undefined ? `, tasa de éxito ${pct(p.tasa_exito)} en ${p.ofertas_presentadas} ofertas` : ''}${p.principal_articulo ? `, sobre todo ${p.principal_articulo}` : ''}, monto 12 m ${pct(p.variacion_12m, true)}`);
  });

  lineas.push('', 'COMPRADORES POR MONTO EN EL PERÍODO:');
  d.organismos.slice(0, lim.organismos).forEach((o) => {
    lineas.push(`- ${o.inciso}${o.unidad_ejecutora ? ` / ${o.unidad_ejecutora}` : ''}: ${monto(o.monto_uyu)}, ${o.llamados} llamados, ${o.proveedores} proveedores${Array.isArray(o.principales) && o.principales.length ? `; compra sobre todo ${o.principales.join(', ')}` : ''}`);
  });
  return lineas.join('\n');
}

/** Reduce filas hasta que el texto entre en el presupuesto de caracteres del modelo. */
function ajustarAlPresupuesto(armar: (lim: Limites) => string, max: number): string {
  const escalas: Limites[] = [
    { oportunidades: 15, productos: 12, proveedores: 10, organismos: 8 },
    { oportunidades: 12, productos: 8, proveedores: 8, organismos: 6 },
    { oportunidades: 8, productos: 6, proveedores: 6, organismos: 4 },
    { oportunidades: 6, productos: 4, proveedores: 4, organismos: 3 },
    { oportunidades: 4, productos: 3, proveedores: 3, organismos: 2 },
  ];
  let texto = '';
  for (const lim of escalas) {
    texto = armar(lim);
    if (texto.length <= max) return texto;
  }
  return texto.slice(0, max);
}

/** Presupuesto de caracteres para el paquete de datos: amplio con Anthropic, acotado con un modelo local. */
export function presupuestoChars(): number {
  return config.LLM_PROVIDER === 'anthropic' ? 60_000 : Math.max(4_000, Math.floor(config.LLM_MAX_CHARS * 0.6));
}

export function armarTextoProducto(f: pg.QueryResultRow, rango: consultas.Rango, maxChars: number): string {
  const r = f.rango as pg.QueryResultRow;
  const unidad = f.unidad_principal ?? 'unidad';
  const L: string[] = [];
  L.push(`PRODUCTO: [id ${f.articulo_id}] ${f.nombre} (${f.categoria ?? 'sin categoría'})${f.codigo ? `, código ${f.codigo}` : ''}, se compra por ${unidad}. Datos de ${fecha(f.primera_fecha)} a ${fecha(f.ultima_fecha)}. Período analizado: ${describirRango(rango)}. Montos en pesos uruguayos sin impuestos.`);
  L.push(`TOTALES DEL PERÍODO: ${monto(r.monto_uyu)} adjudicados, ${r.adjudicaciones} adjudicaciones en ${r.llamados} llamados, ${r.organismos} organismos compradores, ${r.proveedores} proveedores ganadores, cantidad ${r.cantidad !== null ? fmt0.format(n(r.cantidad) ?? 0) : 's/d'} ${unidad}.`);
  L.push(`PRECIO UNITARIO (${r.con_precio} de ${r.adjudicaciones} con precio comparable): p10 ${precio(r.precio_p10_uyu)}, p25 ${precio(r.precio_p25_uyu)}, mediana ${precio(r.precio_mediano_uyu)}, p75 ${precio(r.precio_p75_uyu)}, p90 ${precio(r.precio_p90_uyu)} por ${unidad}${f.variacion_precio_12m !== null && f.variacion_precio_12m !== undefined ? `; precio mediano últimos 12 m vs. 12 anteriores: ${pct(f.variacion_precio_12m, true)}` : ''}${f.variacion_12m !== null && f.variacion_12m !== undefined ? `; monto últimos 12 m vs. anteriores: ${pct(f.variacion_12m, true)}` : ''}.`);
  if (f.indice_oportunidad !== null && f.indice_oportunidad !== undefined) {
    L.push(`OPORTUNIDAD (últimos 24 meses de datos): índice ${f.indice_oportunidad} de 100 (volumen ${Math.round((n(f.comp_volumen) ?? 0) * 100)}, frecuencia ${Math.round((n(f.comp_recurrencia) ?? 0) * 100)}, amplitud ${Math.round((n(f.comp_amplitud) ?? 0) * 100)}, apertura ${Math.round((n(f.comp_apertura) ?? 0) * 100)}); HHI ${fmt2.format(n(f.hhi_24m) ?? 0)}${f.lider ? `; líder ${f.lider} con ${pct(f.lider_share_24m)} del monto` : ''}; ${f.adjudicaciones_24m} adjudicaciones, ${f.llamados_24m} llamados, ${f.organismos_24m} organismos, ${f.proveedores_24m} proveedores.`);
  } else {
    L.push('OPORTUNIDAD: sin índice (menos de 3 adjudicaciones en los últimos 24 meses de datos).');
  }
  const serie = (f.serie as pg.QueryResultRow[]) ?? [];
  if (serie.length) {
    L.push(`SERIE MENSUAL (mes: adjudicaciones, monto, precio mediano), últimos ${Math.min(18, serie.length)} meses con datos:`);
    L.push(serie.slice(-18).map((s) => `${mes(s.mes)}: ${s.adjudicaciones}, ${monto(s.monto_uyu)}, ${precio(s.precio_mediano_uyu)}`).join(' · '));
  }
  const provs = (f.proveedores as pg.QueryResultRow[]) ?? [];
  L.push(`QUIÉN GANA (cuota del monto del período):`);
  provs.slice(0, 10).forEach((p, i) => L.push(`${i + 1}. ${p.nombre}${p.rut ? ` (RUT ${p.rut})` : ''}: ${pct(p.share)}, ${p.adjudicaciones} adjudicaciones, ${p.organismos} organismos, precio mediano ${precio(p.precio_mediano_uyu)}, última ${fecha(p.ultima_fecha)}`));
  const orgs = (f.organismos as pg.QueryResultRow[]) ?? [];
  L.push(`QUIÉN COMPRA (cuota del monto del período):`);
  orgs.slice(0, 10).forEach((o, i) => L.push(`${i + 1}. ${o.inciso ?? 'sin organismo'}${o.unidad_ejecutora ? ` / ${o.unidad_ejecutora}` : ''}: ${pct(o.share)}, ${o.adjudicaciones} adjudicaciones, última ${fecha(o.ultima_fecha)}`));
  const comp = (f.competencia as pg.QueryResultRow[]) ?? [];
  if (comp.length) {
    L.push('CUADROS COMPARATIVOS POR AÑO (precio ganador vs. mediana de las ofertas perdedoras):');
    comp.forEach((c) => L.push(`- ${c.anio}: ${c.items_con_cuadro} ítems, ${fmt1.format(n(c.oferentes_promedio) ?? 0)} oferentes promedio, ganador ${precio(c.precio_ganador_mediano)} vs. perdedores ${precio(c.precio_perdedor_mediano)} (${pct(c.descuento_mediano, true)})`));
  } else {
    L.push('CUADROS COMPARATIVOS: no hay (no se sabe a qué precio ofertaron los que perdieron).');
  }
  const tipos = (f.tipos_compra as pg.QueryResultRow[]) ?? [];
  const totalTipos = tipos.reduce((s, t) => s + (n(t.adjudicaciones) ?? 0), 0);
  if (tipos.length) L.push(`CÓMO SE COMPRA: ${tipos.map((t) => `${t.tipo_compra} ${pct(totalTipos ? (n(t.adjudicaciones) ?? 0) / totalTipos : null)}`).join(', ')}.`);
  const ultimas = (f.ultimas as pg.QueryResultRow[]) ?? [];
  if (ultimas.length) {
    L.push('ÚLTIMAS ADJUDICACIONES (fecha · comprador · ganador · cantidad · precio unitario · monto):');
    ultimas.slice(0, 12).forEach((a) => L.push(`- ${fecha(a.fecha)} · ${a.inciso ?? 's/d'} · ${a.proveedor} · ${a.cantidad !== null ? fmt0.format(n(a.cantidad) ?? 0) : 's/d'} ${a.unidad} · ${precio(a.precio_base_uyu)} · ${monto(a.monto_uyu)}`));
  }
  const texto = L.join('\n');
  return texto.length > maxChars ? texto.slice(0, maxChars) : texto;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const SYSTEM_ANALISTA = `Sos un analista senior de mercado de compras públicas de Uruguay. Trabajás para una empresa proveedora del Estado que tiene que decidir qué productos vender, a qué precio entrar y contra quién compite. Te dan estadísticas calculadas sobre el histórico de adjudicaciones del portal de ARCE (Compras Estatales): montos en pesos uruguayos sin impuestos, precios unitarios medianos por unidad, cuotas de mercado, concentración (HHI) y un índice de oportunidad de 0 a 100 que combina volumen, frecuencia de llamados, cantidad de organismos compradores y apertura competitiva.

Reglas:
- Basate exclusivamente en los datos que recibís. No inventes cifras, productos, proveedores ni organismos. Si algo no está en los datos, decilo en vez de suponerlo.
- Citá los números que sostienen cada conclusión (montos, cuotas, precios, variaciones, cantidad de compradores).
- Hablá en términos de negocio, concretos y accionables, en español rioplatense neutro, sin relleno ni frases genéricas.
- Un precio mediano alto con muchos oferentes no es lo mismo que un precio alto con un solo ganador: distinguí poder de mercado de simple volumen.
- Las recomendaciones de precio van en pesos uruguayos sin impuestos y por la unidad indicada, y tienen que apoyarse en los percentiles o en los cuadros comparativos.
- Si los datos son sintéticos, parciales o con poca cobertura, advertilo explícitamente.
- Respondé únicamente con el JSON del esquema, en español.`;

function promptInforme(paquete: string): string {
  return `Con los datos de abajo, escribí el informe de mercado para la dirección: dónde está la plata, qué productos conviene atacar (hasta 8, de mayor a menor prioridad, con el id entre corchetes), a qué precio entrar, qué proveedores dominan y qué organismos compran. Marcá en alertas_de_datos cualquier límite de los datos.

${paquete}`;
}

function promptProducto(paquete: string): string {
  return `Evaluá si a la empresa le conviene entrar a vender este producto al Estado. Dá un veredicto (entrar, explorar o evitar) con confianza 0-100, un rango de precio unitario de entrada apoyado en los percentiles y en los cuadros comparativos, a quién venderle primero, quiénes son los competidores que importan y por qué, cómo ganar y qué riesgos hay. Si falta información para decidir, listala en datos_faltantes.

${paquete}`;
}

function promptPregunta(pregunta: string, paquete: string): string {
  return `Respondé la pregunta del usuario usando solo los datos de abajo. Si los datos no alcanzan, decí qué parte no podés responder y por qué.

PREGUNTA: ${pregunta}

${paquete}`;
}

// ---------------------------------------------------------------------------
// Generación y persistencia
// ---------------------------------------------------------------------------

export interface Informe<T> {
  id: number;
  tipo: 'mercado' | 'producto' | 'pregunta';
  clave: string;
  filtros: unknown;
  pregunta: string | null;
  informe: T;
  proveedor: string | null;
  modelo: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  duracion_ms: number | null;
  creado_en: string;
  paquete?: string;
}

interface Opciones {
  pool?: pg.Pool;
  proveedor?: ProveedorLlm;
}

async function guardar<T>(pool: pg.Pool, tipo: Informe<T>['tipo'], clave: string, filtros: unknown, pregunta: string | null, paquete: string, informe: T, meta: MetaLlm): Promise<Informe<T>> {
  const { rows } = await pool.query<Informe<T>>(
    `INSERT INTO mercado.informes (tipo, clave, filtros, pregunta, paquete, informe, proveedor, modelo, prompt_tokens, completion_tokens, duracion_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, tipo, clave, filtros, pregunta, informe, proveedor, modelo, prompt_tokens, completion_tokens, duracion_ms, creado_en`,
    [tipo, clave, JSON.stringify(filtros ?? null), pregunta, paquete, JSON.stringify(informe), meta.proveedor, meta.modelo, meta.prompt_tokens, meta.completion_tokens, meta.duracion_ms],
  );
  return rows[0]!;
}

export async function ultimoInforme<T>(tipo: Informe<T>['tipo'], clave: string, pool: pg.Pool = poolDefault, conPaquete = false): Promise<Informe<T> | null> {
  const { rows } = await pool.query<Informe<T>>(
    `SELECT id, tipo, clave, filtros, pregunta, informe, proveedor, modelo, prompt_tokens, completion_tokens, duracion_ms, creado_en${conPaquete ? ', paquete' : ''}
       FROM mercado.informes WHERE tipo = $1 AND clave = $2 ORDER BY id DESC LIMIT 1`,
    [tipo, clave],
  );
  return rows[0] ?? null;
}

export async function ultimasPreguntas(n = 10, pool: pg.Pool = poolDefault): Promise<Informe<RespuestaPregunta>[]> {
  const { rows } = await pool.query<Informe<RespuestaPregunta>>(
    `SELECT id, tipo, clave, filtros, pregunta, informe, proveedor, modelo, prompt_tokens, completion_tokens, duracion_ms, creado_en
       FROM mercado.informes WHERE tipo = 'pregunta' ORDER BY id DESC LIMIT $1`,
    [n],
  );
  return rows;
}

export function claveMercado(f: FiltrosMercado): string {
  return hashCanonico({ categoria: f.categoria ?? null, desde: f.desde ?? null, hasta: f.hasta ?? null }).slice(0, 32);
}

export function claveProducto(id: number, rango: consultas.Rango): string {
  return `${id}:${hashCanonico({ desde: rango.desde ?? null, hasta: rango.hasta ?? null }).slice(0, 16)}`;
}

export function clavePregunta(pregunta: string): string {
  return hashCanonico(normalizarTexto(pregunta)).slice(0, 32);
}

async function proveedorListo(opciones: Opciones): Promise<ProveedorLlm> {
  const prov = opciones.proveedor ?? (await getProveedor());
  await prov.preparar();
  return prov;
}

export async function generarInformeMercado(f: FiltrosMercado, opciones: Opciones = {}): Promise<Informe<InformeMercado>> {
  const pool = opciones.pool ?? poolDefault;
  const datos = await obtenerDatosMercado(f, pool);
  const paquete = ajustarAlPresupuesto((lim) => armarTextoMercado(datos, lim), presupuestoChars());
  const prov = await proveedorListo(opciones);
  const t0 = Date.now();
  logger.info({ proveedor: prov.nombre, modelo: prov.modelo, chars: paquete.length, filtros: f }, 'IA: generando informe de mercado');
  const r = await prov.generarJson<InformeMercado>({ system: SYSTEM_ANALISTA, prompt: promptInforme(paquete), jsonSchema: jsonSchemaDe(InformeMercadoSchema), validar: validarInforme, maxTokens: 6000 });
  // Los ids que cita el modelo tienen que existir en el paquete; si no, se descartan (sin romper el informe).
  const idsValidos = new Set([...datos.oportunidades, ...datos.productos].map((p) => Number(p.articulo_id)));
  for (const o of r.datos.oportunidades) if (o.articulo_id !== null && !idsValidos.has(o.articulo_id)) o.articulo_id = null;
  const guardado = await guardar(pool, 'mercado', claveMercado(f), f, null, paquete, r.datos, r.meta);
  logger.info({ id: guardado.id, duracion_ms: Date.now() - t0, prompt_tokens: r.meta.prompt_tokens }, 'IA: informe de mercado guardado');
  return guardado;
}

export async function generarAnalisisProducto(id: number, rango: consultas.Rango, opciones: Opciones = {}): Promise<Informe<AnalisisProducto> | null> {
  const pool = opciones.pool ?? poolDefault;
  const ficha = await consultas.producto(id, rango, pool);
  if (!ficha) return null;
  const paquete = armarTextoProducto(ficha, rango, presupuestoChars());
  const prov = await proveedorListo(opciones);
  logger.info({ proveedor: prov.nombre, modelo: prov.modelo, chars: paquete.length, articulo_id: id }, 'IA: analizando producto');
  const r = await prov.generarJson<AnalisisProducto>({ system: SYSTEM_ANALISTA, prompt: promptProducto(paquete), jsonSchema: jsonSchemaDe(AnalisisProductoSchema), validar: validarAnalisisProducto, maxTokens: 4000 });
  // La unidad del precio es la del producto, no la que diga el modelo (a veces pone la moneda).
  r.datos.precio_recomendado.unidad = ficha.unidad_principal ?? 'unidad';
  return guardar(pool, 'producto', claveProducto(id, rango), { articulo_id: id, ...rango }, null, paquete, r.datos, r.meta);
}

const PALABRAS_VACIAS = new Set(['para', 'como', 'cual', 'cuales', 'que', 'quien', 'quienes', 'donde', 'cuando', 'cuanto', 'cuanta', 'cuantos', 'cuantas', 'con', 'sin', 'por', 'del', 'los', 'las', 'una', 'uno', 'unos', 'unas', 'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas', 'mas', 'menos', 'entre', 'sobre', 'desde', 'hasta', 'hay', 'son', 'esta', 'estan', 'tiene', 'tienen', 'precio', 'precios', 'vender', 'vende', 'venden', 'compra', 'compras', 'compran', 'comprar', 'mercado', 'producto', 'productos', 'proveedor', 'proveedores', 'organismo', 'organismos', 'estado', 'conviene', 'entrar', 'entra', 'mejor', 'mejores', 'ultimo', 'ultimos', 'meses', 'anio', 'anios', 'gana', 'ganan', 'ganador', 'quienes', 'cuanto']);

/** Términos de búsqueda a partir de la pregunta: palabras de 4+ letras que no sean conectores. */
export function terminosDe(pregunta: string): string[] {
  const vistos = new Set<string>();
  for (const p of normalizarTexto(pregunta).toLowerCase().split(' ')) {
    if (p.length >= 4 && !PALABRAS_VACIAS.has(p) && !/^\d+$/.test(p)) vistos.add(p);
  }
  return [...vistos].slice(0, 6);
}

export async function responderPregunta(pregunta: string, opciones: Opciones = {}): Promise<Informe<RespuestaPregunta>> {
  const pool = opciones.pool ?? poolDefault;
  const rango: consultas.Rango = { desde: null, hasta: null };
  const terminos = terminosDe(pregunta);
  const encontrados = await Promise.all(terminos.map((t) => consultas.buscar(t, pool)));
  const articulos = new Map<number, string>();
  const proveedores = new Map<number, string>();
  for (const e of encontrados) {
    for (const a of e.articulos.slice(0, 3)) if (articulos.size < 3) articulos.set(Number(a.id), String(a.nombre));
    for (const p of e.proveedores.slice(0, 2)) if (proveedores.size < 2) proveedores.set(Number(p.id), String(p.nombre));
  }
  const presupuesto = presupuestoChars();
  const datos = await obtenerDatosMercado({ categoria: null, desde: null, hasta: null }, pool);
  const partes: string[] = [ajustarAlPresupuesto((lim) => armarTextoMercado(datos, { ...lim, oportunidades: Math.min(lim.oportunidades, 10) }), Math.floor(presupuesto * 0.45))];
  const porFicha = Math.floor((presupuesto * 0.5) / Math.max(1, articulos.size + proveedores.size));
  for (const id of articulos.keys()) {
    const ficha = await consultas.producto(id, rango, pool);
    if (ficha) partes.push('', `FICHA DE PRODUCTO RELACIONADO CON LA PREGUNTA:`, armarTextoProducto(ficha, rango, porFicha));
  }
  for (const id of proveedores.keys()) {
    const p = await consultas.proveedor(id, rango, pool);
    if (p) partes.push('', `FICHA DE PROVEEDOR RELACIONADO CON LA PREGUNTA:`, armarTextoProveedor(p, porFicha));
  }
  const paquete = partes.join('\n');
  const prov = await proveedorListo(opciones);
  logger.info({ proveedor: prov.nombre, modelo: prov.modelo, chars: paquete.length, terminos, articulos: [...articulos.values()], proveedores: [...proveedores.values()] }, 'IA: respondiendo pregunta');
  const r = await prov.generarJson<RespuestaPregunta>({ system: SYSTEM_ANALISTA, prompt: promptPregunta(pregunta, paquete), jsonSchema: jsonSchemaDe(RespuestaPreguntaSchema), validar: validarRespuesta, maxTokens: 3000 });
  return guardar(pool, 'pregunta', clavePregunta(pregunta), { terminos, articulos: [...articulos.keys()], proveedores: [...proveedores.keys()] }, pregunta.trim(), paquete, r.datos, r.meta);
}

// La misma pregunta repetida mientras se está respondiendo comparte la llamada al modelo.
const preguntasEnCurso = new Map<string, Promise<Informe<RespuestaPregunta>>>();

export function responderPreguntaUnaVez(pregunta: string, opciones: Opciones = {}): Promise<Informe<RespuestaPregunta>> {
  const clave = clavePregunta(pregunta);
  let p = preguntasEnCurso.get(clave);
  if (!p) {
    p = responderPregunta(pregunta, opciones).finally(() => preguntasEnCurso.delete(clave));
    preguntasEnCurso.set(clave, p);
  }
  return p;
}

export function preguntaEnCurso(pregunta: string): boolean {
  return preguntasEnCurso.has(clavePregunta(pregunta));
}

export function armarTextoProveedor(p: pg.QueryResultRow, maxChars: number): string {
  const r = p.rango as pg.QueryResultRow;
  const L: string[] = [];
  L.push(`PROVEEDOR: ${p.nombre}${p.rut ? ` (RUT ${p.rut})` : ''}. ${monto(r.monto_uyu)} ganados en ${r.adjudicaciones} adjudicaciones (${r.llamados} llamados), ${r.articulos} productos, ${r.organismos} organismos; de ${fecha(r.primera_fecha)} a ${fecha(r.ultima_fecha)}${p.tasa_exito !== null && p.tasa_exito !== undefined ? `; tasa de éxito ${pct(p.tasa_exito)} en ${p.ofertas_presentadas} ofertas con cuadro comparativo` : ''}${p.variacion_12m !== null && p.variacion_12m !== undefined ? `; monto últimos 12 m ${pct(p.variacion_12m, true)}` : ''}.`);
  const prods = (p.productos as pg.QueryResultRow[]) ?? [];
  if (prods.length) L.push(`QUÉ VENDE (cuota de su monto): ${prods.slice(0, 8).map((x) => `[id ${x.articulo_id}] ${x.nombre} ${pct(x.share)} (${x.adjudicaciones} adj., precio mediano ${precio(x.precio_mediano_uyu)}/${x.unidad})`).join('; ')}.`);
  const orgs = (p.organismos as pg.QueryResultRow[]) ?? [];
  if (orgs.length) L.push(`A QUIÉN LE VENDE: ${orgs.slice(0, 8).map((o) => `${o.inciso ?? 's/d'}${o.unidad_ejecutora ? ` / ${o.unidad_ejecutora}` : ''} ${pct(o.share)}`).join('; ')}.`);
  const comp = (p.competidores as pg.QueryResultRow[]) ?? [];
  if (comp.length) L.push(`CONTRA QUIÉN COMPITE (ganan sus mismos productos): ${comp.slice(0, 8).map((c) => `${c.nombre} (${c.productos_en_comun} productos en común, ${monto(c.monto_uyu)})`).join('; ')}.`);
  const texto = L.join('\n');
  return texto.length > maxChars ? texto.slice(0, maxChars) : texto;
}

// ---------------------------------------------------------------------------
// Trabajos en curso (los análisis con un modelo local pueden tardar minutos)
// ---------------------------------------------------------------------------

interface Trabajo {
  iniciado_en: string;
  promesa: Promise<unknown>;
  error: string | null;
}

const trabajos = new Map<string, Trabajo>();

export function estadoTrabajo(clave: string): { en_curso: boolean; iniciado_en: string | null; error: string | null } {
  const t = trabajos.get(clave);
  return { en_curso: !!t && t.error === null && !terminados.has(clave), iniciado_en: t?.iniciado_en ?? null, error: t?.error ?? null };
}

const terminados = new Set<string>();

/** Lanza el trabajo si no está corriendo; devuelve si se inició. El error queda consultable hasta el próximo intento. */
export function iniciarTrabajo(clave: string, fn: () => Promise<unknown>): boolean {
  const actual = trabajos.get(clave);
  if (actual && actual.error === null && !terminados.has(clave)) return false;
  terminados.delete(clave);
  const trabajo: Trabajo = { iniciado_en: new Date().toISOString(), promesa: Promise.resolve(), error: null };
  trabajo.promesa = fn()
    .then(() => {
      terminados.add(clave);
    })
    .catch((err) => {
      trabajo.error = resumenError(err, 500);
      logger.error({ clave, error: trabajo.error }, 'IA: análisis falló');
    });
  trabajos.set(clave, trabajo);
  return true;
}
