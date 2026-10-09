import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { construirUrlRss, extraerFechaHoraApertura, parsearRss, separarPubDate } from '../src/pipeline/rss.js';
import { cargarRubro, filtrarCandidatos } from '../src/pipeline/filtro.js';

const TZ = 'America/Montevideo';
const xml = fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'rss_arce.xml'), 'utf8');

describe('rss', () => {
  it('parsea los ítems del RSS real', () => {
    const items = parsearRss(xml, TZ);
    expect(items).toHaveLength(7);
    const primero = items[0]!;
    expect(primero.id).toBe('i503354');
    expect(primero.url_detalle).toBe('http://www.comprasestatales.gub.uy/consultas/detalle/id/i503354');
    expect(primero.fecha_apertura).toBe('2026-10-14');
    expect(primero.hora_apertura).toBe('10:00');
    expect(primero.fecha_publicacion).toBe('2026-10-09');
    expect(primero.hora_publicacion).toBe('19:30');
    expect(primero.descripcion).toContain('Última Modificación: 09/10/2026');
    expect(primero.descripcion).not.toContain('&');
  });
  it('un ítem sin "Recepción de ofertas" queda sin fecha de apertura', () => {
    const items = parsearRss(xml, TZ);
    const sin = items.find((i) => i.descripcion.includes('TUBOS SECOS'));
    expect(sin?.fecha_apertura).toBeNull();
  });
  it('el filtro sobre el fixture deja solo los del rubro', () => {
    const { candidatos } = filtrarCandidatos(parsearRss(xml, TZ), cargarRubro('aluminio'), '2026-10-09');
    const ids = candidatos.map((c) => c.id).sort();
    // i503342 (cables de aluminio) y i503121 (panel led) pasan el pre-filtro: los descarta la IA.
    expect(ids).toEqual(['1377448', 'i502991', 'i503121', 'i503342']);
  });
  it('extrae fecha/hora de apertura con y sin acento', () => {
    expect(extraerFechaHoraApertura('x | Recepcion de ofertas hasta: 5/11/2026 9:30 hs')).toEqual({ fecha_apertura: '2026-11-05', hora_apertura: '09:30' });
    expect(extraerFechaHoraApertura('sin fecha')).toEqual({ fecha_apertura: null, hora_apertura: null });
  });
  it('pubDate se convierte a hora local de Montevideo sin corrimiento', () => {
    // 23:30 del 9/10 en UTC-3 = 02:30 del 10/10 en UTC: debe quedar el 9/10
    expect(separarPubDate('Fri, 09 Oct 2026 23:30:00 -0300', TZ)).toEqual({ fecha_publicacion: '2026-10-09', hora_publicacion: '23:30' });
    expect(separarPubDate('Sat, 10 Oct 2026 02:30:00 +0000', TZ)).toEqual({ fecha_publicacion: '2026-10-09', hora_publicacion: '23:30' });
  });
  it('arma la URL con el rango de días en hora local', () => {
    const url = construirUrlRss(60, TZ, new Date('2026-10-10T01:00:00Z')); // 22:00 del 9/10 en Montevideo
    expect(url).toContain('rango-fecha/2026-08-10%2B00:00:00_2026-10-09%2B23:59:59');
  });
});
