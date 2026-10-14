import { describe, expect, it } from 'vitest';
import { claveOrganismo, fechaFlexible, fechaHoraFlexible, grupoTipoCompra, hashCanonico, normalizarEstado, normalizarMoneda, normalizarRut, normalizarTexto, normalizarUnidad, numeroFlexible } from '../src/mercado/normalizar.js';

describe('normalización de la ingesta', () => {
  it('texto: sin acentos, mayúsculas, un solo espacio', () => {
    expect(normalizarTexto('  Aluminios  del Sur S.A. ')).toBe('ALUMINIOS DEL SUR S A');
    expect(normalizarTexto('Ñandú – café')).toBe('NANDU CAFE');
    expect(normalizarTexto(null)).toBe('');
  });

  it('RUT: solo 12 dígitos', () => {
    expect(normalizarRut('21.123456.0012')).toBe('211234560012');
    expect(normalizarRut(211234560012)).toBe('211234560012');
    expect(normalizarRut('12345')).toBeNull();
    expect(normalizarRut(undefined)).toBeNull();
  });

  it('monedas del portal', () => {
    expect(normalizarMoneda('$')).toBe('UYU');
    expect(normalizarMoneda('Pesos Uruguayos')).toBe('UYU');
    expect(normalizarMoneda('U$S')).toBe('USD');
    expect(normalizarMoneda('Dólares USA')).toBe('USD');
    expect(normalizarMoneda('Unidad Indexada')).toBe('UI');
    expect(normalizarMoneda('€')).toBe('EUR');
    expect(normalizarMoneda(null)).toBe('UYU');
    expect(normalizarMoneda('Yen')).toBe('YEN');
  });

  it('unidades de medida', () => {
    expect(normalizarUnidad('UNIDAD')).toBe('unidad');
    expect(normalizarUnidad('c/u')).toBe('unidad');
    expect(normalizarUnidad('Kilogramos')).toBe('kg');
    expect(normalizarUnidad('METRO CUADRADO')).toBe('m2');
    expect(normalizarUnidad('Lts')).toBe('l');
    expect(normalizarUnidad('Resma')).toBe('resma');
    expect(normalizarUnidad('UNIDAD (CU)')).toBe('unidad');
    expect(normalizarUnidad(null)).toBe('unidad');
    expect(normalizarUnidad('Bandeja de 24')).toBe('bandeja_de_24');
  });

  it('estados y tipos de compra', () => {
    expect(normalizarEstado('Adjudicado', false)).toBe('adjudicado');
    expect(normalizarEstado('Adjudicación aprobada', false)).toBe('adjudicado');
    expect(normalizarEstado('Desierto', false)).toBe('desierto');
    expect(normalizarEstado('Anulado', true)).toBe('anulado');
    expect(normalizarEstado('Dejado sin efecto', false)).toBe('sin_efecto');
    expect(normalizarEstado('En evaluación', false)).toBe('en_evaluacion');
    expect(normalizarEstado('En evaluación', true)).toBe('adjudicado');
    expect(normalizarEstado('Publicado', false)).toBe('publicado');
    expect(normalizarEstado(null, true)).toBe('adjudicado');
    expect(normalizarEstado('', false)).toBe('otro');

    expect(grupoTipoCompra('Licitación Pública Internacional')).toBe('licitacion_publica');
    expect(grupoTipoCompra('Licitación Abreviada')).toBe('licitacion_abreviada');
    expect(grupoTipoCompra('Compra Directa por Excepción')).toBe('compra_directa_excepcion');
    expect(grupoTipoCompra('Compra Directa')).toBe('compra_directa');
    expect(grupoTipoCompra('Pregón')).toBe('pregon');
    expect(grupoTipoCompra('Convenio Marco')).toBe('convenio_marco');
    expect(grupoTipoCompra(null)).toBe('otro');
  });

  it('números en formato uruguayo y JSON', () => {
    expect(numeroFlexible(1234.5)).toBe(1234.5);
    expect(numeroFlexible('1.234,56')).toBe(1234.56);
    expect(numeroFlexible('1,234.56')).toBe(1234.56);
    expect(numeroFlexible('1234.56')).toBe(1234.56);
    expect(numeroFlexible('3,5')).toBe(3.5);
    expect(numeroFlexible('$ 12.000')).toBe(12);
    expect(numeroFlexible('1.200.000')).toBe(1200000);
    expect(numeroFlexible('U$S 1,250,000')).toBe(1250000);
    expect(numeroFlexible('')).toBeNull();
    expect(numeroFlexible('abc')).toBeNull();
    expect(numeroFlexible(Number.NaN)).toBeNull();
  });

  it('fechas en ISO y dd/mm/aaaa', () => {
    expect(fechaFlexible('2025-03-09')).toBe('2025-03-09');
    expect(fechaFlexible('2025-03-09T14:00:00Z')).toBe('2025-03-09');
    expect(fechaFlexible('9/3/2025')).toBe('2025-03-09');
    expect(fechaFlexible('09-03-2025')).toBe('2025-03-09');
    expect(fechaFlexible('31/02/2025')).toBeNull();
    expect(fechaFlexible('hoy')).toBeNull();
    expect(fechaHoraFlexible('2025-03-09T11:00:00-03:00')).toBe('2025-03-09T14:00:00.000Z');
    expect(fechaHoraFlexible('2025-03-09 11:00')).toBe('2025-03-09T14:00:00.000Z');
    expect(fechaHoraFlexible('09/03/2025 11:00')).toBe('2025-03-09T14:00:00.000Z');
    expect(fechaHoraFlexible('2025-03-09')).toBe('2025-03-09T03:00:00.000Z');
  });

  it('clave de organismo y hash canónico', () => {
    expect(claveOrganismo('Intendencia de Montevideo', 'Desarrollo Urbano')).toBe('INTENDENCIA DE MONTEVIDEO|DESARROLLO URBANO');
    expect(claveOrganismo('ASSE', null)).toBe('ASSE|');
    expect(hashCanonico({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(hashCanonico({ b: [1, { d: 3, c: 2 }], a: 1 }));
    expect(hashCanonico({ a: 1 })).not.toBe(hashCanonico({ a: 2 }));
    expect(hashCanonico({ a: 1, b: undefined })).toBe(hashCanonico({ a: 1 }));
  });
});
