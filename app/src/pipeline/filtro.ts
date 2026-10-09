import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { APP_ROOT } from '../config.js';
import { coincidencias } from '../utils/texto.js';
import { diasEntre, urgenciaPorDias, type Urgencia } from '../utils/fechas.js';
import type { LlamadoRss } from './rss.js';

const RubroSchema = z.object({
  nombre: z.string(),
  descripcion: z.string(),
  keywords: z.array(z.string()).min(1),
  exclusiones: z.array(z.string()).default([]),
  materiales_ejemplo: z.array(z.string()).default([]),
  relevancia: z.object({
    relevante: z.array(z.string()),
    parcial: z.array(z.string()).default([]),
    no_relevante: z.array(z.string()),
    regla_clave: z.string(),
  }),
});
export type Rubro = z.infer<typeof RubroSchema>;

export const RUBROS_DIR = path.join(APP_ROOT, 'rubros');
const cache = new Map<string, Rubro>();

export function cargarRubro(nombre: string): Rubro {
  const hit = cache.get(nombre);
  if (hit) return hit;
  if (!/^[a-z0-9_-]+$/i.test(nombre)) throw new Error(`Nombre de rubro inválido: ${nombre}`);
  const archivo = path.join(RUBROS_DIR, `${nombre}.json`);
  if (!fs.existsSync(archivo)) throw new Error(`No existe el rubro "${nombre}" (${archivo})`);
  const rubro = RubroSchema.parse(JSON.parse(fs.readFileSync(archivo, 'utf8')));
  cache.set(nombre, rubro);
  return rubro;
}

export function rubrosDisponibles(): string[] {
  return fs.readdirSync(RUBROS_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
}

export interface Candidato extends LlamadoRss {
  dias_restantes: number | null;
  urgencia: Urgencia;
  keywords: string[];
}

export interface Evaluacion {
  ok: boolean;
  motivo?: 'sin_keywords' | 'exclusion' | 'sin_fecha_apertura' | 'apertura_vencida';
  keywords: string[];
  exclusiones: string[];
}

export function evaluarCandidato(item: LlamadoRss, rubro: Rubro, hoy: string): Evaluacion {
  const texto = `${item.titulo} ${item.descripcion}`;
  const keywords = coincidencias(texto, rubro.keywords);
  const exclusiones = coincidencias(texto, rubro.exclusiones);
  if (keywords.length === 0) return { ok: false, motivo: 'sin_keywords', keywords, exclusiones };
  if (exclusiones.length > 0) return { ok: false, motivo: 'exclusion', keywords, exclusiones };
  if (!item.fecha_apertura) return { ok: false, motivo: 'sin_fecha_apertura', keywords, exclusiones };
  const dias = diasEntre(hoy, item.fecha_apertura);
  if (dias === null || dias < 0) return { ok: false, motivo: 'apertura_vencida', keywords, exclusiones };
  return { ok: true, keywords, exclusiones };
}

export interface ResultadoFiltro {
  candidatos: Candidato[];
  descartados: Record<NonNullable<Evaluacion['motivo']>, number>;
}

export function filtrarCandidatos(items: LlamadoRss[], rubro: Rubro, hoy: string): ResultadoFiltro {
  const descartados = { sin_keywords: 0, exclusion: 0, sin_fecha_apertura: 0, apertura_vencida: 0 };
  const candidatos: Candidato[] = [];
  for (const item of items) {
    const ev = evaluarCandidato(item, rubro, hoy);
    if (!ev.ok) {
      if (ev.motivo) descartados[ev.motivo]++;
      continue;
    }
    const dias = item.fecha_apertura ? diasEntre(hoy, item.fecha_apertura) : null;
    candidatos.push({ ...item, dias_restantes: dias, urgencia: urgenciaPorDias(dias), keywords: ev.keywords });
  }
  candidatos.sort((a, b) => {
    const ka = `${a.fecha_publicacion ?? ''}T${a.hora_publicacion ?? ''}`;
    const kb = `${b.fecha_publicacion ?? ''}T${b.hora_publicacion ?? ''}`;
    return kb.localeCompare(ka);
  });
  return { candidatos, descartados };
}

/**
 * Segundo filtro (post-scraping): si el llamado tiene ítems y ninguno menciona una keyword del rubro,
 * se descarta. Sin ítems, se deja pasar (decide la IA).
 */
export function itemsCoinciden(items: string[], rubro: Rubro): { ok: boolean; keywords: string[] } {
  if (items.length === 0) return { ok: true, keywords: [] };
  const keywords = coincidencias(items.join(' \n '), rubro.keywords);
  return { ok: keywords.length > 0, keywords };
}
