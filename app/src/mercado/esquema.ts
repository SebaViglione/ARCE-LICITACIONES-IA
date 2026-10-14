import { z } from 'zod';
import { fechaFlexible, fechaHoraFlexible, numeroFlexible } from './normalizar.js';

// Contrato de ingesta: lo que el scraper tiene que mandar a POST /api/ingesta/llamados (y afines).
// Es deliberadamente tolerante en formato (números con coma, fechas dd/mm/aaaa, texto en vez de null)
// y estricto en estructura (un ítem tiene nro_item, una adjudicación tiene proveedor).
// El JSON Schema de entrada se publica en GET /api/ingesta/esquema (ver docs/MERCADO.md).

const texto = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => {
      const t = v?.trim();
      return t ? t : null;
    });

const Numero = z
  .union([z.number(), z.string().max(40)])
  .nullable()
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === '') return null;
    const n = numeroFlexible(v);
    if (n === null) {
      ctx.addIssue({ code: 'custom', message: `número inválido: ${JSON.stringify(v)}` });
      return z.NEVER;
    }
    return n;
  });

const NumeroNoNegativo = Numero.refine((n) => n === null || n >= 0, 'no puede ser negativo');

const Fecha = z
  .string()
  .max(40)
  .nullable()
  .optional()
  .transform((v, ctx) => {
    if (!v || !v.trim()) return null;
    const f = fechaFlexible(v);
    if (!f) {
      ctx.addIssue({ code: 'custom', message: `fecha inválida: ${JSON.stringify(v)} (usar AAAA-MM-DD)` });
      return z.NEVER;
    }
    return f;
  });

const FechaHora = z
  .string()
  .max(40)
  .nullable()
  .optional()
  .transform((v, ctx) => {
    if (!v || !v.trim()) return null;
    const f = fechaHoraFlexible(v);
    if (!f) {
      ctx.addIssue({ code: 'custom', message: `fecha/hora inválida: ${JSON.stringify(v)} (usar ISO 8601)` });
      return z.NEVER;
    }
    return f;
  });

export const CategoriaIngesta = z
  .object({
    familia: texto(200),
    subfamilia: texto(200),
    clase: texto(200),
  })
  .describe('Jerarquía del catálogo de ARCE; cualquier nivel puede faltar');

export const ArticuloIngesta = z
  .object({
    codigo: texto(50).describe('Código del artículo en el catálogo de ARCE (identificador preferido)'),
    nombre: z.string().trim().min(1).max(500).describe('Nombre del artículo tal como figura en el catálogo'),
    categoria: CategoriaIngesta.nullable().optional(),
    unidad: texto(50).describe('Unidad de medida habitual del artículo'),
  })
  .describe('Producto del catálogo. Sin código se identifica por nombre normalizado');

export const ProveedorIngesta = z
  .object({
    rut: z.union([z.string().max(30), z.number()]).nullable().optional().describe('RUT (12 dígitos). Identificador preferido'),
    nombre: z.string().trim().min(1).max(300).describe('Razón social o nombre tal como figura en el portal'),
    pais: texto(100),
  })
  .describe('Oferente o adjudicatario. Sin RUT se identifica por nombre normalizado');

const camposPrecio = {
  precio_unitario: NumeroNoNegativo.describe('Precio por unidad, en la moneda indicada'),
  moneda: texto(30).describe('UYU, USD, UI, UR, EUR o el texto del portal ($, U$S, ...)'),
  impuestos_incluidos: z.boolean().default(false).describe('true si el precio ya incluye impuestos. El portal suele publicar precios sin impuestos'),
  tasa_impuestos: Numero.refine((n) => n === null || (n >= 0 && n <= 1), 'tasa entre 0 y 1').describe('Tasa de impuestos (0.22 = IVA 22 %) si el portal la muestra; permite comparar precios con y sin impuestos'),
  cantidad: NumeroNoNegativo,
  monto_total: NumeroNoNegativo.describe('Monto total en la misma base impositiva que precio_unitario. Si falta se calcula precio × cantidad'),
};

export const OfertaIngesta = z
  .object({
    proveedor: ProveedorIngesta,
    ...camposPrecio,
    plazo_entrega: texto(200),
    marca: texto(200),
    observaciones: texto(2000),
  })
  .describe('Una oferta del cuadro comparativo (ganadora o no)');

export const AdjudicacionIngesta = z
  .object({
    proveedor: ProveedorIngesta,
    ...camposPrecio,
    monto_total_con_impuestos: NumeroNoNegativo,
    fecha: Fecha.describe('Fecha de la adjudicación (AAAA-MM-DD). Si falta se usa la del llamado'),
    resolucion: texto(200),
  })
  .describe('Lo adjudicado a un proveedor en el ítem');

