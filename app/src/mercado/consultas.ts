import type pg from 'pg';
import { pool as poolDefault } from '../db/pool.js';

// Consultas de estadísticas de mercado sobre las vistas materializadas (ver migrations/004_mercado.sql).
// Todo recibe un rango de meses opcional ('AAAA-MM'); sin rango, todo el histórico.

export interface Rango {
  desde: string | null; // 'AAAA-MM'
  hasta: string | null; // 'AAAA-MM' inclusive
}

/** Límites como fechas: [desde-01, primer día del mes siguiente a hasta). */
export function limitesRango(r: Rango): { desde: string | null; hasta: string | null } {
  const desde = r.desde ? `${r.desde}-01` : null;
  let hasta: string | null = null;
  if (r.hasta) {
    const [a, m] = r.hasta.split('-').map(Number) as [number, number];
    const siguiente = new Date(Date.UTC(a, m, 1)); // mes es 1-12 → índice del mes siguiente
    hasta = siguiente.toISOString().slice(0, 10);
  }
  return { desde, hasta };
}

const FILTRO_RANGO = `($1::date IS NULL OR h.fecha >= $1) AND ($2::date IS NULL OR h.fecha < $2)`;

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** pg devuelve numeric/bigint como texto: se convierten las columnas numéricas conocidas. */
function numerico<T extends pg.QueryResultRow>(row: T, claves: string[]): T {
  const r: Record<string, unknown> = { ...row };
  for (const k of claves) if (k in r) r[k] = num(r[k]);
  return r as T;
}

const CLAVES_NUM = [
  'adjudicaciones', 'llamados', 'organismos', 'proveedores', 'articulos', 'cantidad', 'monto_uyu', 'con_monto', 'con_precio',
  'precio_mediano_uyu', 'precio_min_uyu', 'precio_max_uyu', 'precio_p25_uyu', 'precio_p75_uyu', 'precio_p10_uyu', 'precio_p90_uyu',
  'monto_uyu_12m', 'monto_uyu_12m_previo', 'monto_uyu_24m', 'adjudicaciones_24m', 'llamados_24m', 'organismos_24m', 'proveedores_24m',
  'cobertura_precio', 'precio_mediano_uyu_12m', 'precio_p25_uyu_12m', 'precio_p75_uyu_12m', 'precio_mediano_uyu_12m_previo',
  'hhi_24m', 'lider_share_24m', 'comp_volumen', 'comp_recurrencia', 'comp_amplitud', 'comp_apertura', 'indice_oportunidad',
  'variacion_12m', 'variacion_precio_12m', 'share', 'total', 'ofertas_presentadas', 'ofertas_ganadas', 'tasa_exito',
  'principal_monto_uyu', 'items_con_cuadro', 'oferentes_promedio', 'precio_ganador_mediano', 'precio_perdedor_mediano', 'descuento_mediano',
  'productos_en_comun', 'precio_unitario', 'precio_base_uyu', 'cotizacion', 'llamados_adjudicados', 'items', 'items_sin_articulo',
  'ofertas', 'cotizaciones', 'monto_uyu_total', 'cobertura_monto', 'hechos', 'adjudicaciones_excluidas', 'productos', 'con_cotizacion',
];

// ---------------------------------------------------------------------------
// Panorama
// ---------------------------------------------------------------------------

