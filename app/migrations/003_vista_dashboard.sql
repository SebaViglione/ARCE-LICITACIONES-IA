-- 003_vista_dashboard.sql
-- Única definición de v_llamados_dashboard: llamado + mejor análisis IA + conteo de archivos
-- (adjuntos + archivos de aclaraciones). Reemplaza create_dashboard_view.sql y migracion_total_archivos.sql.
-- La vista NO filtra por estado: lo hace la API (default 'activo').

DROP VIEW IF EXISTS v_llamados_dashboard CASCADE;

CREATE VIEW v_llamados_dashboard AS
WITH mejor_analisis AS (
  SELECT DISTINCT ON (llamado_id)
    llamado_id,
    archivo_analizado,
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
    analizado_en,
    modelo,
    proveedor,
    rubro
  FROM analisis_ia
  WHERE es_relevante IS NOT NULL
  -- Preferir análisis sobre un archivo real antes que el fallback por metadatos.
  ORDER BY llamado_id,
           (archivo_analizado = 'METADATA_FALLBACK') ASC,
           confianza DESC NULLS LAST,
           analizado_en DESC
),
conteo_archivos AS (
  SELECT l.id AS llamado_id,
         (SELECT count(DISTINCT aa.archivo_url) FROM archivos_adjuntos aa WHERE aa.llamado_id = l.id AND aa.archivo_url IS NOT NULL)
       + (SELECT count(DISTINCT ac.archivo_url) FROM aclaraciones ac WHERE ac.id_llamado = l.id AND ac.archivo_url IS NOT NULL) AS total_archivos,
         (SELECT count(*) FROM analisis_ia ai WHERE ai.llamado_id = l.id AND ai.es_relevante IS NOT NULL) AS archivos_analizados
  FROM llamados l
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
  l.actualizado_en,
  ma.archivo_analizado,
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
  ma.modelo,
  ma.proveedor,
  ma.rubro,
  COALESCE(ca.total_archivos, 0)::integer AS total_archivos,
  COALESCE(ca.archivos_analizados, 0)::integer AS archivos_analizados
FROM llamados l
LEFT JOIN mejor_analisis ma ON ma.llamado_id = l.id
LEFT JOIN conteo_archivos ca ON ca.llamado_id = l.id;

COMMENT ON VIEW v_llamados_dashboard IS 'Llamados con su mejor análisis IA y conteo de archivos; la API filtra por estado.';
