import { describe, expect, it } from 'vitest';
import { esquemasJson, LlamadoIngesta, LoteCotizacionesIngesta, LoteLlamadosIngesta } from '../src/mercado/esquema.js';

const llamadoMinimo = {
  arce_id: 'L-1',
  items: [{ nro_item: 1, articulo: { nombre: 'PAPEL A4' }, adjudicaciones: [{ proveedor: { nombre: 'Papelera' }, precio_unitario: '265,50', cantidad: '100' }] }],
};

describe('contrato de ingesta', () => {
  it('acepta lo mínimo y aplica defaults', () => {
    const r = LlamadoIngesta.parse(llamadoMinimo);
    expect(r.items[0]!.ofertas).toEqual([]);
    expect(r.items[0]!.adjudicaciones[0]!.precio_unitario).toBe(265.5);
    expect(r.items[0]!.adjudicaciones[0]!.cantidad).toBe(100);
    expect(r.items[0]!.adjudicaciones[0]!.impuestos_incluidos).toBe(false);
    expect(r.estado).toBeNull();
    expect(r.organismo).toBeUndefined();
  });

  it('tolera formatos del portal: fechas dd/mm/aaaa, arce_id numérico, textos vacíos', () => {
    const r = LlamadoIngesta.parse({ ...llamadoMinimo, arce_id: 123, fecha_publicacion: '09/03/2025', fecha_apertura: '20/03/2025 11:00', objeto: '   ', estado: 'Adjudicado' });
    expect(r.arce_id).toBe('123');
    expect(r.fecha_publicacion).toBe('2025-03-09');
    expect(r.fecha_apertura).toBe('2025-03-20T14:00:00.000Z');
    expect(r.objeto).toBeNull();
    expect(r.estado).toBe('Adjudicado');
  });

  it('rechaza lo que rompería las estadísticas', () => {
    expect(LlamadoIngesta.safeParse({ ...llamadoMinimo, arce_id: '' }).success).toBe(false);
    expect(LlamadoIngesta.safeParse({ ...llamadoMinimo, items: [{ nro_item: 1 }, { nro_item: 1 }] }).success).toBe(false);
    expect(LlamadoIngesta.safeParse({ ...llamadoMinimo, items: [{ nro_item: 1, adjudicaciones: [{ precio_unitario: 10 }] }] }).success).toBe(false); // sin proveedor
    expect(LlamadoIngesta.safeParse({ ...llamadoMinimo, items: [{ nro_item: 1, adjudicaciones: [{ proveedor: { nombre: 'X' }, precio_unitario: 'muchos' }] }] }).success).toBe(false);
    expect(LlamadoIngesta.safeParse({ ...llamadoMinimo, items: [{ nro_item: 1, adjudicaciones: [{ proveedor: { nombre: 'X' }, precio_unitario: -5 }] }] }).success).toBe(false);
    expect(LlamadoIngesta.safeParse({ ...llamadoMinimo, fecha_publicacion: '31/02/2025' }).success).toBe(false);
    expect(LlamadoIngesta.safeParse({ ...llamadoMinimo, items: [{ nro_item: 1, adjudicaciones: [{ proveedor: { nombre: 'X' }, tasa_impuestos: 22 }] }] }).success).toBe(false);
  });

  it('lotes: fuente por defecto y límites', () => {
    const r = LoteLlamadosIngesta.parse({ llamados: [llamadoMinimo] });
    expect(r.fuente).toBe('scraper');
    expect(LoteLlamadosIngesta.safeParse({ llamados: [] }).success).toBe(false);
    const c = LoteCotizacionesIngesta.parse({ cotizaciones: [{ moneda: 'U$S', fecha: '1/3/2025', valor_uyu: '43,10' }] });
    expect(c.cotizaciones[0]).toMatchObject({ fecha: '2025-03-01', valor_uyu: 43.1 });
    expect(LoteCotizacionesIngesta.safeParse({ cotizaciones: [{ moneda: 'USD', fecha: '2025-03-01', valor_uyu: 0 }] }).success).toBe(false);
  });

  it('publica JSON Schema de entrada para el scraper', () => {
    const e = esquemasJson() as Record<string, { properties: Record<string, unknown>; required?: string[] }>;
    const llamados = e['POST /api/ingesta/llamados']!;
    expect(llamados.properties).toHaveProperty('llamados');
    expect(JSON.stringify(llamados)).toContain('arce_id');
    expect(JSON.stringify(llamados)).toContain('adjudicaciones');
    expect(e['POST /api/ingesta/cotizaciones']!.properties).toHaveProperty('cotizaciones');
  });
});
