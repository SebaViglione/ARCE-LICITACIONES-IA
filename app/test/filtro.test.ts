import { describe, expect, it } from 'vitest';
import { coincidencias, contienePalabra, normalizar, limpiarHtml, decodeHtml } from '../src/utils/texto.js';
import { cargarRubro, evaluarCandidato, filtrarCandidatos, itemsCoinciden } from '../src/pipeline/filtro.js';
import type { LlamadoRss } from '../src/pipeline/rss.js';

const base: LlamadoRss = {
  id: 'x1',
  titulo: 'Compra Directa 1/2026 - Organismo',
  descripcion: 'Suministro con colocación de ventanas de aluminio. Recepción de ofertas hasta: 20/10/2026 10:00hs',
  fecha_apertura: '2026-10-20',
  hora_apertura: '10:00',
  fecha_publicacion: '2026-10-09',
  hora_publicacion: '12:00',
  url_detalle: 'http://www.comprasestatales.gub.uy/consultas/detalle/id/x1',
};
const HOY = '2026-10-09';

describe('texto', () => {
  it('normaliza acentos y mayúsculas', () => {
    expect(normalizar('Carpintería Metálica Ñandú')).toBe('carpinteria metalica nandu');
  });
  it('decodifica entidades HTML de ARCE', () => {
    expect(decodeHtml('09&sol;10&sol;2026&nbsp;&Uacute;ltima Modificaci&oacute;n &#233;')).toBe('09/10/2026 Última Modificación é');
  });
  it('limpia HTML con <br/> como separador', () => {
    expect(limpiarHtml('Hola<br/> Recepción: 1<br/>Publicado:&nbsp;x')).toBe('Hola | Recepción: 1 | Publicado: x');
  });
  it('matchea por palabra completa, no por substring', () => {
    expect(contienePalabra(normalizar('tubos de pan dulce'), 'pan')).toBe(true);
    expect(contienePalabra(normalizar('paneles solares'), 'pan')).toBe(false);
    expect(contienePalabra(normalizar('obra sobre la calle Toledo'), 'sobre')).toBe(true);
    expect(contienePalabra(normalizar('calle Toledo'), 'led')).toBe(false);
    expect(contienePalabra(normalizar('CARPINTERÍA   METÁLICA'), 'carpintería metálica')).toBe(true);
    expect(contienePalabra(normalizar('ventanas.'), 'ventanas')).toBe(true);
    expect(contienePalabra(normalizar('(aluminio)'), 'aluminio')).toBe(true);
  });
  it('coincidencias devuelve los términos encontrados', () => {
    expect(coincidencias('Puertas y ventanas de aluminio', ['aluminio', 'ventanas', 'pan'])).toEqual(['aluminio', 'ventanas']);
  });
});

describe('filtro de candidatos', () => {
  const rubro = cargarRubro('aluminio');

  it('acepta un llamado con keyword y apertura futura', () => {
    const ev = evaluarCandidato(base, rubro, HOY);
    expect(ev.ok).toBe(true);
    expect(ev.keywords).toContain('aluminio');
    expect(ev.keywords).toContain('ventanas');
  });
  it('rechaza sin keywords', () => {
    expect(evaluarCandidato({ ...base, descripcion: 'Servicio de limpieza de plazas' }, rubro, HOY).motivo).toBe('sin_keywords');
  });
  it('rechaza por exclusión como palabra completa', () => {
    expect(evaluarCandidato({ ...base, descripcion: 'Ventanas para computadoras y software' }, rubro, HOY).motivo).toBe('exclusion');
  });
  it('no excluye por substring (Toledo, paneles, sobre la calle)', () => {
    const ev = evaluarCandidato({ ...base, descripcion: 'Paneles de aluminio sobre la calle Toledo' }, rubro, HOY);
    expect(ev.ok).toBe(true);
  });
  it('"en el marco de" no es keyword', () => {
    expect(evaluarCandidato({ ...base, descripcion: 'Contratación de personal en el marco del programa' }, rubro, HOY).motivo).toBe('sin_keywords');
  });
  it('rechaza apertura vencida y sin fecha', () => {
    expect(evaluarCandidato({ ...base, fecha_apertura: '2026-10-08' }, rubro, HOY).motivo).toBe('apertura_vencida');
    expect(evaluarCandidato({ ...base, fecha_apertura: null }, rubro, HOY).motivo).toBe('sin_fecha_apertura');
  });
  it('apertura hoy cuenta como válida (0 días, urgente)', () => {
    const { candidatos } = filtrarCandidatos([{ ...base, fecha_apertura: HOY }], rubro, HOY);
    expect(candidatos).toHaveLength(1);
    expect(candidatos[0]!.dias_restantes).toBe(0);
    expect(candidatos[0]!.urgencia).toBe('urgente');
  });
  it('calcula urgencia por días', () => {
    const { candidatos } = filtrarCandidatos(
      [
        { ...base, id: 'a', fecha_apertura: '2026-10-12' },
        { ...base, id: 'b', fecha_apertura: '2026-10-16' },
        { ...base, id: 'c', fecha_apertura: '2026-10-24' },
        { ...base, id: 'd', fecha_apertura: '2026-12-01' },
      ],
      rubro,
      HOY,
    );
    const porId = Object.fromEntries(candidatos.map((c) => [c.id, c]));
    expect(porId.a!.urgencia).toBe('urgente');
    expect(porId.b!.urgencia).toBe('próximo');
    expect(porId.c!.urgencia).toBe('atención');
    expect(porId.d!.urgencia).toBe('futuro');
  });
  it('ordena por publicación descendente', () => {
    const { candidatos } = filtrarCandidatos(
      [
        { ...base, id: 'viejo', fecha_publicacion: '2026-10-01' },
        { ...base, id: 'nuevo', fecha_publicacion: '2026-10-08' },
      ],
      rubro,
      HOY,
    );
    expect(candidatos.map((c) => c.id)).toEqual(['nuevo', 'viejo']);
  });
  it('filtro por ítems: sin ítems pasa; con ítems sin keywords no', () => {
    expect(itemsCoinciden([], rubro).ok).toBe(true);
    expect(itemsCoinciden(['Resmas de papel A4'], rubro).ok).toBe(false);
    expect(itemsCoinciden(['Resmas de papel A4', 'Ventana corrediza'], rubro).ok).toBe(true);
  });
});
