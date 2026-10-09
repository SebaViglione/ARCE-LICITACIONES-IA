import type pg from 'pg';
import { pool, type Queryable } from './pool.js';
import type { Candidato } from '../pipeline/filtro.js';
import type { AclaracionScrape, AdjuntoScrape } from '../pipeline/scraper.js';

// ---------------------------------------------------------------------------
// Llamados
// ---------------------------------------------------------------------------

export async function upsertLlamado(c: Candidato, db: Queryable = pool): Promise<void> {
  await db.query(
    `INSERT INTO llamados (id, titulo, descripcion, fecha_publicacion, hora_publicacion, fecha_apertura, hora_apertura,
                           url_detalle, dias_restantes, urgencia, estado, detectado_en, actualizado_en)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'activo', now(), now())
     ON CONFLICT (id) DO UPDATE SET
       titulo = EXCLUDED.titulo,
       descripcion = EXCLUDED.descripcion,
       fecha_publicacion = EXCLUDED.fecha_publicacion,
       hora_publicacion = EXCLUDED.hora_publicacion,
       fecha_apertura = EXCLUDED.fecha_apertura,
       hora_apertura = EXCLUDED.hora_apertura,
       url_detalle = EXCLUDED.url_detalle,
       dias_restantes = EXCLUDED.dias_restantes,
       urgencia = EXCLUDED.urgencia,
       estado = 'activo',
       actualizado_en = now()`,
    [c.id, c.titulo, c.descripcion, c.fecha_publicacion, c.hora_publicacion, c.fecha_apertura, c.hora_apertura, c.url_detalle, c.dias_restantes, c.urgencia],
  );
}

/** IDs de llamados ya vistos hoy (se evita re-scrapear). */
export async function idsActualizadosHoy(db: Queryable = pool): Promise<Set<string>> {
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM llamados WHERE actualizado_en::date = CURRENT_DATE`);
  return new Set(rows.map((r) => r.id));
}

export async function marcarVencidos(db: Queryable = pool): Promise<number> {
  const r = await db.query(`UPDATE llamados SET estado = 'vencido' WHERE estado = 'activo' AND fecha_apertura < CURRENT_DATE`);
  return r.rowCount ?? 0;
}

export async function archivarAntiguos(dias = 120, db: Queryable = pool): Promise<number> {
  const r = await db.query(
    `UPDATE llamados SET estado = 'archivado' WHERE estado = 'vencido' AND fecha_apertura < CURRENT_DATE - ($1::int * INTERVAL '1 day')`,
    [dias],
  );
  return r.rowCount ?? 0;
}

/** Recalcula dias_restantes/urgencia de los activos (por si el RSS no los trajo hoy). */
export async function refrescarDiasRestantes(db: Queryable = pool): Promise<void> {
  await db.query(`
    UPDATE llamados SET
      dias_restantes = (fecha_apertura - CURRENT_DATE),
      urgencia = CASE
        WHEN fecha_apertura IS NULL THEN 'desconocida'
        WHEN (fecha_apertura - CURRENT_DATE) <= 3 THEN 'urgente'
        WHEN (fecha_apertura - CURRENT_DATE) <= 7 THEN 'próximo'
        WHEN (fecha_apertura - CURRENT_DATE) <= 15 THEN 'atención'
        ELSE 'futuro' END
    WHERE estado = 'activo' AND fecha_apertura IS NOT NULL
      AND dias_restantes IS DISTINCT FROM (fecha_apertura - CURRENT_DATE)`);
}

// ---------------------------------------------------------------------------
// Adjuntos, aclaraciones, ítems
// ---------------------------------------------------------------------------

export async function upsertAdjuntos(llamadoId: string, adjuntos: AdjuntoScrape[], db: Queryable = pool): Promise<number> {
  let n = 0;
  for (const a of adjuntos) {
    if (!a.archivo_url) continue;
    const r = await db.query(
      `INSERT INTO archivos_adjuntos (llamado_id, nombre, tipo, archivo_url, label, actualizado_en)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (llamado_id, archivo_url) DO UPDATE SET
         nombre = EXCLUDED.nombre, tipo = EXCLUDED.tipo, label = EXCLUDED.label, actualizado_en = now()`,
      [llamadoId, a.nombre, a.tipo, a.archivo_url, a.label],
    );
    n += r.rowCount ?? 0;
  }
  return n;
}

export async function upsertAclaraciones(llamadoId: string, aclaraciones: AclaracionScrape[], db: Queryable = pool): Promise<number> {
  let n = 0;
  for (const a of aclaraciones) {
    const r = await db.query(
      `INSERT INTO aclaraciones (id_llamado, fecha, hora, texto, archivo_url, actualizado_en)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (id_llamado, archivo_url) DO UPDATE SET
         fecha = EXCLUDED.fecha, hora = EXCLUDED.hora, texto = EXCLUDED.texto, actualizado_en = now()`,
      [llamadoId, a.fecha, a.hora, a.texto, a.archivo_url],
    );
    n += r.rowCount ?? 0;
  }
  return n;
}

export async function insertItems(llamadoId: string, items: string[], db: Queryable = pool): Promise<number> {
  let n = 0;
  for (const texto of items) {
    if (!texto || typeof texto !== 'string') continue;
    const r = await db.query(`INSERT INTO items_llamado (id_llamado, texto) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [llamadoId, texto]);
    n += r.rowCount ?? 0;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Análisis IA
