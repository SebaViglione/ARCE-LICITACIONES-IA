-- Vista para el dashboard que combina llamados con el mejor análisis IA disponible
-- Selecciona el análisis con mayor confianza para cada llamado

DROP VIEW IF EXISTS v_llamados_dashboard CASCADE;

CREATE VIEW v_llamados_dashboard AS
WITH mejor_analisis AS (
  SELECT DISTINCT ON (llamado_id)
    llamado_id,
    es_relevante,
    confianza,
    razon,
    resumen_trabajo,
    ubicacion_obra,
    requiere_visita,
    ubicacion_visita,
    fecha_visita_especifica,
    coordina_visita,
    contacto_visita_nombre,
    contacto_visita_telefono,
    contacto_visita_correo,
    descripcion_llamado AS ai_descripcion,
    materiales_detectados,
    formularios_requeridos,
    analizado_en
  FROM analisis_ia
  WHERE es_relevante IS NOT NULL
  ORDER BY llamado_id, confianza DESC NULLS LAST, analizado_en DESC
),
conteo_archivos AS (
  SELECT
    llamado_id,
    COUNT(*) AS total_archivos
  FROM archivos_adjuntos
  GROUP BY llamado_id
)
SELECT
  l.id AS llamado_id,
  l.titulo,
  l.descripcion,
  l.fecha_publicacion,
  l.hora_publicacion,
  l.fecha_apertura,
  l.hora_apertura,
  l.url_detalle,
  l.dias_restantes,
  l.urgencia,
  l.estado,
  l.prioridad_score,
  l.detectado_en,
  -- Datos del análisis IA
  ma.es_relevante,
  ma.confianza,
  ma.razon,
  ma.resumen_trabajo,
  ma.ubicacion_obra,
  ma.requiere_visita,
  ma.ubicacion_visita,
  ma.fecha_visita_especifica,
  ma.coordina_visita,
  ma.contacto_visita_nombre,
  ma.contacto_visita_telefono,
  ma.contacto_visita_correo,
  ma.ai_descripcion,
  ma.materiales_detectados,
  ma.formularios_requeridos,
  ma.analizado_en,
  -- Conteo de archivos
  COALESCE(ca.total_archivos, 0) AS total_archivos
FROM llamados l
LEFT JOIN mejor_analisis ma ON ma.llamado_id = l.id
LEFT JOIN conteo_archivos ca ON ca.llamado_id = l.id
WHERE l.estado = 'activo';

-- Crear índice en la vista para mejorar rendimiento
CREATE INDEX IF NOT EXISTS idx_llamados_estado ON llamados(estado) WHERE estado = 'activo';

COMMENT ON VIEW v_llamados_dashboard IS 'Vista optimizada para el dashboard web que combina llamados activos con su mejor análisis IA';
