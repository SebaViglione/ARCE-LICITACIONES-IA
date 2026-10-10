// Cliente de la API del servicio (app/src/api/routes.ts). Tipos espejo de v_llamados_dashboard.

export interface Formulario {
  nombre: string;
  obligatorio: boolean;
  seccion: string | null;
}

export interface Llamado {
  llamado_id: string;
  titulo: string | null;
  descripcion: string | null;
  fecha_publicacion: string | null;
  hora_publicacion: string | null;
  fecha_apertura: string | null;
  hora_apertura: string | null;
  url_detalle: string | null;
  dias_restantes: number | null;
  urgencia: string | null;
  estado: string;
  prioridad_score: number | null;
  detectado_en: string;
  actualizado_en: string | null;
  archivo_analizado: string | null;
  es_relevante: boolean | null;
  confianza: number | null;
  razon: string | null;
  resumen_trabajo: string | null;
  ubicacion_obra: string | null;
  requiere_visita: boolean | null;
  ubicacion_visita: string | null;
  fecha_visita_especifica: string | null;
  coordina_visita: boolean | null;
  contacto_visita_nombre: string | null;
  contacto_visita_telefono: string | null;
  contacto_visita_correo: string | null;
  ai_descripcion: string | null;
  materiales_detectados: string[] | null;
  formularios_requeridos: Formulario[] | null;
  analizado_en: string | null;
  modelo: string | null;
  proveedor: string | null;
  rubro: string | null;
  total_archivos: number;
  archivos_analizados: number;
  es_relevante_real: boolean | null;
  estado_seguimiento: string | null;
  comentario?: string | null;
}

export interface Adjunto {
  id: number;
  nombre: string | null;
  tipo: string | null;
  archivo_url: string;
  label: string | null;
}

export interface Aclaracion {
  id: number;
  fecha: string | null;
  hora: string | null;
  texto: string | null;
  archivo_url: string | null;
}

export interface AnalisisResumen {
  id: number;
  archivo_analizado: string;
  es_relevante: boolean | null;
  confianza: number | null;
  descripcion_llamado: string | null;
  errores_extraccion: string | null;
  modelo: string | null;
  proveedor: string | null;
  prompt_tokens: number | null;
  duracion_ms: number | null;
  chars_enviados: number | null;
  analizado_en: string;
}

export interface Detalle {
  llamado: Llamado;
  adjuntos: Adjunto[];
  aclaraciones: Aclaracion[];
  analisis: AnalisisResumen[];
  items: string[];
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
}

export interface Corrida {
  id?: number;
  origen: string;
  estado: string;
  iniciada_en: string;
  finalizada_en: string | null;
  rss_total: number | null;
  candidatos: number | null;
  scrapeados: number | null;
  analizados: number | null;
  errores: number | null;
}

export interface EstadoPipeline {
  enCurso: boolean;
  iniciadaEn: string | null;
  ultimaCorrida: Corrida | null;
  corridas: Corrida[];
}

export const ESTADOS_SEGUIMIENTO = {
  pendiente: 'Pendiente',
  en_progreso: 'En progreso',
  ganado: 'Ganado',
  descartado: 'Descartado',
} as const;
export type EstadoSeguimiento = keyof typeof ESTADOS_SEGUIMIENTO;

export interface FeedbackEntrada {
  llamado_id: string;
  es_relevante_real: boolean | null;
  estado_seguimiento: EstadoSeguimiento;
  comentario: string | null;
}

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let detalle = '';
    try {
      detalle = ((await res.json()) as { error?: string }).error ?? '';
    } catch {
      /* sin cuerpo JSON */
    }
    throw new Error(detalle || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  llamados: () => pedir<Llamado[]>('/api/llamados?limit=500'),
  detalle: (id: string) => pedir<Detalle>(`/api/llamados/${encodeURIComponent(id)}`),
  metricas: () => pedir<Metricas>('/api/metricas'),
  pipelineEstado: () => pedir<EstadoPipeline>('/api/pipeline/estado'),
  pipelineRun: () => pedir<{ iniciada: boolean }>('/api/pipeline/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
  rubros: () => pedir<{ actual: string; disponibles: string[] }>('/api/rubros'),
  feedback: (f: FeedbackEntrada) =>
    pedir<Llamado & { comentario: string | null }>('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) }),
};
