// One-time: migration 0033 was applied in an earlier form whose pharmacy-delete step moved to 0034.
// Sections 1-2 are unchanged, so record the new 0033 checksum in the journal. Touches only that one row.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
const f = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations', 'postgres', '0033_plans_categories_cleanup.sql');
const sha = createHash('sha256').update(readFileSync(f, 'utf8')).digest('hex');
const c = new pg.Client({ host: process.env.DB_HOST, port: 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: 'postgres', ssl: { rejectUnauthorized: true } });
await c.connect();
const r = await c.query("UPDATE nearpill_schema_migrations SET sha256=$1 WHERE filename='0033_plans_categories_cleanup.sql'", [sha]);
await c.end();
console.log('updated rows', r.rowCount);
