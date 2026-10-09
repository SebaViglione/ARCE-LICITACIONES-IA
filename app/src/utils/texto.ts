// Utilidades de texto: decodificación de entidades HTML, limpieza y normalización
// (sin acentos, minúsculas) para comparar palabras completas.

const ENTIDADES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", sol: '/', ordm: 'º', ordf: 'ª', deg: '°',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', Uuml: 'Ü',
  iquest: '¿', iexcl: '¡', laquo: '«', raquo: '»', ndash: '–', mdash: '—', hellip: '…', middot: '·', euro: '€',
};

export function decodeHtml(texto: string): string {
  return String(texto ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, nombre: string) => ENTIDADES[nombre] ?? m);
}

/** Convierte HTML simple a texto plano: <br> → ' | ', quita etiquetas, decodifica entidades y colapsa espacios. */
export function limpiarHtml(texto: string): string {
  return decodeHtml(
    String(texto ?? '')
      .replace(/<br\s*\/?>/gi, ' | ')
      .replace(/<\/?(p|div|li|tr|h[1-6])[^>]*>/gi, ' | ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .replace(/(\s*\|\s*)+/g, ' | ')
    .replace(/^\s*\|\s*|\s*\|\s*$/g, '')
    .trim();
}

/** Texto plano sin etiquetas, conservando saltos de línea (para pliegos en HTML). */
export function htmlATextoPlano(html: string): string {
  return decodeHtml(
    String(html ?? '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6]|table)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Minúsculas y sin diacríticos (NFD). 'Ñ' → 'n', 'ü' → 'u'. */
export function normalizar(texto: string): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const cacheRegex = new Map<string, RegExp>();

/** Coincidencia por palabra/frase completa sobre texto ya normalizado. */
export function contienePalabra(textoNormalizado: string, termino: string): boolean {
  const t = normalizar(termino).trim();
  if (!t) return false;
  let re = cacheRegex.get(t);
  if (!re) {
    const cuerpo = escaparRegex(t).replace(/\s+/g, '\\s+');
    re = new RegExp(`(^|[^\\p{L}\\p{N}])${cuerpo}(?=$|[^\\p{L}\\p{N}])`, 'u');
    cacheRegex.set(t, re);
  }
  return re.test(textoNormalizado);
}

/** Devuelve los términos de la lista que aparecen como palabra completa en el texto. */
export function coincidencias(texto: string, terminos: readonly string[]): string[] {
  const n = normalizar(texto);
  return terminos.filter((t) => contienePalabra(n, t));
}

/** Quita caracteres de control (salvo \n y \t) que rompen JSON/Postgres. */
export function sinControles(texto: string): string {
  return String(texto ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

export function truncar(texto: string, max: number, sufijo = '… [TEXTO TRUNCADO]'): string {
  if (texto.length <= max) return texto;
  return texto.slice(0, Math.max(0, max - sufijo.length)) + sufijo;
}
