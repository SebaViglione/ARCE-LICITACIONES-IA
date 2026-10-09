import { Ollama } from 'ollama';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { resumenError, type PedidoJson, type ProveedorLlm, type RespuestaJson, type SaludLlm } from './index.js';

type FetchFn = typeof fetch;

/** fetch con timeout global por request (ollama-js no expone timeout para respuestas no streameadas). */
function fetchConTimeout(ms: number): FetchFn {
  return (input, init) => {
    const propio = AbortSignal.timeout(ms);
    const signal = init?.signal ? AbortSignal.any([init.signal, propio]) : propio;
    return fetch(input, { ...init, signal });
  };
}

export class ProveedorOllama implements ProveedorLlm {
  readonly nombre = 'ollama';
  readonly modelo = config.OLLAMA_MODEL;
  private cliente: Ollama;
  private thinking: boolean | null = null;
  private preparado = false;

  constructor() {
    this.cliente = new Ollama({ host: config.OLLAMA_HOST, fetch: fetchConTimeout(config.LLM_TIMEOUT_MS) });
  }

  private async capacidades(): Promise<string[]> {
    const info = (await this.cliente.show({ model: this.modelo })) as unknown as { capabilities?: string[] };
    return info.capabilities ?? [];
  }

  private async soportaThinking(): Promise<boolean> {
    if (this.thinking === null) {
      try {
        this.thinking = (await this.capacidades()).includes('thinking');
      } catch {
        this.thinking = false;
      }
    }
    return this.thinking;
  }

  async preparar(): Promise<void> {
    if (this.preparado) return;
    const t0 = Date.now();
    const thinking = await this.soportaThinking();
    // Prompt vacío = cargar el modelo en memoria y mantenerlo (keep_alive)
    await this.cliente.generate({ model: this.modelo, prompt: '', stream: false, keep_alive: config.OLLAMA_KEEP_ALIVE });
    this.preparado = true;
    logger.info({ modelo: this.modelo, host: config.OLLAMA_HOST, thinking, num_ctx: config.OLLAMA_NUM_CTX, carga_ms: Date.now() - t0 }, 'modelo Ollama listo');
  }

  async salud(): Promise<SaludLlm> {
    try {
      const [lista, ps] = await Promise.all([this.cliente.list(), this.cliente.ps()]);
      const esMio = (m: { name?: string; model?: string }) => m.name === this.modelo || m.model === this.modelo;
      const descargado = lista.models.some(esMio);
      const cargado = ps.models.some(esMio);
      return { ok: descargado, proveedor: this.nombre, modelo: this.modelo, cargado, ...(descargado ? {} : { detalle: `modelo ${this.modelo} no está descargado (ollama pull ${this.modelo})` }) };
    } catch (err) {
      return { ok: false, proveedor: this.nombre, modelo: this.modelo, cargado: false, detalle: `Ollama no responde en ${config.OLLAMA_HOST}: ${resumenError(err)}` };
    }
  }

  async generarJson<T>(pedido: PedidoJson<T>): Promise<RespuestaJson<T>> {
    const thinking = await this.soportaThinking();
    let prompt = pedido.prompt;
    let numPredict = pedido.maxTokens ?? config.OLLAMA_NUM_PREDICT;
    let ultimoError: unknown = null;
    let promptTokens: number | null = null;
    let completionTokens: number | null = null;
    let duracionTotal = 0;

    for (let intento = 1; intento <= 2; intento++) {
      const t0 = Date.now();
      const res = await this.cliente.generate({
        model: this.modelo,
        system: pedido.system,
        prompt,
        format: pedido.jsonSchema,
        stream: false,
        keep_alive: config.OLLAMA_KEEP_ALIVE,
        ...(thinking ? { think: false } : {}),
        options: { temperature: 0, num_ctx: config.OLLAMA_NUM_CTX, num_predict: numPredict },
      });
      duracionTotal += Date.now() - t0;
      promptTokens = res.prompt_eval_count ?? promptTokens;
      completionTokens = (completionTokens ?? 0) + (res.eval_count ?? 0);
      try {
        if (res.done_reason === 'length') throw new Error(`respuesta truncada por num_predict=${numPredict}`);
        const raw: unknown = JSON.parse(res.response ?? '');
        const datos = pedido.validar(raw);
        return { datos, meta: { proveedor: this.nombre, modelo: this.modelo, prompt_tokens: promptTokens, completion_tokens: completionTokens, duracion_ms: duracionTotal, intentos: intento } };
      } catch (err) {
        ultimoError = err;
        logger.warn({ intento, error: resumenError(err), done_reason: res.done_reason, eval_count: res.eval_count }, 'respuesta del modelo inválida; reintentando');
        if (res.done_reason === 'length') numPredict = Math.min(numPredict * 2, 8192);
        prompt = `${pedido.prompt}\n\nATENCIÓN: tu respuesta anterior no cumplió el esquema JSON (${resumenError(err, 200)}). Respondé únicamente con el JSON válido y completo.`;
      }
    }
    throw new Error(`El modelo ${this.modelo} no devolvió JSON válido tras 2 intentos: ${resumenError(ultimoError)}`);
  }
}
