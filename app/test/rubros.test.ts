import { describe, expect, it } from 'vitest';
import { cargarRubro, rubrosDisponibles } from '../src/pipeline/filtro.js';
import { promptAnalisisCompleto, systemPrompt } from '../src/llm/prompts.js';

describe('rubros configurables', () => {
  it('todos los rubros del directorio cargan y generan prompts', () => {
    const nombres = rubrosDisponibles();
    expect(nombres).toContain('aluminio');
    expect(nombres).toContain('informatica');
    for (const n of nombres) {
      const r = cargarRubro(n);
      expect(r.keywords.length).toBeGreaterThan(5);
      expect(systemPrompt(r)).toContain(r.descripcion);
      const p = promptAnalisisCompleto(r, 'contenido');
      expect(p).toContain(r.relevancia.regla_clave);
      for (const c of r.relevancia.relevante) expect(p).toContain(c);
    }
  });
  it('rechaza nombres de rubro inválidos o inexistentes', () => {
    expect(() => cargarRubro('../x')).toThrow(/inválido/);
    expect(() => cargarRubro('noexiste')).toThrow(/No existe/);
  });
});
