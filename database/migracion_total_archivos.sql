-- Migración: Actualizar total_archivos para incluir adjuntos de aclaraciones
-- Fecha: 2025-11-21
-- Descripción: El conteo de archivos ahora incluye tanto archivos_adjuntos como archivos de aclaraciones

DROP VIEW IF EXISTS public.v_llamados_dashboard;

CREATE VIEW public.v_llamados_dashboard AS
 SELECT l.id AS llamado_id,
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
    -- Contar archivos de archivos_adjuntos + archivos de aclaraciones
    (
      count(DISTINCT aa.archivo_url) FILTER (WHERE (aa.archivo_url IS NOT NULL)) +
      count(DISTINCT ac.archivo_url) FILTER (WHERE (ac.archivo_url IS NOT NULL))
    ) AS total_archivos,
    count(DISTINCT ai_all.id) AS archivos_analizados,
    string_agg(DISTINCT (ai_all.archivo_analizado)::text, ', '::text) AS lista_archivos_analizados,
    l.detectado_en,
    max(ai_all.analizado_en) AS ultima_actualizacion_ia
   FROM ((((public.llamados l
     LEFT JOIN LATERAL ( SELECT ai.id,
            ai.llamado_id,
            ai.archivo_analizado,
            ai.es_relevante,
            ai.confianza,
            ai.razon,
            ai.resumen_trabajo,
            ai.ubicacion_obra,
            ai.requiere_visita,
            ai.ubicacion_visita,
            ai.fecha_visita_especifica,
            ai.coordina_visita,
            ai.contacto_visita_nombre,
            ai.contacto_visita_telefono,
            ai.analizado_en,
            ai.errores_extraccion,
            ai.descripcion_llamado,
            ai.contacto_visita_correo,
            ai.materiales_detectados
           FROM public.analisis_ia ai
          WHERE ((ai.llamado_id)::text = (l.id)::text)
          ORDER BY ai.confianza DESC NULLS LAST, ai.analizado_en DESC
         LIMIT 1) ai_best ON (true))
     LEFT JOIN public.archivos_adjuntos aa ON (((aa.llamado_id)::text = (l.id)::text)))
     LEFT JOIN public.aclaraciones ac ON (((ac.id_llamado)::text = (l.id)::text)))
     LEFT JOIN public.analisis_ia ai_all ON (((ai_all.llamado_id)::text = (l.id)::text)))
  WHERE ((l.estado)::text = 'activo'::text)
  GROUP BY l.id, l.titulo, l.descripcion, l.fecha_publicacion, l.hora_publicacion, l.fecha_apertura, l.hora_apertura, l.dias_restantes, l.urgencia, l.url_detalle, l.estado, l.detectado_en, ai_best.archivo_analizado, ai_best.descripcion_llamado, ai_best.es_relevante, ai_best.confianza, ai_best.razon, ai_best.materiales_detectados, ai_best.resumen_trabajo, ai_best.ubicacion_obra, ai_best.requiere_visita, ai_best.ubicacion_visita, ai_best.fecha_visita_especifica, ai_best.coordina_visita, ai_best.contacto_visita_nombre, ai_best.contacto_visita_telefono, ai_best.contacto_visita_correo;

ALTER VIEW public.v_llamados_dashboard OWNER TO n8n;