// ---------------------------------------------------------------------------

export const TIPOS_EXTRAIBLES = ['pdf', 'doc', 'docx', 'rtf', 'odt', 'txt', 'xls', 'xlsx', 'ods', 'csv', 'zip', 'html', 'png', 'jpg', 'tif', 'bmp'];

export interface AdjuntoPendiente {
  llamado_id: string;
  archivo_analizado: string;
  tipo: string;
  archivo_url: string;
  titulo: string;
  fecha_apertura: string | null;
}

/** Adjuntos extraíbles de llamados activos que aún no tienen fila en analisis_ia. */
export async function adjuntosPendientes(limite: number, db: Queryable = pool): Promise<AdjuntoPendiente[]> {
  const { rows } = await db.query<AdjuntoPendiente>(
    `SELECT aa.llamado_id, aa.nombre AS archivo_analizado, aa.tipo, aa.archivo_url, l.titulo, l.fecha_apertura
       FROM archivos_adjuntos aa
       JOIN llamados l ON l.id = aa.llamado_id
       LEFT JOIN analisis_ia ai ON ai.llamado_id = aa.llamado_id AND ai.archivo_analizado = aa.nombre
      WHERE ai.id IS NULL
        AND l.estado = 'activo'
        AND aa.archivo_url IS NOT NULL
        AND aa.tipo = ANY($1::text[])
      ORDER BY l.fecha_apertura ASC NULLS LAST, aa.llamado_id ASC, aa.id ASC
      LIMIT $2`,
    [TIPOS_EXTRAIBLES, limite],
  );
  return rows;
}

export interface ContextoLlamado {
  titulo: string;
  descripcion: string;
  items: string[];
  aclaraciones: string[];
}

export async function contextoLlamado(llamadoId: string, db: Queryable = pool): Promise<ContextoLlamado> {
  const [l, items, acl] = await Promise.all([
    db.query<{ titulo: string | null; descripcion: string | null }>(`SELECT titulo, descripcion FROM llamados WHERE id = $1`, [llamadoId]),
    db.query<{ texto: string | null }>(`SELECT texto FROM items_llamado WHERE id_llamado = $1 ORDER BY id`, [llamadoId]),
    db.query<{ texto: string | null; fecha: string | null }>(
      `SELECT texto, fecha FROM aclaraciones WHERE id_llamado = $1 AND texto IS NOT NULL AND texto <> '' ORDER BY fecha DESC NULLS LAST, hora DESC NULLS LAST`,
      [llamadoId],
    ),
  ]);
  return {
    titulo: l.rows[0]?.titulo ?? '',
    descripcion: l.rows[0]?.descripcion ?? '',
    items: items.rows.map((r) => r.texto ?? '').filter(Boolean),
    aclaraciones: acl.rows.map((r) => (r.fecha ? `[${r.fecha}] ${r.texto}` : r.texto ?? '')).filter(Boolean),
  };
}

