import { createHash, timingSafeEqual } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { ErrorHttp } from '../api/errores.js';
import * as consultas from './consultas.js';
import { esquemasJson, LoteArticulosIngesta, LoteCotizacionesIngesta, LoteLlamadosIngesta, LoteProveedoresIngesta } from './esquema.js';
import { refrescoEnCurso, refrescarEstadisticas, ultimoRefresco, ultimosRefrescos } from './estadisticas.js';
import { borrarFuente, ingestarArticulos, ingestarCotizaciones, ingestarLlamados, ingestarProveedores, reprocesarCrudos, ultimosLotes } from './ingesta.js';
import { logger } from '../logger.js';
import { claveMercado, claveProducto, clavePregunta, estadoTrabajo, generarAnalisisProducto, generarInformeMercado, iniciarTrabajo, responderPreguntaUnaVez, ultimasPreguntas, ultimoInforme, type AnalisisProducto, type FiltrosMercado, type InformeMercado, type RespuestaPregunta } from './analista.js';

function validar<T>(schema: z.ZodType<T>, datos: unknown): T {
  const r = schema.safeParse(datos);
  if (!r.success) throw new ErrorHttp(400, 'Datos inválidos', r.error.issues.slice(0, 50).map((i) => ({ campo: i.path.join('.'), mensaje: i.message })));
  return r.data;
}

// ---------------------------------------------------------------------------
// Ingesta (protegida por INGESTA_TOKEN)
// ---------------------------------------------------------------------------

function tokenValido(recibido: string | undefined, esperado: string): boolean {
  if (!recibido) return false;
  const a = createHash('sha256').update(recibido).digest();
  const b = createHash('sha256').update(esperado).digest();
  return timingSafeEqual(a, b);
}

export function requiereToken(req: Request, _res: Response, next: NextFunction): void {
  if (!config.INGESTA_TOKEN) throw new ErrorHttp(503, 'La ingesta está deshabilitada: definí INGESTA_TOKEN en el entorno (openssl rand -hex 32)');
  const auth = req.get('authorization');
  const recibido = auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : req.get('x-ingesta-token');
  if (!tokenValido(recibido, config.INGESTA_TOKEN)) throw new ErrorHttp(401, 'Token de ingesta inválido');
  next();
}

export const ingesta = Router();

ingesta.get('/esquema', (_req: Request, res: Response) => {
  res.json({
    descripcion: 'Contrato de ingesta del histórico de ARCE. Autenticación: Authorization: Bearer <INGESTA_TOKEN>. Ver docs/MERCADO.md.',
    esquemas: esquemasJson(),
  });
});

ingesta.post('/llamados', requiereToken, async (req: Request, res: Response) => {
  const lote = validar(LoteLlamadosIngesta, req.body);
  const r = await ingestarLlamados(lote);
  res.status(r.rechazados.length === r.recibidos ? 422 : 200).json(r);
});

ingesta.post('/cotizaciones', requiereToken, async (req: Request, res: Response) => {
  const lote = validar(LoteCotizacionesIngesta, req.body);
  res.json(await ingestarCotizaciones(lote));
});

ingesta.post('/articulos', requiereToken, async (req: Request, res: Response) => {
  const lote = validar(LoteArticulosIngesta, req.body);
  res.json(await ingestarArticulos(lote));
});

ingesta.post('/proveedores', requiereToken, async (req: Request, res: Response) => {
  const lote = validar(LoteProveedoresIngesta, req.body);
  res.json(await ingestarProveedores(lote));
});

ingesta.post('/reprocesar', requiereToken, async (req: Request, res: Response) => {
  const o = validar(z.object({ desde_lote: z.number().int().positive().optional(), limite: z.number().int().positive().max(1_000_000).optional() }).default({}), req.body ?? {});
  res.json(await reprocesarCrudos({ desdeLote: o.desde_lote, limite: o.limite }));
});

