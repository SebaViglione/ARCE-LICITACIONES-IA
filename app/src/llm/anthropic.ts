// Fase 5b: se implementa después de verificar la Fase 5. Placeholder para que compile getProveedor().
import type { PedidoJson, ProveedorLlm, RespuestaJson, SaludLlm } from './index.js';

export class ProveedorAnthropic implements ProveedorLlm {
  readonly nombre = 'anthropic';
  readonly modelo = 'pendiente';
  async preparar(): Promise<void> {
    throw new Error('Proveedor Anthropic todavía no implementado (Fase 5b)');
  }
  async salud(): Promise<SaludLlm> {
    return { ok: false, proveedor: this.nombre, modelo: this.modelo, cargado: false, detalle: 'no implementado' };
  }
  async generarJson<T>(_p: PedidoJson<T>): Promise<RespuestaJson<T>> {
    throw new Error('Proveedor Anthropic todavía no implementado (Fase 5b)');
  }
}
