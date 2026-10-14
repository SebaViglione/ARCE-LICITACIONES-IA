-- 004_mercado.sql
-- Inteligencia de mercado sobre el histórico completo de ARCE (ver docs/MERCADO.md y docs/CAMBIO-DE-ENFOQUE.md).
--
-- El esquema "mercado" es independiente del pipeline por rubro (tablas públicas). Lo alimentan los
-- endpoints /api/ingesta/* (un scraper externo manda los llamados con sus ítems, ofertas y adjudicaciones)
-- y las estadísticas salen solas de las vistas materializadas, que se refrescan después de cada lote.
--
-- Capas:
--   1. crudos / lotes          → lo que llegó, tal cual, con hash (idempotencia y reproceso)
--   2. tablas normalizadas     → organismos, proveedores, artículos, categorías, llamados, ítems, ofertas, adjudicaciones, cotizaciones
--   3. vistas materializadas   → mv_hechos (una fila por adjudicación, todo en UYU sin impuestos) y los agregados por producto,
--                                proveedor, organismo, mes y competencia (ofertas ganadoras vs perdedoras)

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE SCHEMA IF NOT EXISTS mercado;

-- ===========================================================================
-- 1. Trazabilidad de la ingesta
-- ===========================================================================

CREATE TABLE IF NOT EXISTS mercado.lotes (
    id             bigserial PRIMARY KEY,
    tipo           text NOT NULL,                      -- llamados | cotizaciones | articulos | proveedores | reproceso
    fuente         text NOT NULL DEFAULT 'scraper',
    recibido_en    timestamptz NOT NULL DEFAULT now(),
    finalizado_en  timestamptz,
    recibidos      integer NOT NULL DEFAULT 0,
    insertados     integer NOT NULL DEFAULT 0,
    actualizados   integer NOT NULL DEFAULT 0,
    sin_cambios    integer NOT NULL DEFAULT 0,
    rechazados     integer NOT NULL DEFAULT 0,
    errores        jsonb,                              -- [{indice, clave, error}]
    duracion_ms    integer
);
CREATE INDEX IF NOT EXISTS lotes_recibido ON mercado.lotes (recibido_en DESC);

-- Payload original de cada llamado recibido. Mismo (clave, hash) ya procesado → no se vuelve a tocar nada.
CREATE TABLE IF NOT EXISTS mercado.crudos (
    id            bigserial PRIMARY KEY,
    lote_id       bigint REFERENCES mercado.lotes(id) ON DELETE SET NULL,
    tipo          text NOT NULL,                       -- llamado
    clave         text NOT NULL,                       -- arce_id
    hash          text NOT NULL,                       -- sha256 del JSON canónico
    payload       jsonb NOT NULL,
    recibido_en   timestamptz NOT NULL DEFAULT now(),
    procesado_en  timestamptz,
    error         text
);
CREATE INDEX IF NOT EXISTS crudos_clave ON mercado.crudos (tipo, clave, hash);
CREATE INDEX IF NOT EXISTS crudos_lote  ON mercado.crudos (lote_id);

-- Historial de refrescos de las vistas materializadas.
CREATE TABLE IF NOT EXISTS mercado.refrescos (
    id             serial PRIMARY KEY,
    origen         text NOT NULL,                      -- ingesta | cron | api | inicio
    iniciado_en    timestamptz NOT NULL DEFAULT now(),
    finalizado_en  timestamptz,
    estado         text NOT NULL DEFAULT 'en_curso',   -- en_curso | ok | error
    duracion_ms    integer,
    detalle        jsonb,                              -- {vista: ms}
    error          text
);

-- ===========================================================================
-- 2. Dimensiones
-- ===========================================================================

-- Jerarquía del catálogo (familia > subfamilia > clase). Cualquier nivel puede faltar.
CREATE TABLE IF NOT EXISTS mercado.categorias (
    id        serial PRIMARY KEY,
    nombre    text NOT NULL,
    padre_id  integer REFERENCES mercado.categorias(id) ON DELETE CASCADE,
    raiz_id   integer REFERENCES mercado.categorias(id) ON DELETE CASCADE,
    nivel     smallint NOT NULL CHECK (nivel BETWEEN 1 AND 4),
    ruta      text NOT NULL,                           -- "Familia > Subfamilia > Clase"
    UNIQUE NULLS NOT DISTINCT (padre_id, nombre)
);
CREATE INDEX IF NOT EXISTS categorias_raiz ON mercado.categorias (raiz_id);

-- Un artículo = un producto del catálogo de ARCE (código) o, si el scraper no trae código, un nombre normalizado.
CREATE TABLE IF NOT EXISTS mercado.articulos (
    id                  serial PRIMARY KEY,
    codigo              text UNIQUE,
    nombre              text NOT NULL,
    nombre_normalizado  text NOT NULL,
    categoria_id        integer REFERENCES mercado.categorias(id) ON DELETE SET NULL,
    unidad_habitual     text,
    creado_en           timestamptz NOT NULL DEFAULT now(),
    actualizado_en      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS articulos_sin_codigo   ON mercado.articulos (nombre_normalizado) WHERE codigo IS NULL;
CREATE INDEX        IF NOT EXISTS articulos_nombre_trgm  ON mercado.articulos USING gin (nombre gin_trgm_ops);
CREATE INDEX        IF NOT EXISTS articulos_categoria    ON mercado.articulos (categoria_id);

-- Proveedores por RUT; sin RUT, por nombre normalizado (se fusionan cuando aparece el RUT).
CREATE TABLE IF NOT EXISTS mercado.proveedores (
    id                  serial PRIMARY KEY,
    rut                 text UNIQUE,
    nombre              text NOT NULL,
    nombre_normalizado  text NOT NULL,
    pais                text,
    creado_en           timestamptz NOT NULL DEFAULT now(),
    actualizado_en      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS proveedores_sin_rut     ON mercado.proveedores (nombre_normalizado) WHERE rut IS NULL;
CREATE INDEX        IF NOT EXISTS proveedores_nombre_trgm ON mercado.proveedores USING gin (nombre gin_trgm_ops);

-- Organismos compradores: inciso (ministerio, ente, intendencia) + unidad ejecutora.
CREATE TABLE IF NOT EXISTS mercado.organismos (
    id                serial PRIMARY KEY,
    inciso            text NOT NULL,
    unidad_ejecutora  text NOT NULL DEFAULT '',
    clave             text NOT NULL UNIQUE,            -- "INCISO|UNIDAD" normalizado
    codigo_inciso     text,
    codigo_unidad     text,
    creado_en         timestamptz NOT NULL DEFAULT now(),
    actualizado_en    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS organismos_nombre_trgm ON mercado.organismos USING gin ((inciso || ' ' || unidad_ejecutora) gin_trgm_ops);

-- Cotizaciones a pesos uruguayos (USD, UI, UR, EUR...). Una por moneda y día; se usa la última anterior a la fecha.
CREATE TABLE IF NOT EXISTS mercado.cotizaciones (
    moneda     text NOT NULL,
    fecha      date NOT NULL,
    valor_uyu  numeric(18,6) NOT NULL CHECK (valor_uyu > 0),
    fuente     text,
    PRIMARY KEY (moneda, fecha)
);

-- ===========================================================================
-- 3. Hechos
-- ===========================================================================

CREATE TABLE IF NOT EXISTS mercado.llamados (
    id                 bigserial PRIMARY KEY,
    arce_id            text NOT NULL UNIQUE,            -- id del llamado en el portal
    tipo_compra        text,                            -- texto del portal
    tipo_compra_grupo  text NOT NULL DEFAULT 'otro',    -- licitacion_publica | licitacion_abreviada | compra_directa | ...
    numero             text,
    anio               smallint,
    organismo_id       integer REFERENCES mercado.organismos(id) ON DELETE SET NULL,
    objeto             text,
    estado             text NOT NULL DEFAULT 'otro'
                       CHECK (estado IN ('publicado', 'en_evaluacion', 'adjudicado', 'desierto', 'anulado', 'sin_efecto', 'otro')),
    estado_original    text,
    fecha_publicacion  date,
    fecha_apertura     timestamptz,
    fecha_adjudicacion date,
    moneda             text,
    url                text,
    fuente             text NOT NULL DEFAULT 'scraper',
    crudo_id           bigint,                          -- último crudo aplicado
    ingresado_en       timestamptz NOT NULL DEFAULT now(),
    actualizado_en     timestamptz NOT NULL DEFAULT now(),
    tsv                tsvector GENERATED ALWAYS AS (to_tsvector('spanish', COALESCE(objeto, ''))) STORED
);
CREATE INDEX IF NOT EXISTS llamados_m_organismo ON mercado.llamados (organismo_id);
CREATE INDEX IF NOT EXISTS llamados_m_anio      ON mercado.llamados (anio);
CREATE INDEX IF NOT EXISTS llamados_m_estado    ON mercado.llamados (estado);
CREATE INDEX IF NOT EXISTS llamados_m_fuente    ON mercado.llamados (fuente);
CREATE INDEX IF NOT EXISTS llamados_m_tsv       ON mercado.llamados USING gin (tsv);

CREATE TABLE IF NOT EXISTS mercado.items (
    id                 bigserial PRIMARY KEY,
    llamado_id         bigint NOT NULL REFERENCES mercado.llamados(id) ON DELETE CASCADE,
    nro_item           integer NOT NULL,
    articulo_id        integer REFERENCES mercado.articulos(id) ON DELETE SET NULL,
    descripcion        text,
    cantidad           numeric(18,4),
    unidad             text,
    unidad_normalizada text,
    variante           text,
    presentacion       text,
    detalle            text,
    marca              text,
    UNIQUE (llamado_id, nro_item)
);
CREATE INDEX IF NOT EXISTS items_articulo ON mercado.items (articulo_id);

-- Cuadro comparativo de ofertas (cuando el portal lo publica): todas las ofertas por ítem, ganadoras o no.
CREATE TABLE IF NOT EXISTS mercado.ofertas (
    id                  bigserial PRIMARY KEY,
    item_id             bigint NOT NULL REFERENCES mercado.items(id) ON DELETE CASCADE,
    proveedor_id        integer NOT NULL REFERENCES mercado.proveedores(id),
    nro_oferta          smallint NOT NULL DEFAULT 1,     -- un proveedor puede ofertar variantes
    precio_unitario     numeric(18,4),
    moneda              text NOT NULL DEFAULT 'UYU',
    impuestos_incluidos boolean NOT NULL DEFAULT false,
    tasa_impuestos      numeric(6,4),
    cantidad            numeric(18,4),
    monto_total         numeric(18,2),
    plazo_entrega       text,
    marca               text,
    observaciones       text,
    UNIQUE (item_id, proveedor_id, nro_oferta)
);
CREATE INDEX IF NOT EXISTS ofertas_proveedor ON mercado.ofertas (proveedor_id);

-- Lo adjudicado por ítem (un ítem puede repartirse entre varios proveedores).
CREATE TABLE IF NOT EXISTS mercado.adjudicaciones (
    id                        bigserial PRIMARY KEY,
    item_id                   bigint NOT NULL REFERENCES mercado.items(id) ON DELETE CASCADE,
    proveedor_id              integer NOT NULL REFERENCES mercado.proveedores(id),
    nro                       smallint NOT NULL DEFAULT 1,
    cantidad                  numeric(18,4),
    precio_unitario           numeric(18,4),
    moneda                    text NOT NULL DEFAULT 'UYU',
    impuestos_incluidos       boolean NOT NULL DEFAULT false,
    tasa_impuestos            numeric(6,4),            -- 0.22 si el portal muestra el IVA aparte
    monto_total               numeric(18,2),           -- misma base impositiva que precio_unitario
    monto_total_con_impuestos numeric(18,2),
    fecha                     date,
    resolucion                text,
    UNIQUE (item_id, proveedor_id, nro)
);
CREATE INDEX IF NOT EXISTS adjudicaciones_proveedor ON mercado.adjudicaciones (proveedor_id);
CREATE INDEX IF NOT EXISTS adjudicaciones_fecha     ON mercado.adjudicaciones (fecha);

-- ===========================================================================
-- 4. Funciones
-- ===========================================================================

-- Cotización vigente para pasar a UYU: la última conocida hasta la fecha, con 45 días de tolerancia.
CREATE OR REPLACE FUNCTION mercado.cotizacion_uyu(p_moneda text, p_fecha date)
RETURNS numeric
LANGUAGE sql STABLE
AS $$
  SELECT CASE
    WHEN p_moneda IS NULL OR p_moneda = 'UYU' THEN 1::numeric
    ELSE (SELECT c.valor_uyu
            FROM mercado.cotizaciones c
           WHERE c.moneda = p_moneda AND c.fecha <= p_fecha AND c.fecha >= p_fecha - 45
           ORDER BY c.fecha DESC
           LIMIT 1)
  END
$$;

-- ===========================================================================
-- 5. Vistas materializadas (se refrescan en este orden; ver src/mercado/estadisticas.ts)
-- ===========================================================================

-- 5.1 Tabla de hechos: una fila por adjudicación con fecha, en UYU y sin impuestos cuando se puede.
--     Reglas anti-ruido: se excluyen llamados anulados/sin efecto y adjudicaciones sin ninguna fecha;
--     precio_base/monto_base quedan NULL si la base impositiva es desconocida (impuestos incluidos sin tasa);
--     *_uyu quedan NULL si no hay cotización para la moneda en la fecha.
CREATE MATERIALIZED VIEW IF NOT EXISTS mercado.mv_hechos AS
WITH base AS (
  SELECT
    a.id                                    AS adjudicacion_id,
    l.id                                    AS llamado_id,
    l.arce_id,
    l.tipo_compra_grupo                     AS tipo_compra,
    l.organismo_id,
    i.id                                    AS item_id,
    i.articulo_id,
    ar.categoria_id,
    ca.raiz_id                              AS categoria_raiz_id,
    COALESCE(i.unidad_normalizada, 'unidad') AS unidad,
    a.proveedor_id,
    COALESCE(a.fecha, l.fecha_adjudicacion, (l.fecha_apertura AT TIME ZONE 'America/Montevideo')::date, l.fecha_publicacion) AS fecha,
    a.cantidad,
    a.moneda,
    a.precio_unitario,
    CASE
      WHEN a.precio_unitario IS NULL THEN NULL
      WHEN NOT a.impuestos_incluidos THEN a.precio_unitario
      WHEN a.tasa_impuestos IS NOT NULL THEN a.precio_unitario / (1 + a.tasa_impuestos)
    END AS precio_base,
    CASE
      WHEN NOT a.impuestos_incluidos THEN COALESCE(a.monto_total, a.precio_unitario * a.cantidad)
      WHEN a.tasa_impuestos IS NOT NULL THEN COALESCE(a.monto_total, a.precio_unitario * a.cantidad) / (1 + a.tasa_impuestos)
    END AS monto_base,
    COALESCE(a.monto_total, a.precio_unitario * a.cantidad, a.monto_total_con_impuestos) AS monto_bruto
  FROM mercado.adjudicaciones a
  JOIN mercado.items     i  ON i.id = a.item_id
  JOIN mercado.llamados  l  ON l.id = i.llamado_id
  LEFT JOIN mercado.articulos  ar ON ar.id = i.articulo_id
  LEFT JOIN mercado.categorias ca ON ca.id = ar.categoria_id
  WHERE l.estado NOT IN ('anulado', 'sin_efecto')
)
SELECT
  b.*,
  date_trunc('month', b.fecha)::date          AS mes,
  EXTRACT(YEAR FROM b.fecha)::int             AS anio,
  cot.valor                                   AS cotizacion,
  b.precio_base * cot.valor                   AS precio_base_uyu,
  COALESCE(b.monto_base, b.monto_bruto) * cot.valor AS monto_uyu,
  (b.monto_base IS NOT NULL)                  AS base_conocida,
  (cot.valor IS NOT NULL)                     AS con_cotizacion
FROM base b
LEFT JOIN LATERAL (SELECT mercado.cotizacion_uyu(b.moneda, b.fecha) AS valor) cot ON true
WHERE b.fecha IS NOT NULL
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS mv_hechos_pk        ON mercado.mv_hechos (adjudicacion_id);
CREATE INDEX        IF NOT EXISTS mv_hechos_articulo  ON mercado.mv_hechos (articulo_id, fecha);
CREATE INDEX        IF NOT EXISTS mv_hechos_proveedor ON mercado.mv_hechos (proveedor_id, fecha);
CREATE INDEX        IF NOT EXISTS mv_hechos_organismo ON mercado.mv_hechos (organismo_id, fecha);
CREATE INDEX        IF NOT EXISTS mv_hechos_fecha     ON mercado.mv_hechos (fecha);
CREATE INDEX        IF NOT EXISTS mv_hechos_categoria ON mercado.mv_hechos (categoria_raiz_id);

-- 5.2 Ofertas (cuadro comparativo) con si ganaron o no y cuántos oferentes hubo en el ítem.
CREATE MATERIALIZED VIEW IF NOT EXISTS mercado.mv_ofertas AS
WITH base AS (
  SELECT
    o.id                                     AS oferta_id,
    o.item_id,
    i.llamado_id,
    i.articulo_id,
    COALESCE(i.unidad_normalizada, 'unidad') AS unidad,
    o.proveedor_id,
    l.organismo_id,
    COALESCE(l.fecha_adjudicacion, (l.fecha_apertura AT TIME ZONE 'America/Montevideo')::date, l.fecha_publicacion) AS fecha,
    o.moneda,
    o.precio_unitario,
    CASE
      WHEN o.precio_unitario IS NULL THEN NULL
      WHEN NOT o.impuestos_incluidos THEN o.precio_unitario
      WHEN o.tasa_impuestos IS NOT NULL THEN o.precio_unitario / (1 + o.tasa_impuestos)
    END AS precio_base,
    EXISTS (SELECT 1 FROM mercado.adjudicaciones a WHERE a.item_id = o.item_id AND a.proveedor_id = o.proveedor_id) AS gano
  FROM mercado.ofertas o
  JOIN mercado.items    i ON i.id = o.item_id
  JOIN mercado.llamados l ON l.id = i.llamado_id
  WHERE l.estado NOT IN ('anulado', 'sin_efecto')
),
oferentes AS (
  SELECT item_id, count(DISTINCT proveedor_id) AS n FROM mercado.ofertas GROUP BY item_id
)
SELECT
  b.*,
  EXTRACT(YEAR FROM b.fecha)::int AS anio,
  cot.valor                       AS cotizacion,
  b.precio_base * cot.valor       AS precio_base_uyu,
  ofe.n                           AS oferentes
FROM base b
JOIN oferentes ofe ON ofe.item_id = b.item_id
LEFT JOIN LATERAL (SELECT mercado.cotizacion_uyu(b.moneda, b.fecha) AS valor) cot ON true
WHERE b.fecha IS NOT NULL
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS mv_ofertas_pk        ON mercado.mv_ofertas (oferta_id);
CREATE INDEX        IF NOT EXISTS mv_ofertas_articulo  ON mercado.mv_ofertas (articulo_id, anio);
CREATE INDEX        IF NOT EXISTS mv_ofertas_proveedor ON mercado.mv_ofertas (proveedor_id);
CREATE INDEX        IF NOT EXISTS mv_ofertas_item      ON mercado.mv_ofertas (item_id);

-- 5.3 Totales por mes (para el panorama general).
CREATE MATERIALIZED VIEW IF NOT EXISTS mercado.mv_mes AS
SELECT
  mes,
  count(*)                        AS adjudicaciones,
  count(DISTINCT llamado_id)      AS llamados,
  count(DISTINCT organismo_id)    AS organismos,
  count(DISTINCT proveedor_id)    AS proveedores,
  count(DISTINCT articulo_id)     AS articulos,
  sum(monto_uyu)                  AS monto_uyu,
  count(monto_uyu)                AS con_monto
FROM mercado.mv_hechos
GROUP BY mes
WITH DATA;
CREATE UNIQUE INDEX IF NOT EXISTS mv_mes_pk ON mercado.mv_mes (mes);

-- 5.4 Producto × unidad × mes: serie de precio (mediana) y volumen.
CREATE MATERIALIZED VIEW IF NOT EXISTS mercado.mv_producto_mes AS
SELECT
  articulo_id,
  unidad,
  mes,
  count(*)                                                        AS adjudicaciones,
  count(DISTINCT llamado_id)                                      AS llamados,
  count(DISTINCT organismo_id)                                    AS organismos,
  count(DISTINCT proveedor_id)                                    AS proveedores,
  sum(cantidad)                                                   AS cantidad,
  sum(monto_uyu)                                                  AS monto_uyu,
  count(precio_base_uyu)                                          AS con_precio,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY precio_base_uyu)    AS precio_mediano_uyu,
  min(precio_base_uyu)                                            AS precio_min_uyu,
  max(precio_base_uyu)                                            AS precio_max_uyu
FROM mercado.mv_hechos
WHERE articulo_id IS NOT NULL
GROUP BY articulo_id, unidad, mes
WITH DATA;
CREATE UNIQUE INDEX IF NOT EXISTS mv_producto_mes_pk  ON mercado.mv_producto_mes (articulo_id, unidad, mes);
CREATE INDEX        IF NOT EXISTS mv_producto_mes_mes ON mercado.mv_producto_mes (mes);

-- 5.5 Proveedor × mes.
CREATE MATERIALIZED VIEW IF NOT EXISTS mercado.mv_proveedor_mes AS
SELECT
  proveedor_id,
  mes,
  count(*)                     AS adjudicaciones,
  count(DISTINCT llamado_id)   AS llamados,
  count(DISTINCT articulo_id)  AS articulos,
  count(DISTINCT organismo_id) AS organismos,
  sum(monto_uyu)               AS monto_uyu
FROM mercado.mv_hechos
GROUP BY proveedor_id, mes
WITH DATA;
CREATE UNIQUE INDEX IF NOT EXISTS mv_proveedor_mes_pk ON mercado.mv_proveedor_mes (proveedor_id, mes);

-- 5.6 Competencia por producto y año: precio ganador vs precio de las ofertas perdedoras.
--     Solo ítems con cuadro comparativo y al menos un ganador con precio.
CREATE MATERIALIZED VIEW IF NOT EXISTS mercado.mv_producto_ofertas_anio AS
WITH por_item AS (
  SELECT
    item_id, articulo_id, unidad, anio,
    min(precio_base_uyu) FILTER (WHERE gano)                                             AS precio_ganador,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY precio_base_uyu) FILTER (WHERE NOT gano) AS precio_perdedor_mediano,
    max(oferentes)                                                                       AS oferentes
  FROM mercado.mv_ofertas
  WHERE articulo_id IS NOT NULL AND precio_base_uyu IS NOT NULL
  GROUP BY item_id, articulo_id, unidad, anio
  HAVING bool_or(gano)
)
SELECT
  articulo_id,
  unidad,
  anio,
  count(*)                                                                                   AS items_con_cuadro,
  avg(oferentes)                                                                             AS oferentes_promedio,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY precio_ganador)                                AS precio_ganador_mediano,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY precio_perdedor_mediano)                       AS precio_perdedor_mediano,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY precio_ganador / NULLIF(precio_perdedor_mediano, 0) - 1) AS descuento_mediano
FROM por_item
GROUP BY articulo_id, unidad, anio
WITH DATA;
CREATE UNIQUE INDEX IF NOT EXISTS mv_producto_ofertas_anio_pk ON mercado.mv_producto_ofertas_anio (articulo_id, unidad, anio);

-- 5.7 Resumen por producto con ventanas de 12 y 24 meses (relativas a la última fecha con datos),
--     concentración (HHI), líder y el índice de oportunidad ("qué vender").
--     Índice (0-100, solo productos con ≥ 3 adjudicaciones en 24 meses):
--       35 % volumen (rango percentil del monto 24 m) + 20 % recurrencia (llamados 24 m)
--       + 20 % amplitud (organismos compradores 24 m) + 25 % apertura competitiva (1 - HHI).
CREATE MATERIALIZED VIEW IF NOT EXISTS mercado.mv_productos AS
WITH ref AS (
  SELECT max(fecha) AS fecha_ref FROM mercado.mv_hechos
),
h AS (
  SELECT
    h.*,
    r.fecha_ref,
    (h.fecha >  r.fecha_ref - INTERVAL '12 months') AS en_12m,
    (h.fecha >  r.fecha_ref - INTERVAL '24 months') AS en_24m,
    (h.fecha <= r.fecha_ref - INTERVAL '12 months' AND h.fecha > r.fecha_ref - INTERVAL '24 months') AS en_12m_previo
  FROM mercado.mv_hechos h
  CROSS JOIN ref r
  WHERE h.articulo_id IS NOT NULL
),
unidad_principal AS (
  SELECT DISTINCT ON (articulo_id) articulo_id, unidad
  FROM (SELECT articulo_id, unidad, count(*) AS n FROM h GROUP BY articulo_id, unidad) u
  ORDER BY articulo_id, n DESC, unidad
),
totales AS (
  SELECT
    h.articulo_id,
    up.unidad                                                                    AS unidad_principal,
    count(*)                                                                     AS adjudicaciones,
    count(DISTINCT h.llamado_id)                                                 AS llamados,
    count(DISTINCT h.organismo_id)                                               AS organismos,
    count(DISTINCT h.proveedor_id)                                               AS proveedores,
    sum(h.monto_uyu)                                                             AS monto_uyu,
    sum(h.cantidad) FILTER (WHERE h.unidad = up.unidad)                          AS cantidad,
    min(h.fecha)                                                                 AS primera_fecha,
    max(h.fecha)                                                                 AS ultima_fecha,
    sum(h.monto_uyu) FILTER (WHERE h.en_12m)                                     AS monto_uyu_12m,
    sum(h.monto_uyu) FILTER (WHERE h.en_12m_previo)                              AS monto_uyu_12m_previo,
    sum(h.monto_uyu) FILTER (WHERE h.en_24m)                                     AS monto_uyu_24m,
    count(*) FILTER (WHERE h.en_24m)                                             AS adjudicaciones_24m,
    count(DISTINCT h.llamado_id) FILTER (WHERE h.en_24m)                         AS llamados_24m,
    count(DISTINCT h.organismo_id) FILTER (WHERE h.en_24m)                       AS organismos_24m,
    count(DISTINCT h.proveedor_id) FILTER (WHERE h.en_24m)                       AS proveedores_24m,
    count(h.precio_base_uyu)::numeric / count(*)                                 AS cobertura_precio,
    percentile_cont(0.5)  WITHIN GROUP (ORDER BY h.precio_base_uyu) FILTER (WHERE h.en_12m AND h.unidad = up.unidad)        AS precio_mediano_uyu_12m,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY h.precio_base_uyu) FILTER (WHERE h.en_12m AND h.unidad = up.unidad)        AS precio_p25_uyu_12m,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY h.precio_base_uyu) FILTER (WHERE h.en_12m AND h.unidad = up.unidad)        AS precio_p75_uyu_12m,
    percentile_cont(0.5)  WITHIN GROUP (ORDER BY h.precio_base_uyu) FILTER (WHERE h.en_12m_previo AND h.unidad = up.unidad) AS precio_mediano_uyu_12m_previo,
    max(h.fecha_ref)                                                             AS fecha_referencia
  FROM h
  JOIN unidad_principal up ON up.articulo_id = h.articulo_id
  GROUP BY h.articulo_id, up.unidad
),
cuotas AS (
  SELECT
    articulo_id,
    proveedor_id,
    sum(monto_uyu) AS monto,
    sum(sum(monto_uyu)) OVER (PARTITION BY articulo_id) AS total
  FROM h
  WHERE en_24m AND monto_uyu IS NOT NULL
  GROUP BY articulo_id, proveedor_id
),
concentracion AS (
  SELECT
    articulo_id,
    sum(power(monto / NULLIF(total, 0), 2))         AS hhi_24m,
    (array_agg(proveedor_id ORDER BY monto DESC))[1] AS lider_proveedor_id,
    max(monto) / NULLIF(max(total), 0)               AS lider_share_24m
  FROM cuotas
  GROUP BY articulo_id
),
puntaje AS (
  SELECT
    t.articulo_id,
    CASE WHEN t.adjudicaciones_24m >= 3 THEN percent_rank() OVER (PARTITION BY (t.adjudicaciones_24m >= 3) ORDER BY t.monto_uyu_24m NULLS FIRST) END AS comp_volumen,
    CASE WHEN t.adjudicaciones_24m >= 3 THEN percent_rank() OVER (PARTITION BY (t.adjudicaciones_24m >= 3) ORDER BY t.llamados_24m)                 END AS comp_recurrencia,
    CASE WHEN t.adjudicaciones_24m >= 3 THEN percent_rank() OVER (PARTITION BY (t.adjudicaciones_24m >= 3) ORDER BY t.organismos_24m)               END AS comp_amplitud,
    CASE WHEN t.adjudicaciones_24m >= 3 THEN 1 - COALESCE(c.hhi_24m, 1) END                                                                             AS comp_apertura
  FROM totales t
  LEFT JOIN concentracion c ON c.articulo_id = t.articulo_id
)
SELECT
  t.*,
  c.hhi_24m,
  c.lider_proveedor_id,
  c.lider_share_24m,
  p.comp_volumen,
  p.comp_recurrencia,
  p.comp_amplitud,
  p.comp_apertura,
  CASE WHEN p.comp_volumen IS NULL THEN NULL
       ELSE round(100 * (0.35 * p.comp_volumen + 0.20 * p.comp_recurrencia + 0.20 * p.comp_amplitud + 0.25 * p.comp_apertura))::int
  END AS indice_oportunidad,
  CASE WHEN t.monto_uyu_12m_previo > 0 THEN t.monto_uyu_12m / t.monto_uyu_12m_previo - 1 END AS variacion_12m,
  CASE WHEN t.precio_mediano_uyu_12m_previo > 0 THEN t.precio_mediano_uyu_12m / t.precio_mediano_uyu_12m_previo - 1 END AS variacion_precio_12m
FROM totales t
LEFT JOIN concentracion c ON c.articulo_id = t.articulo_id
LEFT JOIN puntaje       p ON p.articulo_id = t.articulo_id
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS mv_productos_pk          ON mercado.mv_productos (articulo_id);
CREATE INDEX        IF NOT EXISTS mv_productos_oportunidad ON mercado.mv_productos (indice_oportunidad DESC NULLS LAST);
CREATE INDEX        IF NOT EXISTS mv_productos_monto       ON mercado.mv_productos (monto_uyu DESC NULLS LAST);

-- 5.8 Resumen por proveedor (competidores): volumen, ventanas, producto principal y tasa de éxito
--     (ganadas / presentadas, solo cuando hay cuadro comparativo).
CREATE MATERIALIZED VIEW IF NOT EXISTS mercado.mv_proveedores AS
WITH ref AS (
  SELECT max(fecha) AS fecha_ref FROM mercado.mv_hechos
),
h AS (
  SELECT
    h.*,
    r.fecha_ref,
    (h.fecha >  r.fecha_ref - INTERVAL '12 months') AS en_12m,
    (h.fecha >  r.fecha_ref - INTERVAL '24 months') AS en_24m,
    (h.fecha <= r.fecha_ref - INTERVAL '12 months' AND h.fecha > r.fecha_ref - INTERVAL '24 months') AS en_12m_previo
  FROM mercado.mv_hechos h
  CROSS JOIN ref r
),
totales AS (
  SELECT
    proveedor_id,
    count(*)                                               AS adjudicaciones,
    count(DISTINCT llamado_id)                             AS llamados,
    count(DISTINCT articulo_id)                            AS articulos,
    count(DISTINCT organismo_id)                           AS organismos,
    sum(monto_uyu)                                         AS monto_uyu,
    sum(monto_uyu) FILTER (WHERE en_12m)                   AS monto_uyu_12m,
    sum(monto_uyu) FILTER (WHERE en_12m_previo)            AS monto_uyu_12m_previo,
    sum(monto_uyu) FILTER (WHERE en_24m)                   AS monto_uyu_24m,
    count(*) FILTER (WHERE en_24m)                         AS adjudicaciones_24m,
    min(fecha)                                             AS primera_fecha,
    max(fecha)                                             AS ultima_fecha,
    max(fecha_ref)                                         AS fecha_referencia
  FROM h
  GROUP BY proveedor_id
),
principal AS (
  SELECT DISTINCT ON (proveedor_id) proveedor_id, articulo_id AS principal_articulo_id, monto AS principal_monto_uyu
  FROM (SELECT proveedor_id, articulo_id, sum(monto_uyu) AS monto FROM h WHERE articulo_id IS NOT NULL GROUP BY proveedor_id, articulo_id) x
  ORDER BY proveedor_id, monto DESC NULLS LAST
),
ofs AS (
  SELECT proveedor_id, count(*) AS ofertas_presentadas, count(*) FILTER (WHERE gano) AS ofertas_ganadas
  FROM mercado.mv_ofertas
  GROUP BY proveedor_id
),
ids AS (
  SELECT proveedor_id FROM totales
  UNION
  SELECT proveedor_id FROM ofs
)
SELECT
  i.proveedor_id,
  COALESCE(t.adjudicaciones, 0)      AS adjudicaciones,
  COALESCE(t.llamados, 0)            AS llamados,
  COALESCE(t.articulos, 0)           AS articulos,
  COALESCE(t.organismos, 0)          AS organismos,
  t.monto_uyu,
  t.monto_uyu_12m,
  t.monto_uyu_12m_previo,
  t.monto_uyu_24m,
  COALESCE(t.adjudicaciones_24m, 0)  AS adjudicaciones_24m,
  t.primera_fecha,
  t.ultima_fecha,
  t.fecha_referencia,
  pr.principal_articulo_id,
  pr.principal_monto_uyu,
  COALESCE(o.ofertas_presentadas, 0) AS ofertas_presentadas,
  COALESCE(o.ofertas_ganadas, 0)     AS ofertas_ganadas,
  CASE WHEN o.ofertas_presentadas > 0 THEN o.ofertas_ganadas::numeric / o.ofertas_presentadas END AS tasa_exito,
  CASE WHEN t.monto_uyu_12m_previo > 0 THEN t.monto_uyu_12m / t.monto_uyu_12m_previo - 1 END     AS variacion_12m
FROM ids i
LEFT JOIN totales   t  ON t.proveedor_id  = i.proveedor_id
LEFT JOIN principal pr ON pr.proveedor_id = i.proveedor_id
LEFT JOIN ofs       o  ON o.proveedor_id  = i.proveedor_id
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS mv_proveedores_pk    ON mercado.mv_proveedores (proveedor_id);
CREATE INDEX        IF NOT EXISTS mv_proveedores_monto ON mercado.mv_proveedores (monto_uyu DESC NULLS LAST);

COMMENT ON SCHEMA mercado IS 'Histórico de compras estatales (ARCE) normalizado para estadísticas de mercado: qué se compra, a qué precio, quién gana.';
COMMENT ON MATERIALIZED VIEW mercado.mv_hechos IS 'Una fila por adjudicación con fecha, en UYU y sin impuestos cuando la base es conocida. Excluye llamados anulados/sin efecto.';
COMMENT ON MATERIALIZED VIEW mercado.mv_productos IS 'Resumen por artículo: totales, ventanas 12/24 m, HHI, líder e índice de oportunidad (0-100).';
COMMENT ON MATERIALIZED VIEW mercado.mv_proveedores IS 'Resumen por proveedor: totales, ventanas 12/24 m, producto principal y tasa de éxito en cuadros comparativos.';
