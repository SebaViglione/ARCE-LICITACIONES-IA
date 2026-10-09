import { z } from 'zod';
import { esFechaIsoValida, fechaDdMmAaaaAIso } from '../utils/fechas.js';

export const FormularioSchema = z.object({
  nombre: z.string(),
  obligatorio: z.boolean(),
  seccion: z.string().nullable(),
});
export type Formulario = z.infer<typeof FormularioSchema>;

/**
 * Esquema que se le exige al modelo (structured output). Es laxo en `confianza` y `fecha_visita_especifica`
 * para que la gramática no bloquee la generación; `normalizarAnalisis` lo lleva al esquema estricto.
 */
export const AnalisisLlmSchema = z.object({
  descripcion_llamado: z.string(),
  es_relevante: z.boolean(),
  confianza: z.number(),
  razon: z.string(),
  materiales_detectados: z.array(z.string()),
  resumen_trabajo: z.string(),
  ubicacion_obra: z.string().nullable(),
  requiere_visita: z.boolean(),
  ubicacion_visita: z.string().nullable(),
  fecha_visita_especifica: z.string().nullable(),
  coordina_visita: z.boolean(),
  contacto_visita_nombre: z.string().nullable(),
  contacto_visita_telefono: z.string().nullable(),
  contacto_visita_correo: z.string().nullable(),
  formularios_requeridos: z.array(FormularioSchema),
});
export type AnalisisLlm = z.infer<typeof AnalisisLlmSchema>;

/** Esquema final con el que se guarda en la BD. */
export const AnalisisSchema = AnalisisLlmSchema.extend({
  confianza: z.number().int().min(0).max(100),
  fecha_visita_especifica: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});
export type Analisis = z.infer<typeof AnalisisSchema>;

/** Lo que se le pide a cada fragmento de un pliego largo. */
export const ChunkSchema = z.object({
  resumen_fragmento: z.string(),
  materiales: z.array(z.string()),
  ubicacion_obra: z.string().nullable(),
  requiere_visita: z.boolean(),
  ubicacion_visita: z.string().nullable(),
  fecha_visita: z.string().nullable(),
  coordina_visita: z.boolean(),
  contacto_nombre: z.string().nullable(),
  contacto_tel: z.string().nullable(),
  contacto_mail: z.string().nullable(),
  formularios: z.array(FormularioSchema),
});
export type Chunk = z.infer<typeof ChunkSchema>;

function sinSchemaKey<T extends Record<string, unknown>>(s: T): Omit<T, '$schema'> {
  const { $schema: _omitido, ...resto } = s;
  return resto;
}

export const analisisJsonSchema = sinSchemaKey(z.toJSONSchema(AnalisisLlmSchema) as Record<string, unknown>);
export const chunkJsonSchema = sinSchemaKey(z.toJSONSchema(ChunkSchema) as Record<string, unknown>);

const NULOS = new Set(['', 'null', 'none', 'n/a', 'na', 'no aplica', 'no especifica', 'no especificado', 'no se especifica', 'sin datos', 'desconocido', '-', '—']);

export function textoONull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return NULOS.has(t.toLowerCase()) ? null : t;
}

/** Confianza en 0-100. Acepta 0-1 (escala vieja del fallback) y strings con %. */
export function normalizarConfianza(v: unknown): number {
  let n = typeof v === 'number' ? v : Number(String(v ?? '').replace('%', '').trim());
  if (!Number.isFinite(n)) return 0;
  if (n > 0 && n <= 1 && !Number.isInteger(n)) n = n * 100;
  return Math.min(100, Math.max(0, Math.round(n)));
}

