import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { archivosEnDocumento, decodificarHtml, enlacesComentarios, esRedireccionIm, extraerIm } from '../src/pipeline/extract_im.js';

const fixtures = path.join(import.meta.dirname, 'fixtures');
const leer = (n: string) => decodificarHtml(fs.readFileSync(path.join(fixtures, n)));
const redirect = leer('im_redirect.html');
const pagina = leer('im_pagina.html');
const comentario = leer('im_comentario.html');
const URL_PAGINA = 'http://www.montevideo.gub.uy/asl/sistemas/siab/Cartelera.nsf/comprasconcomentarios/3A0B3FB7D1A6264B03258E87006E939A?OpenDocument';
const URL_COMENTARIO = 'http://www.montevideo.gub.uy/asl/sistemas/siab/Cartelera.nsf/0/B2DF90DD996D82A103258E87006FE5D3?OpenDocument';

describe('Intendencia de Montevideo', () => {
  it('detecta la redirección del HTML de ARCE', () => {
    expect(esRedireccionIm(redirect)).toBe(URL_PAGINA);
    expect(esRedireccionIm('<html>otra cosa</html>')).toBeNull();
  });
  it('decodifica ISO-8859-1 sin meta charset', () => {
    expect(pagina).toContain('Descripción');
    expect(pagina).toContain('Subtítulo');
    expect(pagina).not.toContain('�');
  });
  it('encuentra los documentos de comentarios', () => {
    const c = enlacesComentarios(pagina, URL_PAGINA);
    expect(c).toEqual([{ url: URL_COMENTARIO, titulo: 'Pliego del llamado ( 05/10/2026 )' }]);
  });
  it('encuentra los archivos reales ($FILE) del comentario', () => {
    const a = archivosEnDocumento(comentario, URL_COMENTARIO, 'Pliego del llamado');
    expect(a).toHaveLength(1);
    expect(a[0]!.nombre).toBe('D197462_202610051630_PL.PDF');
    expect(a[0]!.tipo).toBe('pdf');
    expect(a[0]!.archivo_url).toBe('http://www.montevideo.gub.uy/asl/sistemas/siab/Cartelera.nsf/0/b2df90dd996d82a103258e87006fe5d3/$FILE/D197462_202610051630_PL.PDF');
  });
  it('resuelve la cadena completa con fetch simulado', async () => {
    const visitadas: string[] = [];
    const fetchFake = async (url: string) => {
      visitadas.push(url);
      if (url === URL_PAGINA) return pagina;
      if (url === URL_COMENTARIO) return comentario;
      throw new Error('url inesperada ' + url);
    };
    const r = await extraerIm(redirect, fetchFake);
    expect(r.error).toBeUndefined();
    expect(visitadas).toEqual([URL_PAGINA, URL_COMENTARIO]);
    expect(r.texto).toContain('SUM PUERTA ALUMINIO');
    expect(r.texto).toContain('Suministro con colocación de 2 puertas de aluminio');
    expect(r.texto).not.toContain('<');
    expect(r.adjuntos.map((a) => a.nombre)).toEqual(['D197462_202610051630_PL.PDF']);
  });
  it('si falla la redirección devuelve error tipado', async () => {
    const r = await extraerIm(redirect, async () => {
      throw new Error('timeout');
    });
    expect(r.error).toMatch(/redirección/);
    expect(r.texto).toBe('');
  });
});
