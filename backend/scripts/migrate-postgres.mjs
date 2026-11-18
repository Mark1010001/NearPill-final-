import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { assertApprovedMigrationTarget, assertSafeMigrationSession } from './lib/verify-migration-target.mjs';
import { executeReviewedMigration } from './lib/execute-reviewed-migration.mjs';
import { loadReviewedMigrationSources } from './lib/reviewed-migration-sources.mjs';

// Validate explicit target and migrator identity before constructing any connection.
assertApprovedMigrationTarget(process.env);

const { Pool } = pg;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationDir = path.join(root, 'migrations', 'postgres');

// Refuse any bad/unreadable SQL source before connecting or applying the
// first migration; migration order and inventory must match live preflight.
const migrations = (await loadReviewedMigrationSources(migrationDir)).map(({ filename, sql }) => ({
  filename, sql, sha256: createHash('sha256').update(sql).digest('hex'),
}));
const reviewedMigrations = migrations.map(({ filename, sha256 }) => ({ filename, sha256 }));

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
});

try {
  for (const { filename, sql, sha256 } of migrations) {
    const client = await pool.connect();
    try {
      await assertSafeMigrationSession(client, process.env);
      const result = await executeReviewedMigration(client, { filename, sql, sha256, reviewedMigrations });
      console.log(`${result === 'skipped' ? 'skip' : 'applied'} ${filename}`);
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
