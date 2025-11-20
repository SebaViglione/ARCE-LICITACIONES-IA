# Esquema de Base de Datos - Sistema de Licitaciones

Documentación del esquema PostgreSQL para el sistema de análisis de licitaciones con IA.

## Resumen

El sistema utiliza PostgreSQL 16 con extensiones `pgcrypto` y `uuid-ossp`. Las tablas principales almacenan información de licitaciones, archivos adjuntos, análisis de IA y feedback de usuarios.

## Tablas Principales

### `llamados`

Tabla central que almacena la información básica de cada licitación.

```sql
CREATE TABLE llamados (
    id VARCHAR(20) PRIMARY KEY,
    titulo TEXT,
    descripcion TEXT,
    fecha_publicacion DATE,
    hora_publicacion TIME,
    fecha_apertura DATE,
    hora_apertura TIME,
    url_detalle TEXT,
    detectado_en TIMESTAMP DEFAULT NOW(),
    dias_restantes INTEGER,
    urgencia VARCHAR(20),
    estado VARCHAR(20) DEFAULT 'activo',
    prioridad_score INTEGER,
    tsv_search TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('spanish', COALESCE(titulo, '') || ' ' || COALESCE(descripcion, ''))
    ) STORED,
    CONSTRAINT llamados_estado_check CHECK (estado IN ('activo', 'vencido', 'archivado'))
);
```

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | VARCHAR(20) | ID único del llamado (del portal de compras) |
| `titulo` | TEXT | Título completo de la licitación |
| `descripcion` | TEXT | Descripción del llamado |
| `fecha_publicacion` | DATE | Fecha de publicación |
| `hora_publicacion` | TIME | Hora de publicación |
| `fecha_apertura` | DATE | Fecha de apertura de ofertas |
| `hora_apertura` | TIME | Hora de apertura |
| `url_detalle` | TEXT | URL al detalle en Compras Estatales |
| `detectado_en` | TIMESTAMP | Cuándo se detectó el llamado |
| `dias_restantes` | INTEGER | Días hasta la apertura |
| `urgencia` | VARCHAR(20) | Nivel de urgencia (urgente, próximo, futuro) |
| `estado` | VARCHAR(20) | Estado actual (activo, vencido, archivado) |
| `prioridad_score` | INTEGER | Puntaje de prioridad calculado |
| `tsv_search` | TSVECTOR | Vector para búsqueda full-text en español |

---

### `archivos_adjuntos`

Archivos asociados a cada licitación (pliegos, anexos, planos).

```sql
CREATE TABLE archivos_adjuntos (
    id SERIAL PRIMARY KEY,
    llamado_id VARCHAR(20),
    nombre TEXT,
    tipo TEXT,
    archivo_url TEXT,
    label TEXT,
    actualizado_en TIMESTAMP DEFAULT NOW()
);
```

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | SERIAL | ID autoincremental |
| `llamado_id` | VARCHAR(20) | FK a llamados.id |
| `nombre` | TEXT | Nombre del archivo |
| `tipo` | TEXT | Extensión (pdf, docx, xlsx, etc.) |
| `archivo_url` | TEXT | URL de descarga |
| `label` | TEXT | Etiqueta o categoría del archivo |
| `actualizado_en` | TIMESTAMP | Última actualización |

---

### `aclaraciones`

Aclaraciones y consultas publicadas sobre los llamados.

```sql
CREATE TABLE aclaraciones (
    id SERIAL PRIMARY KEY,
    id_llamado VARCHAR(20),
    fecha DATE,
    hora TIME,
    texto TEXT,
    archivo_url TEXT,
    actualizado_en TIMESTAMP DEFAULT NOW()
);
```

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | SERIAL | ID autoincremental |
| `id_llamado` | VARCHAR(20) | FK a llamados.id |
| `fecha` | DATE | Fecha de la aclaración |
| `hora` | TIME | Hora de la aclaración |
| `texto` | TEXT | Contenido de la aclaración |
| `archivo_url` | TEXT | Archivo adjunto (si existe) |
| `actualizado_en` | TIMESTAMP | Última actualización |

