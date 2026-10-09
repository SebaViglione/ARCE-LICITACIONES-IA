import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type pg from 'pg';
import { APP_ROOT } from '../config.js';
import { logger } from '../logger.js';

const MIGRATIONS_DIR = path.join(APP_ROOT, 'migrations');

export async function runMigrations(pool: pg.Pool): Promise<string[]> {
  const archivos = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const aplicadas: string[] = [];

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        nombre text PRIMARY KEY,
        aplicada_en timestamptz NOT NULL DEFAULT now()
      )`);
    // Lock para que dos instancias no migren a la vez
    await client.query('SELECT pg_advisory_lock(427_001)');
    try {
      const { rows } = await client.query<{ nombre: string }>('SELECT nombre FROM schema_migrations');
      const hechas = new Set(rows.map((r) => r.nombre));
      for (const archivo of archivos) {
        if (hechas.has(archivo)) continue;
        const sql = await fs.readFile(path.join(MIGRATIONS_DIR, archivo), 'utf8');
        logger.info({ migracion: archivo }, 'aplicando migración');
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (nombre) VALUES ($1)', [archivo]);
          await client.query('COMMIT');
          aplicadas.push(archivo);
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(`Falló la migración ${archivo}: ${(err as Error).message}`);
        }
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock(427_001)');
    }
  } finally {
    client.release();
  }
  return aplicadas;
}

const esMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (esMain) {
  const { pool, cerrarPool } = await import('./pool.js');
  try {
    const aplicadas = await runMigrations(pool);
    logger.info({ aplicadas }, aplicadas.length ? 'migraciones aplicadas' : 'base de datos al día');
  } catch (err) {
    logger.error({ err }, 'error migrando');
    process.exitCode = 1;
  } finally {
    await cerrarPool();
  }
}
