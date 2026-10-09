import pg from 'pg';
import { config } from '../config.js';

const { Pool, types } = pg;

// DATE (oid 1082) y TIME (1083) se devuelven como texto plano ('YYYY-MM-DD', 'HH:MM:SS')
// para evitar corrimientos de zona horaria al serializar a JSON.
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1083, (v) => v);

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export type Queryable = pg.Pool | pg.PoolClient;

export async function cerrarPool(): Promise<void> {
  await pool.end();
}
