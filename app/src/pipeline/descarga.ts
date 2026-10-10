import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

export const DESCARGA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-UY,es;q=0.9,en;q=0.8',
  Referer: 'https://www.comprasestatales.gub.uy/',
};

const MAX_BYTES = 100 * 1024 * 1024; // 100 MB

/** Nombre de archivo seguro: solo basename, caracteres acotados, largo acotado, con hash corto de la URL. */
export function nombreSeguro(nombre: string, url: string): string {
  const base = path.basename(String(nombre ?? '').replace(/\\/g, '/')).normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const ext = path.extname(base).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 8);
  let cuerpo = base.slice(0, base.length - path.extname(base).length).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+|[._]+$/g, '');
  if (!cuerpo) cuerpo = 'archivo';
  cuerpo = cuerpo.slice(0, 80);
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 8);
  return `${cuerpo}-${hash}${ext}`;
}

export function idSeguro(llamadoId: string): string {
  const limpio = String(llamadoId).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40);
  return limpio || 'sin_id';
}

export interface Descarga {
  ruta: string;
  bytes: number;
  contentType: string | null;
}

/** Descarga un adjunto a DATA_DIR/<llamado_id>/<nombre saneado>. Nunca usa el nombre remoto crudo en el path. */
export async function descargarAdjunto(url: string, llamadoId: string, nombre: string, timeoutMs = 90_000): Promise<Descarga> {
  if (!/^https?:\/\//i.test(url)) throw new Error(`URL no soportada: ${url}`);
  const dir = path.join(config.DATA_DIR, 'adjuntos', idSeguro(llamadoId));
  await fs.mkdir(dir, { recursive: true });
  const ruta = path.join(dir, nombreSeguro(nombre, url));

  let res: Response | null = null;
  for (let intento = 1; intento <= 2; intento++) {
    try {
      res = await fetch(url, { headers: DESCARGA_HEADERS, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
      break;
    } catch (err) {
      if (intento === 2) throw err;
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
  if (!res) throw new Error(`sin respuesta al descargar ${url}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);
  const largo = Number(res.headers.get('content-length') ?? 0);
  if (largo > MAX_BYTES) throw new Error(`Archivo demasiado grande (${largo} bytes)`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error('Archivo descargado vacío (0 bytes)');
  if (buf.length > MAX_BYTES) throw new Error(`Archivo demasiado grande (${buf.length} bytes)`);
  await fs.writeFile(ruta, buf);
  return { ruta, bytes: buf.length, contentType: res.headers.get('content-type') };
}

export async function borrarArchivo(ruta: string): Promise<void> {
  await fs.rm(ruta, { force: true }).catch(() => undefined);
}
