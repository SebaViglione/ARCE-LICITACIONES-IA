// Cliente de /api/mercado/* (app/src/mercado/rutas.ts y consultas.ts).

export interface Rango {
  desde: string | null; // AAAA-MM
  hasta: string | null;
}

export interface PuntoMes {
  mes: string;
  adjudicaciones: number;
  llamados: number;
  organismos?: number;
  proveedores?: number;
  articulos?: number;
  monto_uyu: number | null;
  cantidad?: number | null;
  con_precio?: number;
  precio_mediano_uyu?: number | null;
  precio_min_uyu?: number | null;
  precio_max_uyu?: number | null;
}

export interface ResumenMercado {
  llamados: number;
  llamados_adjudicados: number;
  adjudicaciones: number;
  items: number;
  items_sin_articulo: number;
  articulos: number;
  proveedores: number;
  organismos: number;
  ofertas: number;
  cotizaciones: number;
  hechos: number;
  monto_uyu_total: number | null;
  cobertura_monto: number | null;
  cobertura_precio: number | null;
  con_cotizacion: number;
  primera_fecha: string | null;
  ultima_fecha: string | null;
  productos: number;
  adjudicaciones_excluidas: number;
  por_mes: PuntoMes[];
  monedas: Array<{ moneda: string; adjudicaciones: number }>;
  estados: Array<{ estado: string; llamados: number }>;
  tipos_compra: Array<{ tipo_compra: string; adjudicaciones: number; monto_uyu: number | null }>;
  ultima_ingesta: { id: number; tipo: string; fuente: string; recibido_en: string; finalizado_en: string | null; recibidos: number; insertados: number; actualizados: number; sin_cambios: number; rechazados: number } | null;
  ultimo_refresco: { id: number; origen: string; iniciado_en: string; finalizado_en: string | null; estado: string; duracion_ms: number | null } | null;
}

export interface ProductoFila {
  articulo_id: number;
  nombre: string;
  codigo: string | null;
  categoria: string | null;
  categoria_raiz_id: number | null;
  unidad: string;
  adjudicaciones: number;
  llamados: number;
  organismos: number;
  proveedores: number;
  monto_uyu: number | null;
  cantidad: number | null;
  precio_mediano_uyu: number | null;
  ultima_fecha: string | null;
  lider_proveedor_id: number | null;
  lider: string | null;
  lider_share_24m: number | null;
  hhi_24m: number | null;
  indice_oportunidad: number | null;
  monto_uyu_12m: number | null;
  monto_uyu_12m_previo: number | null;
  variacion_12m: number | null;
  variacion_precio_12m: number | null;
  precio_mediano_uyu_12m: number | null;
}

export interface Oportunidad {
  articulo_id: number;
  nombre: string;
  codigo: string | null;
  categoria: string | null;
  unidad: string;
  indice_oportunidad: number;
  comp_volumen: number;
  comp_recurrencia: number;
  comp_amplitud: number;
  comp_apertura: number;
  monto_uyu_24m: number | null;
  adjudicaciones_24m: number;
  llamados_24m: number;
  organismos_24m: number;
  proveedores_24m: number;
  hhi_24m: number | null;
  lider_proveedor_id: number | null;
  lider: string | null;
  lider_share_24m: number | null;
  precio_mediano_uyu_12m: number | null;
  precio_p25_uyu_12m: number | null;
  precio_p75_uyu_12m: number | null;
  variacion_12m: number | null;
  variacion_precio_12m: number | null;
  fecha_referencia: string | null;
}

export interface ParticipanteFila {
  adjudicaciones: number;
  llamados?: number;
  organismos?: number;
  monto_uyu: number | null;
  cantidad?: number | null;
  precio_mediano_uyu?: number | null;
  share: number | null;
  ultima_fecha: string | null;
}

export interface ProveedorEnProducto extends ParticipanteFila {
  proveedor_id: number;
  nombre: string;
  rut: string | null;
}

export interface OrganismoEnFicha extends ParticipanteFila {
  organismo_id: number | null;
  inciso: string | null;
  unidad_ejecutora: string | null;
}

