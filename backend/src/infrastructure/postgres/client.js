import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

const { Pool } = pg;

export function createPostgresDatabase({ host, port, user, password, database, ssl = false }) {
  const pool = new Pool({
    host,
    port: Number(port),
    user,
    password,
    database,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: ssl ? { rejectUnauthorized: true } : false,
  });

  pool.on('error', (error) => {
    console.error('postgres_pool_error', { code: error.code });
  });

  return Object.freeze({
    pool,
    db: drizzle(pool),
  });
}
