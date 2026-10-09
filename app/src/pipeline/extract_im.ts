// Port de extract_im_html.sh: pliegos de la Intendencia de Montevideo (IM).
//
// Cadena real (relevada el 9/10/2026):
//   1. ARCE publica un .html de 263 bytes: "Haga click aqui para acceder al detalle de la compra" → URL en montevideo.gub.uy
//   2. La página IM (Cartelera.nsf/.../?OpenDocument, ISO-8859-1) trae título, observaciones, lugar de entrega,
//      fecha límite y una lista de "Comentarios, aclaraciones y modificaciones" (cada uno abre otro documento).
//   3. Cada documento de comentario enlaza los archivos reales: .../$FILE/<NOMBRE>.PDF
// Algunas páginas (formato viejo) traen los datos en <input type="hidden"> (Departamento, NroCompra, Comentarios...).
import { decodeHtml, htmlATextoPlano, limpiarHtml } from '../utils/texto.js';
import { DESCARGA_HEADERS } from './descarga.js';
import { tipoPorNombre } from './scraper.js';

export const IM_BASE = 'http://www.montevideo.gub.uy';

export interface AdjuntoIm {
  nombre: string;
  tipo: string;
  archivo_url: string;
  label: string;
}

export interface ResultadoIm {
  texto: string;
  items: string[];
  adjuntos: AdjuntoIm[];
  metadata: Record<string, string>;
  paginas_visitadas: string[];
  error?: string;
}

export type FetchHtml = (url: string) => Promise<string>;

/** Descarga HTML respetando el charset real (las páginas IM son ISO-8859-1 sin meta charset). */
export async function fetchHtmlIm(url: string, timeoutMs = 60_000): Promise<string> {
  const res = await fetch(url, { headers: DESCARGA_HEADERS, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return decodificarHtml(Buffer.from(await res.arrayBuffer()), res.headers.get('content-type'));
}

export function decodificarHtml(buf: Buffer, contentType?: string | null): string {
  const declarado = /charset=([\w-]+)/i.exec(contentType ?? '')?.[1]?.toLowerCase();
  const cabecera = buf.subarray(0, 2048).toString('latin1');
  const meta = /charset=["']?([\w-]+)/i.exec(cabecera)?.[1]?.toLowerCase();
  const charset = meta ?? declarado;
  if (charset && /8859|latin|windows-1252|ansi/.test(charset)) return buf.toString('latin1');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return buf.toString('latin1');
  }
}

export function esRedireccionIm(html: string): string | null {
  if (!/Haga click aqui para acceder/i.test(html)) return null;
  const m = /HREF\s*=\s*"([^"]+)"/i.exec(html);
  return m?.[1] ?? null;
}

export function esHtmlIm(html: string): boolean {
  return /montevideo\.gub\.uy|Cartelera\.nsf|Haga click aqui para acceder/i.test(html);
}

function absolutaIm(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href.startsWith('/') ? IM_BASE + href : href;
  }
}

export function valoresOcultos(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const nombre = m[1]!;
    if (!(nombre in out)) out[nombre] = decodeHtml(m[2] ?? '').trim();
  }
  return out;
}

/** Ítems del formato viejo: tabla CANTIDAD / ARTICULO / UNIDAD con celdas cyan (#C2EFFF). */
export function itemsFormatoViejo(html: string): string[] {
  if (!/ARTICULO/i.test(html)) return [];
  const seccion = html.split(/ARTICULO/i).slice(1).join(' ').split(/Pliego sin costo|<\/table>/i)[0] ?? '';
  const celdas = [...seccion.matchAll(/<td[^>]*bgcolor="#C2EFFF"[^>]*>([\s\S]*?)<\/td>/gi)]
    .map((c) => limpiarHtml(c[1] ?? ''))
    .filter((v) => v && !/^(CANTIDAD|ARTICULO|UNIDAD)$/i.test(v));
  const items: string[] = [];
  for (let i = 0; i + 1 < celdas.length; i += 2) items.push(`${celdas[i]} - ${celdas[i + 1]}`);
  return items;
}

/** Documentos de "Comentarios, aclaraciones y modificaciones" de la página principal IM. */
export function enlacesComentarios(html: string, base: string): Array<{ url: string; titulo: string }> {
  const out: Array<{ url: string; titulo: string }> = [];
  const vistos = new Set<string>();
  const re = /open\(\s*'([^']*Cartelera\.nsf[^']*OpenDocument[^']*)'[^>]*>([\s\S]*?)<\/SPAN>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const url = absolutaIm(m[1]!, base);
    if (vistos.has(url)) continue;
    vistos.add(url);
    out.push({ url, titulo: limpiarHtml(m[2] ?? '') || 'Comentario' });
  }
  // Formato viejo: campo oculto Comentarios = "ID#Titulo##, ID#Titulo##"
  const ocultos = valoresOcultos(html);
  if (ocultos.Comentarios) {
    for (const parte of ocultos.Comentarios.split(',')) {
      const [id, titulo] = parte.trim().split('#');
      if (!id || !titulo) continue;
      const url = `${IM_BASE}/asl/sistemas/siab/Cartelera.nsf/0/${id}?OpenDocument`;
      if (vistos.has(url)) continue;
      vistos.add(url);
      out.push({ url, titulo: titulo.trim() });
    }
  }
  return out;
}

