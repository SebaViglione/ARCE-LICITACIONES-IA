import { describe, expect, it } from 'vitest';
import { AnalisisLlmSchema, aplicarCoherenciaVisita, normalizarAnalisis, normalizarConfianza, normalizarFecha, analisisJsonSchema } from '../src/llm/schema.js';
import { dividirEnChunks, construirContexto } from '../src/pipeline/analyze.js';

const base = {
  descripcion_llamado: 'Ventanas de aluminio DVH para liceo en Salto',
  es_relevante: true,
  confianza: 85,
  razon: 'Pide aberturas de aluminio',
  materiales_detectados: ['aluminio', 'DVH', 'aluminio'],
  resumen_trabajo: 'Suministro e instalación de 20 ventanas.',
  ubicacion_obra: 'Liceo Nº 2, Salto',
  requiere_visita: true,
  ubicacion_visita: null,
  fecha_visita_especifica: null,
  coordina_visita: false,
  contacto_visita_nombre: 'Arq. Pérez',
  contacto_visita_telefono: '+598 1825 int 01200',
  contacto_visita_correo: 'Contacto: compras@salto.gub.uy (ver web)',
  formularios_requeridos: [
    { nombre: 'Anexo I', obligatorio: true, seccion: 'Capítulo 5' },
    { nombre: 'anexo i', obligatorio: true, seccion: null },
    { nombre: '', obligatorio: false, seccion: null },
  ],
};

describe('esquema de análisis', () => {
  it('el JSON Schema para el modelo no trae $schema y es estricto', () => {
    expect(analisisJsonSchema).not.toHaveProperty('$schema');
    expect(analisisJsonSchema.additionalProperties).toBe(false);
    expect((analisisJsonSchema.required as string[]).length).toBe(15);
  });
  it('normaliza confianza en 0-100 (acepta escala 0-1 y strings)', () => {
    expect(normalizarConfianza(85)).toBe(85);
    expect(normalizarConfianza(0.3)).toBe(30);
    expect(normalizarConfianza(1)).toBe(1);
    expect(normalizarConfianza(150)).toBe(100);
    expect(normalizarConfianza(-5)).toBe(0);
    expect(normalizarConfianza('72%')).toBe(72);
    expect(normalizarConfianza('x')).toBe(0);
  });
  it('normaliza fechas a ISO o null', () => {
    expect(normalizarFecha('2025-11-25')).toBe('2025-11-25');
    expect(normalizarFecha("'2025-11-25'")).toBe('2025-11-25');
    expect(normalizarFecha('25/11/2025')).toBe('2025-11-25');
    expect(normalizarFecha('2025-11-25T10:00:00')).toBe('2025-11-25');
    expect(normalizarFecha('null')).toBeNull();
    expect(normalizarFecha('a coordinar')).toBeNull();
    expect(normalizarFecha('2025-13-40')).toBeNull();
  });
  it('normaliza y deduplica materiales, formularios y correo', () => {
    const a = normalizarAnalisis(AnalisisLlmSchema.parse(base));
    expect(a.materiales_detectados).toEqual(['aluminio', 'DVH']);
    expect(a.formularios_requeridos).toEqual([{ nombre: 'Anexo I', obligatorio: true, seccion: 'Capítulo 5' }]);
    expect(a.contacto_visita_correo).toBe('compras@salto.gub.uy');
  });
  it('regla 1 y 2: visita sin ubicación usa obra; contacto sin fecha → coordina', () => {
    const { analisis, ajustes } = aplicarCoherenciaVisita(normalizarAnalisis(AnalisisLlmSchema.parse(base)));
    expect(analisis.ubicacion_visita).toBe('Liceo Nº 2, Salto');
    expect(analisis.coordina_visita).toBe(true);
    expect(ajustes).toHaveLength(2);
  });
  it('regla 3: fecha específica → no coordina', () => {
    const { analisis } = aplicarCoherenciaVisita(normalizarAnalisis(AnalisisLlmSchema.parse({ ...base, fecha_visita_especifica: '2026-10-20', coordina_visita: true })));
    expect(analisis.coordina_visita).toBe(false);
  });
  it('regla 4: sin visita se limpian los datos de visita', () => {
    const { analisis, ajustes } = aplicarCoherenciaVisita(normalizarAnalisis(AnalisisLlmSchema.parse({ ...base, requiere_visita: false, ubicacion_visita: 'x' })));
    expect(analisis.ubicacion_visita).toBeNull();
    expect(analisis.contacto_visita_telefono).toBeNull();
    expect(analisis.coordina_visita).toBe(false);
    expect(ajustes).toEqual(['sin visita → datos de visita limpiados']);
  });
  it('rechaza respuestas incompletas del modelo', () => {
    expect(() => AnalisisLlmSchema.parse({ ...base, es_relevante: 'si' })).toThrow();
    const { confianza: _c, ...sinConfianza } = base;
    expect(() => AnalisisLlmSchema.parse(sinConfianza)).toThrow();
  });
});

describe('chunking por caracteres', () => {
  it('no divide textos cortos', () => {
    expect(dividirEnChunks('hola', 100, 10)).toEqual(['hola']);
  });
  it('divide con solapamiento y cubre todo el texto (acentos cuentan como 1 char)', () => {
    const texto = Array.from({ length: 200 }, (_, i) => `línea ${i} ñandú`).join('\n');
    const chunks = dividirEnChunks(texto, 500, 100);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.length <= 500)).toBe(true);
    expect(chunks[0]).toContain('línea 0');
    expect(chunks.at(-1)).toContain('línea 199');
    // cada chunk (menos el primero) comparte texto con el anterior
    for (let i = 1; i < chunks.length; i++) {
      const cola = chunks[i - 1]!.slice(-50);
      expect(chunks[i]!.includes(cola.slice(-20))).toBe(true);
    }
  });
  it('construye el contexto con todas las fuentes', () => {
    const c = construirContexto({ titulo: 'T', descripcion: 'D', items: ['i1'], aclaraciones: ['a1'] }, 'pliego.pdf', 'texto');
    expect(c).toContain('=== TÍTULO DEL LLAMADO ===\nT');
    expect(c).toContain('=== ITEMS/PRODUCTOS SOLICITADOS ===\n- i1');
    expect(c).toContain('=== CONTENIDO DEL ARCHIVO: pliego.pdf ===\ntexto');
  });
});

describe('límites derivados del contexto', async () => {
  const { derivarLimites } = await import('../src/config.js');
  it('16k → ~40k chars; 8k → ~17k chars; explícitos se respetan', () => {
    expect(derivarLimites(16384)).toEqual({ LLM_MAX_CHARS: 41652, LLM_CHUNK_CHARS: 31239 });
    expect(derivarLimites(8192)).toEqual({ LLM_MAX_CHARS: 17076, LLM_CHUNK_CHARS: 12807 });
    expect(derivarLimites(8192, 20000, 15000)).toEqual({ LLM_MAX_CHARS: 20000, LLM_CHUNK_CHARS: 15000 });
    expect(derivarLimites(8192, 10000, 50000).LLM_CHUNK_CHARS).toBe(10000);
  });
});
