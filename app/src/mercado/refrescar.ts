import { pathToFileURL } from 'node:url';
import { logger } from '../logger.js';

// Refresco manual de las vistas materializadas de mercado (sin levantar la API).
//   npm run mercado:refrescar            → CONCURRENTLY (no bloquea lecturas)
//   npm run mercado:refrescar -- --bloqueante   → más rápido para la carga inicial masiva

const esMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (esMain) {
  const { pool, cerrarPool } = await import('../db/pool.js');
  const { refrescarEstadisticas } = await import('./estadisticas.js');
  try {
    const r = await refrescarEstadisticas('manual', { pool, concurrente: !process.argv.includes('--bloqueante') });
    logger.info({ estado: r.estado, duracion_ms: r.duracion_ms, detalle: r.detalle, error: r.error }, 'refresco terminado');
    if (r.estado !== 'ok') process.exitCode = 1;
  } finally {
    await cerrarPool();
  }
}
