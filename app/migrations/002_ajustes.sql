-- 002_ajustes.sql
-- Ajustes de la modernización (ver docs/PLAN-MODERNIZACION.md, Fase 2).

-- detectado_en no se pisa en los upserts; actualizado_en registra la última vez que se vio el llamado en el RSS/scraper.
ALTER TABLE llamados ADD COLUMN IF NOT EXISTS actualizado_en timestamp without time zone DEFAULT now();

-- Qué modelo/proveedor generó cada análisis y para qué rubro.
ALTER TABLE analisis_ia ADD COLUMN IF NOT EXISTS modelo text;
ALTER TABLE analisis_ia ADD COLUMN IF NOT EXISTS proveedor text;
ALTER TABLE analisis_ia ADD COLUMN IF NOT EXISTS rubro text DEFAULT 'aluminio';
-- Métricas de la llamada al LLM (tokens de prompt reportados por el proveedor y duración total).
ALTER TABLE analisis_ia ADD COLUMN IF NOT EXISTS prompt_tokens integer;
ALTER TABLE analisis_ia ADD COLUMN IF NOT EXISTS duracion_ms integer;
ALTER TABLE analisis_ia ADD COLUMN IF NOT EXISTS chars_enviados integer;

-- Índice de estado (antes vivía dentro del SQL de la vista).
CREATE INDEX IF NOT EXISTS idx_llamados_estado ON llamados (estado);
CREATE INDEX IF NOT EXISTS idx_llamados_actualizado ON llamados (actualizado_en);

-- items_llamado no tenía unicidad: cada corrida duplicaba los ítems.
DELETE FROM items_llamado a
 USING items_llamado b
 WHERE a.id > b.id AND a.id_llamado = b.id_llamado AND a.texto IS NOT DISTINCT FROM b.texto;
CREATE UNIQUE INDEX IF NOT EXISTS items_llamado_unique ON items_llamado (id_llamado, md5(COALESCE(texto, '')));

-- Estado de seguimiento acotado a lo que usa el dashboard.
ALTER TABLE feedback_usuario DROP CONSTRAINT IF EXISTS feedback_estado_check;
ALTER TABLE feedback_usuario
  ADD CONSTRAINT feedback_estado_check
  CHECK (estado_seguimiento IN ('pendiente', 'en_progreso', 'ganado', 'descartado'));

-- Resumen de cada corrida del pipeline (para /api/pipeline/estado y la demo).
CREATE TABLE IF NOT EXISTS corridas_pipeline (
    id              serial PRIMARY KEY,
    iniciada_en     timestamptz NOT NULL DEFAULT now(),
    finalizada_en   timestamptz,
    origen          text NOT NULL DEFAULT 'cron',
    estado          text NOT NULL DEFAULT 'en_curso',
    rss_total       integer,
    candidatos      integer,
    scrapeados      integer,
    analizados      integer,
    errores         integer,
    detalle         jsonb
);