export async function resumen(pool: pg.Pool = poolDefault): Promise<pg.QueryResultRow> {
  const [tot, hechos, meses, monedas, estados, tipos, ultimaIngesta, ultimoRefresco] = await Promise.all([
    pool.query(`
      SELECT (SELECT count(*) FROM mercado.llamados)                              AS llamados,
             (SELECT count(*) FROM mercado.llamados WHERE estado = 'adjudicado')  AS llamados_adjudicados,
             (SELECT count(*) FROM mercado.adjudicaciones)                        AS adjudicaciones,
             (SELECT count(*) FROM mercado.items)                                 AS items,
             (SELECT count(*) FROM mercado.items WHERE articulo_id IS NULL)       AS items_sin_articulo,
             (SELECT count(*) FROM mercado.articulos)                             AS articulos,
             (SELECT count(*) FROM mercado.proveedores)                           AS proveedores,
             (SELECT count(*) FROM mercado.organismos)                            AS organismos,
             (SELECT count(*) FROM mercado.ofertas)                               AS ofertas,
             (SELECT count(*) FROM mercado.cotizaciones)                          AS cotizaciones`),
    pool.query(`
      SELECT count(*)                                         AS hechos,
             sum(monto_uyu)                                   AS monto_uyu_total,
             count(monto_uyu)::numeric / NULLIF(count(*), 0)  AS cobertura_monto,
             count(precio_base_uyu)::numeric / NULLIF(count(*), 0) AS cobertura_precio,
             count(*) FILTER (WHERE con_cotizacion)           AS con_cotizacion,
             min(fecha)                                       AS primera_fecha,
             max(fecha)                                       AS ultima_fecha,
             count(DISTINCT articulo_id)                      AS productos
        FROM mercado.mv_hechos h`),
    pool.query(`SELECT mes, adjudicaciones, llamados, organismos, proveedores, articulos, monto_uyu FROM mercado.mv_mes ORDER BY mes`),
    pool.query(`SELECT moneda, count(*) AS adjudicaciones FROM mercado.adjudicaciones GROUP BY moneda ORDER BY adjudicaciones DESC`),
    pool.query(`SELECT estado, count(*) AS llamados FROM mercado.llamados GROUP BY estado ORDER BY llamados DESC`),
    pool.query(`SELECT tipo_compra, count(*) AS adjudicaciones, sum(monto_uyu) AS monto_uyu FROM mercado.mv_hechos GROUP BY tipo_compra ORDER BY monto_uyu DESC NULLS LAST`),
    pool.query(`SELECT id, tipo, fuente, recibido_en, finalizado_en, recibidos, insertados, actualizados, sin_cambios, rechazados FROM mercado.lotes ORDER BY id DESC LIMIT 1`),
    pool.query(`SELECT id, origen, iniciado_en, finalizado_en, estado, duracion_ms FROM mercado.refrescos WHERE estado <> 'en_curso' ORDER BY id DESC LIMIT 1`),
  ]);
  const h = hechos.rows[0]!;
  return {
    ...numerico(tot.rows[0]!, CLAVES_NUM),
    ...numerico(h, CLAVES_NUM),
    // Adjudicaciones que no entran en las estadísticas: llamados anulados/sin efecto o sin ninguna fecha
    adjudicaciones_excluidas: num(tot.rows[0]!.adjudicaciones)! - num(h.hechos)!,
    por_mes: meses.rows.map((r) => numerico(r, CLAVES_NUM)),
    monedas: monedas.rows.map((r) => numerico(r, CLAVES_NUM)),
    estados: estados.rows.map((r) => numerico(r, CLAVES_NUM)),
    tipos_compra: tipos.rows.map((r) => numerico(r, CLAVES_NUM)),
    ultima_ingesta: ultimaIngesta.rows[0] ?? null,
    ultimo_refresco: ultimoRefresco.rows[0] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Productos
// ---------------------------------------------------------------------------

export type OrdenProductos = 'monto' | 'adjudicaciones' | 'organismos' | 'oportunidad' | 'crecimiento' | 'precio';

const ORDEN_PRODUCTOS: Record<OrdenProductos, string> = {
  monto: 'monto_uyu DESC NULLS LAST',
  adjudicaciones: 'adjudicaciones DESC',
  organismos: 'organismos DESC, monto_uyu DESC NULLS LAST',
  oportunidad: 'indice_oportunidad DESC NULLS LAST, monto_uyu DESC NULLS LAST',
  crecimiento: 'variacion_12m DESC NULLS LAST',
  precio: 'precio_mediano_uyu DESC NULLS LAST',
};

export interface FiltroProductos extends Rango {
  q: string | null;
  categoria: number | null;
  orden: OrdenProductos;
  limit: number;
  offset: number;
}

export async function productos(f: FiltroProductos, pool: pg.Pool = poolDefault): Promise<{ total: number; filas: pg.QueryResultRow[] }> {
  const { desde, hasta } = limitesRango(f);
  const { rows } = await pool.query(
    `SELECT h.articulo_id, ar.nombre, ar.codigo, ca.ruta AS categoria, ca.raiz_id AS categoria_raiz_id, p.unidad_principal AS unidad,
            count(*)                                   AS adjudicaciones,
            count(DISTINCT h.llamado_id)               AS llamados,
            count(DISTINCT h.organismo_id)             AS organismos,
            count(DISTINCT h.proveedor_id)             AS proveedores,
            sum(h.monto_uyu)                           AS monto_uyu,
            sum(h.cantidad) FILTER (WHERE h.unidad = p.unidad_principal) AS cantidad,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY h.precio_base_uyu) FILTER (WHERE h.unidad = p.unidad_principal) AS precio_mediano_uyu,
            max(h.fecha)                               AS ultima_fecha,
            p.lider_proveedor_id, pl.nombre AS lider, p.lider_share_24m, p.hhi_24m, p.indice_oportunidad,
            p.monto_uyu_12m, p.monto_uyu_12m_previo, p.variacion_12m, p.variacion_precio_12m, p.precio_mediano_uyu_12m,
            count(*) OVER () AS total
       FROM mercado.mv_hechos h
       JOIN mercado.mv_productos p ON p.articulo_id = h.articulo_id
       JOIN mercado.articulos ar ON ar.id = h.articulo_id
       LEFT JOIN mercado.categorias ca ON ca.id = ar.categoria_id
       LEFT JOIN mercado.proveedores pl ON pl.id = p.lider_proveedor_id
      WHERE ${FILTRO_RANGO}
        AND ($3::text IS NULL OR ar.nombre ILIKE '%' || $3 || '%' OR ar.codigo = $3 OR ca.ruta ILIKE '%' || $3 || '%')
        AND ($4::int IS NULL OR ca.raiz_id = $4 OR ca.id = $4)
      GROUP BY h.articulo_id, ar.nombre, ar.codigo, ca.ruta, ca.raiz_id, p.unidad_principal, p.lider_proveedor_id, pl.nombre,
               p.lider_share_24m, p.hhi_24m, p.indice_oportunidad, p.monto_uyu_12m, p.monto_uyu_12m_previo, p.variacion_12m, p.variacion_precio_12m, p.precio_mediano_uyu_12m
      ORDER BY ${ORDEN_PRODUCTOS[f.orden]}, ar.nombre
      LIMIT $5 OFFSET $6`,
    [desde, hasta, f.q, f.categoria, f.limit, f.offset],
  );
  const total = rows[0] ? num(rows[0].total)! : 0;
  return { total, filas: rows.map((r) => numerico(r, CLAVES_NUM)) };
}

export async function producto(id: number, r: Rango, pool: pg.Pool = poolDefault): Promise<pg.QueryResultRow | null> {
  const { desde, hasta } = limitesRango(r);
  const ficha = await pool.query(
    `SELECT ar.id AS articulo_id, ar.nombre, ar.codigo, ar.unidad_habitual, ca.ruta AS categoria, ca.raiz_id AS categoria_raiz_id,
            p.*, pl.nombre AS lider, pl.rut AS lider_rut
       FROM mercado.articulos ar
       LEFT JOIN mercado.categorias ca ON ca.id = ar.categoria_id
       LEFT JOIN mercado.mv_productos p ON p.articulo_id = ar.id
       LEFT JOIN mercado.proveedores pl ON pl.id = p.lider_proveedor_id
      WHERE ar.id = $1`,
    [id],
  );
  if (!ficha.rows[0]) return null;
  const unidad: string = ficha.rows[0].unidad_principal ?? 'unidad';
  const params = [desde, hasta, id, unidad];

  const [enRango, serie, proveedores, organismos, tipos, ultimas, ofertas, unidades] = await Promise.all([
    pool.query(
      `SELECT count(*) AS adjudicaciones, count(DISTINCT h.llamado_id) AS llamados, count(DISTINCT h.organismo_id) AS organismos,
              count(DISTINCT h.proveedor_id) AS proveedores, sum(h.monto_uyu) AS monto_uyu,
              sum(h.cantidad) FILTER (WHERE h.unidad = $4) AS cantidad,
              count(h.precio_base_uyu) FILTER (WHERE h.unidad = $4) AS con_precio,
              percentile_cont(0.1)  WITHIN GROUP (ORDER BY h.precio_base_uyu) FILTER (WHERE h.unidad = $4) AS precio_p10_uyu,
              percentile_cont(0.25) WITHIN GROUP (ORDER BY h.precio_base_uyu) FILTER (WHERE h.unidad = $4) AS precio_p25_uyu,
              percentile_cont(0.5)  WITHIN GROUP (ORDER BY h.precio_base_uyu) FILTER (WHERE h.unidad = $4) AS precio_mediano_uyu,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY h.precio_base_uyu) FILTER (WHERE h.unidad = $4) AS precio_p75_uyu,
              percentile_cont(0.9)  WITHIN GROUP (ORDER BY h.precio_base_uyu) FILTER (WHERE h.unidad = $4) AS precio_p90_uyu,
              min(h.fecha) AS primera_fecha, max(h.fecha) AS ultima_fecha
         FROM mercado.mv_hechos h WHERE h.articulo_id = $3 AND ${FILTRO_RANGO}`,
      params,
    ),
    pool.query(
      `SELECT mes, adjudicaciones, llamados, organismos, proveedores, cantidad, monto_uyu, con_precio, precio_mediano_uyu, precio_min_uyu, precio_max_uyu
         FROM mercado.mv_producto_mes
        WHERE articulo_id = $3 AND unidad = $4 AND ($1::date IS NULL OR mes >= $1) AND ($2::date IS NULL OR mes < $2)
        ORDER BY mes`,
      params,
    ),
    pool.query(
      `SELECT h.proveedor_id, p.nombre, p.rut, count(*) AS adjudicaciones, count(DISTINCT h.llamado_id) AS llamados, count(DISTINCT h.organismo_id) AS organismos,
              sum(h.monto_uyu) AS monto_uyu, sum(h.cantidad) FILTER (WHERE h.unidad = $4) AS cantidad,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY h.precio_base_uyu) FILTER (WHERE h.unidad = $4) AS precio_mediano_uyu,
              sum(h.monto_uyu) / NULLIF(sum(sum(h.monto_uyu)) OVER (), 0) AS share, max(h.fecha) AS ultima_fecha
         FROM mercado.mv_hechos h JOIN mercado.proveedores p ON p.id = h.proveedor_id
        WHERE h.articulo_id = $3 AND ${FILTRO_RANGO}
        GROUP BY h.proveedor_id, p.nombre, p.rut
        ORDER BY monto_uyu DESC NULLS LAST, adjudicaciones DESC LIMIT 15`,
      params,
    ),
    pool.query(
      `SELECT h.organismo_id, o.inciso, o.unidad_ejecutora, count(*) AS adjudicaciones, count(DISTINCT h.llamado_id) AS llamados,
              sum(h.monto_uyu) AS monto_uyu, sum(h.cantidad) FILTER (WHERE h.unidad = $4) AS cantidad,
              sum(h.monto_uyu) / NULLIF(sum(sum(h.monto_uyu)) OVER (), 0) AS share, max(h.fecha) AS ultima_fecha
         FROM mercado.mv_hechos h LEFT JOIN mercado.organismos o ON o.id = h.organismo_id
        WHERE h.articulo_id = $3 AND ${FILTRO_RANGO}
        GROUP BY h.organismo_id, o.inciso, o.unidad_ejecutora
        ORDER BY monto_uyu DESC NULLS LAST, adjudicaciones DESC LIMIT 15`,
      params,
    ),
    pool.query(
      `SELECT h.tipo_compra, count(*) AS adjudicaciones, sum(h.monto_uyu) AS monto_uyu
         FROM mercado.mv_hechos h WHERE h.articulo_id = $3 AND ${FILTRO_RANGO}
        GROUP BY h.tipo_compra ORDER BY monto_uyu DESC NULLS LAST`,
      params.slice(0, 3),
    ),
    pool.query(
      `SELECT h.adjudicacion_id, h.fecha, h.arce_id, l.tipo_compra, l.objeto, l.url, o.inciso, o.unidad_ejecutora, p.nombre AS proveedor, h.proveedor_id,
              h.cantidad, h.unidad, h.moneda, h.precio_unitario, h.precio_base_uyu, h.monto_uyu, h.base_conocida, h.con_cotizacion
         FROM mercado.mv_hechos h
         JOIN mercado.llamados l ON l.id = h.llamado_id
         JOIN mercado.proveedores p ON p.id = h.proveedor_id
         LEFT JOIN mercado.organismos o ON o.id = h.organismo_id
        WHERE h.articulo_id = $3 AND ${FILTRO_RANGO}
        ORDER BY h.fecha DESC, h.adjudicacion_id DESC LIMIT 25`,
      params.slice(0, 3),
    ),
    pool.query(
      `SELECT anio, items_con_cuadro, oferentes_promedio, precio_ganador_mediano, precio_perdedor_mediano, descuento_mediano
         FROM mercado.mv_producto_ofertas_anio
        WHERE articulo_id = $3 AND unidad = $4 AND ($1::date IS NULL OR anio >= EXTRACT(YEAR FROM $1::date)) AND ($2::date IS NULL OR anio <= EXTRACT(YEAR FROM ($2::date - 1)))
        ORDER BY anio`,
      params,
    ),
    pool.query(
      `SELECT h.unidad, count(*) AS adjudicaciones, sum(h.cantidad) AS cantidad, percentile_cont(0.5) WITHIN GROUP (ORDER BY h.precio_base_uyu) AS precio_mediano_uyu
         FROM mercado.mv_hechos h WHERE h.articulo_id = $3 AND ${FILTRO_RANGO}
        GROUP BY h.unidad ORDER BY adjudicaciones DESC`,
      params.slice(0, 3),
    ),
  ]);

  return {
    ...numerico(ficha.rows[0]!, CLAVES_NUM),
    rango: numerico(enRango.rows[0]!, CLAVES_NUM),
    serie: serie.rows.map((r) => numerico(r, CLAVES_NUM)),
    proveedores: proveedores.rows.map((r) => numerico(r, CLAVES_NUM)),
    organismos: organismos.rows.map((r) => numerico(r, CLAVES_NUM)),
    tipos_compra: tipos.rows.map((r) => numerico(r, CLAVES_NUM)),
    ultimas: ultimas.rows.map((r) => numerico(r, [...CLAVES_NUM, 'cantidad'])),
    competencia: ofertas.rows.map((r) => numerico(r, CLAVES_NUM)),
    unidades: unidades.rows.map((r) => numerico(r, CLAVES_NUM)),
  };
}

// ---------------------------------------------------------------------------
// Proveedores (competidores)
// ---------------------------------------------------------------------------

export type OrdenProveedores = 'monto' | 'adjudicaciones' | 'articulos' | 'organismos' | 'exito' | 'crecimiento';

const ORDEN_PROVEEDORES: Record<OrdenProveedores, string> = {
  monto: 'monto_uyu DESC NULLS LAST',
  adjudicaciones: 'adjudicaciones DESC',
  articulos: 'articulos DESC, monto_uyu DESC NULLS LAST',
  organismos: 'organismos DESC, monto_uyu DESC NULLS LAST',
  exito: 'tasa_exito DESC NULLS LAST, ofertas_presentadas DESC',
  crecimiento: 'variacion_12m DESC NULLS LAST',
};

export interface FiltroProveedores extends Rango {
  q: string | null;
  articulo: number | null;
  orden: OrdenProveedores;
  limit: number;
  offset: number;
}

export async function proveedores(f: FiltroProveedores, pool: pg.Pool = poolDefault): Promise<{ total: number; filas: pg.QueryResultRow[] }> {
  const { desde, hasta } = limitesRango(f);
  const { rows } = await pool.query(
    `SELECT h.proveedor_id, p.nombre, p.rut,
            count(*)                        AS adjudicaciones,
            count(DISTINCT h.llamado_id)    AS llamados,
            count(DISTINCT h.articulo_id)   AS articulos,
            count(DISTINCT h.organismo_id)  AS organismos,
            sum(h.monto_uyu)                AS monto_uyu,
            max(h.fecha)                    AS ultima_fecha,
            mp.ofertas_presentadas, mp.ofertas_ganadas, mp.tasa_exito, mp.variacion_12m, mp.monto_uyu_12m,
            mp.principal_articulo_id, pa.nombre AS principal_articulo,
            count(*) OVER () AS total
       FROM mercado.mv_hechos h
       JOIN mercado.proveedores p ON p.id = h.proveedor_id
       LEFT JOIN mercado.mv_proveedores mp ON mp.proveedor_id = h.proveedor_id
       LEFT JOIN mercado.articulos pa ON pa.id = mp.principal_articulo_id
      WHERE ${FILTRO_RANGO}
        AND ($3::text IS NULL OR p.nombre ILIKE '%' || $3 || '%' OR p.rut = $3)
        AND ($4::int IS NULL OR h.articulo_id = $4)
      GROUP BY h.proveedor_id, p.nombre, p.rut, mp.ofertas_presentadas, mp.ofertas_ganadas, mp.tasa_exito, mp.variacion_12m, mp.monto_uyu_12m, mp.principal_articulo_id, pa.nombre
      ORDER BY ${ORDEN_PROVEEDORES[f.orden]}, p.nombre
      LIMIT $5 OFFSET $6`,
    [desde, hasta, f.q, f.articulo, f.limit, f.offset],
  );
  const total = rows[0] ? num(rows[0].total)! : 0;
  return { total, filas: rows.map((r) => numerico(r, CLAVES_NUM)) };
}

export async function proveedor(id: number, r: Rango, pool: pg.Pool = poolDefault): Promise<pg.QueryResultRow | null> {
  const { desde, hasta } = limitesRango(r);
  const ficha = await pool.query(
    `SELECT p.id AS proveedor_id, p.nombre, p.rut, p.pais, mp.*, pa.nombre AS principal_articulo
       FROM mercado.proveedores p
       LEFT JOIN mercado.mv_proveedores mp ON mp.proveedor_id = p.id
       LEFT JOIN mercado.articulos pa ON pa.id = mp.principal_articulo_id
      WHERE p.id = $1`,
    [id],
  );
  if (!ficha.rows[0]) return null;
  const params = [desde, hasta, id];
  const [enRango, serie, productosQ, organismos, competidores, ultimas, tipos] = await Promise.all([
    pool.query(
      `SELECT count(*) AS adjudicaciones, count(DISTINCT h.llamado_id) AS llamados, count(DISTINCT h.articulo_id) AS articulos,
              count(DISTINCT h.organismo_id) AS organismos, sum(h.monto_uyu) AS monto_uyu, min(h.fecha) AS primera_fecha, max(h.fecha) AS ultima_fecha
         FROM mercado.mv_hechos h WHERE h.proveedor_id = $3 AND ${FILTRO_RANGO}`,
      params,
    ),
    pool.query(
      `SELECT mes, adjudicaciones, llamados, articulos, organismos, monto_uyu FROM mercado.mv_proveedor_mes
        WHERE proveedor_id = $3 AND ($1::date IS NULL OR mes >= $1) AND ($2::date IS NULL OR mes < $2) ORDER BY mes`,
      params,
    ),
    pool.query(
      `SELECT h.articulo_id, ar.nombre, ar.codigo, ca.ruta AS categoria, h.unidad, count(*) AS adjudicaciones, count(DISTINCT h.organismo_id) AS organismos,
              sum(h.cantidad) AS cantidad, sum(h.monto_uyu) AS monto_uyu,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY h.precio_base_uyu) AS precio_mediano_uyu,
              sum(h.monto_uyu) / NULLIF(sum(sum(h.monto_uyu)) OVER (), 0) AS share, max(h.fecha) AS ultima_fecha
         FROM mercado.mv_hechos h JOIN mercado.articulos ar ON ar.id = h.articulo_id LEFT JOIN mercado.categorias ca ON ca.id = ar.categoria_id
        WHERE h.proveedor_id = $3 AND ${FILTRO_RANGO}
        GROUP BY h.articulo_id, ar.nombre, ar.codigo, ca.ruta, h.unidad
        ORDER BY monto_uyu DESC NULLS LAST, adjudicaciones DESC LIMIT 20`,
      params,
    ),
    pool.query(
      `SELECT h.organismo_id, o.inciso, o.unidad_ejecutora, count(*) AS adjudicaciones, count(DISTINCT h.llamado_id) AS llamados, sum(h.monto_uyu) AS monto_uyu,
              sum(h.monto_uyu) / NULLIF(sum(sum(h.monto_uyu)) OVER (), 0) AS share, max(h.fecha) AS ultima_fecha
         FROM mercado.mv_hechos h LEFT JOIN mercado.organismos o ON o.id = h.organismo_id
        WHERE h.proveedor_id = $3 AND ${FILTRO_RANGO}
        GROUP BY h.organismo_id, o.inciso, o.unidad_ejecutora
        ORDER BY monto_uyu DESC NULLS LAST, adjudicaciones DESC LIMIT 15`,
      params,
    ),
    // Quiénes ganan los mismos productos que este proveedor (sus 20 productos principales del rango)
    pool.query(
      `WITH mios AS (
         SELECT h.articulo_id, sum(h.monto_uyu) AS monto FROM mercado.mv_hechos h
          WHERE h.proveedor_id = $3 AND h.articulo_id IS NOT NULL AND ${FILTRO_RANGO}
          GROUP BY h.articulo_id ORDER BY monto DESC NULLS LAST LIMIT 20)
       SELECT h.proveedor_id, p.nombre, p.rut, count(DISTINCT h.articulo_id) AS productos_en_comun, count(*) AS adjudicaciones, sum(h.monto_uyu) AS monto_uyu,
              (array_agg(DISTINCT ar.nombre))[1:3] AS ejemplos
         FROM mercado.mv_hechos h
         JOIN mios ON mios.articulo_id = h.articulo_id
         JOIN mercado.proveedores p ON p.id = h.proveedor_id
         JOIN mercado.articulos ar ON ar.id = h.articulo_id
        WHERE h.proveedor_id <> $3 AND ${FILTRO_RANGO}
        GROUP BY h.proveedor_id, p.nombre, p.rut
        ORDER BY productos_en_comun DESC, monto_uyu DESC NULLS LAST LIMIT 15`,
      params,
    ),
    pool.query(
      `SELECT h.adjudicacion_id, h.fecha, h.arce_id, l.tipo_compra, l.objeto, l.url, o.inciso, o.unidad_ejecutora, ar.nombre AS articulo, h.articulo_id,
              h.cantidad, h.unidad, h.moneda, h.precio_unitario, h.precio_base_uyu, h.monto_uyu
         FROM mercado.mv_hechos h
         JOIN mercado.llamados l ON l.id = h.llamado_id
         LEFT JOIN mercado.articulos ar ON ar.id = h.articulo_id
         LEFT JOIN mercado.organismos o ON o.id = h.organismo_id
        WHERE h.proveedor_id = $3 AND ${FILTRO_RANGO}
        ORDER BY h.fecha DESC, h.adjudicacion_id DESC LIMIT 25`,
      params,
    ),
    pool.query(
      `SELECT h.tipo_compra, count(*) AS adjudicaciones, sum(h.monto_uyu) AS monto_uyu FROM mercado.mv_hechos h
        WHERE h.proveedor_id = $3 AND ${FILTRO_RANGO} GROUP BY h.tipo_compra ORDER BY monto_uyu DESC NULLS LAST`,
      params,
    ),
  ]);
  return {
    ...numerico(ficha.rows[0]!, CLAVES_NUM),
    rango: numerico(enRango.rows[0]!, CLAVES_NUM),
    serie: serie.rows.map((r) => numerico(r, CLAVES_NUM)),
    productos: productosQ.rows.map((r) => numerico(r, CLAVES_NUM)),
    organismos: organismos.rows.map((r) => numerico(r, CLAVES_NUM)),
    competidores: competidores.rows.map((r) => numerico(r, CLAVES_NUM)),
    ultimas: ultimas.rows.map((r) => numerico(r, [...CLAVES_NUM, 'cantidad'])),
    tipos_compra: tipos.rows.map((r) => numerico(r, CLAVES_NUM)),
  };
}

// ---------------------------------------------------------------------------
// Organismos (compradores)
// ---------------------------------------------------------------------------

export interface FiltroOrganismos extends Rango {
  q: string | null;
  limit: number;
  offset: number;
}

export async function organismos(f: FiltroOrganismos, pool: pg.Pool = poolDefault): Promise<{ total: number; filas: pg.QueryResultRow[] }> {
  const { desde, hasta } = limitesRango(f);
  const { rows } = await pool.query(
    `WITH agg AS (
       SELECT h.organismo_id, count(*) AS adjudicaciones, count(DISTINCT h.llamado_id) AS llamados, count(DISTINCT h.articulo_id) AS articulos,
              count(DISTINCT h.proveedor_id) AS proveedores, sum(h.monto_uyu) AS monto_uyu, max(h.fecha) AS ultima_fecha
         FROM mercado.mv_hechos h
        WHERE h.organismo_id IS NOT NULL AND ${FILTRO_RANGO}
        GROUP BY h.organismo_id)
     SELECT a.*, o.inciso, o.unidad_ejecutora, count(*) OVER () AS total,
            (SELECT array_agg(x.nombre) FROM (
               SELECT ar.nombre FROM mercado.mv_hechos h JOIN mercado.articulos ar ON ar.id = h.articulo_id
                WHERE h.organismo_id = a.organismo_id AND ${FILTRO_RANGO}
                GROUP BY ar.nombre ORDER BY sum(h.monto_uyu) DESC NULLS LAST LIMIT 3) x) AS principales
       FROM agg a JOIN mercado.organismos o ON o.id = a.organismo_id
      WHERE ($3::text IS NULL OR o.inciso ILIKE '%' || $3 || '%' OR o.unidad_ejecutora ILIKE '%' || $3 || '%')
      ORDER BY a.monto_uyu DESC NULLS LAST, a.adjudicaciones DESC
      LIMIT $4 OFFSET $5`,
    [desde, hasta, f.q, f.limit, f.offset],
  );
  const total = rows[0] ? num(rows[0].total)! : 0;
  return { total, filas: rows.map((r) => numerico(r, CLAVES_NUM)) };
}

// ---------------------------------------------------------------------------
// Categorías, oportunidades, búsqueda
// ---------------------------------------------------------------------------

export async function categorias(r: Rango, pool: pg.Pool = poolDefault): Promise<pg.QueryResultRow[]> {
  const { desde, hasta } = limitesRango(r);
  const { rows } = await pool.query(
    `SELECT c.id, c.nombre, count(*) AS adjudicaciones, count(DISTINCT h.articulo_id) AS articulos, sum(h.monto_uyu) AS monto_uyu
       FROM mercado.mv_hechos h JOIN mercado.categorias c ON c.id = h.categoria_raiz_id
      WHERE ${FILTRO_RANGO}
      GROUP BY c.id, c.nombre ORDER BY monto_uyu DESC NULLS LAST`,
    [desde, hasta],
  );
  return rows.map((x) => numerico(x, CLAVES_NUM));
}

export async function oportunidades(limit: number, categoria: number | null, pool: pg.Pool = poolDefault): Promise<pg.QueryResultRow[]> {
  const { rows } = await pool.query(
    `SELECT p.articulo_id, ar.nombre, ar.codigo, ca.ruta AS categoria, p.unidad_principal AS unidad,
            p.indice_oportunidad, p.comp_volumen, p.comp_recurrencia, p.comp_amplitud, p.comp_apertura,
            p.monto_uyu_24m, p.adjudicaciones_24m, p.llamados_24m, p.organismos_24m, p.proveedores_24m, p.hhi_24m,
            p.lider_proveedor_id, pl.nombre AS lider, p.lider_share_24m,
            p.precio_mediano_uyu_12m, p.precio_p25_uyu_12m, p.precio_p75_uyu_12m, p.variacion_12m, p.variacion_precio_12m, p.fecha_referencia
       FROM mercado.mv_productos p
       JOIN mercado.articulos ar ON ar.id = p.articulo_id
       LEFT JOIN mercado.categorias ca ON ca.id = ar.categoria_id
       LEFT JOIN mercado.proveedores pl ON pl.id = p.lider_proveedor_id
      WHERE p.indice_oportunidad IS NOT NULL AND ($2::int IS NULL OR ca.raiz_id = $2 OR ca.id = $2)
      ORDER BY p.indice_oportunidad DESC, p.monto_uyu_24m DESC NULLS LAST
      LIMIT $1`,
    [limit, categoria],
  );
  return rows.map((x) => numerico(x, CLAVES_NUM));
}

export async function buscar(q: string, pool: pg.Pool = poolDefault): Promise<{ articulos: pg.QueryResultRow[]; proveedores: pg.QueryResultRow[]; organismos: pg.QueryResultRow[] }> {
  const [a, p, o] = await Promise.all([
    pool.query(
      `SELECT ar.id, ar.nombre, ar.codigo, ca.ruta AS categoria, mp.adjudicaciones, mp.monto_uyu
         FROM mercado.articulos ar LEFT JOIN mercado.categorias ca ON ca.id = ar.categoria_id LEFT JOIN mercado.mv_productos mp ON mp.articulo_id = ar.id
        WHERE ar.nombre ILIKE '%' || $1 || '%' OR ar.codigo = $1
        ORDER BY mp.monto_uyu DESC NULLS LAST, similarity(ar.nombre, $1) DESC LIMIT 10`,
      [q],
    ),
    pool.query(
      `SELECT p.id, p.nombre, p.rut, mp.adjudicaciones, mp.monto_uyu
         FROM mercado.proveedores p LEFT JOIN mercado.mv_proveedores mp ON mp.proveedor_id = p.id
        WHERE p.nombre ILIKE '%' || $1 || '%' OR p.rut = $1
        ORDER BY mp.monto_uyu DESC NULLS LAST, similarity(p.nombre, $1) DESC LIMIT 10`,
      [q],
    ),
    pool.query(
      `SELECT o.id, o.inciso, o.unidad_ejecutora
         FROM mercado.organismos o
        WHERE o.inciso ILIKE '%' || $1 || '%' OR o.unidad_ejecutora ILIKE '%' || $1 || '%'
        ORDER BY similarity(o.inciso || ' ' || o.unidad_ejecutora, $1) DESC LIMIT 10`,
      [q],
    ),
  ]);
  return {
    articulos: a.rows.map((x) => numerico(x, CLAVES_NUM)),
    proveedores: p.rows.map((x) => numerico(x, CLAVES_NUM)),
    organismos: o.rows,
  };
}
