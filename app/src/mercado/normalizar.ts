import { createHash } from 'node:crypto';

// Normalizaciones compartidas por la ingesta: lo que llega del scraper se lleva a claves estables
// (RUT, nombres, monedas, unidades, estados, tipos de compra) para que las estadísticas no se
// fragmenten por diferencias de escritura. Todo es determinista y sin acceso a la base.

/** Sin acentos, mayúsculas, solo letras/números separados por un espacio. */
export function normalizarTexto(v: string | null | undefined): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/** RUT uruguayo: 12 dígitos. Cualquier otra cosa se descarta (se identifica por nombre). */
export function normalizarRut(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const digitos = String(v).replace(/\D/g, '');
  return digitos.length === 12 ? digitos : null;
}

const MONEDAS: Record<string, string> = {
  UYU: 'UYU', '$': 'UYU', '$U': 'UYU', 'N$': 'UYU', PESOS: 'UYU', 'PESOS URUGUAYOS': 'UYU', 'PESO URUGUAYO': 'UYU', 'PESO': 'UYU',
  USD: 'USD', 'U$S': 'USD', 'US$': 'USD', DOLAR: 'USD', DOLARES: 'USD', 'DOLARES USA': 'USD', 'DOLAR USA': 'USD', 'DOLAR AMERICANO': 'USD', 'DOLARES AMERICANOS': 'USD',
  UI: 'UI', 'UNIDAD INDEXADA': 'UI', 'UNIDADES INDEXADAS': 'UI',
  UR: 'UR', 'UNIDAD REAJUSTABLE': 'UR', 'UNIDADES REAJUSTABLES': 'UR',
  EUR: 'EUR', '€': 'EUR', EURO: 'EUR', EUROS: 'EUR',
  ARS: 'ARS', 'PESO ARGENTINO': 'ARS', 'PESOS ARGENTINOS': 'ARS',
  BRL: 'BRL', REAL: 'BRL', REALES: 'BRL',
};

export function normalizarMoneda(v: string | null | undefined): string {
  if (!v) return 'UYU';
  const crudo = v.trim().toUpperCase();
  if (MONEDAS[crudo]) return MONEDAS[crudo];
  const limpio = normalizarTexto(crudo);
  if (MONEDAS[limpio]) return MONEDAS[limpio];
  return limpio.replace(/\s+/g, '_').slice(0, 10) || 'UYU';
}