export interface LlamadoSinAnalisis {
  llamado_id: string;
  titulo: string;
  fecha_apertura: string | null;
}

/**
 * Llamados activos sin ningún análisis válido (es_relevante no nulo) y sin adjuntos extraíbles pendientes:
 * candidatos al análisis fallback por metadatos.
 */
export async function llamadosSinAnalisis(limite: number, db: Queryable = pool): Promise<LlamadoSinAnalisis[]> {
  const { rows } = await db.query<LlamadoSinAnalisis>(
    `SELECT l.id AS llamado_id, l.titulo, l.fecha_apertura
       FROM llamados l
      WHERE l.estado = 'activo'
        AND NOT EXISTS (SELECT 1 FROM analisis_ia ai WHERE ai.llamado_id = l.id AND ai.es_relevante IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1 FROM archivos_adjuntos aa
           LEFT JOIN analisis_ia ai2 ON ai2.llamado_id = aa.llamado_id AND ai2.archivo_analizado = aa.nombre
          WHERE aa.llamado_id = l.id AND ai2.id IS NULL AND aa.archivo_url IS NOT NULL AND aa.tipo = ANY($1::text[]))
      ORDER BY l.fecha_apertura ASC NULLS LAST
      LIMIT $2`,
    [TIPOS_EXTRAIBLES, limite],
  );
  return rows;
}

export interface AnalisisParaGuardar {
  llamado_id: string;
  archivo_analizado: string;
  descripcion_llamado: string | null;
  es_relevante: boolean;
  confianza: number;
  razon: string | null;
  materiales_detectados: string[];
  resumen_trabajo: string | null;
  ubicacion_obra: string | null;
  requiere_visita: boolean;
  ubicacion_visita: string | null;
  fecha_visita_especifica: string | null;
  coordina_visita: boolean;
  contacto_visita_nombre: string | null;
  contacto_visita_telefono: string | null;
  contacto_visita_correo: string | null;
  formularios_requeridos: Array<{ nombre: string; obligatorio: boolean; seccion: string | null }>;
  errores_extraccion: string | null;
  modelo: string;
  proveedor: string;
  rubro: string;
  prompt_tokens: number | null;
  duracion_ms: number | null;
  chars_enviados: number | null;
}

