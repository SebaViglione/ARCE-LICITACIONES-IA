import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { MODELO_ANTHROPIC_DEFAULT, ProveedorAnthropic } from '../src/llm/anthropic.js';

function clienteFalso(respuestas: Array<Record<string, unknown>>, llamadas: unknown[] = []): Anthropic {
  let i = 0;
  return {
    models: { retrieve: async () => ({ id: 'x' }) },
    beta: {
      messages: {
        create: async (params: unknown) => {
          llamadas.push(params);
          const r = respuestas[Math.min(i, respuestas.length - 1)]!;
          i++;
          return { model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_details: null, usage: { input_tokens: 100, output_tokens: 20 }, content: [], ...r };
        },
      },
    },
  } as unknown as Anthropic;
}

const Esquema = z.object({ a: z.number(), b: z.string() });
const jsonSchema = z.toJSONSchema(Esquema) as Record<string, unknown>;

describe('proveedor Anthropic (cliente simulado)', () => {
  it('usa el modelo por defecto y manda el JSON Schema como output_config', async () => {
    const llamadas: unknown[] = [];
    const prov = new ProveedorAnthropic(clienteFalso([{ content: [{ type: 'text', text: '{"a":1,"b":"x"}' }] }], llamadas));
    expect(prov.modelo).toBe(MODELO_ANTHROPIC_DEFAULT);
    const r = await prov.generarJson({ system: 's', prompt: 'p', jsonSchema, validar: (raw) => Esquema.parse(raw) });
    expect(r.datos).toEqual({ a: 1, b: 'x' });
    expect(r.meta).toMatchObject({ proveedor: 'anthropic', prompt_tokens: 100, completion_tokens: 20, intentos: 1 });
    const params = llamadas[0] as { output_config: { format: { type: string; schema: unknown } }; fallbacks: string; betas: string[]; system: string };
    expect(params.output_config.format.type).toBe('json_schema');
    expect(params.output_config.format.schema).toBe(jsonSchema);
    expect(params.fallbacks).toBe('default');
    expect(params.betas).toContain('server-side-fallback-2026-07-01');
    expect(params.system).toBe('s');
  });
  it('reintenta una vez si la respuesta no valida y acumula tokens', async () => {
    const llamadas: unknown[] = [];
    const prov = new ProveedorAnthropic(clienteFalso([{ content: [{ type: 'text', text: '{"a":"no"}' }] }, { content: [{ type: 'text', text: '{"a":2,"b":"y"}' }] }], llamadas));
    const r = await prov.generarJson({ system: 's', prompt: 'p', jsonSchema, validar: (raw) => Esquema.parse(raw) });
    expect(r.datos).toEqual({ a: 2, b: 'y' });
    expect(r.meta.intentos).toBe(2);
    expect(r.meta.prompt_tokens).toBe(200);
    expect((llamadas[1] as { messages: Array<{ content: string }> }).messages[0]!.content).toContain('ATENCIÓN');
  });
  it('falla tras dos respuestas inválidas y ante un rechazo', async () => {
    const prov = new ProveedorAnthropic(clienteFalso([{ content: [{ type: 'text', text: 'no json' }] }]));
    await expect(prov.generarJson({ system: 's', prompt: 'p', jsonSchema, validar: (raw) => Esquema.parse(raw) })).rejects.toThrow(/2 intentos/);
    const rechazo = new ProveedorAnthropic(clienteFalso([{ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' } }]));
    await expect(rechazo.generarJson({ system: 's', prompt: 'p', jsonSchema, validar: (raw) => Esquema.parse(raw) })).rejects.toThrow(/rechazó/);
  });
  it('salud ok con cliente simulado', async () => {
    const prov = new ProveedorAnthropic(clienteFalso([]));
    expect(await prov.salud()).toMatchObject({ ok: true, proveedor: 'anthropic', cargado: true });
  });
});