ingesta.delete('/fuente/:fuente', requiereToken, async (req: Request, res: Response) => {
  const fuente = validar(z.string().min(1).max(100), req.params.fuente);
  const confirmar = validar(z.string().optional(), req.query.confirmar);
  if (confirmar !== fuente) throw new ErrorHttp(400, `Para borrar la fuente "${fuente}" repetila en ?confirmar=${encodeURIComponent(fuente)}`);
  const r = await borrarFuente(fuente);
  logger.warn({ fuente, ...r }, 'fuente borrada por API');
  res.json(r);
});

ingesta.get('/lotes', async (req: Request, res: Response) => {
  const n = validar(z.coerce.number().int().min(1).max(200).default(20), req.query.limit);
  res.json(await ultimosLotes(n));
});

// ---------------------------------------------------------------------------
// Estadísticas de mercado
// ---------------------------------------------------------------------------

export const mercado = Router();

const Mes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'usar AAAA-MM');
const RangoQuery = z.object({ desde: Mes.optional(), hasta: Mes.optional() });

function rangoDe(q: z.infer<typeof RangoQuery>): consultas.Rango {
  if (q.desde && q.hasta && q.desde > q.hasta) throw new ErrorHttp(400, '"desde" no puede ser posterior a "hasta"');
  return { desde: q.desde ?? null, hasta: q.hasta ?? null };
}

mercado.get('/resumen', async (_req: Request, res: Response) => {
  res.json(await consultas.resumen());
});

mercado.get('/estado', async (_req: Request, res: Response) => {
  res.json({ refresco_en_curso: refrescoEnCurso(), ultimo_refresco: await ultimoRefresco(), refrescos: await ultimosRefrescos(10), lotes: await ultimosLotes(10) });
});

mercado.post('/refrescar', async (req: Request, res: Response) => {
  const o = validar(z.object({ concurrente: z.boolean().optional() }).default({}), req.body ?? {});
  if (refrescoEnCurso()) {
    res.status(202).json({ iniciado: false, motivo: 'ya hay un refresco en curso' });
    return;
  }
  void refrescarEstadisticas('api', { concurrente: o.concurrente }).catch((err) => logger.error({ err }, 'refresco por API falló'));
  res.status(202).json({ iniciado: true });
});

