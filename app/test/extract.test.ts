import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extraerTexto } from '../src/pipeline/extract.js';
import { nombreSeguro, idSeguro } from '../src/pipeline/descarga.js';

const fixtures = path.join(import.meta.dirname, 'fixtures');
const hay = (cmd: string) => {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

describe('extracción de texto', () => {
  it.skipIf(!hay('pdftotext'))('PDF con pdftotext', async () => {
    const r = await extraerTexto(path.join(fixtures, 'prueba.pdf'));
    expect(r.error).toBeUndefined();
    expect(r.texto).toContain('ventanas de aluminio DVH');
    expect(r.herramienta).toBe('pdftotext');
  });
  it.skipIf(!hay('pandoc'))('DOCX con pandoc', async () => {
    const r = await extraerTexto(path.join(fixtures, 'prueba.docx'));
    expect(r.error).toBeUndefined();
    expect(r.texto).toContain('mamparas de aluminio');
    expect(r.texto).toContain('Visita obligatoria');
  });
  it.skipIf(!hay('unzip') || !hay('pdftotext') || !hay('pandoc'))('ZIP recursivo', async () => {
    const r = await extraerTexto(path.join(fixtures, 'prueba.zip'));
    expect(r.error).toBeUndefined();
    expect(r.texto).toContain('--- Archivo: prueba.pdf ---');
    expect(r.texto).toContain('ventanas de aluminio DVH');
    expect(r.texto).toContain('mamparas de aluminio');
  });
  it('formato comprimido no soportado devuelve error tipado', async () => {
    const r = await extraerTexto('/tmp/no-existe.rar');
    expect(r.error).toBe('ERROR_FORMATO_COMPRIMIDO_NO_SOPORTADO');
    expect(r.texto).toBe('');
  });
  it('formato desconocido devuelve error tipado', async () => {
    const r = await extraerTexto('/tmp/no-existe.xyz');
    expect(r.error).toBe('ERROR_FORMATO_DESCONOCIDO');
  });
});

describe('nombres de archivo seguros', () => {
  it('sanea rutas y caracteres raros', () => {
    const n = nombreSeguro('../../etc/passwd', 'http://x/1');
    expect(n).not.toContain('/');
    expect(n).not.toContain('..');
    expect(nombreSeguro('Pliego Ñandú (final).PDF', 'http://x/2')).toMatch(/^Pliego_Nandu_final-[0-9a-f]{8}\.pdf$/);
    expect(nombreSeguro('', 'http://x/3')).toMatch(/^archivo-[0-9a-f]{8}$/);
  });
  it('distintas URLs con el mismo nombre no colisionan', () => {
    expect(nombreSeguro('pliego.pdf', 'http://a/pliego.pdf')).not.toBe(nombreSeguro('pliego.pdf', 'http://b/pliego.pdf'));
  });
  it('id de llamado seguro', () => {
    expect(idSeguro('i502991')).toBe('i502991');
    expect(idSeguro('../x')).toBe('_x');
  });
});
