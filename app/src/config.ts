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
  LLM_MAX_CHARS: z.coerce.number().int().positive().default(40000),
  LLM_CHUNK_CHARS: z.coerce.number().int().positive().default(30000),
  LLM_CHUNK_OVERLAP: z.coerce.number().int().nonnegative().default(2000),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(900_000),

  OLLAMA_HOST: z.string().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('qwen3.5:9b'),
  OLLAMA_NUM_CTX: z.coerce.number().int().positive().default(16384),
  OLLAMA_NUM_PREDICT: z.coerce.number().int().positive().default(2048),
  OLLAMA_KEEP_ALIVE: z.string().default('30m'),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().optional(),
});

export type Config = z.infer<typeof EsquemaEnv>;

function cargarConfig(): Config {
  const resultado = EsquemaEnv.safeParse(process.env);
  if (!resultado.success) {
    const detalle = resultado.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida:\n${detalle}`);
  }
  return resultado.data;
}

export const config: Config = cargarConfig();