---

### `analisis_ia`

Resultados del análisis de IA de cada archivo.

```sql
CREATE TABLE analisis_ia (
    id SERIAL PRIMARY KEY,
    llamado_id VARCHAR(20),
    archivo_analizado VARCHAR(500),
    es_relevante BOOLEAN,
    confianza INTEGER CHECK (confianza >= 0 AND confianza <= 100),
    razon TEXT,
    resumen_trabajo TEXT,
    ubicacion_obra TEXT,
    requiere_visita BOOLEAN,
    ubicacion_visita TEXT,
    fecha_visita_especifica DATE,
    coordina_visita BOOLEAN,
    contacto_visita_nombre TEXT,
    contacto_visita_telefono TEXT,
    contacto_visita_correo TEXT,
    analizado_en TIMESTAMP DEFAULT NOW(),
    errores_extraccion TEXT,
    descripcion_llamado TEXT,
    materiales_detectados JSONB,
    formularios_requeridos JSONB DEFAULT '[]'
);
```

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | SERIAL | ID autoincremental |
| `llamado_id` | VARCHAR(20) | FK a llamados.id |
| `archivo_analizado` | VARCHAR(500) | Nombre del archivo procesado |
| `es_relevante` | BOOLEAN | ¿Es relevante para empresa de aluminio? |
| `confianza` | INTEGER | Nivel de confianza 0-100 |
| `razon` | TEXT | Explicación de la relevancia |
| `resumen_trabajo` | TEXT | Resumen del trabajo requerido |
| `ubicacion_obra` | TEXT | Dirección de la obra |
| `requiere_visita` | BOOLEAN | ¿Requiere visita técnica? |
| `ubicacion_visita` | TEXT | Dónde es la visita |
| `fecha_visita_especifica` | DATE | Fecha de visita técnica |
| `coordina_visita` | BOOLEAN | ¿Se debe coordinar? |
| `contacto_visita_nombre` | TEXT | Nombre del contacto |
| `contacto_visita_telefono` | TEXT | Teléfono del contacto |
| `contacto_visita_correo` | TEXT | Email del contacto |
| `analizado_en` | TIMESTAMP | Cuándo se realizó el análisis |
| `errores_extraccion` | TEXT | Errores durante la extracción |
| `descripcion_llamado` | TEXT | Resumen generado por IA |
| `materiales_detectados` | JSONB | Array de materiales encontrados |
| `formularios_requeridos` | JSONB | Array de formularios a presentar |

---

### `feedback_usuario`

Retroalimentación humana sobre los análisis de IA.

```sql
CREATE TABLE feedback_usuario (
    id SERIAL PRIMARY KEY,
    llamado_id VARCHAR(64) NOT NULL,
    es_relevante_real BOOLEAN,
    comentario TEXT,
    estado_seguimiento VARCHAR(20) DEFAULT 'pendiente',
    ia_es_relevante BOOLEAN,
    ia_confianza NUMERIC(5,2),
    ia_razon TEXT,
    usuario VARCHAR(50) DEFAULT CURRENT_USER,
    creado_en TIMESTAMP DEFAULT NOW(),
    actualizado_en TIMESTAMP DEFAULT NOW()
);
```

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | SERIAL | ID autoincremental |
| `llamado_id` | VARCHAR(64) | FK a llamados.id |
| `es_relevante_real` | BOOLEAN | Decisión humana de relevancia |
| `comentario` | TEXT | Notas del usuario |
| `estado_seguimiento` | VARCHAR(20) | Estado (pendiente, en_progreso, ganado, descartado) |
| `ia_es_relevante` | BOOLEAN | Predicción original de IA |
| `ia_confianza` | NUMERIC(5,2) | Confianza original de IA |
| `ia_razon` | TEXT | Razón original de IA |
| `usuario` | VARCHAR(50) | Usuario que dio feedback |
| `creado_en` | TIMESTAMP | Fecha de creación |
| `actualizado_en` | TIMESTAMP | Última actualización |

