import cron from 'node-cron';
import { config } from './config.js';
import { logger } from './logger.js';
import { pool, cerrarPool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { iniciarServidor } from './api/server.js';
import { runPipeline } from './pipeline/run.js';
import { getProveedor } from './llm/index.js';
import { cancelarRefrescoProgramado, refrescarEstadisticas } from './mercado/estadisticas.js';

async function main(): Promise<void> {
  logger.info({ rubro: config.RUBRO, proveedor: config.LLM_PROVIDER, modelo: config.LLM_PROVIDER === 'ollama' ? config.OLLAMA_MODEL : config.ANTHROPIC_MODEL, num_ctx: config.OLLAMA_NUM_CTX, max_chars: config.LLM_MAX_CHARS, data_dir: config.DATA_DIR }, 'arce-licitaciones-ia iniciando');

  // Postgres puede tardar unos segundos en aceptar conexiones aunque el healthcheck ya pasó
  for (let intento = 1; ; intento++) {
    try {
      const aplicadas = await runMigrations(pool);
      if (aplicadas.length) logger.info({ aplicadas }, 'migraciones aplicadas');
      break;
    } catch (err) {
      if (intento >= 10) throw err;
      logger.warn({ intento, error: (err as Error).message }, 'base de datos no disponible; reintentando en 3 s');
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  const server = await iniciarServidor();

  const salud = await (await getProveedor()).salud();
  if (salud.ok) logger.info({ ...salud }, 'proveedor LLM disponible');
  else logger.warn({ ...salud }, 'proveedor LLM no disponible: la ingesta funciona, el análisis fallará hasta que esté');

  let tarea: ReturnType<typeof cron.schedule> | null = null;
  if (config.CRON_ENABLED) {
    if (!cron.validate(config.CRON)) throw new Error(`CRON inválido: "${config.CRON}"`);
    tarea = cron.schedule(
      config.CRON,
      async () => {
        const r = await runPipeline({ origen: 'cron' });
        if (!r.ok && r.motivo) logger.info({ motivo: r.motivo }, 'corrida de cron omitida');
      },
      { timezone: config.TZ_LOCAL },
    );
    logger.info({ cron: config.CRON, tz: config.TZ_LOCAL }, 'scheduler activo');
  }

  // Estadísticas de mercado: refresco nocturno además del que dispara cada lote de ingesta.
  let tareaMercado: ReturnType<typeof cron.schedule> | null = null;
  if (config.MERCADO_REFRESCO_ENABLED) {
    if (!cron.validate(config.MERCADO_REFRESCO_CRON)) throw new Error(`MERCADO_REFRESCO_CRON inválido: "${config.MERCADO_REFRESCO_CRON}"`);
    tareaMercado = cron.schedule(
      config.MERCADO_REFRESCO_CRON,
      () => void refrescarEstadisticas('cron').catch((err) => logger.error({ err }, 'refresco nocturno de mercado falló')),
      { timezone: config.TZ_LOCAL },
    );
  }
  logger.info({ ingesta: config.INGESTA_TOKEN ? 'habilitada' : 'deshabilitada (sin INGESTA_TOKEN)', refresco: config.MERCADO_REFRESCO_ENABLED ? config.MERCADO_REFRESCO_CRON : 'off' }, 'mercado listo');

  if (config.RUN_ON_START) {
    // 15 s: la red del contenedor recién creado puede tardar unos segundos en salir a internet
    setTimeout(() => {
      void runPipeline({ origen: 'inicio' }).catch((err) => logger.error({ err }, 'corrida inicial falló'));
    }, 15_000);
  }

  let cerrando = false;
  const apagar = async (senal: string) => {
    if (cerrando) return;
    cerrando = true;
    logger.info({ senal }, 'apagando');
    tarea?.stop();
    tareaMercado?.stop();
    cancelarRefrescoProgramado();
    server.close();
    setTimeout(() => process.exit(0), 10_000).unref();
    await cerrarPool().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void apagar('SIGTERM'));
  process.on('SIGINT', () => void apagar('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'no se pudo iniciar');
  process.exit(1);
});
