import { describe, expect, it } from 'vitest';
import { armarTextoMercado, monto, pct, precio, terminosDe, validarAnalisisProducto, validarInforme, validarRespuesta, type DatosMercado } from '../src/mercado/analista.js';

const datos: DatosMercado = {
  resumen: { llamados: 1500, hechos: 2652, adjudicaciones_excluidas: 0, primera_fecha: '2023-11-21', ultima_fecha: '2026-10-07', cobertura_precio: 1, cobertura_monto: 1, items_sin_articulo: 0, ofertas: 3981, monto_uyu_total: 3676569897, tipos_compra: [{ tipo_compra: 'compra_directa', monto_uyu: 1200000000 }, { tipo_compra: 'licitacion_abreviada', monto_uyu: 800000000 }] },
  fuentes: [{ fuente: 'demo-sintetico', llamados: 1500 }],
  categoria: null,
  rango: { desde: null, hasta: null },
  oportunidades: Array.from({ length: 15 }, (_, i) => ({ articulo_id: 20 + i, nombre: `PRODUCTO ${i}`, categoria: 'Fam > Sub', unidad: 'unidad', indice_oportunidad: 80 - i, comp_volumen: 0.9, comp_recurrencia: 0.6, comp_amplitud: 0.7, comp_apertura: 0.8, monto_uyu_24m: 146700000, llamados_24m: 56, organismos_24m: 25, proveedores_24m: 8, hhi_24m: 0.21, lider: 'Infotec S.R.L.', lider_share_24m: 0.29, precio_mediano_uyu_12m: 5031, precio_p25_uyu_12m: 4635, precio_p75_uyu_12m: 5076, variacion_precio_12m: 0.04, variacion_12m: 0.05 })),
  competencia: new Map([[20, { articulo_id: 20, anio: 2026, items_con_cuadro: 12, oferentes_promedio: 3.2, descuento_mediano: -0.06 }]]),
  productos: Array.from({ length: 12 }, (_, i) => ({ articulo_id: 40 + i, nombre: `OTRO ${i}`, categoria: null, monto_uyu: 1000000 * (12 - i), adjudicaciones: 10, organismos: 5, proveedores: 3, precio_mediano_uyu: 42.5, unidad: 'litro', lider: null, lider_share_24m: null, variacion_12m: -0.12 })),
  proveedores: Array.from({ length: 10 }, (_, i) => ({ nombre: `Proveedor ${i}`, rut: '211234560012', monto_uyu: 500000, adjudicaciones: 4, articulos: 2, organismos: 3, tasa_exito: 0.5, ofertas_presentadas: 8, principal_articulo: 'PRODUCTO 0', variacion_12m: null })),
  organismos: Array.from({ length: 8 }, (_, i) => ({ inciso: `Organismo ${i}`, unidad_ejecutora: 'UE', monto_uyu: 900000, llamados: 12, proveedores: 6, principales: ['PRODUCTO 0', 'OTRO 1'] })),
};

describe('analista de mercado (sin modelo)', () => {
  it('formatea montos, precios y porcentajes en español', () => {
    expect(monto(3676569897)).toBe('$ 3,7 mil M');
    expect(monto(146700000)).toBe('$ 146,7 M');
    expect(monto(12500)).toBe('$ 12,5 k');
    expect(monto(null)).toBe('s/d');
    expect(precio(5031)).toBe('$ 5.031');
    expect(precio(42.5)).toBe('$ 42,50');
    expect(pct(0.29)).toBe('29 %');
    expect(pct(0.04, true)).toBe('+4 %');
    expect(pct(-0.06, true)).toBe('-6 %');
  });

  it('arma el paquete de texto con ids, cifras y la advertencia de datos sintéticos', () => {
    const t = armarTextoMercado(datos);
    expect(t).toContain('SINTÉTICOS');
    expect(t).toContain('[id 20] PRODUCTO 0');
    expect(t).toContain('índice 80');
    expect(t).toContain('ganador -6 % vs. mediana de perdedoras');
    expect(t).toContain('compra_directa 60 %');
    expect(t).toContain('Proveedor 0 (RUT 211234560012)');
    expect(t).toContain('compra sobre todo PRODUCTO 0, OTRO 1');
    const corto = armarTextoMercado(datos, { oportunidades: 3, productos: 2, proveedores: 2, organismos: 1 });
    expect(corto.length).toBeLessThan(t.length);
    expect(corto).not.toContain('[id 23]');
  });

  it('extrae términos útiles de una pregunta', () => {
    expect(terminosDe('¿Quién vende papel A4 y a qué precio?')).toEqual(['papel']);
    expect(terminosDe('Conviene entrar en licencias de software ofimático?')).toEqual(['licencias', 'software', 'ofimatico']);
    expect(terminosDe('qué pasa')).toEqual(['pasa']);
  });

  it('valida y acota las respuestas del modelo', () => {
    const informe = validarInforme({
      resumen_ejecutivo: ' Resumen ',
      oportunidades: Array.from({ length: 10 }, (_, i) => ({ producto: `P${i}`, articulo_id: i === 0 ? 25 : 'x', prioridad: 'alta', por_que: 'porque', precio_de_entrada: null, competidores_a_vigilar: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], riesgos: null })),
      tendencias: ['t1', '', 't2'],
      competencia: [],
      compradores_clave: ['c'],
      alertas_de_datos: ['sintético'],
      preguntas_abiertas: [],
    });
    expect(informe.resumen_ejecutivo).toBe('Resumen');
    expect(informe.oportunidades).toHaveLength(8);
    expect(informe.oportunidades[0]!.articulo_id).toBe(25);
    expect(informe.oportunidades[1]!.articulo_id).toBeNull();
    expect(informe.oportunidades[0]!.competidores_a_vigilar).toHaveLength(5);
    expect(informe.tendencias).toEqual(['t1', 't2']);

    const prod = validarAnalisisProducto({ veredicto: 'entrar', confianza: 0.85, resumen: 'ok', precio_recomendado: { desde: 4600, hasta: 4900, unidad: 'unidad', justificacion: 'p25-p50' }, a_quien_venderle: [], competidores: [{ nombre: 'X', por_que_importa: 'lidera' }], como_ganar: [], riesgos: [], datos_faltantes: [] });
    expect(prod.confianza).toBe(85);
    expect(prod.precio_recomendado.desde).toBe(4600);
    expect(() => validarAnalisisProducto({ veredicto: 'comprar' })).toThrow();

    const resp = validarRespuesta({ respuesta: 'R', datos_usados: ['d'], limitaciones: [], sugerencias: [] });
    expect(resp.respuesta).toBe('R');
  });
});