const UNIDADES: Array<[string, string[]]> = [
  ['unidad', ['UNIDAD', 'UNIDADES', 'UN', 'U', 'UNID', 'UNI', 'UND', 'PIEZA', 'PIEZAS', 'PZA', 'PZAS', 'C U', 'CU', 'EQUIPO', 'EQUIPOS', 'JUEGO', 'JUEGOS', 'KIT', 'KITS', 'ARTICULO', 'ARTICULOS', 'ITEM', 'ITEMS', 'UNIDAD DE MEDIDA']],
  ['kg', ['KG', 'KGS', 'KILO', 'KILOS', 'KILOGRAMO', 'KILOGRAMOS']],
  ['g', ['G', 'GR', 'GRS', 'GRAMO', 'GRAMOS']],
  ['ton', ['TON', 'TONS', 'TONELADA', 'TONELADAS', 'T', 'TN']],
  ['l', ['L', 'LT', 'LTS', 'LITRO', 'LITROS']],
  ['ml', ['ML', 'MILILITRO', 'MILILITROS', 'CC', 'CM3']],
  ['m', ['M', 'MT', 'MTS', 'METRO', 'METROS', 'METRO LINEAL', 'METROS LINEALES', 'ML LINEAL']],
  ['m2', ['M2', 'M²', 'MTS2', 'METRO CUADRADO', 'METROS CUADRADOS']],
  ['m3', ['M3', 'M³', 'MTS3', 'METRO CUBICO', 'METROS CUBICOS']],
  ['cm', ['CM', 'CMS', 'CENTIMETRO', 'CENTIMETROS']],
  ['hora', ['HORA', 'HORAS', 'HS', 'H', 'HR', 'HRS']],
  ['dia', ['DIA', 'DIAS', 'JORNADA', 'JORNADAS']],
  ['mes', ['MES', 'MESES']],
  ['anio', ['ANIO', 'ANIOS', 'ANO', 'ANOS', 'AÑO', 'AÑOS']],
  ['caja', ['CAJA', 'CAJAS', 'CJ', 'CJA']],
  ['paquete', ['PAQUETE', 'PAQUETES', 'PAQ', 'PACK', 'PACKS']],
  ['rollo', ['ROLLO', 'ROLLOS']],
  ['bolsa', ['BOLSA', 'BOLSAS']],
  ['resma', ['RESMA', 'RESMAS']],
  ['par', ['PAR', 'PARES']],
  ['docena', ['DOCENA', 'DOCENAS', 'DOC']],
  ['global', ['GLOBAL', 'GL', 'PRECIO GLOBAL', 'SUMA ALZADA', 'TOTAL', 'LOTE', 'LOTES']],
  ['servicio', ['SERVICIO', 'SERVICIOS', 'SERV']],
  ['hoja', ['HOJA', 'HOJAS']],
  ['frasco', ['FRASCO', 'FRASCOS', 'FCO']],
  ['botella', ['BOTELLA', 'BOTELLAS', 'BOT']],
  ['bidon', ['BIDON', 'BIDONES']],
  ['lata', ['LATA', 'LATAS']],
  ['tubo', ['TUBO', 'TUBOS']],
  ['sobre', ['SOBRE', 'SOBRES']],
  ['ampolla', ['AMPOLLA', 'AMPOLLAS', 'AMP']],
  ['comprimido', ['COMPRIMIDO', 'COMPRIMIDOS', 'COMP', 'TABLETA', 'TABLETAS']],
  ['dosis', ['DOSIS']],
  ['km', ['KM', 'KMS', 'KILOMETRO', 'KILOMETROS']],
  ['persona', ['PERSONA', 'PERSONAS', 'PLAZA', 'PLAZAS', 'CUPO', 'CUPOS']],
  ['vale', ['VALE', 'VALES', 'TICKET', 'TICKETS']],
];
const UNIDAD_POR_ALIAS = new Map<string, string>();
for (const [canonica, alias] of UNIDADES) for (const a of alias) UNIDAD_POR_ALIAS.set(normalizarTexto(a), canonica);

/** Unidad de medida canónica (el precio unitario solo se compara dentro de la misma unidad). */
export function normalizarUnidad(v: string | null | undefined): string {
  const t = normalizarTexto(v);
  if (!t) return 'unidad';
  const directo = UNIDAD_POR_ALIAS.get(t);
  if (directo) return directo;
  // "UNIDAD (CU)" o "KILOGRAMO (KG)": probar cada paréntesis y cada palabra
  for (const parte of t.split(' ')) {
    const u = UNIDAD_POR_ALIAS.get(parte);
    if (u) return u;
  }
  return t.toLowerCase().replace(/\s+/g, '_').slice(0, 40);
}

export type EstadoLlamado = 'publicado' | 'en_evaluacion' | 'adjudicado' | 'desierto' | 'anulado' | 'sin_efecto' | 'otro';

export function normalizarEstado(v: string | null | undefined, tieneAdjudicaciones: boolean): EstadoLlamado {
  const t = normalizarTexto(v);
  if (/SIN EFECTO|DEJAD[OA] SIN/.test(t)) return 'sin_efecto';
  if (/ANUL|REVOC|CANCEL/.test(t)) return 'anulado';
  if (/DESIERT/.test(t)) return 'desierto';
  if (/ADJUDIC/.test(t)) return 'adjudicado';
  if (/EVALU|ESTUDIO|CERRAD|FINALIZ|EN PROCESO|APERTURA REALIZADA/.test(t)) return tieneAdjudicaciones ? 'adjudicado' : 'en_evaluacion';
  if (/PUBLIC|VIGENT|ABIERT|RECEPCION|LLAMADO/.test(t)) return tieneAdjudicaciones ? 'adjudicado' : 'publicado';
  return tieneAdjudicaciones ? 'adjudicado' : 'otro';
}

