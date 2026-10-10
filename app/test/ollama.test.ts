import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Ollama } from 'ollama';
import { ProveedorOllama } from '../src/llm/ollama.js';

type Respuesta = { response?: string; done_reason?: string; prompt_eval_count?: number; eval_count?: number } | Error;

function clienteFalso(secuencia: Respuesta[], llamadas: unknown[] = []): Ollama {
  let i = 0;
  return {
    show: async () => ({ capabilities: ['completion', 'thinking'] }),
    list: async () => ({ models: [{ name: 'qwen3.5:4b', model: 'qwen3.5:4b' }] }),
    ps: async () => ({ models: [] }),
    generate: async (req: unknown) => {
      llamadas.push(req);
      const r = secuencia[Math.min(i, secuencia.length - 1)]!;
      i++;
      if (r instanceof Error) throw r;
      return { done_reason: 'stop', prompt_eval_count: 50, eval_count: 10, ...r };
    },
  } as unknown as Ollama;
}

const Esquema = z.object({ a: z.number() });
const jsonSchema = z.toJSONSchema(Esquema) as Record<string, unknown>;
const pedido = { system: 's', prompt: 'p', jsonSchema, validar: (raw: unknown) => Esquema.parse(raw) };

describe('proveedor Ollama (cliente simulado)', () => {
  it('manda format=JSON Schema, temperature 0, num_ctx y think:false si el modelo piensa', async () => {
    const llamadas: unknown[] = [];
    const prov = new ProveedorOllama(clienteFalso([{ response: '{"a":1}' }], llamadas));
    const r = await prov.generarJson(pedido);
    expect(r.datos).toEqual({ a: 1 });
    const req = llamadas[0] as { format: unknown; think: boolean; options: { temperature: number; num_ctx: number } };
    expect(req.format).toBe(jsonSchema);
    expect(req.think).toBe(false);
    expect(req.options.temperature).toBe(0);
    expect(req.options.num_ctx).toBeGreaterThan(0);
    expect(r.meta).toMatchObject({ proveedor: 'ollama', prompt_tokens: 50, intentos: 1 });
  });
  it('reintenta ante "unexpected EOF" (runner reiniciado por OOM) y sigue', async () => {
    const llamadas: unknown[] = [];
    const prov = new ProveedorOllama(clienteFalso([new Error('an error was encountered while running the model: unexpected EOF'), { response: '{"a":2}' }], llamadas), { esperaReintentoMs: 1 });
    const r = await prov.generarJson(pedido);
    expect(r.datos).toEqual({ a: 2 });
    expect(llamadas).toHaveLength(2);
  });
  it('no reintenta errores no transitorios', async () => {
    const llamadas: unknown[] = [];
    const prov = new ProveedorOllama(clienteFalso([new Error('model "x" not found')], llamadas), { esperaReintentoMs: 1 });
    await expect(prov.generarJson(pedido)).rejects.toThrow(/not found/);
    expect(llamadas).toHaveLength(1);
  });
  it('si la salida se corta por num_predict, reintenta con el doble', async () => {
    const llamadas: unknown[] = [];
    const prov = new ProveedorOllama(clienteFalso([{ response: '{"a":', done_reason: 'length' }, { response: '{"a":3}' }], llamadas));
    const r = await prov.generarJson(pedido);
    expect(r.datos).toEqual({ a: 3 });
    const [p1, p2] = llamadas as Array<{ options: { num_predict: number } }>;
    expect(p2!.options.num_predict).toBe(p1!.options.num_predict * 2);
    expect(r.meta.intentos).toBe(2);
  });
  it('salud: modelo descargado pero no cargado', async () => {
    const prov = new ProveedorOllama(clienteFalso([]));
    expect(await prov.salud()).toMatchObject({ ok: true, cargado: false, modelo: expect.any(String) });
  });
});