export const ItemIngesta = z
  .object({
    nro_item: z.coerce.number().int().positive().describe('Número de ítem dentro del llamado (único por llamado)'),
    articulo: ArticuloIngesta.nullable().optional(),
    descripcion: texto(5000).describe('Descripción libre del ítem si no hay artículo de catálogo'),
    cantidad: NumeroNoNegativo,
    unidad: texto(50),
    variante: texto(500),
    presentacion: texto(500),
    detalle: texto(5000),
    marca: texto(200),
    ofertas: z.array(OfertaIngesta).max(500).default([]),
    adjudicaciones: z.array(AdjudicacionIngesta).max(100).default([]),
  })
  .describe('Ítem del llamado con sus ofertas (si hay cuadro comparativo) y adjudicaciones');

export const OrganismoIngesta = z
  .object({
    inciso: z.string().trim().min(1).max(300).describe('Inciso (ministerio, ente, intendencia...)'),
    unidad_ejecutora: texto(300),
    codigo_inciso: texto(20),
    codigo_unidad: texto(20),
  })
  .describe('Organismo comprador');

export const LlamadoIngesta = z
  .object({
    arce_id: z.union([z.string().trim().min(1).max(64), z.number().int()]).transform(String).describe('Identificador del llamado en el portal (el id de la URL de detalle)'),
    tipo_compra: texto(100).describe('Licitación Pública, Licitación Abreviada, Compra Directa, Pregón, Convenio Marco...'),
    numero: texto(50),
    anio: z.coerce.number().int().min(1990).max(2100).nullable().optional(),
    organismo: OrganismoIngesta.nullable().optional(),
    objeto: texto(10000).describe('Objeto del llamado'),
    estado: texto(100).describe('Estado tal como lo muestra el portal (Adjudicado, Desierto, Anulado, Publicado...)'),
    fecha_publicacion: Fecha,
    fecha_apertura: FechaHora,
    fecha_adjudicacion: Fecha,
    moneda: texto(30),
    url: texto(1000),
    items: z.array(ItemIngesta).max(5000).default([]),
  })
  .superRefine((ll, ctx) => {
    const vistos = new Set<number>();
    for (const it of ll.items) {
      if (vistos.has(it.nro_item)) ctx.addIssue({ code: 'custom', path: ['items'], message: `nro_item repetido: ${it.nro_item}` });
      vistos.add(it.nro_item);
    }
  })
  .describe('Un llamado completo (snapshot de la página de detalle). Reenviar el mismo arce_id reemplaza ítems, ofertas y adjudicaciones');

export const LoteLlamadosIngesta = z.object({
  fuente: z.string().trim().min(1).max(100).default('scraper').describe('Quién manda los datos (nombre del scraper o del dataset)'),
  llamados: z.array(LlamadoIngesta).min(1).max(500),
});

export const CotizacionIngesta = z.object({
  moneda: z.string().trim().min(1).max(30),
  fecha: Fecha.pipe(z.string()),
  valor_uyu: Numero.pipe(z.number().positive()).describe('Cuántos pesos uruguayos vale una unidad de la moneda ese día'),
  fuente: texto(100),
});

export const LoteCotizacionesIngesta = z.object({
  cotizaciones: z.array(CotizacionIngesta).min(1).max(20000),
});

export const LoteArticulosIngesta = z.object({
  articulos: z.array(ArticuloIngesta).min(1).max(5000),
});

export const LoteProveedoresIngesta = z.object({
  proveedores: z.array(ProveedorIngesta).min(1).max(5000),
});

export type CategoriaIngesta = z.infer<typeof CategoriaIngesta>;
export type ArticuloIngesta = z.infer<typeof ArticuloIngesta>;
export type ProveedorIngesta = z.infer<typeof ProveedorIngesta>;
export type OfertaIngesta = z.infer<typeof OfertaIngesta>;
export type AdjudicacionIngesta = z.infer<typeof AdjudicacionIngesta>;
export type ItemIngesta = z.infer<typeof ItemIngesta>;
export type OrganismoIngesta = z.infer<typeof OrganismoIngesta>;
export type LlamadoIngesta = z.infer<typeof LlamadoIngesta>;
export type LoteLlamadosIngesta = z.infer<typeof LoteLlamadosIngesta>;
export type CotizacionIngesta = z.infer<typeof CotizacionIngesta>;
export type LoteCotizacionesIngesta = z.infer<typeof LoteCotizacionesIngesta>;
export type LoteArticulosIngesta = z.infer<typeof LoteArticulosIngesta>;
export type LoteProveedoresIngesta = z.infer<typeof LoteProveedoresIngesta>;

/** JSON Schema (lado de entrada) de cada endpoint, para quien escriba el scraper. */
export function esquemasJson(): Record<string, unknown> {
  const opciones = { io: 'input' as const, unrepresentable: 'any' as const };
  return {
    'POST /api/ingesta/llamados': z.toJSONSchema(LoteLlamadosIngesta, opciones),
    'POST /api/ingesta/cotizaciones': z.toJSONSchema(LoteCotizacionesIngesta, opciones),
    'POST /api/ingesta/articulos': z.toJSONSchema(LoteArticulosIngesta, opciones),
    'POST /api/ingesta/proveedores': z.toJSONSchema(LoteProveedoresIngesta, opciones),
  };
}
