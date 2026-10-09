// Fechas en zona local del negocio (America/Montevideo) sin depender del TZ del proceso.

const ISO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface PartesFechaHora {
  fecha: string; // YYYY-MM-DD
  hora: string; // HH:MM
}

/** Partes de fecha/hora de un instante, expresadas en la zona horaria indicada. */
export function partesEnZona(instante: Date, tz: string): PartesFechaHora {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instante);
  const get = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '00';
  return { fecha: `${get('year')}-${get('month')}-${get('day')}`, hora: `${get('hour')}:${get('minute')}` };
}

export function hoyEnZona(tz: string, ahora: Date = new Date()): string {
  return partesEnZona(ahora, tz).fecha;
}

/** Días calendario entre `desde` y `hasta` (ambos YYYY-MM-DD). Positivo si `hasta` es futuro. */
export function diasEntre(desde: string, hasta: string): number | null {
  const a = ISO_FECHA.exec(desde);
  const b = ISO_FECHA.exec(hasta);
  if (!a || !b) return null;
  const ua = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  const ub = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
  return Math.round((ub - ua) / 86_400_000);
}

export type Urgencia = 'urgente' | 'próximo' | 'atención' | 'futuro' | 'desconocida';

export function urgenciaPorDias(dias: number | null): Urgencia {
  if (dias === null) return 'desconocida';
  if (dias <= 3) return 'urgente';
  if (dias <= 7) return 'próximo';
  if (dias <= 15) return 'atención';
  return 'futuro';
}

/** dd/mm/yyyy → yyyy-mm-dd (o null si no es válida). */
export function fechaDdMmAaaaAIso(texto: string | null | undefined): string | null {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(texto ?? '');
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const fecha = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  return esFechaIsoValida(fecha) ? fecha : null;
}

export function esFechaIsoValida(fecha: string): boolean {
  const m = ISO_FECHA.exec(fecha);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** Suma/resta días a una fecha YYYY-MM-DD. */
export function sumarDias(fecha: string, dias: number): string {
  const m = ISO_FECHA.exec(fecha);
  if (!m) throw new Error(`Fecha inválida: ${fecha}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + dias));
  return d.toISOString().slice(0, 10);
}