export interface Adjudicacion {
  adjudicacion_id: number;
  fecha: string;
  arce_id: string;
  tipo_compra: string | null;
  objeto: string | null;
  url: string | null;
  inciso: string | null;
  unidad_ejecutora: string | null;
  proveedor?: string;
  proveedor_id?: number;
  articulo?: string | null;
  articulo_id?: number | null;
  cantidad: number | null;
  unidad: string;
  moneda: string;
  precio_unitario: number | null;
  precio_base_uyu: number | null;
  monto_uyu: number | null;
  base_conocida?: boolean;
  con_cotizacion?: boolean;
}

export interface CompetenciaAnio {
  anio: number;
  items_con_cuadro: number;
  oferentes_promedio: number | null;
  precio_ganador_mediano: number | null;
  precio_perdedor_mediano: number | null;
  descuento_mediano: number | null;
}

export interface FichaProducto {
  articulo_id: number;
  nombre: string;
  codigo: string | null;
  unidad_habitual: string | null;
  categoria: string | null;
  categoria_raiz_id: number | null;
  unidad_principal: string | null;
  lider: string | null;
  lider_rut: string | null;
  lider_proveedor_id: number | null;
  lider_share_24m: number | null;
  hhi_24m: number | null;
  adjudicaciones?: number;
  llamados?: number;
  monto_uyu?: number | null;
  monto_uyu_12m?: number | null;
  monto_uyu_12m_previo?: number | null;
  variacion_12m?: number | null;
  variacion_precio_12m?: number | null;
  precio_mediano_uyu_12m?: number | null;
  precio_p25_uyu_12m?: number | null;
  precio_p75_uyu_12m?: number | null;
  adjudicaciones_24m?: number;
  llamados_24m?: number;
  organismos_24m?: number;
  proveedores_24m?: number;
  primera_fecha?: string | null;
  ultima_fecha?: string | null;
  fecha_referencia?: string | null;
  cobertura_precio?: number | null;
  indice_oportunidad: number | null;
  comp_volumen?: number | null;
  comp_recurrencia?: number | null;
  comp_amplitud?: number | null;
  comp_apertura?: number | null;
  rango: {
    adjudicaciones: number;
    llamados: number;
    organismos: number;
    proveedores: number;
    monto_uyu: number | null;
    cantidad: number | null;
    con_precio: number;
    precio_p10_uyu: number | null;
    precio_p25_uyu: number | null;
    precio_mediano_uyu: number | null;
    precio_p75_uyu: number | null;
    precio_p90_uyu: number | null;
    primera_fecha: string | null;
    ultima_fecha: string | null;
  };
  serie: PuntoMes[];
  proveedores: ProveedorEnProducto[];
  organismos: OrganismoEnFicha[];
  tipos_compra: Array<{ tipo_compra: string; adjudicaciones: number; monto_uyu: number | null }>;
  ultimas: Adjudicacion[];
  competencia: CompetenciaAnio[];
  unidades: Array<{ unidad: string; adjudicaciones: number; cantidad: number | null; precio_mediano_uyu: number | null }>;
}

export interface ProveedorFila {
  proveedor_id: number;
  nombre: string;
  rut: string | null;
  adjudicaciones: number;
  llamados: number;
  articulos: number;
  organismos: number;
  monto_uyu: number | null;
  ultima_fecha: string | null;
  ofertas_presentadas: number | null;
  ofertas_ganadas: number | null;
  tasa_exito: number | null;
  variacion_12m: number | null;
  monto_uyu_12m: number | null;
  principal_articulo_id: number | null;
  principal_articulo: string | null;
}

export interface ProductoEnProveedor extends ParticipanteFila {
  articulo_id: number;
  nombre: string;
  codigo: string | null;
  categoria: string | null;
  unidad: string;
}

export interface Competidor {
  proveedor_id: number;
  nombre: string;
  rut: string | null;
  productos_en_comun: number;
  adjudicaciones: number;
  monto_uyu: number | null;
  ejemplos: string[] | null;
}

