import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { htmlATextoPlano, sinControles, truncar } from '../utils/texto.js';

const execFileAsync = promisify(execFile);

export const TIMEOUT_MS = 120_000;
const MAX_BUFFER = 64 * 1024 * 1024;
const MAX_CHARS_TEXTO = 300_000;
const MIN_CHARS_PDF = 50;

export interface Extraccion {
  texto: string;
  error?: string;
  herramienta?: string;
}

export type ErrorExtraccion =
  | 'ERROR_PDF_NO_EXTRAIBLE'
  | 'ERROR_DOC_NO_EXTRAIBLE'
  | 'ERROR_DOCX_NO_EXTRAIBLE'
  | 'ERROR_ODT_NO_EXTRAIBLE'
  | 'ERROR_EXCEL_NO_EXTRAIBLE'
  | 'ERROR_ZIP_SIN_CONTENIDO_EXTRAIBLE'
  | 'ERROR_OCR_FALLO'
  | 'ERROR_FORMATO_COMPRIMIDO_NO_SOPORTADO'
  | 'ERROR_FORMATO_DESCONOCIDO'
  | 'ERROR_HTML_VACIO'
  | 'ERROR_HERRAMIENTA_NO_DISPONIBLE';

/** Ejecuta una herramienta externa sin shell. Devuelve '' si falla o no existe (el llamador decide). */
async function correr(cmd: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<{ stdout: string; ok: boolean; error?: string }> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: opts.timeoutMs ?? TIMEOUT_MS, maxBuffer: MAX_BUFFER, encoding: 'utf8', windowsHide: true });
    return { stdout, ok: true };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string };
    const error = e.code === 'ENOENT' ? `${cmd} no está instalado` : e.message;
    return { stdout: e.stdout ?? '', ok: false, error };
  }
}

function limpiar(texto: string): string {
  return truncar(
    sinControles(texto)
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim(),
    MAX_CHARS_TEXTO,
  );
}

export function extensionDe(ruta: string): string {
  const ext = path.extname(ruta).toLowerCase().replace('.', '');
  if (ext === 'htm') return 'html';
  if (ext === 'jpeg') return 'jpg';
  if (ext === 'tiff') return 'tif';
  return ext;
}

async function pdf(ruta: string): Promise<Extraccion> {
  const r = await correr('pdftotext', ['-layout', '-enc', 'UTF-8', ruta, '-']);
  let texto = limpiar(r.stdout);
  if (texto.length >= MIN_CHARS_PDF) return { texto, herramienta: 'pdftotext' };
  // PDF escaneado: OCR de las primeras páginas (pdftoppm + tesseract)
  const ocr = await ocrPdf(ruta);
  if (ocr.texto.length >= MIN_CHARS_PDF) return ocr;
  texto = texto || ocr.texto;
  return { texto, error: 'ERROR_PDF_NO_EXTRAIBLE', herramienta: ocr.herramienta };
}

