import { config as cargarDotenv } from 'dotenv';
import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Raíz de app/ (funciona igual desde src/ con tsx y desde dist/ compilado)
export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Carga .env de app/ y, si no existe, el .env de la raíz del repo. Las variables ya
// definidas en el entorno (por ejemplo desde docker compose) tienen prioridad.
cargarDotenv({
  path: [path.join(APP_ROOT, '.env'), path.join(APP_ROOT, '..', '.env')],
  quiet: true,
});

const booleano = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'si', 'sí', 'yes'].includes(v.trim().toLowerCase())));

const EsquemaEnv = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_PRETTY: booleano.default(false),

  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria (ej: postgres://user:pass@localhost:5433/arce_licitaciones)'),
  DATA_DIR: z.string().default(path.join(APP_ROOT, '..', 'data')),

  TZ_LOCAL: z.string().default('America/Montevideo'),

  // Pipeline
  RUBRO: z.string().default('aluminio'),
  CRON: z.string().default('*/15 * * * *'),
  CRON_ENABLED: booleano.default(true),
  RUN_ON_START: booleano.default(true),
  RSS_DIAS: z.coerce.number().int().positive().default(60),
  SCRAPER_CONCURRENCIA: z.coerce.number().int().positive().max(8).default(2),
  MAX_ANALISIS_POR_CORRIDA: z.coerce.number().int().positive().default(50),
  PUPPETEER_EXECUTABLE_PATH: z.string().optional(),

  // LLM
  LLM_PROVIDER: z.enum(['ollama', 'anthropic']).default('ollama'),
  // Si no se definen, se derivan de OLLAMA_NUM_CTX (ver derivarLimites): ~3 chars/token dejando lugar al prompt y a la respuesta.
  LLM_MAX_CHARS: z.coerce.number().int().positive().optional(),
  LLM_CHUNK_CHARS: z.coerce.number().int().positive().optional(),
  LLM_CHUNK_OVERLAP: z.coerce.number().int().nonnegative().default(2000),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(900_000),

  OLLAMA_HOST: z.string().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('qwen3.5:4b'),
  OLLAMA_NUM_CTX: z.coerce.number().int().positive().default(8192),
  OLLAMA_NUM_PREDICT: z.coerce.number().int().positive().default(2048),
  OLLAMA_KEEP_ALIVE: z.string().default('30m'),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().optional(),

  // Mercado (histórico de ARCE): ingesta por API y refresco de estadísticas
  // Token que debe mandar el scraper (Authorization: Bearer ...). Vacío = ingesta deshabilitada.
  INGESTA_TOKEN: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().min(16, 'INGESTA_TOKEN debe tener al menos 16 caracteres (openssl rand -hex 32)').optional()),
  INGESTA_MAX_MB: z.coerce.number().int().positive().max(500).default(50),
  MERCADO_REFRESCO_CRON: z.string().default('30 3 * * *'),
  MERCADO_REFRESCO_ENABLED: booleano.default(true),
  // Espera tras el último lote antes de refrescar las vistas (varios lotes seguidos → un solo refresco)
  MERCADO_REFRESCO_DEBOUNCE_MS: z.coerce.number().int().nonnegative().default(60_000),
});

type Env = z.infer<typeof EsquemaEnv>;
export type Config = Omit<Env, 'LLM_MAX_CHARS' | 'LLM_CHUNK_CHARS'> & { LLM_MAX_CHARS: number; LLM_CHUNK_CHARS: number };

/** Reserva ~2500 tokens para instrucciones + respuesta y asume ~3 chars/token en español. */
export function derivarLimites(numCtx: number, maxChars?: number, chunkChars?: number): { LLM_MAX_CHARS: number; LLM_CHUNK_CHARS: number } {
  const max = maxChars ?? Math.max(6000, Math.floor((numCtx - 2500) * 3));
  const chunk = chunkChars ?? Math.max(4000, Math.floor(max * 0.75));
  return { LLM_MAX_CHARS: max, LLM_CHUNK_CHARS: Math.min(chunk, max) };
}

function cargarConfig(): Config {
  const resultado = EsquemaEnv.safeParse(process.env);
  if (!resultado.success) {
    const detalle = resultado.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida:\n${detalle}`);
  }
  const env = resultado.data;
  return { ...env, ...derivarLimites(env.OLLAMA_NUM_CTX, env.LLM_MAX_CHARS, env.LLM_CHUNK_CHARS) };
}

export const config: Config = cargarConfig();