---

## Vistas

### `v_llamados_dashboard`

Vista principal para el dashboard. Combina llamados con el mejor análisis de IA (mayor confianza).

```sql
CREATE VIEW v_llamados_dashboard AS
SELECT
    l.id AS llamado_id,
    l.titulo,
    l.descripcion,
    l.fecha_publicacion,
    l.hora_publicacion,
    l.fecha_apertura,
    l.hora_apertura,
    l.dias_restantes,
    l.urgencia,
    l.url_detalle,
    l.estado,
    ai_best.archivo_analizado,
    ai_best.descripcion_llamado AS ai_descripcion,
    ai_best.es_relevante,
    ai_best.confianza,
    ai_best.razon,
    ai_best.materiales_detectados,
    ai_best.resumen_trabajo,
    ai_best.ubicacion_obra,
    ai_best.requiere_visita,
    ai_best.ubicacion_visita,
    ai_best.fecha_visita_especifica,
    ai_best.coordina_visita,
    ai_best.contacto_visita_nombre,
    ai_best.contacto_visita_telefono,
    ai_best.contacto_visita_correo,
    COUNT(DISTINCT aa.archivo_url) FILTER (WHERE aa.archivo_url IS NOT NULL) AS total_archivos,
    COUNT(DISTINCT ai_all.id) AS archivos_analizados,
    STRING_AGG(DISTINCT ai_all.archivo_analizado, ', ') AS lista_archivos_analizados,
    l.detectado_en,
    MAX(ai_all.analizado_en) AS ultima_actualizacion_ia
FROM llamados l
LEFT JOIN LATERAL (
    SELECT * FROM analisis_ia ai
    WHERE ai.llamado_id = l.id
    ORDER BY ai.confianza DESC NULLS LAST, ai.analizado_en DESC
    LIMIT 1
) ai_best ON true
LEFT JOIN archivos_adjuntos aa ON aa.llamado_id = l.id
LEFT JOIN analisis_ia ai_all ON ai_all.llamado_id = l.id
WHERE l.estado = 'activo'
GROUP BY l.id, ai_best.*;
```

**Uso**: Esta vista es usada por el endpoint `/api/llamados` del dashboard.

---

### `vista_adjuntos`

Vista auxiliar que une adjuntos con título del llamado.

```sql
CREATE VIEW vista_adjuntos AS
SELECT
    a.id,
    a.llamado_id,
    l.titulo AS titulo_llamado,
    a.nombre,
    a.tipo,
    a.archivo_url,
    a.label
FROM archivos_adjuntos a
JOIN llamados l ON a.llamado_id = l.id;
```

---

### `vista_aclaraciones`

Vista auxiliar que une aclaraciones con título del llamado.

```sql
CREATE VIEW vista_aclaraciones AS
SELECT
    ac.id,
    ac.id_llamado,
    l.titulo AS titulo_llamado,
    ac.fecha,
    ac.hora,
    ac.texto,
    ac.archivo_url
FROM aclaraciones ac
JOIN llamados l ON ac.id_llamado = l.id;
```

---

## Funciones

### `calcular_prioridad()`

Calcula el puntaje de prioridad de un llamado basándose en:
- Urgencia temporal (0-50 puntos)
- Confianza IA (0-30 puntos)
- Requiere visita (+30 puntos bonus)

```sql
CREATE FUNCTION calcular_prioridad(
    p_dias_restantes INTEGER,
    p_confianza NUMERIC,
    p_requiere_visita BOOLEAN
) RETURNS INTEGER AS $$
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
$$ LANGUAGE plpgsql IMMUTABLE;
```

---

### `normalize_materiales()`

Normaliza texto de materiales a formato JSONB.

