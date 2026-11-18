import mysql from 'mysql2/promise';
import { pesosToCentavos } from '../src/domain/money/centavos.js';
import pg from 'pg';
import { assertApprovedLegacyImportTarget } from './lib/verify-legacy-import-target.mjs';
import { assertSafeMigrationSession } from './lib/verify-migration-target.mjs';

// Fail before opening either database, including when this legacy utility is
// called directly rather than through npm. Production migration needs its own
// reviewed, reconciled, backup-backed procedure.
assertApprovedLegacyImportTarget(process.env);

const { Pool } = pg;
const tables = [
  'users',
  'drugstores',
  'medicines',
  'inventory',
  'orders',
  'order_drugstores',
  'order_items',
  'audit_logs',
  'payments',
  'subscriptions',
];

const mysqlPool = mysql.createPool({
  host: process.env.LEGACY_DB_HOST,
  port: Number(process.env.LEGACY_DB_PORT),
  user: process.env.LEGACY_DB_USER,
  password: process.env.LEGACY_DB_PASSWORD,
  database: process.env.LEGACY_DB_NAME,
  waitForConnections: true,
  connectionLimit: 4,
});
const postgresPool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
});

function normalizedRow(table, row) {
  const copy = { ...row };
  if (table === 'orders') {
    delete copy.userId;
    copy.total_centavos = pesosToCentavos(copy.total ?? 0);
    copy.idempotency_key = null;
    copy.idempotency_fingerprint = null;
    delete copy.total;
    const status = String(copy.status || '').toLowerCase();
    copy.status = ({ pending: 'reserved', approved: 'confirmed', rejected: 'cancelled', canceled: 'cancelled' })[status] || status;
    copy.idempotency_key = null;
  }
  if (table === 'order_drugstores') {
    const status = String(copy.status || '').toLowerCase();
    copy.status = ({ pending: 'reserved', approved: 'confirmed', rejected: 'cancelled', canceled: 'cancelled' })[status] || status;
  }
  if (table === 'inventory') {
    copy.price_centavos = pesosToCentavos(copy.price ?? 0);
    copy.stock_on_hand = Number(copy.stock_count || 0);
    copy.reserved_quantity = 0;
    delete copy.price;
    delete copy.stock_count;
  }
  if (table === 'order_items') {
    copy.unit_price_centavos = pesosToCentavos(copy.price ?? 0);
    delete copy.price;
  }
  if (table === 'payments') {
    copy.amount_centavos = pesosToCentavos(copy.amount ?? 0);
    delete copy.amount;
    const legacyStatus = String(copy.payment_status || '').toLowerCase();
    copy.payment_status = legacyStatus === 'failed' ? 'failed' : 'reconciliation_required';
    copy.currency = 'PHP';
    copy.provider = 'legacy-local';
    copy.provider_payment_id = null;
    copy.payment_plan = null;
    copy.policy_version = 'legacy-import';
    copy.idempotency_key = null;
    copy.updated_at = copy.created_at || new Date();
  }
  if (table === 'subscriptions') {
    copy.plan_version = 'legacy-import';
  }
  if (table === 'medicines') {
    const legacyRestricted = Number(copy.rx_required ?? 0) === 1;
    delete copy.rx_required;
    copy.publication_status = legacyRestricted ? 'retired' : 'draft';
    copy.published_at = null;
  }
  for (const [key, value] of Object.entries(copy)) {
    if (value === undefined) copy[key] = null;
  }
  return copy;
}

async function ensureEmpty(client) {
  const result = await client.query(`
    SELECT SUM(row_count)::bigint AS total
    FROM (
      SELECT COUNT(*) AS row_count FROM users
      UNION ALL SELECT COUNT(*) FROM drugstores
      UNION ALL SELECT COUNT(*) FROM medicines
      UNION ALL SELECT COUNT(*) FROM inventory
      UNION ALL SELECT COUNT(*) FROM orders
      UNION ALL SELECT COUNT(*) FROM order_drugstores
      UNION ALL SELECT COUNT(*) FROM order_items
      UNION ALL SELECT COUNT(*) FROM audit_logs
      UNION ALL SELECT COUNT(*) FROM payments
      UNION ALL SELECT COUNT(*) FROM subscriptions
    ) counts
  `);
  if (Number(result.rows[0]?.total || 0) !== 0) {
    throw new Error('PostgreSQL target is not empty; refusing legacy import. Use a fresh target database.');
  }
}

async function insertRows(client, table, rows) {
  for (const raw of rows) {
    const row = normalizedRow(table, raw);
    const columns = Object.keys(row);
    const values = Object.values(row);
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
    await client.query(
      `INSERT INTO ${table} (${columns.map((column) => `"${column}"`).join(', ')}) VALUES (${placeholders})`,
      values,
    );
  }
}

async function resetIdentity(client, table) {
  await client.query(`
    SELECT setval(
      pg_get_serial_sequence($1, 'id'),
      GREATEST(COALESCE((SELECT MAX(id) FROM ${table}), 1), 1),
      EXISTS (SELECT 1 FROM ${table})
    )
  `, [table]);
}

let pgClient;
let inTransaction = false;
let primaryError = null;
try {
  pgClient = await postgresPool.connect();
  // The operator's DB_USER text is not proof of the actual connected role.
  // Reuse the canonical read-only migrator identity/privilege inspection.
  await assertSafeMigrationSession(pgClient, process.env);
  await pgClient.query('BEGIN');
  inTransaction = true;
  await ensureEmpty(pgClient);
  for (const table of tables) {
    const [rows] = await mysqlPool.query(`SELECT * FROM ${table} ORDER BY id ASC`);
    await insertRows(pgClient, table, rows);
    await resetIdentity(pgClient, table);
    console.log(`imported ${table}: ${rows.length}`);
  }
  await pgClient.query('COMMIT');
  inTransaction = false;
} catch (error) {
  primaryError = error;
  if (pgClient && inTransaction) {
    try { await pgClient.query('ROLLBACK'); } catch { /* preserve original failure */ }
  }
  throw error;
} finally {
  pgClient?.release();
  // Also close the MySQL pool if connecting to PostgreSQL failed, so the
  // one-shot test utility cannot leave a process holding idle connections.
  const teardown = await Promise.allSettled([postgresPool.end(), mysqlPool.end()]);
  // Do not hide teardown failures after an otherwise successful import, while
  // preserving the original transaction/connection error on failed imports.
  if (!primaryError) {
    const failedClose = teardown.find((outcome) => outcome.status === 'rejected');
    if (failedClose) throw failedClose.reason;
  }
}
