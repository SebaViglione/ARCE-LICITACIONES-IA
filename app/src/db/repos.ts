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

// ---------------------------------------------------------------------------
// API: listados, detalle, feedback y métricas
// ---------------------------------------------------------------------------

export interface FiltroLlamados {
  estado: 'activo' | 'vencido' | 'archivado' | 'todos';
  rubro: string | null;
  limit: number;
  offset: number;
}

export async function listarLlamados(f: FiltroLlamados, db: Queryable = pool): Promise<pg.QueryResultRow[]> {
  const { rows } = await db.query(
    `SELECT l.*, fu.es_relevante_real, fu.estado_seguimiento
       FROM v_llamados_dashboard l
       LEFT JOIN feedback_usuario fu ON fu.llamado_id = l.llamado_id
      WHERE ($1 = 'todos' OR l.estado = $1)
        AND ($2::text IS NULL OR l.rubro = $2)
      ORDER BY l.dias_restantes ASC NULLS LAST, l.fecha_apertura ASC NULLS LAST, l.llamado_id
      LIMIT $3 OFFSET $4`,
    [f.estado, f.rubro, f.limit, f.offset],
  );
  return rows;
}

export async function detalleLlamado(id: string, db: Queryable = pool): Promise<{ llamado: pg.QueryResultRow; adjuntos: pg.QueryResultRow[]; aclaraciones: pg.QueryResultRow[]; analisis: pg.QueryResultRow[]; items: string[] } | null> {
  const [l, adj, acl, an, it] = await Promise.all([
    db.query(
      `SELECT l.*, fu.es_relevante_real, fu.estado_seguimiento, fu.comentario, fu.ia_es_relevante, fu.ia_confianza, fu.ia_razon, fu.actualizado_en AS feedback_actualizado_en
         FROM v_llamados_dashboard l LEFT JOIN feedback_usuario fu ON fu.llamado_id = l.llamado_id
        WHERE l.llamado_id = $1`,
      [id],
    ),
    db.query(`SELECT id, nombre, tipo, archivo_url, label FROM archivos_adjuntos WHERE llamado_id = $1 ORDER BY id`, [id]),
    db.query(`SELECT id, fecha, hora, texto, archivo_url FROM aclaraciones WHERE id_llamado = $1 ORDER BY fecha DESC NULLS LAST, hora DESC NULLS LAST, id DESC`, [id]),
    db.query(
      `SELECT id, archivo_analizado, es_relevante, confianza, descripcion_llamado, errores_extraccion, modelo, proveedor, rubro, prompt_tokens, duracion_ms, chars_enviados, analizado_en
         FROM analisis_ia WHERE llamado_id = $1 ORDER BY (es_relevante IS NULL), confianza DESC NULLS LAST, analizado_en DESC`,
      [id],
    ),
    db.query<{ texto: string }>(`SELECT texto FROM items_llamado WHERE id_llamado = $1 ORDER BY id`, [id]),
  ]);
  if (l.rows.length === 0) return null;
  return { llamado: l.rows[0]!, adjuntos: adj.rows, aclaraciones: acl.rows, analisis: an.rows, items: it.rows.map((r) => r.texto) };
}

export interface FeedbackEntrada {
  llamado_id: string;
  es_relevante_real: boolean | null;
  estado_seguimiento: string;
  comentario: string | null;
  ia_es_relevante: boolean | null;
  ia_confianza: number | null;
  ia_razon: string | null;
}

export async function mejorAnalisis(llamadoId: string, db: Queryable = pool): Promise<{ es_relevante: boolean; confianza: number | null; razon: string | null } | null> {
  const { rows } = await db.query<{ es_relevante: boolean; confianza: number | null; razon: string | null }>(
    `SELECT es_relevante, confianza, razon FROM v_llamados_dashboard WHERE llamado_id = $1 AND es_relevante IS NOT NULL`,
    [llamadoId],
  );
  return rows[0] ?? null;
}

export async function upsertFeedback(f: FeedbackEntrada, db: Queryable = pool): Promise<pg.QueryResultRow> {
  const { rows } = await db.query(
    `INSERT INTO feedback_usuario (llamado_id, es_relevante_real, estado_seguimiento, comentario, ia_es_relevante, ia_confianza, ia_razon, actualizado_en)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (llamado_id) DO UPDATE SET
       es_relevante_real = EXCLUDED.es_relevante_real,
       estado_seguimiento = EXCLUDED.estado_seguimiento,
       comentario = EXCLUDED.comentario,
       ia_es_relevante = COALESCE(EXCLUDED.ia_es_relevante, feedback_usuario.ia_es_relevante),
       ia_confianza = COALESCE(EXCLUDED.ia_confianza, feedback_usuario.ia_confianza),
       ia_razon = COALESCE(EXCLUDED.ia_razon, feedback_usuario.ia_razon),
       actualizado_en = now()
     RETURNING *`,
    [f.llamado_id, f.es_relevante_real, f.estado_seguimiento, f.comentario, f.ia_es_relevante, f.ia_confianza, f.ia_razon],
  );
  return rows[0]!;
}