export type GrupoTipoCompra = 'licitacion_publica' | 'licitacion_abreviada' | 'compra_directa' | 'compra_directa_excepcion' | 'pregon' | 'convenio_marco' | 'concurso_precios' | 'procedimiento_especial' | 'otro';

export function grupoTipoCompra(v: string | null | undefined): GrupoTipoCompra {
  const t = normalizarTexto(v);
  if (!t) return 'otro';
  if (/LICITACION PUBLICA|LICITACION INTERNACIONAL/.test(t)) return 'licitacion_publica';
  if (/LICITACION ABREVIADA/.test(t)) return 'licitacion_abreviada';
  if (/COMPRA DIRECTA POR EXCEPCION|EXCEPCION/.test(t)) return 'compra_directa_excepcion';
  if (/COMPRA DIRECTA|CONTRATACION DIRECTA|COMPRA COMUN/.test(t)) return 'compra_directa';
  if (/PREGON|SUBASTA/.test(t)) return 'pregon';
  if (/CONVENIO MARCO|COMPRA CENTRALIZADA|CONVENIO/.test(t)) return 'convenio_marco';
  if (/CONCURSO DE PRECIOS/.test(t)) return 'concurso_precios';
  if (/PROCEDIMIENTO ESPECIAL|PROCEDIMIENTO COMPETITIVO|CONCURSO/.test(t)) return 'procedimiento_especial';
  return 'otro';
}

/**
 * Números como vienen de un portal uruguayo: 1.234,56 · 1234.56 · "$ 12.000" · " 3,5 ". Devuelve null si no es un número.
 * Con un solo punto se asume decimal (convención JSON); con punto y coma, el último separador es el decimal.
 */
export function numeroFlexible(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.replace(/[^\d.,-]/g, '');
  if (!s || s === '-' || s === '.' || s === ',') return null;
  const coma = s.lastIndexOf(',');
  const punto = s.lastIndexOf('.');
  if (coma > -1 && punto > -1) {
    s = coma > punto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (coma > -1) {
    s = s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (punto > -1 && s.split('.').length > 2) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function fechaValida(a: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31 || a < 1900 || a > 2200) return false;
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

/** Fecha a 'AAAA-MM-DD'. Acepta ISO (con o sin hora), dd/mm/aaaa y dd-mm-aaaa. */
export function fechaFlexible(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return fechaValida(+m[1]!, +m[2]!, +m[3]!) ? `${m[1]}-${m[2]}-${m[3]}` : null;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(s);
  if (m) {
    const d = m[1]!.padStart(2, '0');
    const mes = m[2]!.padStart(2, '0');
    return fechaValida(+m[3]!, +mes, +d) ? `${m[3]}-${mes}-${d}` : null;
  }
  return null;
}

/** Fecha y hora a ISO 8601. Sin zona se interpreta en Montevideo (-03:00). Solo fecha → medianoche de Montevideo. */
export function fechaHoraFlexible(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (m) {
    const t = new Date(`${m[1]}T${m[2]}${m[3] ?? '-03:00'}`);
    return Number.isNaN(t.getTime()) ? null : t.toISOString();
  }
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(s);
  if (m) {
    const fecha = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
    const hora = m[4] ? `${m[4].padStart(2, '0')}:${m[5]}` : '00:00';
    const t = new Date(`${fecha}T${hora}:00-03:00`);
    return Number.isNaN(t.getTime()) ? null : t.toISOString();
  }
  const soloFecha = fechaFlexible(s);
  if (soloFecha) return new Date(`${soloFecha}T00:00:00-03:00`).toISOString();
  return null;
}

export function claveOrganismo(inciso: string, unidad: string | null | undefined): string {
  return `${normalizarTexto(inciso)}|${normalizarTexto(unidad)}`;
}

function canonico(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonico);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .filter((k) => o[k] !== undefined)
        .map((k) => [k, canonico(o[k])]),
    );
  }
  return v;
}

/** sha256 del JSON con claves ordenadas: el mismo contenido da el mismo hash aunque cambie el orden. */
export function hashCanonico(v: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonico(v))).digest('hex');
}
