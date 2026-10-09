import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import * as repos from '../db/repos.js';
import { getProveedor } from '../llm/index.js';
import { rubrosDisponibles } from '../pipeline/filtro.js';
import { estadoPipeline, runPipeline } from '../pipeline/run.js';
import { logger } from '../logger.js';

export const api = Router();

export class ErrorHttp extends Error {
  constructor(
    public status: number,
    message: string,
    public detalle?: unknown,
  ) {
    super(message);
  }
}

function validar<T>(schema: z.ZodType<T>, datos: unknown): T {
  const r = schema.safeParse(datos);
  if (!r.success) throw new ErrorHttp(400, 'Datos inválidos', r.error.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })));
  return r.data;
}

// --- Salud -----------------------------------------------------------------
api.get('/health', async (_req: Request, res: Response) => {
  const db = await pool
    .query('SELECT 1')
    .then(() => true)
    .catch(() => false);
  const llm = await (await getProveedor()).salud();
  const ok = db && llm.ok;
  res.status(ok ? 200 : 503).json({ ok, db, llm, rubro: config.RUBRO, cron: config.CRON_ENABLED ? config.CRON : null, pipeline: estadoPipeline() });
});

// --- Llamados --------------------------------------------------------------
const ListadoQuery = z.object({
  estado: z.enum(['activo', 'vencido', 'archivado', 'todos']).default('activo'),
  rubro: z.string().min(1).max(50).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

api.get('/llamados', async (req: Request, res: Response) => {
  const q = validar(ListadoQuery, req.query);
  const rows = await repos.listarLlamados({ estado: q.estado, rubro: q.rubro ?? null, limit: q.limit, offset: q.offset });
  res.json(rows);
});

api.get('/llamados/:id', async (req: Request, res: Response) => {
  const id = validar(z.string().min(1).max(64), req.params.id);
  const d = await repos.detalleLlamado(id);
  if (!d) throw new ErrorHttp(404, 'Llamado no encontrado');
  res.json(d);
});

// --- Feedback humano -------------------------------------------------------
export const ESTADOS_SEGUIMIENTO = ['pendiente', 'en_progreso', 'ganado', 'descartado'] as const;

const FeedbackBody = z.object({
  llamado_id: z.string().min(1).max(64),
  es_relevante_real: z.boolean().nullable().default(null),
  estado_seguimiento: z.enum(ESTADOS_SEGUIMIENTO).default('pendiente'),
  comentario: z.string().max(5000).nullable().default(null),
  ia_es_relevante: z.boolean().nullable().default(null),
  ia_confianza: z.number().min(0).max(100).nullable().default(null),
  ia_razon: z.string().max(5000).nullable().default(null),
});

api.post('/feedback', async (req: Request, res: Response) => {
  const f = validar(FeedbackBody, req.body);
  // Snapshot de lo que dijo la IA al momento de la revisión (si el cliente no lo manda)
  if (f.ia_es_relevante === null) {
    const ia = await repos.mejorAnalisis(f.llamado_id);
    if (ia) {
      f.ia_es_relevante = ia.es_relevante;
      f.ia_confianza = f.ia_confianza ?? ia.confianza;
      f.ia_razon = f.ia_razon ?? ia.razon;
    }
  }
  try {
    res.json(await repos.upsertFeedback(f));
  } catch (err) {
    if ((err as { code?: string }).code === '23503') throw new ErrorHttp(404, 'Llamado no encontrado');
    throw err;
  }
});

// --- Métricas --------------------------------------------------------------
api.get('/metricas', async (_req: Request, res: Response) => {
  res.json(await repos.metricas());
});

// --- Pipeline --------------------------------------------------------------
api.post('/pipeline/run', async (req: Request, res: Response) => {
  const estado = estadoPipeline();
  if (estado.enCurso) {
    res.status(202).json({ iniciada: false, motivo: 'ya hay una corrida en curso', pipeline: estado });
    return;
  }
  const opciones = validar(z.object({ soloIngesta: z.boolean().optional(), soloAnalisis: z.boolean().optional(), limiteAnalisis: z.number().int().min(1).max(500).optional() }).default({}), req.body ?? {});
  // No se espera el resultado: la corrida puede tardar minutos
  void runPipeline({ origen: 'api', ...opciones }).catch((err) => logger.error({ err }, 'corrida disparada por API falló'));
  res.status(202).json({ iniciada: true, pipeline: estadoPipeline() });
});

api.get('/pipeline/estado', async (_req: Request, res: Response) => {
  res.json({ ...estadoPipeline(), corridas: await repos.ultimasCorridas(10) });
});

// --- Rubros ----------------------------------------------------------------
api.get('/rubros', (_req: Request, res: Response) => {
  res.json({ actual: config.RUBRO, disponibles: rubrosDisponibles() });
});
