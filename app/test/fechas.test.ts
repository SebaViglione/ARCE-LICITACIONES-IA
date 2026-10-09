import { describe, expect, it } from 'vitest';
import { diasEntre, esFechaIsoValida, fechaDdMmAaaaAIso, hoyEnZona, sumarDias, urgenciaPorDias } from '../src/utils/fechas.js';

describe('fechas', () => {
  it('diasEntre es exacto en días calendario', () => {
    expect(diasEntre('2026-10-09', '2026-10-09')).toBe(0);
    expect(diasEntre('2026-10-09', '2026-10-10')).toBe(1);
    expect(diasEntre('2026-10-09', '2026-10-08')).toBe(-1);
    expect(diasEntre('2026-02-28', '2026-03-01')).toBe(1);
    expect(diasEntre('x', '2026-03-01')).toBeNull();
  });
  it('hoyEnZona respeta la zona horaria', () => {
    expect(hoyEnZona('America/Montevideo', new Date('2026-10-10T02:30:00Z'))).toBe('2026-10-09');
    expect(hoyEnZona('UTC', new Date('2026-10-10T02:30:00Z'))).toBe('2026-10-10');
  });
  it('convierte dd/mm/yyyy y valida', () => {
    expect(fechaDdMmAaaaAIso('5/1/2026')).toBe('2026-01-05');
    expect(fechaDdMmAaaaAIso('31/02/2026')).toBeNull();
    expect(esFechaIsoValida('2026-13-01')).toBe(false);
  });
  it('sumarDias cruza meses', () => {
    expect(sumarDias('2026-10-09', -60)).toBe('2026-08-10');
  });
  it('urgencia', () => {
    expect(urgenciaPorDias(null)).toBe('desconocida');
    expect(urgenciaPorDias(3)).toBe('urgente');
    expect(urgenciaPorDias(7)).toBe('próximo');
    expect(urgenciaPorDias(15)).toBe('atención');
    expect(urgenciaPorDias(16)).toBe('futuro');
  });
});
