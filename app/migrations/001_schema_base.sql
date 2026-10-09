-- 001_schema_base.sql
-- Esquema base del proyecto (derivado de database/scheme.sql, sin artefactos de pg_dump).

CREATE TABLE IF NOT EXISTS llamados (
    id                varchar(20) PRIMARY KEY,
    titulo            text,
    descripcion       text,
    fecha_publicacion date,
    hora_publicacion  time without time zone,
    fecha_apertura    date,
    hora_apertura     time without time zone,
    url_detalle       text,
    detectado_en      timestamp without time zone DEFAULT now(),
    dias_restantes    integer,
    urgencia          varchar(20),
    estado            varchar(20) DEFAULT 'activo',
    prioridad_score   integer,
    tsv_search        tsvector GENERATED ALWAYS AS (
                        to_tsvector('spanish'::regconfig, (COALESCE(titulo, '') || ' ' || COALESCE(descripcion, '')))
                      ) STORED,
    CONSTRAINT llamados_estado_check CHECK (estado IN ('activo', 'vencido', 'archivado'))
);

CREATE TABLE IF NOT EXISTS archivos_adjuntos (
    id             serial PRIMARY KEY,
    llamado_id     varchar(20) REFERENCES llamados(id) ON DELETE CASCADE,
    nombre         text,
    tipo           text,
    archivo_url    text,
    label          text,
    actualizado_en timestamp without time zone DEFAULT now(),
    CONSTRAINT adjuntos_unique UNIQUE (llamado_id, archivo_url)
);

CREATE TABLE IF NOT EXISTS aclaraciones (
    id             serial PRIMARY KEY,
    id_llamado     varchar(20) REFERENCES llamados(id) ON DELETE CASCADE,
    fecha          date,
    hora           time without time zone,
    texto          text,
    archivo_url    text,
    actualizado_en timestamp without time zone DEFAULT now(),
    CONSTRAINT aclaraciones_unique UNIQUE (id_llamado, archivo_url)
);

CREATE TABLE IF NOT EXISTS items_llamado (
    id         serial PRIMARY KEY,
    id_llamado varchar(20) REFERENCES llamados(id) ON DELETE CASCADE,
    texto      text
);

CREATE TABLE IF NOT EXISTS analisis_ia (
    id                       serial PRIMARY KEY,
    llamado_id               varchar(20) REFERENCES llamados(id) ON DELETE CASCADE,
    archivo_analizado        varchar(500),
    es_relevante             boolean,
    confianza                integer,
    razon                    text,
    resumen_trabajo          text,
    ubicacion_obra           text,
    requiere_visita          boolean,
    ubicacion_visita         text,
    fecha_visita_especifica  date,
    coordina_visita          boolean,
    contacto_visita_nombre   text,
    contacto_visita_telefono text,
    analizado_en             timestamp without time zone DEFAULT now(),
    errores_extraccion       text,
    descripcion_llamado      text,
    contacto_visita_correo   text,
    materiales_detectados    jsonb,
    formularios_requeridos   jsonb DEFAULT '[]'::jsonb,
    CONSTRAINT analisis_ia_confianza_check CHECK (confianza >= 0 AND confianza <= 100),
    CONSTRAINT analisis_ia_llamado_id_archivo_analizado_key UNIQUE (llamado_id, archivo_analizado)
);

CREATE TABLE IF NOT EXISTS feedback_usuario (
    id                 serial PRIMARY KEY,
    llamado_id         varchar(64) NOT NULL UNIQUE REFERENCES llamados(id) ON DELETE CASCADE,
    es_relevante_real  boolean,
    comentario         text,
    estado_seguimiento varchar(20) DEFAULT 'pendiente',
    ia_es_relevante    boolean,
    ia_confianza       numeric(5,2),
    ia_razon           text,
    usuario            varchar(50) DEFAULT CURRENT_USER,
    creado_en          timestamp without time zone DEFAULT now(),
    actualizado_en     timestamp without time zone DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_analisis_confianza      ON analisis_ia (confianza DESC);
CREATE INDEX IF NOT EXISTS idx_analisis_fecha_visita   ON analisis_ia (fecha_visita_especifica) WHERE fecha_visita_especifica IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analisis_relevante      ON analisis_ia (es_relevante, confianza DESC);
CREATE INDEX IF NOT EXISTS idx_analisis_visita         ON analisis_ia (requiere_visita) WHERE requiere_visita = true;
CREATE INDEX IF NOT EXISTS idx_materiales_gin          ON analisis_ia USING gin (materiales_detectados jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_feedback_comparacion    ON feedback_usuario (ia_es_relevante, es_relevante_real) WHERE es_relevante_real IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_feedback_estado         ON feedback_usuario (estado_seguimiento);
CREATE INDEX IF NOT EXISTS idx_llamados_estado_urgencia ON llamados (estado, urgencia, dias_restantes) WHERE estado = 'activo';
CREATE INDEX IF NOT EXISTS idx_llamados_fecha_apertura ON llamados (fecha_apertura) WHERE estado = 'activo';
CREATE INDEX IF NOT EXISTS idx_llamados_fts            ON llamados USING gin (tsv_search);
CREATE INDEX IF NOT EXISTS idx_llamados_prioridad      ON llamados (prioridad_score DESC NULLS LAST) WHERE estado = 'activo';

-- Prioridad: urgencia por días restantes + confianza de la IA + visita técnica
CREATE OR REPLACE FUNCTION calcular_prioridad(p_dias_restantes integer, p_confianza numeric, p_requiere_visita boolean)
RETURNS integer
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  RETURN (
    CASE
      WHEN p_dias_restantes IS NULL THEN 0
      WHEN p_dias_restantes <= 0 THEN 50
      WHEN p_dias_restantes <= 2 THEN 40
      WHEN p_dias_restantes <= 5 THEN 30
      WHEN p_dias_restantes <= 10 THEN 20
      WHEN p_dias_restantes <= 15 THEN 10
      ELSE 5
    END
    + COALESCE(FLOOR(p_confianza * 0.3), 0)
    + CASE WHEN p_requiere_visita = TRUE THEN 30 ELSE 0 END
  );
END;
$$;

CREATE OR REPLACE FUNCTION actualizar_prioridad_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_dias_restantes integer;
BEGIN
  SELECT dias_restantes INTO v_dias_restantes FROM llamados WHERE id = NEW.llamado_id;
  UPDATE llamados
     SET prioridad_score = calcular_prioridad(v_dias_restantes, NEW.confianza, NEW.requiere_visita)
   WHERE id = NEW.llamado_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_actualizar_prioridad ON analisis_ia;
CREATE TRIGGER trg_actualizar_prioridad
AFTER INSERT OR UPDATE OF confianza, requiere_visita ON analisis_ia
FOR EACH ROW EXECUTE FUNCTION actualizar_prioridad_trigger();