const ProductosQuery = RangoQuery.extend({
  q: z.string().trim().min(1).max(200).optional(),
  categoria: z.coerce.number().int().positive().optional(),
  orden: z.enum(['monto', 'adjudicaciones', 'organismos', 'oportunidad', 'crecimiento', 'precio']).default('monto'),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

mercado.get('/productos', async (req: Request, res: Response) => {
  const q = validar(ProductosQuery, req.query);
  res.json(await consultas.productos({ ...rangoDe(q), q: q.q ?? null, categoria: q.categoria ?? null, orden: q.orden, limit: q.limit, offset: q.offset }));
});

mercado.get('/productos/:id', async (req: Request, res: Response) => {
  const id = validar(z.coerce.number().int().positive(), req.params.id);
  const q = validar(RangoQuery, req.query);
  const p = await consultas.producto(id, rangoDe(q));
  if (!p) throw new ErrorHttp(404, 'Producto no encontrado');
  res.json(p);
});

const ProveedoresQuery = RangoQuery.extend({
  q: z.string().trim().min(1).max(200).optional(),
  articulo: z.coerce.number().int().positive().optional(),
  orden: z.enum(['monto', 'adjudicaciones', 'articulos', 'organismos', 'exito', 'crecimiento']).default('monto'),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

mercado.get('/proveedores', async (req: Request, res: Response) => {
  const q = validar(ProveedoresQuery, req.query);
  res.json(await consultas.proveedores({ ...rangoDe(q), q: q.q ?? null, articulo: q.articulo ?? null, orden: q.orden, limit: q.limit, offset: q.offset }));
});

mercado.get('/proveedores/:id', async (req: Request, res: Response) => {
  const id = validar(z.coerce.number().int().positive(), req.params.id);
  const q = validar(RangoQuery, req.query);
  const p = await consultas.proveedor(id, rangoDe(q));
  if (!p) throw new ErrorHttp(404, 'Proveedor no encontrado');
  res.json(p);
});

const OrganismosQuery = RangoQuery.extend({
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

mercado.get('/organismos', async (req: Request, res: Response) => {
  const q = validar(OrganismosQuery, req.query);
  res.json(await consultas.organismos({ ...rangoDe(q), q: q.q ?? null, limit: q.limit, offset: q.offset }));
});

mercado.get('/categorias', async (req: Request, res: Response) => {
  const q = validar(RangoQuery, req.query);
  res.json(await consultas.categorias(rangoDe(q)));
});

mercado.get('/oportunidades', async (req: Request, res: Response) => {
  const q = validar(z.object({ limit: z.coerce.number().int().min(1).max(200).default(30), categoria: z.coerce.number().int().positive().optional() }), req.query);
  res.json(await consultas.oportunidades(q.limit, q.categoria ?? null));
});

mercado.get('/buscar', async (req: Request, res: Response) => {
  const q = validar(z.string().trim().min(2).max(200), req.query.q);
  res.json(await consultas.buscar(q));
});

// ---------------------------------------------------------------------------
// Analista (IA sobre las estadísticas): informe del mercado, veredicto por producto, preguntas
// ---------------------------------------------------------------------------

const FiltrosAnalisisQuery = RangoQuery.extend({ categoria: z.coerce.number().int().positive().optional() });

function filtrosDe(q: z.infer<typeof FiltrosAnalisisQuery>): FiltrosMercado {
  return { ...rangoDe(q), categoria: q.categoria ?? null };
}

mercado.get('/analisis', async (req: Request, res: Response) => {
  const f = filtrosDe(validar(FiltrosAnalisisQuery, req.query));
  const clave = claveMercado(f);
  res.json({ ...estadoTrabajo(`mercado:${clave}`), informe: await ultimoInforme<InformeMercado>('mercado', clave) });
});

mercado.post('/analisis', async (req: Request, res: Response) => {
  const f = filtrosDe(validar(FiltrosAnalisisQuery, req.body ?? {}));
  const iniciado = iniciarTrabajo(`mercado:${claveMercado(f)}`, () => generarInformeMercado(f));
  res.status(202).json({ iniciado, ...estadoTrabajo(`mercado:${claveMercado(f)}`) });
});

mercado.get('/productos/:id/analisis', async (req: Request, res: Response) => {
  const id = validar(z.coerce.number().int().positive(), req.params.id);
  const rango = rangoDe(validar(RangoQuery, req.query));
  const clave = claveProducto(id, rango);
  res.json({ ...estadoTrabajo(`producto:${clave}`), informe: await ultimoInforme<AnalisisProducto>('producto', clave) });
});

mercado.post('/productos/:id/analisis', async (req: Request, res: Response) => {
  const id = validar(z.coerce.number().int().positive(), req.params.id);
  const rango = rangoDe(validar(RangoQuery, req.body ?? {}));
  const clave = `producto:${claveProducto(id, rango)}`;
  const iniciado = iniciarTrabajo(clave, async () => {
    const r = await generarAnalisisProducto(id, rango);
    if (!r) throw new ErrorHttp(404, 'Producto no encontrado');
  });
  res.status(202).json({ iniciado, ...estadoTrabajo(clave) });
});

// Pregunta libre: responde en la misma llamada (segundos con Anthropic, alrededor de un minuto con un modelo local).
// La misma pregunta en las últimas 6 horas se devuelve de la base; repetida mientras se responde, comparte la llamada.
mercado.post('/preguntar', async (req: Request, res: Response) => {
  const { pregunta } = validar(z.object({ pregunta: z.string().trim().min(5).max(500) }), req.body ?? {});
  const reciente = await ultimoInforme<RespuestaPregunta>('pregunta', clavePregunta(pregunta));
  if (reciente && Date.now() - new Date(reciente.creado_en).getTime() < 6 * 3600_000) {
    res.json({ ...reciente, en_cache: true });
    return;
  }
  try {
    res.json(await responderPreguntaUnaVez(pregunta));
  } catch (err) {
    throw new ErrorHttp(502, `La IA no pudo responder: ${(err as Error).message}`);
  }
});

mercado.get('/preguntas', async (req: Request, res: Response) => {
  const n = validar(z.coerce.number().int().min(1).max(50).default(10), req.query.limit);
  res.json(await ultimasPreguntas(n));
});