export interface FichaProveedor {
  proveedor_id: number;
  nombre: string;
  rut: string | null;
  pais: string | null;
  adjudicaciones?: number;
  llamados?: number;
  articulos?: number;
  monto_uyu?: number | null;
  monto_uyu_12m?: number | null;
  variacion_12m?: number | null;
  primera_fecha?: string | null;
  ultima_fecha?: string | null;
  principal_articulo_id?: number | null;
  principal_articulo?: string | null;
  ofertas_presentadas?: number | null;
  ofertas_ganadas?: number | null;
  tasa_exito?: number | null;
  rango: { adjudicaciones: number; llamados: number; articulos: number; organismos: number; monto_uyu: number | null; primera_fecha: string | null; ultima_fecha: string | null };
  serie: PuntoMes[];
  productos: ProductoEnProveedor[];
  organismos: OrganismoEnFicha[];
  competidores: Competidor[];
  ultimas: Adjudicacion[];
  tipos_compra: Array<{ tipo_compra: string; adjudicaciones: number; monto_uyu: number | null }>;
}

export interface OrganismoFila {
  organismo_id: number;
  inciso: string;
  unidad_ejecutora: string;
  adjudicaciones: number;
  llamados: number;
  articulos: number;
  proveedores: number;
  monto_uyu: number | null;
  ultima_fecha: string | null;
  principales: string[] | null;
}

export interface Categoria {
  id: number;
  nombre: string;
  adjudicaciones: number;
  articulos: number;
  monto_uyu: number | null;
}

export interface Lote {
  id: number;
  tipo: string;
  fuente: string;
  recibido_en: string;
  finalizado_en: string | null;
  recibidos: number;
  insertados: number;
  actualizados: number;
  sin_cambios: number;
  rechazados: number;
  errores: Array<{ indice: number; clave: string; error: string }> | null;
  duracion_ms: number | null;
}

export interface EstadoMercado {
  refresco_en_curso: boolean;
  ultimo_refresco: ResumenMercado['ultimo_refresco'];
  refrescos: NonNullable<ResumenMercado['ultimo_refresco']>[];
  lotes: Lote[];
}

export type OrdenProductos = 'monto' | 'adjudicaciones' | 'organismos' | 'oportunidad' | 'crecimiento' | 'precio';
export type OrdenProveedores = 'monto' | 'adjudicaciones' | 'articulos' | 'organismos' | 'exito' | 'crecimiento';

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let detalle = '';
    try {
      detalle = ((await res.json()) as { error?: string }).error ?? '';
    } catch {
      /* sin cuerpo JSON */
    }
    throw new Error(detalle || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function qs(params: Record<string, string | number | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const mercadoApi = {
  resumen: () => pedir<ResumenMercado>('/api/mercado/resumen'),
  estado: () => pedir<EstadoMercado>('/api/mercado/estado'),
  refrescar: () => pedir<{ iniciado: boolean }>('/api/mercado/refrescar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
  categorias: (r: Rango) => pedir<Categoria[]>(`/api/mercado/categorias${qs({ desde: r.desde, hasta: r.hasta })}`),
  oportunidades: (categoria: number | null, limit = 40) => pedir<Oportunidad[]>(`/api/mercado/oportunidades${qs({ categoria, limit })}`),
  productos: (r: Rango, f: { q?: string | null; categoria?: number | null; orden: OrdenProductos; limit?: number; offset?: number }) =>
    pedir<{ total: number; filas: ProductoFila[] }>(`/api/mercado/productos${qs({ desde: r.desde, hasta: r.hasta, q: f.q, categoria: f.categoria, orden: f.orden, limit: f.limit ?? 100, offset: f.offset ?? 0 })}`),
  producto: (id: number, r: Rango) => pedir<FichaProducto>(`/api/mercado/productos/${id}${qs({ desde: r.desde, hasta: r.hasta })}`),
  proveedores: (r: Rango, f: { q?: string | null; articulo?: number | null; orden: OrdenProveedores; limit?: number; offset?: number }) =>
    pedir<{ total: number; filas: ProveedorFila[] }>(`/api/mercado/proveedores${qs({ desde: r.desde, hasta: r.hasta, q: f.q, articulo: f.articulo, orden: f.orden, limit: f.limit ?? 100, offset: f.offset ?? 0 })}`),
  proveedor: (id: number, r: Rango) => pedir<FichaProveedor>(`/api/mercado/proveedores/${id}${qs({ desde: r.desde, hasta: r.hasta })}`),
  organismos: (r: Rango, f: { q?: string | null; limit?: number; offset?: number }) =>
    pedir<{ total: number; filas: OrganismoFila[] }>(`/api/mercado/organismos${qs({ desde: r.desde, hasta: r.hasta, q: f.q, limit: f.limit ?? 100, offset: f.offset ?? 0 })}`),
};
