import { XMLParser } from 'fast-xml-parser';
import { limpiarHtml } from '../utils/texto.js';
import { fechaDdMmAaaaAIso, hoyEnZona, partesEnZona, sumarDias } from '../utils/fechas.js';

export interface LlamadoRss {
  id: string;
  titulo: string;
  descripcion: string;
  fecha_apertura: string | null;
  hora_apertura: string | null;
  fecha_publicacion: string | null;
  hora_publicacion: string | null;
  url_detalle: string;
}

export const RSS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 Safari/537.36',
  Accept: 'application/rss+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-UY,es;q=0.9',
  Referer: 'https://www.comprasestatales.gub.uy/consultas',
};

/** URL del RSS de ARCE para las publicaciones de los últimos `dias` días (en zona local). */
export function construirUrlRss(dias: number, tz: string, ahora: Date = new Date()): string {
  const hasta = hoyEnZona(tz, ahora);
  const desde = sumarDias(hasta, -dias);
  const rango = `${desde}%2B00:00:00_${hasta}%2B23:59:59`;
  return `https://www.comprasestatales.gub.uy/consultas/rss/tipo-pub/ALL/tipo-fecha/PUB/orden/ORD_PUB/tipo-orden/DESC/rango-fecha/${rango}`;
}

export async function descargarRss(url: string, timeoutMs = 60_000): Promise<string> {
  const res = await fetch(url, { headers: RSS_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`RSS respondió HTTP ${res.status}`);
  return res.text();
}

const RE_APERTURA = /Recepci(?:ó|o)n de ofertas hasta:\s*([0-3]?\d\/[01]?\d\/\d{4})\s+(\d{1,2}:\d{2})\s*h?s?/i;

export function extraerFechaHoraApertura(descripcionLimpia: string): { fecha_apertura: string | null; hora_apertura: string | null } {
  const m = RE_APERTURA.exec(descripcionLimpia);
  if (!m) return { fecha_apertura: null, hora_apertura: null };
  const fecha = fechaDdMmAaaaAIso(m[1]);
  const hora = (m[2] ?? '').padStart(5, '0');
  return { fecha_apertura: fecha, hora_apertura: fecha ? hora : null };
}

export function separarPubDate(pubDate: string | undefined, tz: string): { fecha_publicacion: string | null; hora_publicacion: string | null } {
  if (!pubDate) return { fecha_publicacion: null, hora_publicacion: null };
  const d = new Date(pubDate);
  if (Number.isNaN(d.getTime())) return { fecha_publicacion: null, hora_publicacion: null };
  const { fecha, hora } = partesEnZona(d, tz);
  return { fecha_publicacion: fecha, hora_publicacion: hora };
}

function idDesdeLink(link: string, fallback: string): string {
  const m = /id\/([A-Za-z0-9]+)/i.exec(link);
  if (m?.[1]) return m[1];
  return Buffer.from(fallback || 'sin_id').toString('base64url').slice(0, 20);
}

interface ItemXml {
  title?: unknown;
  link?: unknown;
  guid?: unknown;
  pubDate?: unknown;
  description?: unknown;
  'content:encoded'?: unknown;
}

const texto = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function parsearRss(xml: string, tz: string): LlamadoRss[] {
  const parser = new XMLParser({
    ignoreAttributes: true,
    cdataPropName: false,
    htmlEntities: false,
    parseTagValue: false,
    trimValues: true,
    isArray: (_nombre, jpath) => jpath === 'rss.channel.item',
  });
  const doc = parser.parse(xml) as { rss?: { channel?: { item?: ItemXml[] } } };
  const items = doc.rss?.channel?.item ?? [];

  return items.map((src) => {
    const link = texto(src.link || src.guid).trim();
    const descLimpia = limpiarHtml(texto(src.description || src['content:encoded']));
    const titulo = limpiarHtml(texto(src.title));
    return {
      id: idDesdeLink(link, link || titulo),
      titulo,
      descripcion: descLimpia,
      ...extraerFechaHoraApertura(descLimpia),
      ...separarPubDate(texto(src.pubDate) || undefined, tz),
      url_detalle: link,
    };
  });
}