export interface Metricas {
  revisados: number;
  matriz: { tp: number; fp: number; fn: number; tn: number };
  precision: number | null;
  recall: number | null;
  f1: number | null;
  exactitud: number | null;
  totales: { llamados_activos: number; con_analisis: number; ia_relevantes: number; adjuntos_pendientes: number; extraccion_fallida: number };
  por_modelo: Array<{ modelo: string | null; proveedor: string | null; analisis: number; relevantes: number; confianza_promedio: number | null; duracion_promedio_ms: number | null; prompt_tokens_promedio: number | null }>;
  por_estado_seguimiento: Record<string, number>;
}

export async function metricas(db: Queryable = pool): Promise<Metricas> {
  const [m, t, pm, es] = await Promise.all([
    db.query<{ tp: string; fp: string; fn: string; tn: string; revisados: string }>(
      `SELECT count(*) FILTER (WHERE ia_es_relevante AND es_relevante_real) AS tp,
              count(*) FILTER (WHERE ia_es_relevante AND NOT es_relevante_real) AS fp,
              count(*) FILTER (WHERE NOT ia_es_relevante AND es_relevante_real) AS fn,
              count(*) FILTER (WHERE NOT ia_es_relevante AND NOT es_relevante_real) AS tn,
              count(*) AS revisados
         FROM feedback_usuario WHERE es_relevante_real IS NOT NULL AND ia_es_relevante IS NOT NULL`,
    ),
    db.query<{ llamados_activos: string; con_analisis: string; ia_relevantes: string; adjuntos_pendientes: string; extraccion_fallida: string }>(
      `SELECT (SELECT count(*) FROM llamados WHERE estado = 'activo') AS llamados_activos,
              (SELECT count(*) FROM v_llamados_dashboard WHERE estado = 'activo' AND es_relevante IS NOT NULL) AS con_analisis,
              (SELECT count(*) FROM v_llamados_dashboard WHERE estado = 'activo' AND es_relevante) AS ia_relevantes,
              (SELECT count(*) FROM archivos_adjuntos aa JOIN llamados l ON l.id = aa.llamado_id
                 LEFT JOIN analisis_ia ai ON ai.llamado_id = aa.llamado_id AND ai.archivo_analizado = aa.nombre
                WHERE ai.id IS NULL AND l.estado = 'activo' AND aa.tipo = ANY($1::text[])) AS adjuntos_pendientes,
              (SELECT count(*) FROM analisis_ia WHERE es_relevante IS NULL AND errores_extraccion IS NOT NULL) AS extraccion_fallida`,
      [TIPOS_EXTRAIBLES],
    ),
    db.query<{ modelo: string | null; proveedor: string | null; analisis: string; relevantes: string; confianza_promedio: string | null; duracion_promedio_ms: string | null; prompt_tokens_promedio: string | null }>(
      `SELECT modelo, proveedor, count(*) AS analisis, count(*) FILTER (WHERE es_relevante) AS relevantes,
              round(avg(confianza), 1) AS confianza_promedio, round(avg(duracion_ms)) AS duracion_promedio_ms, round(avg(prompt_tokens)) AS prompt_tokens_promedio
         FROM analisis_ia WHERE es_relevante IS NOT NULL GROUP BY modelo, proveedor ORDER BY analisis DESC`,
    ),
    db.query<{ estado_seguimiento: string; n: string }>(`SELECT estado_seguimiento, count(*) AS n FROM feedback_usuario GROUP BY 1`),
  ]);
  const r = m.rows[0]!;
  const tp = Number(r.tp), fp = Number(r.fp), fn = Number(r.fn), tn = Number(r.tn);
  const div = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null);
  const precision = div(tp, tp + fp);
  const recall = div(tp, tp + fn);
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? Math.round(((2 * precision * recall) / (precision + recall)) * 1000) / 1000 : null;
  const tot = t.rows[0]!;
  return {
    revisados: Number(r.revisados),
    matriz: { tp, fp, fn, tn },
    precision,
    recall,
    f1,
    exactitud: div(tp + tn, tp + fp + fn + tn),
    totales: {
      llamados_activos: Number(tot.llamados_activos),
      con_analisis: Number(tot.con_analisis),
      ia_relevantes: Number(tot.ia_relevantes),
      adjuntos_pendientes: Number(tot.adjuntos_pendientes),
      extraccion_fallida: Number(tot.extraccion_fallida),
    },
    por_modelo: pm.rows.map((x) => ({
      modelo: x.modelo,
      proveedor: x.proveedor,
      analisis: Number(x.analisis),
      relevantes: Number(x.relevantes),
      confianza_promedio: x.confianza_promedio === null ? null : Number(x.confianza_promedio),
      duracion_promedio_ms: x.duracion_promedio_ms === null ? null : Number(x.duracion_promedio_ms),
      prompt_tokens_promedio: x.prompt_tokens_promedio === null ? null : Number(x.prompt_tokens_promedio),
    })),
    por_estado_seguimiento: Object.fromEntries(es.rows.map((x) => [x.estado_seguimiento, Number(x.n)])),
  };
}
