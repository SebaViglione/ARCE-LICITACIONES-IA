-- 005_mercado_informes.sql
-- Análisis generados por la IA sobre las estadísticas de mercado (ver src/mercado/analista.ts):
-- informes del mercado, veredictos por producto y respuestas a preguntas libres. Se guarda también
-- el paquete de datos que se le mandó al modelo, para poder auditar de dónde salió cada conclusión.

CREATE TABLE IF NOT EXISTS mercado.informes (
    id                 bigserial PRIMARY KEY,
    tipo               text NOT NULL CHECK (tipo IN ('mercado', 'producto', 'pregunta')),
    clave              text NOT NULL,            -- hash de los filtros / "articulo_id:hash(rango)" / hash de la pregunta
    filtros            jsonb,
    pregunta           text,
    paquete            text NOT NULL,            -- datos enviados al modelo (texto)
    informe            jsonb NOT NULL,           -- respuesta estructurada validada
    proveedor          text,
    modelo             text,
    prompt_tokens      integer,
    completion_tokens  integer,
    duracion_ms        integer,
    creado_en          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS informes_tipo_clave ON mercado.informes (tipo, clave, id DESC);