```sql
CREATE FUNCTION normalize_materiales(text) RETURNS JSONB AS $$
DECLARE
  v_input alias for $1;
  v_json jsonb;
BEGIN
  -- Intenta parsear como JSON
  BEGIN
    v_json := v_input::jsonb;
    RETURN v_json;
  EXCEPTION WHEN others THEN
    NULL;
  END;

  -- Convierte texto plano a array JSON
  RETURN jsonb_build_array(
    regexp_split_to_array(
      regexp_replace(v_input, '[{}"]', '', 'g'),
      '[,;]'
    )
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

---

## Triggers

### `trg_actualizar_prioridad`

Actualiza automáticamente el `prioridad_score` en `llamados` cuando se inserta o actualiza un análisis en `analisis_ia`.

```sql
CREATE TRIGGER trg_actualizar_prioridad
AFTER INSERT OR UPDATE OF confianza, requiere_visita
ON analisis_ia
FOR EACH ROW
EXECUTE FUNCTION actualizar_prioridad_trigger();
```

---

## Índices Recomendados

```sql
-- Búsqueda full-text
CREATE INDEX idx_llamados_tsv ON llamados USING GIN(tsv_search);

-- Consultas frecuentes
CREATE INDEX idx_llamados_estado ON llamados(estado);
CREATE INDEX idx_llamados_fecha_apertura ON llamados(fecha_apertura);
CREATE INDEX idx_analisis_llamado ON analisis_ia(llamado_id);
CREATE INDEX idx_adjuntos_llamado ON archivos_adjuntos(llamado_id);
CREATE INDEX idx_aclaraciones_llamado ON aclaraciones(id_llamado);
CREATE INDEX idx_feedback_llamado ON feedback_usuario(llamado_id);

-- Unique para evitar duplicados en análisis
CREATE UNIQUE INDEX idx_analisis_unique ON analisis_ia(llamado_id, archivo_analizado);
```

---

## Relaciones

```
llamados (1) ──────┬───── (*) archivos_adjuntos
                   │
                   ├───── (*) aclaraciones
                   │
                   ├───── (*) analisis_ia
                   │
                   └───── (*) feedback_usuario
```

---

## Queries Útiles

### Obtener llamados activos con mejor análisis

```sql
SELECT * FROM v_llamados_dashboard
WHERE es_relevante = true
ORDER BY prioridad_score DESC, dias_restantes ASC;
```

### Buscar por texto (full-text search)

```sql
SELECT * FROM llamados
WHERE tsv_search @@ plainto_tsquery('spanish', 'aluminio ventanas')
AND estado = 'activo';
```

### Archivos pendientes de análisis

```sql
SELECT aa.llamado_id, aa.nombre, aa.archivo_url
FROM archivos_adjuntos aa
LEFT JOIN analisis_ia ai ON ai.llamado_id = aa.llamado_id
  AND ai.archivo_analizado = aa.nombre
WHERE ai.id IS NULL
  AND aa.archivo_url IS NOT NULL;
```

### Estadísticas de análisis

```sql
SELECT
    COUNT(*) AS total_llamados,
    COUNT(*) FILTER (WHERE es_relevante = true) AS relevantes,
    AVG(confianza) AS confianza_promedio
FROM v_llamados_dashboard;
```

---

## Importar el esquema

```bash
psql -h localhost -U n8n -d n8n -f schema.sql
```

O restaurar desde dump:

```bash
pg_restore -h localhost -U n8n -d n8n schema.sql
```

---

## Notas

- El esquema incluye tablas de N8N (workflows, credentials, etc.) que son gestionadas automáticamente por el sistema.
- Las tablas específicas del sistema de licitaciones son: `llamados`, `archivos_adjuntos`, `aclaraciones`, `analisis_ia`, `feedback_usuario`.
- La columna `tsv_search` es generada automáticamente para búsqueda full-text en español.
- Los triggers mantienen automáticamente el `prioridad_score` actualizado.