export function normalizarFecha(v: string | null | undefined): string | null {
  const t = textoONull(v);
  if (!t) return null;
  const limpio = t.replace(/^['"]|['"]$/g, '').trim();
  if (esFechaIsoValida(limpio)) return limpio;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(limpio)?.[1];
  if (iso && esFechaIsoValida(iso)) return iso;
  return fechaDdMmAaaaAIso(limpio);
}

export function normalizarCorreo(v: string | null | undefined): string | null {
  const t = textoONull(v);
  if (!t) return null;
  const m = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(t);
  return m ? m[0] : null;
}

/** Normaliza la salida del modelo al esquema estricto (sin aplicar aún las reglas de coherencia de visita). */
export function normalizarAnalisis(raw: AnalisisLlm): Analisis {
  const materiales = [...new Set(raw.materiales_detectados.map((m) => String(m).trim()).filter(Boolean))];
  const formularios: Formulario[] = [];
  const vistos = new Set<string>();
  for (const f of raw.formularios_requeridos ?? []) {
    const nombre = String(f.nombre ?? '').trim();
    if (!nombre || vistos.has(nombre.toLowerCase())) continue;
    vistos.add(nombre.toLowerCase());
    formularios.push({ nombre, obligatorio: Boolean(f.obligatorio), seccion: textoONull(f.seccion) });
  }
  return AnalisisSchema.parse({
    descripcion_llamado: String(raw.descripcion_llamado ?? '').trim().slice(0, 300),
    es_relevante: Boolean(raw.es_relevante),
    confianza: normalizarConfianza(raw.confianza),
    razon: String(raw.razon ?? '').trim(),
    materiales_detectados: materiales,
    resumen_trabajo: String(raw.resumen_trabajo ?? '').trim(),
    ubicacion_obra: textoONull(raw.ubicacion_obra),
    requiere_visita: Boolean(raw.requiere_visita),
    ubicacion_visita: textoONull(raw.ubicacion_visita),
    fecha_visita_especifica: normalizarFecha(raw.fecha_visita_especifica),
    coordina_visita: Boolean(raw.coordina_visita),
    contacto_visita_nombre: textoONull(raw.contacto_visita_nombre),
    contacto_visita_telefono: textoONull(raw.contacto_visita_telefono),
    contacto_visita_correo: normalizarCorreo(raw.contacto_visita_correo),
    formularios_requeridos: formularios,
  });
}

/**
 * Reglas de coherencia de visita técnica (reglas 1-4 del bash original):
 * 1. requiere_visita y sin ubicacion_visita → usar ubicacion_obra.
 * 2. requiere_visita, sin fecha y con contacto → coordina_visita = true.
 * 3. requiere_visita con fecha específica → coordina_visita = false.
 * 4. sin visita → se limpian todos los datos de visita.
 */
export function aplicarCoherenciaVisita(a: Analisis): { analisis: Analisis; ajustes: string[] } {
  const ajustes: string[] = [];
  const r: Analisis = { ...a };
  if (r.requiere_visita) {
    if (!r.ubicacion_visita && r.ubicacion_obra) {
      r.ubicacion_visita = r.ubicacion_obra;
      ajustes.push('ubicacion_visita ← ubicacion_obra');
    }
    if (!r.fecha_visita_especifica && (r.contacto_visita_telefono || r.contacto_visita_correo) && !r.coordina_visita) {
      r.coordina_visita = true;
      ajustes.push('contacto sin fecha → coordina_visita=true');
    }
    if (r.fecha_visita_especifica && r.coordina_visita) {
      r.coordina_visita = false;
      ajustes.push('fecha específica → coordina_visita=false');
    }
  } else if (r.ubicacion_visita || r.fecha_visita_especifica || r.coordina_visita || r.contacto_visita_nombre || r.contacto_visita_telefono || r.contacto_visita_correo) {
    r.ubicacion_visita = null;
    r.fecha_visita_especifica = null;
    r.coordina_visita = false;
    r.contacto_visita_nombre = null;
    r.contacto_visita_telefono = null;
    r.contacto_visita_correo = null;
    ajustes.push('sin visita → datos de visita limpiados');
  }
  return { analisis: r, ajustes };
}