/** Archivos reales ($FILE/...) enlazados en un documento de comentario. */
export function archivosEnDocumento(html: string, base: string, label: string): AdjuntoIm[] {
  const out: AdjuntoIm[] = [];
  const vistos = new Set<string>();
  const re = /href="([^"]*\$FILE\/[^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const url = absolutaIm(decodeHtml(m[1]!), base);
    if (vistos.has(url)) continue;
    vistos.add(url);
    const nombre = decodeURIComponent(url.split('/').pop() ?? 'archivo').replace(/\s+/g, '_');
    out.push({ nombre, tipo: tipoPorNombre(nombre), archivo_url: url, label });
  }
  return out;
}

function textoPrincipal(html: string): string {
  const plano = htmlATextoPlano(html);
  // Quita el ruido de navegación de las páginas Lotus Notes
  return plano
    .replace(/^\s*>\s*(Atrás|Imprimir|Cerrar)\s*$/gim, '')
    .replace(/^\s*[.\s]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Resuelve un pliego HTML de IM: sigue la redirección, extrae texto/metadata/ítems de la página
 * y descubre los archivos reales en los documentos de comentarios.
 */
export async function extraerIm(htmlInicial: string, fetchHtml: FetchHtml = fetchHtmlIm): Promise<ResultadoIm> {
  const paginas: string[] = [];
  let html = htmlInicial;
  let base = IM_BASE;
  const redir = esRedireccionIm(html);
  if (redir) {
    base = redir;
    paginas.push(redir);
    try {
      html = await fetchHtml(redir);
    } catch (err) {
      return { texto: '', items: [], adjuntos: [], metadata: {}, paginas_visitadas: paginas, error: `No se pudo descargar la página de redirección: ${(err as Error).message}` };
    }
  }

  const ocultos = valoresOcultos(html);
  const metadata: Record<string, string> = {};
  for (const k of ['Departamento', 'Division', 'Servicio', 'Direccion', 'ProcCompra', 'NroCompra', 'Fecha', 'CantItems']) {
    if (ocultos[k]) metadata[k.toLowerCase()] = ocultos[k]!;
  }
  if (!metadata.fecha && ocultos.Fecha_Dia && ocultos.Fecha_Mes && ocultos.Fecha_Anio) {
    metadata.fecha = `${ocultos.Fecha_Dia}/${ocultos.Fecha_Mes}/${ocultos.Fecha_Anio} ${ocultos.Fecha_Hora ?? ''}:${ocultos.Fecha_Min ?? ''}`.trim();
  }

  const items = itemsFormatoViejo(html);
  const adjuntos: AdjuntoIm[] = [];
  const comentarios = enlacesComentarios(html, base);
  const textosComentarios: string[] = [];
  for (const c of comentarios.slice(0, 10)) {
    paginas.push(c.url);
    try {
      const doc = await fetchHtml(c.url);
      adjuntos.push(...archivosEnDocumento(doc, c.url, c.titulo));
      const t = textoPrincipal(doc).replace(/Cerrar|Imprimir/g, '').trim();
      if (t) textosComentarios.push(`[${c.titulo}] ${t}`.slice(0, 2000));
    } catch (err) {
      textosComentarios.push(`[${c.titulo}] (no se pudo abrir: ${(err as Error).message})`);
    }
  }

  const partes: string[] = [];
  const cab = [metadata.proccompra, metadata.nrocompra].filter(Boolean).join(' ');
  if (cab) partes.push(cab);
  if (metadata.departamento) partes.push(metadata.departamento);
  if (metadata.division) partes.push(metadata.division);
  if (metadata.servicio) partes.push(metadata.servicio);
  if (metadata.direccion) partes.push(`Lugar de entrega: ${metadata.direccion}`);
  if (metadata.fecha) partes.push(`Fecha Apertura: ${metadata.fecha}`);
  const cuerpo = textoPrincipal(html);
  if (cuerpo) partes.push(cuerpo);
  if (items.length) partes.push(`Items: ${items.join(' | ')}`);
  if (textosComentarios.length) partes.push(`Comentarios/aclaraciones:\n${textosComentarios.join('\n')}`);
  if (adjuntos.length) partes.push(`Archivos adjuntos descubiertos: ${adjuntos.map((a) => a.nombre).join(', ')}`);

  return { texto: partes.join('\n\n').trim(), items, adjuntos, metadata, paginas_visitadas: paginas };
}