async function ocrPdf(ruta: string, maxPaginas = 8): Promise<Extraccion> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'arce-ocr-'));
  try {
    const prefijo = path.join(tmp, 'pag');
    const ppm = await correr('pdftoppm', ['-r', '200', '-l', String(maxPaginas), '-png', ruta, prefijo]);
    if (!ppm.ok) return { texto: '', error: ppm.error, herramienta: 'pdftoppm' };
    const paginas = (await fs.readdir(tmp)).filter((f) => f.endsWith('.png')).sort();
    const partes: string[] = [];
    for (const p of paginas) {
      const t = await correr('tesseract', [path.join(tmp, p), '-', '-l', 'spa']);
      if (!t.ok && t.error?.includes('no está instalado')) return { texto: '', error: t.error, herramienta: 'tesseract' };
      if (t.stdout.trim()) partes.push(t.stdout);
    }
    return { texto: limpiar(partes.join('\n\n')), herramienta: 'tesseract' };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function pandoc(ruta: string, errorCodigo: ErrorExtraccion, formato?: string): Promise<Extraccion> {
  const args = formato ? ['-f', formato, '-t', 'plain', '--wrap=none', ruta] : ['-t', 'plain', '--wrap=none', ruta];
  const r = await correr('pandoc', args);
  const texto = limpiar(r.stdout);
  if (texto) return { texto, herramienta: 'pandoc' };
  return { texto: '', error: r.error?.includes('no está instalado') ? 'ERROR_HERRAMIENTA_NO_DISPONIBLE' : errorCodigo, herramienta: 'pandoc' };
}

async function doc(ruta: string): Promise<Extraccion> {
  const r = await correr('antiword', [ruta]);
  const texto = limpiar(r.stdout);
  if (texto) return { texto, herramienta: 'antiword' };
  return pandoc(ruta, 'ERROR_DOC_NO_EXTRAIBLE');
}

async function imagen(ruta: string): Promise<Extraccion> {
  const r = await correr('tesseract', [ruta, '-', '-l', 'spa']);
  const texto = limpiar(r.stdout);
  if (texto) return { texto, herramienta: 'tesseract' };
  return { texto: '', error: r.error?.includes('no está instalado') ? 'ERROR_HERRAMIENTA_NO_DISPONIBLE' : 'ERROR_OCR_FALLO', herramienta: 'tesseract' };
}

async function zip(ruta: string, profundidad: number): Promise<Extraccion> {
  if (profundidad > 2) return { texto: '', error: 'ERROR_ZIP_SIN_CONTENIDO_EXTRAIBLE' };
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'arce-zip-'));
  try {
    const r = await correr('unzip', ['-qq', '-o', '-j', ruta, '-d', tmp]);
    if (!r.ok && r.error?.includes('no está instalado')) return { texto: '', error: 'ERROR_HERRAMIENTA_NO_DISPONIBLE', herramienta: 'unzip' };
    const archivos = (await fs.readdir(tmp)).sort();
    const partes: string[] = [];
    for (const a of archivos) {
      const interno = path.join(tmp, a);
      const ext = extensionDe(interno);
      if (!EXTRAIBLES.has(ext)) continue;
      const e = await extraerTexto(interno, profundidad + 1);
      if (e.texto) partes.push(`--- Archivo: ${a} ---\n${e.texto}`);
    }
    const texto = limpiar(partes.join('\n\n'));
    if (texto) return { texto, herramienta: 'unzip' };
    return { texto: '', error: 'ERROR_ZIP_SIN_CONTENIDO_EXTRAIBLE', herramienta: 'unzip' };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function html(ruta: string): Promise<Extraccion> {
  const crudo = await fs.readFile(ruta, 'utf8');
  const texto = limpiar(htmlATextoPlano(crudo));
  if (texto) return { texto, herramienta: 'html' };
  return { texto: '', error: 'ERROR_HTML_VACIO', herramienta: 'html' };
}

export const EXTRAIBLES = new Set(['pdf', 'doc', 'docx', 'rtf', 'odt', 'txt', 'csv', 'xls', 'xlsx', 'ods', 'zip', 'html', 'jpg', 'png', 'tif', 'bmp']);

/** Port de extract_text.sh: texto plano a partir de un archivo según su extensión. */
export async function extraerTexto(ruta: string, profundidad = 0): Promise<Extraccion> {
  const ext = extensionDe(ruta);
  switch (ext) {
    case 'pdf':
      return pdf(ruta);
    case 'doc':
      return doc(ruta);
    case 'docx':
      return pandoc(ruta, 'ERROR_DOCX_NO_EXTRAIBLE');
    case 'rtf':
      return pandoc(ruta, 'ERROR_DOCX_NO_EXTRAIBLE', 'rtf');
    case 'odt':
      return pandoc(ruta, 'ERROR_ODT_NO_EXTRAIBLE');
    case 'xls':
    case 'xlsx':
    case 'ods':
      return pandoc(ruta, 'ERROR_EXCEL_NO_EXTRAIBLE');
    case 'txt':
    case 'csv': {
      const texto = limpiar(await fs.readFile(ruta, 'utf8'));
      return { texto, herramienta: 'txt' };
    }
    case 'zip':
      return zip(ruta, profundidad);
    case 'html':
      return html(ruta);
    case 'jpg':
    case 'png':
    case 'tif':
    case 'bmp':
      return imagen(ruta);
    case 'rar':
    case '7z':
    case 'tar':
    case 'gz':
      return { texto: '', error: 'ERROR_FORMATO_COMPRIMIDO_NO_SOPORTADO' };
    default:
      return { texto: '', error: 'ERROR_FORMATO_DESCONOCIDO' };
  }
}