export async function guardarAnalisis(a: AnalisisParaGuardar, db: Queryable = pool): Promise<void> {
  await db.query(
    `INSERT INTO analisis_ia (
       llamado_id, archivo_analizado, descripcion_llamado, es_relevante, confianza, razon, materiales_detectados,
       resumen_trabajo, ubicacion_obra, requiere_visita, ubicacion_visita, fecha_visita_especifica, coordina_visita,
       contacto_visita_nombre, contacto_visita_telefono, contacto_visita_correo, formularios_requeridos,
       errores_extraccion, modelo, proveedor, rubro, prompt_tokens, duracion_ms, chars_enviados, analizado_en)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18, $19, $20, $21, $22, $23, $24, now())
     ON CONFLICT (llamado_id, archivo_analizado) DO UPDATE SET
       descripcion_llamado = EXCLUDED.descripcion_llamado,
       es_relevante = EXCLUDED.es_relevante,
       confianza = EXCLUDED.confianza,
       razon = EXCLUDED.razon,
       materiales_detectados = EXCLUDED.materiales_detectados,
       resumen_trabajo = EXCLUDED.resumen_trabajo,
       ubicacion_obra = EXCLUDED.ubicacion_obra,
       requiere_visita = EXCLUDED.requiere_visita,
       ubicacion_visita = EXCLUDED.ubicacion_visita,
       fecha_visita_especifica = EXCLUDED.fecha_visita_especifica,
       coordina_visita = EXCLUDED.coordina_visita,
       contacto_visita_nombre = EXCLUDED.contacto_visita_nombre,
       contacto_visita_telefono = EXCLUDED.contacto_visita_telefono,
       contacto_visita_correo = EXCLUDED.contacto_visita_correo,
       formularios_requeridos = EXCLUDED.formularios_requeridos,
       errores_extraccion = EXCLUDED.errores_extraccion,
       modelo = EXCLUDED.modelo,
       proveedor = EXCLUDED.proveedor,
       rubro = EXCLUDED.rubro,
       prompt_tokens = EXCLUDED.prompt_tokens,
       duracion_ms = EXCLUDED.duracion_ms,
       chars_enviados = EXCLUDED.chars_enviados,
       analizado_en = now()`,
    [
      a.llamado_id, a.archivo_analizado, a.descripcion_llamado, a.es_relevante, a.confianza, a.razon,
      JSON.stringify(a.materiales_detectados), a.resumen_trabajo, a.ubicacion_obra, a.requiere_visita, a.ubicacion_visita,
      a.fecha_visita_especifica, a.coordina_visita, a.contacto_visita_nombre, a.contacto_visita_telefono, a.contacto_visita_correo,
      JSON.stringify(a.formularios_requeridos), a.errores_extraccion, a.modelo, a.proveedor, a.rubro, a.prompt_tokens, a.duracion_ms, a.chars_enviados,
    ],
  );
}

/** Deja constancia de que un adjunto no pudo extraerse (evita reintentarlo en cada corrida). */
export async function guardarErrorExtraccion(llamadoId: string, archivo: string, error: string, rubro: string, db: Queryable = pool): Promise<void> {
  await db.query(
    `INSERT INTO analisis_ia (llamado_id, archivo_analizado, errores_extraccion, rubro, analizado_en)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (llamado_id, archivo_analizado) DO UPDATE SET errores_extraccion = EXCLUDED.errores_extraccion, analizado_en = now()`,
    [llamadoId, archivo, error.slice(0, 2000), rubro],
  );
}

// ---------------------------------------------------------------------------
// Corridas del pipeline
// ---------------------------------------------------------------------------

export interface ResumenCorrida {
  rss_total: number;
  candidatos: number;
  scrapeados: number;
  analizados: number;
  errores: number;
  detalle: Record<string, unknown>;
}

export async function iniciarCorrida(origen: string, db: Queryable = pool): Promise<number> {
  const { rows } = await db.query<{ id: number }>(`INSERT INTO corridas_pipeline (origen) VALUES ($1) RETURNING id`, [origen]);
  return rows[0]!.id;
}

export async function finalizarCorrida(id: number, estado: 'ok' | 'error', resumen: Partial<ResumenCorrida>, db: Queryable = pool): Promise<void> {
  await db.query(
    `UPDATE corridas_pipeline SET finalizada_en = now(), estado = $2, rss_total = $3, candidatos = $4, scrapeados = $5,
            analizados = $6, errores = $7, detalle = $8::jsonb WHERE id = $1`,
    [id, estado, resumen.rss_total ?? null, resumen.candidatos ?? null, resumen.scrapeados ?? null, resumen.analizados ?? null, resumen.errores ?? null, JSON.stringify(resumen.detalle ?? {})],
  );
}

export async function ultimasCorridas(n = 5, db: Queryable = pool): Promise<pg.QueryResultRow[]> {
  const { rows } = await db.query(`SELECT * FROM corridas_pipeline ORDER BY id DESC LIMIT $1`, [n]);
  return rows;
}
