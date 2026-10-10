import { config } from '../config.js';

export interface MetaLlm {
  proveedor: string;
  modelo: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  duracion_ms: number;
  intentos: number;
}

export interface PedidoJson<T> {
  system: string;
  prompt: string;
  jsonSchema: Record<string, unknown>;
  /** Valida/convierte el JSON crudo; debe lanzar si no cumple. */
  validar: (raw: unknown) => T;
  maxTokens?: number;
}

export interface RespuestaJson<T> {
  datos: T;
  meta: MetaLlm;
}

export interface SaludLlm {
  ok: boolean;
  proveedor: string;
  modelo: string;
  cargado: boolean;
  detalle?: string;
}

export interface ProveedorLlm {
  readonly nombre: string;
  readonly modelo: string;
  /** Carga/calienta el modelo. Idempotente. */
  preparar(): Promise<void>;
  salud(): Promise<SaludLlm>;
  generarJson<T>(pedido: PedidoJson<T>): Promise<RespuestaJson<T>>;
}

let instancia: ProveedorLlm | null = null;

export async function getProveedor(): Promise<ProveedorLlm> {
  if (instancia) return instancia;
  if (config.LLM_PROVIDER === 'anthropic') {
    const { ProveedorAnthropic } = await import('./anthropic.js');
    instancia = new ProveedorAnthropic();
  } else {
    const { ProveedorOllama } = await import('./ollama.js');
    instancia = new ProveedorOllama();
  }
  return instancia;
}

export function resumenError(err: unknown, max = 300): string {
  let msg: string;
  if (err instanceof AggregateError) {
    // p. ej. ECONNREFUSED en IPv4 e IPv6: el mensaje propio viene vacío
    msg = err.message || err.errors.map((e) => (e instanceof Error ? e.message : String(e))).join('; ');
  } else if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    msg = err.message || (code ? `error ${code}` : err.name);
  } else {
    msg = String(err);
  }
  return msg.replace(/\s+/g, ' ').slice(0, max);
}
