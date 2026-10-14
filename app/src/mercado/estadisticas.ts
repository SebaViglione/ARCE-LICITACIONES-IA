import type pg from 'pg';
import { config } from '../config.js';
import { pool as poolDefault } from '../db/pool.js';
import { logger } from '../logger.js';

// Refresco de las vistas materializadas del esquema mercado. Las estadísticas "salen solas":
// cada lote de ingesta programa un refresco (con debounce, por si llegan varios lotes seguidos),
// además del refresco nocturno por cron y del manual por API.

/** Orden de dependencia: mv_hechos y mv_ofertas alimentan al resto. */
export const VISTAS = ['mv_hechos', 'mv_ofertas', 'mv_mes', 'mv_producto_mes', 'mv_proveedor_mes', 'mv_producto_ofertas_anio', 'mv_productos', 'mv_proveedores'] as const;

export interface Refresco {
  id: number;
  origen: string;
  iniciado_en: string;
  finalizado_en: string | null;
  estado: 'en_curso' | 'ok' | 'error';
  duracion_ms: number | null;
  detalle: Record<string, number> | null;
  error: string | null;
}

interface Opciones {
  pool?: pg.Pool;
  /** CONCURRENTLY no bloquea las lecturas pero es más lento en cargas masivas; false para la carga inicial. */
  concurrente?: boolean;
}

let enCurso: Promise<Refresco> | null = null;
let pendiente: { origen: string; opciones: Opciones } | null = null;
let timer: NodeJS.Timeout | null = null;

export function refrescoEnCurso(): boolean {
  return enCurso !== null;
}

async function ejecutar(origen: string, opciones: Opciones): Promise<Refresco> {
  const pool = opciones.pool ?? poolDefault;
  const concurrente = opciones.concurrente ?? true;
  const inicio = Date.now();
  const { rows } = await pool.query<{ id: number }>('INSERT INTO mercado.refrescos (origen) VALUES ($1) RETURNING id', [origen]);
  const id = rows[0]!.id;
  const detalle: Record<string, number> = {};
  logger.info({ origen, concurrente }, 'refrescando estadísticas de mercado');
  try {
    for (const vista of VISTAS) {
      const t = Date.now();
      // Nombres fijos de la lista VISTAS, nunca del usuario.
      await pool.query(`REFRESH MATERIALIZED VIEW ${concurrente ? 'CONCURRENTLY ' : ''}mercado.${vista}`);
      detalle[vista] = Date.now() - t;
    }
    const duracion = Date.now() - inicio;
    const r = await pool.query<Refresco>(
      `UPDATE mercado.refrescos SET finalizado_en = now(), estado = 'ok', duracion_ms = $2, detalle = $3 WHERE id = $1 RETURNING *`,
      [id, duracion, JSON.stringify(detalle)],
    );
    logger.info({ origen, duracion_ms: duracion, detalle }, 'estadísticas de mercado al día');
    return r.rows[0]!;
  } catch (err) {
    const mensaje = (err as Error).message;
    const r = await pool.query<Refresco>(
      `UPDATE mercado.refrescos SET finalizado_en = now(), estado = 'error', duracion_ms = $2, detalle = $3, error = $4 WHERE id = $1 RETURNING *`,
      [id, Date.now() - inicio, JSON.stringify(detalle), mensaje],
    );
    logger.error({ origen, err }, 'falló el refresco de estadísticas de mercado');
    return r.rows[0]!;
  }
}

/** Refresca todas las vistas. Si ya hay un refresco en curso, espera a que termine y vuelve a correr. */
export function refrescarEstadisticas(origen: string, opciones: Opciones = {}): Promise<Refresco> {
  if (enCurso) {
    pendiente = { origen, opciones };
    return enCurso;
  }
  enCurso = ejecutar(origen, opciones).finally(() => {
    enCurso = null;
    if (pendiente) {
      const p = pendiente;
      pendiente = null;
      void refrescarEstadisticas(p.origen, p.opciones);
    }
  });
  return enCurso;
}

/** Refresco diferido: varios lotes seguidos disparan un solo refresco al final. */
export function programarRefresco(origen: string, opciones: Opciones = {}, retrasoMs = config.MERCADO_REFRESCO_DEBOUNCE_MS): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    refrescarEstadisticas(origen, opciones).catch((err) => logger.error({ err }, 'refresco programado falló'));
  }, retrasoMs);
  timer.unref();
}

export function cancelarRefrescoProgramado(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

export async function ultimoRefresco(pool: pg.Pool = poolDefault): Promise<Refresco | null> {
  const { rows } = await pool.query<Refresco>(`SELECT * FROM mercado.refrescos ORDER BY id DESC LIMIT 1`);
  return rows[0] ?? null;
}

export async function ultimosRefrescos(n = 10, pool: pg.Pool = poolDefault): Promise<Refresco[]> {
  const { rows } = await pool.query<Refresco>(`SELECT * FROM mercado.refrescos ORDER BY id DESC LIMIT $1`, [n]);
  return rows;
}
