// Formato de números y montos en español rioplatense.

const fmtEntero = new Intl.NumberFormat('es-UY', { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat('es-UY', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt2 = new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function entero(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '—' : fmtEntero.format(n);
}

/** 1.234 → "1,2 k"; 12.400.000 → "12,4 M"; 3.200.000.000 → "3,2 mil M" */
export function compacto(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${fmt1.format(n / 1e9)} mil M`;
  if (abs >= 1e6) return `${fmt1.format(n / 1e6)} M`;
  if (abs >= 1e4) return `${fmt1.format(n / 1e3)} k`;
  return fmtEntero.format(n);
}

/** Monto en pesos uruguayos, compacto: "$ 12,4 M" */
export function montoUyu(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `$ ${compacto(n)}`;
}

/** Precio unitario en pesos: con centavos si es chico. */
export function precioUyu(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (Math.abs(n) < 100) return `$ ${fmt2.format(n)}`;
  return `$ ${fmtEntero.format(n)}`;
}

export function porcentaje(x: number | null | undefined, decimales = 0): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  const f = decimales ? new Intl.NumberFormat('es-UY', { maximumFractionDigits: decimales }) : fmtEntero;
  return `${f.format(x * 100)} %`;
}

/** Variación relativa con signo: +12 % / −8 % */
export function variacion(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  const v = Math.round(x * 100);
  return v > 0 ? `+${v} %` : v < 0 ? `−${Math.abs(v)} %` : '0 %';
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];

/** '2025-03-01' → 'mar 25' */
export function mesCorto(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${MESES[Number(m[2]) - 1]} ${m[1]!.slice(2)}`;
}

/** '2025-03' → 'marzo 2025' */
export function mesLargo(aaaaMm: string | null | undefined): string {
  if (!aaaaMm) return '';
  const m = /^(\d{4})-(\d{2})/.exec(aaaaMm);
  if (!m) return aaaaMm;
  const nombres = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${nombres[Number(m[2]) - 1]} ${m[1]}`;
}

/** Resta meses a un 'AAAA-MM' */
export function restarMeses(aaaaMm: string, meses: number): string {
  const [a, m] = aaaaMm.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(a, m - 1 - meses, 1));
  return d.toISOString().slice(0, 7);
}

export const UNIDADES_LEGIBLES: Record<string, string> = {
  unidad: 'unidad', kg: 'kg', g: 'g', ton: 'tonelada', l: 'litro', ml: 'ml', m: 'metro', m2: 'm²', m3: 'm³', cm: 'cm', hora: 'hora', dia: 'día', mes: 'mes', anio: 'año',
  caja: 'caja', paquete: 'paquete', rollo: 'rollo', bolsa: 'bolsa', resma: 'resma', par: 'par', docena: 'docena', global: 'global', servicio: 'servicio', hoja: 'hoja',
  frasco: 'frasco', botella: 'botella', bidon: 'bidón', lata: 'lata', tubo: 'tubo', sobre: 'sobre', ampolla: 'ampolla', comprimido: 'comprimido', dosis: 'dosis', km: 'km', persona: 'persona', vale: 'vale',
};

export function unidadLegible(u: string | null | undefined): string {
  if (!u) return 'unidad';
  return UNIDADES_LEGIBLES[u] ?? u.replace(/_/g, ' ');
}

export const TIPOS_COMPRA: Record<string, string> = {
  licitacion_publica: 'Licitación pública',
  licitacion_abreviada: 'Licitación abreviada',
  compra_directa: 'Compra directa',
  compra_directa_excepcion: 'Compra directa por excepción',
  pregon: 'Pregón',
  convenio_marco: 'Convenio marco',
  concurso_precios: 'Concurso de precios',
  procedimiento_especial: 'Procedimiento especial',
  otro: 'Otro',
};

export const ESTADOS_LLAMADO: Record<string, string> = {
  publicado: 'Publicados',
  en_evaluacion: 'En evaluación',
  adjudicado: 'Adjudicados',
  desierto: 'Desiertos',
  anulado: 'Anulados',
  sin_efecto: 'Sin efecto',
  otro: 'Otros',
};
