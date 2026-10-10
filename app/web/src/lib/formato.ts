import type { Llamado } from './api';
import { ESTADOS_SEGUIMIENTO, type EstadoSeguimiento } from './api';

export function fechaCorta(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('es-UY');
}

export function horaCorta(v: string | null | undefined): string {
  return v ? v.slice(0, 5) : '';
}

export function fechaHora(f: string | null | undefined, h: string | null | undefined): string | null {
  const fc = fechaCorta(f);
  if (!fc) return null;
  const hc = horaCorta(h);
  return hc ? `${fc} ${hc}` : fc;
}

export function haceCuanto(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const min = Math.round(ms / 60000);
  if (min < 2) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 36) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

/** "Compra Directa D197530/2026 - Intendencia de Montevideo | Intendencia de Montevideo" → tipo y organismo */
export function partesTitulo(titulo: string | null | undefined): { tipo: string; organismo: string } {
  const t = String(titulo ?? '');
  const [tipo = '', resto = ''] = t.split(' - ');
  const organismo = resto.split(' | ')[0]?.trim() ?? '';
  return { tipo: tipo.trim(), organismo };
}

export function tituloLlamado(l: Pick<Llamado, 'ai_descripcion' | 'titulo'>): string {
  return l.ai_descripcion || l.titulo || 'Sin título';
}

export type Plazo = 'urgente' | 'proximo' | 'normal' | 'sin';

export function plazoDe(dias: number | null | undefined): Plazo {
  if (dias === null || dias === undefined) return 'sin';
  if (dias <= 3) return 'urgente';
  if (dias <= 7) return 'proximo';
  return 'normal';
}

export function textoDias(dias: number | null | undefined): { numero: string; etiqueta: string } {
  if (dias === null || dias === undefined) return { numero: '—', etiqueta: 'sin fecha' };
  if (dias < 0) return { numero: '0', etiqueta: 'vencido' };
  if (dias === 0) return { numero: 'hoy', etiqueta: 'abre' };
  if (dias === 1) return { numero: '1', etiqueta: 'día' };
  return { numero: String(dias), etiqueta: 'días' };
}

export function textoPlazo(dias: number | null | undefined): string {
  if (dias === null || dias === undefined) return 'Sin fecha de apertura';
  if (dias < 0) return 'Ya abrió';
  if (dias === 0) return 'Abre hoy';
  if (dias === 1) return 'Abre mañana';
  return `Faltan ${dias} días`;
}

export interface Grupo {
  clave: string;
  titulo: string;
  plazo: Plazo;
}

export function grupoDe(dias: number | null | undefined): Grupo {
  if (dias === null || dias === undefined) return { clave: 'sin', titulo: 'Sin fecha de apertura', plazo: 'sin' };
  if (dias <= 1) return { clave: 'hoy', titulo: 'Abre hoy o mañana', plazo: 'urgente' };
  if (dias <= 7) return { clave: 'semana', titulo: 'Abre esta semana', plazo: 'proximo' };
  if (dias <= 15) return { clave: 'quincena', titulo: 'Próximas dos semanas', plazo: 'normal' };
  return { clave: 'luego', titulo: 'Más adelante', plazo: 'normal' };
}

export function decisionTexto(l: Pick<Llamado, 'es_relevante_real' | 'estado_seguimiento'>): string {
  if (l.es_relevante_real === true) {
    const est = (l.estado_seguimiento ?? 'pendiente') as EstadoSeguimiento;
    return est === 'pendiente' ? 'Es para nosotros' : `Es para nosotros, ${ESTADOS_SEGUIMIENTO[est] ?? est}`;
  }
  if (l.es_relevante_real === false) return 'No es para nosotros';
  return 'Sin revisar';
}

export function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}
