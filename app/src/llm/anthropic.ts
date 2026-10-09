// Proveedor alternativo: API de Anthropic (Claude) con structured outputs (output_config.format = JSON Schema).
// Misma interfaz que Ollama; se activa con LLM_PROVIDER=anthropic + ANTHROPIC_API_KEY.
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { resumenError, type PedidoJson, type ProveedorLlm, type RespuestaJson, type SaludLlm } from './index.js';

/** Modelo por defecto: el Opus vigente (ver skill claude-api, 2026-10). */
export const MODELO_ANTHROPIC_DEFAULT = 'claude-opus-5-5';
const MAX_TOKENS = 16000;

export class ProveedorAnthropic implements ProveedorLlm {
  readonly nombre = 'anthropic';
  readonly modelo: string;
  private cliente: Anthropic;

  constructor(cliente?: Anthropic) {
    if (!cliente && !config.ANTHROPIC_API_KEY) {
      throw new Error('LLM_PROVIDER=anthropic requiere ANTHROPIC_API_KEY en el entorno');
    }
    this.modelo = config.ANTHROPIC_MODEL?.trim() || MODELO_ANTHROPIC_DEFAULT;
    this.cliente = cliente ?? new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, timeout: config.LLM_TIMEOUT_MS, maxRetries: 2 });
  }

  async preparar(): Promise<void> {
    // No hay nada que cargar: la API es remota.
  }

  async salud(): Promise<SaludLlm> {
    try {
      await this.cliente.models.retrieve(this.modelo);
      return { ok: true, proveedor: this.nombre, modelo: this.modelo, cargado: true };
    } catch (err) {
      let detalle: string;
      if (err instanceof Anthropic.AuthenticationError) detalle = 'ANTHROPIC_API_KEY inválida';
      else if (err instanceof Anthropic.NotFoundError) detalle = `modelo ${this.modelo} no existe`;
      else if (err instanceof Anthropic.APIConnectionError) detalle = `sin conexión con la API de Anthropic: ${resumenError(err)}`;
      else detalle = resumenError(err);
      return { ok: false, proveedor: this.nombre, modelo: this.modelo, cargado: false, detalle };
    }
  }

  async generarJson<T>(pedido: PedidoJson<T>): Promise<RespuestaJson<T>> {
    let prompt = pedido.prompt;
    let ultimoError: unknown = null;
    let entrada = 0;
    let salida = 0;
    let duracion = 0;

    for (let intento = 1; intento <= 2; intento++) {
      const t0 = Date.now();
      // Fallback server-side por defecto: si un clasificador de seguridad rechaza la solicitud,
      // la API la reintenta en otro modelo dentro de la misma llamada (beta server-side-fallback).
      const res = await this.cliente.beta.messages.create({
        model: this.modelo,
        max_tokens: MAX_TOKENS,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: pedido.system,
        messages: [{ role: 'user', content: prompt }],
        output_config: { format: { type: 'json_schema', schema: pedido.jsonSchema }, effort: 'medium' },
      });
      duracion += Date.now() - t0;
      entrada += res.usage.input_tokens;
      salida += res.usage.output_tokens;
      try {
        if (res.stop_reason === 'refusal') {
          throw new Error(`la API rechazó la solicitud (${res.stop_details?.category ?? 'sin categoría'})`);
        }
        if (res.stop_reason === 'max_tokens') throw new Error(`respuesta truncada por max_tokens=${MAX_TOKENS}`);
        const texto = res.content
          .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
          .map((b) => b.text)
          .join('');
        const datos = pedido.validar(JSON.parse(texto));
        return {
          datos,
          meta: { proveedor: this.nombre, modelo: res.model || this.modelo, prompt_tokens: entrada, completion_tokens: salida, duracion_ms: duracion, intentos: intento },
        };
      } catch (err) {
        ultimoError = err;
        logger.warn({ intento, error: resumenError(err), stop_reason: res.stop_reason }, 'respuesta de Anthropic inválida; reintentando');
        prompt = `${pedido.prompt}\n\nATENCIÓN: tu respuesta anterior no cumplió el esquema JSON (${resumenError(err, 200)}). Respondé únicamente con el JSON válido y completo.`;
      }
    }
    throw new Error(`Anthropic (${this.modelo}) no devolvió JSON válido tras 2 intentos: ${resumenError(ultimoError)}`);
  }
}
