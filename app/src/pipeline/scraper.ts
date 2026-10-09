import puppeteer, { type Browser, type Page } from 'puppeteer';
import { config } from '../config.js';
import { limpiarHtml } from '../utils/texto.js';
import { fechaDdMmAaaaAIso } from '../utils/fechas.js';

const BASE_URL = 'https://www.comprasestatales.gub.uy';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36';

export interface AclaracionScrape {
  fecha: string | null;
  hora: string | null;
  texto: string;
  archivo_url: string | null;
}

export interface AdjuntoScrape {
  nombre: string;
  tipo: string;
  archivo_url: string;
  label: string;
}

export interface ResultadoScrape {
  id: string;
  aclaraciones: AclaracionScrape[];
  archivos_adjuntos: AdjuntoScrape[];
  items_extraidos: string[];
  error?: string;
}

export const EXTENSIONES_CONOCIDAS = ['pdf', 'doc', 'docx', 'rtf', 'odt', 'txt', 'xls', 'xlsx', 'ods', 'csv', 'zip', 'rar', '7z', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp', 'html', 'htm', 'dwg', 'ppt', 'pptx'] as const;

export function tipoPorNombre(nombre: string | null | undefined): string {
  const m = /\.([a-z0-9]{2,5})$/i.exec((nombre ?? '').trim());
  const ext = m?.[1]?.toLowerCase();
  if (!ext) return 'otro';
  if (ext === 'htm') return 'html';
  if (ext === 'jpeg') return 'jpg';
  if (ext === 'tiff') return 'tif';
  return (EXTENSIONES_CONOCIDAS as readonly string[]).includes(ext) ? ext : 'otro';
}

export function absolutizar(href: string | null | undefined): string | null {
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) return href;
  return BASE_URL + (href.startsWith('/') ? '' : '/') + href;
}

/** Nombre de archivo a partir de la URL (último segmento, sin query), limpio de espacios. */
export function nombreDesdeUrl(url: string): string {
  try {
    const u = new URL(url);
    const ultimo = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '');
    return ultimo.replace(/\s+/g, '').trim() || 'archivo';
  } catch {
    return (url.split('/').pop() ?? 'archivo').replace(/\s+/g, '').trim() || 'archivo';
  }
}

function parsearFechaHora(raw: string): { fecha: string | null; hora: string | null } {
  const m = /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})/.exec(raw);
  if (!m) return { fecha: null, hora: null };
  const fecha = fechaDdMmAaaaAIso(m[1]);
  return { fecha, hora: fecha ? (m[2] ?? null) : null };
}

export async function abrirBrowser(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    ...(config.PUPPETEER_EXECUTABLE_PATH ? { executablePath: config.PUPPETEER_EXECUTABLE_PATH } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    defaultViewport: { width: 1366, height: 900 },
  });
}

async function prepararPagina(page: Page): Promise<void> {
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-UY,es;q=0.9,en;q=0.8' });
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const t = req.resourceType();
    if (['image', 'font', 'media', 'stylesheet'].includes(t)) void req.abort();
    else void req.continue();
  });
}

/** Port de src/scraper/scrape_arce.js: una page por llamado, browser compartido. */
export async function scrapeLlamado(browser: Browser, url: string, id: string, timeoutMs = 60_000): Promise<ResultadoScrape> {
  const vacio: ResultadoScrape = { id, aclaraciones: [], archivos_adjuntos: [], items_extraidos: [] };
  const page = await browser.newPage();
  try {
    await prepararPagina(page);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: timeoutMs });

    // 1) Aclaraciones
    const aclaracionesRaw = await page.$$eval('.aclaration-container tr', (rows) =>
      rows.map((tr) => {
        const td = tr.querySelector('td');
        const strong = td?.querySelector('strong');
        const fechaRaw = strong?.textContent ?? '';
        const textoNode = strong ? strong.parentNode : td;
        if (textoNode && strong) textoNode.removeChild(strong);
        const texto = textoNode ? (textoNode as HTMLElement).innerText?.trim() ?? textoNode.textContent?.trim() ?? '' : '';
        const link = tr.querySelector('a[href]')?.getAttribute('href') ?? null;
        return { fechaRaw, texto, link };
      }),
    );
    const aclaraciones: AclaracionScrape[] = aclaracionesRaw
      .map((a) => ({ ...parsearFechaHora(a.fechaRaw), texto: limpiarHtml(a.texto), archivo_url: absolutizar(a.link) }))
      .filter((a) => a.fecha || a.texto || a.archivo_url);

    // 2) Adjuntos
    const adjuntosRaw = await page.$$eval('ul.buy-detail-list', (blocks) =>
      blocks.map((ul) => {
        const link = ul.querySelector('a[href]');
        return { href: link?.getAttribute('href') ?? null, label: (ul as HTMLElement).innerText ?? ul.textContent ?? '' };
      }),
    );
    const vistos = new Set<string>();
    const archivos_adjuntos: AdjuntoScrape[] = [];
    for (const a of adjuntosRaw) {
      const archivo_url = absolutizar(a.href);
      if (!archivo_url || vistos.has(archivo_url)) continue;
      vistos.add(archivo_url);
      const nombre = nombreDesdeUrl(archivo_url);
      archivos_adjuntos.push({ nombre, tipo: tipoPorNombre(nombre), archivo_url, label: limpiarHtml(a.label).slice(0, 500) });
    }

    // 3) Ítems
    const items = await page.$$eval('.row.item .desc-item h3', (els) =>
      els.map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').replace(/Ítem\s*Nº\s*\d+/i, '').trim()).filter((t) => t.length > 0),
    );
    const items_extraidos = [...new Set(items.map((t) => limpiarHtml(t)).filter(Boolean))];

    return { id, aclaraciones, archivos_adjuntos, items_extraidos };
  } catch (err) {
    return { ...vacio, error: (err as Error).message };
  } finally {
    await page.close().catch(() => undefined);
  }
}
