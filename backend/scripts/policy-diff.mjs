// READ-ONLY diagnostic: lists how the live RLS policies differ from the reviewed migrations.
// Prints policy/table names only. Uses the app role with the same probe as the verifier.
import pg from 'pg';
import { reviewedRlsPolicyInventory, POLICY_INVENTORY_PROBE_SQL } from './lib/verify-live-fixture-connection.mjs';
const pool = new pg.Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 10000 });
try {
  const approved = await reviewedRlsPolicyInventory();
  const tables = [...new Set(approved.map((p) => p.tablename)), 'users', 'nearpill_schema_migrations'];
  const live = (await pool.query(POLICY_INVENTORY_PROBE_SQL, [tables])).rows;
  const key = (r) => `${r.tablename}.${r.policyname}`;
  const a = new Map(approved.map((r) => [key(r), r])); const l = new Map(live.map((r) => [key(r), r]));
  console.log(`reviewed=${approved.length} live=${live.length}`);
  for (const k of a.keys()) if (!l.has(k)) console.log('MISSING IN DB:', k);
  for (const k of l.keys()) if (!a.has(k)) console.log('EXTRA IN DB (not in migrations):', k);
  for (const [k, r] of a) { const x = l.get(k); if (x && (x.cmd !== r.cmd || x.permissive !== r.permissive || JSON.stringify(x.roles) !== JSON.stringify(r.roles))) console.log('DIFFERENT:', k, 'live', x.cmd, x.permissive, JSON.stringify(x.roles), 'reviewed', r.cmd, r.permissive, JSON.stringify(r.roles)); }
  console.log('done');
} finally { await pool.end(); }
