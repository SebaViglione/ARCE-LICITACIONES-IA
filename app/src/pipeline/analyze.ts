// Stub de Fase 3: se implementa en la Fase 5.
import type { Logger } from '../logger.js';

export interface ResumenAnalisis {
  analizados: number;
  fallback: number;
  errores: number;
  tiempos_ms: number[];
}

export async function analizarPendientes(_log: Logger, _limite: number): Promise<ResumenAnalisis> {
  return { analizados: 0, fallback: 0, errores: 0, tiempos_ms: [] };
}
