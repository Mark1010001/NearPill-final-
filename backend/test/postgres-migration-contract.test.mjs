import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createPostgresCompatPool } from '../src/infrastructure/postgres/compat-pool.js';
import { runWithDatabaseActor } from '../src/infrastructure/postgres/context.js';
import { assertIdentityRepository } from '../src/ports/identity-repository.js';
import { assertCatalogRepository } from '../src/ports/catalog-repository.js';
import { assertInventoryRepository } from '../src/ports/inventory-repository.js';
import { assertOrderRepository } from '../src/ports/order-repository.js';
import { assertPaymentSubscriptionRepository } from '../src/ports/payment-subscription-repository.js';
import { assertReportRepository } from '../src/ports/report-repository.js';
import { createPostgresIdentityRepository } from '../src/infrastructure/postgres/identity-repository.js';
import { createPostgresCatalogRepository } from '../src/infrastructure/postgres/catalog-repository.js';
import { createPostgresInventoryRepository } from '../src/infrastructure/postgres/inventory-repository.js';
import { createPostgresOrderRepository } from '../src/infrastructure/postgres/order-repository.js';
import { createPostgresPaymentSubscriptionRepository } from '../src/infrastructure/postgres/payment-subscription-repository.js';
import { createPostgresReportRepository } from '../src/infrastructure/postgres/report-repository.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => readFile(path.join(root, relative), 'utf8');

function fakePool(handler = async () => ({ rows: [], rowCount: 0 })) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (String(sql) === 'BEGIN' || String(sql) === 'COMMIT' || String(sql) === 'ROLLBACK') {
        return { rows: [], rowCount: 0 };
      }
      if (String(sql).startsWith('SELECT\n       set_config')) return { rows: [{}], rowCount: 1 };
      return handler(String(sql), params, calls);
    },
    release() {},
  };
  return {
    calls,
    async connect() { return client; },
    async query(sql, params) { return client.query(sql, params); },
  };
}

test('active runtime is PostgreSQL/pgvector and does not compose a MySQL service', async () => {
  const compose = await read('compose.yaml');
  assert.match(compose, /pgvector\/pgvector:0\.8\.6-pg18-trixie/);
  assert.match(compose, /db-migrate:/);
  assert.doesNotMatch(compose, /^\s{2}mysql:/m);
  assert.match(compose, /condition:\s*service_completed_successfully/);
  assert.match(compose, /\/docker-entrypoint-initdb\.d:ro/);
});

test('backend runtime composes only PostgreSQL repositories', async () => {
  const server = await read('backend/src/bootstrap/server.ts');
  assert.match(server, /createPostgresDatabase/);
  assert.match(server, /createPostgresIdentityRepository/);
  assert.match(server, /createPostgresCatalogRepository/);
  assert.match(server, /createPostgresInventoryRepository/);
  assert.match(server, /createPostgresOrderRepository/);
  assert.match(server, /createPostgresPaymentSubscriptionRepository/);
  assert.match(server, /createPostgresReportRepository/);
  assert.doesNotMatch(server, /mysql2|createMysql|infrastructure\/mysql/);
  assert.match(server, /runWithDatabaseActor\(\{ role: 'system' \}/);
  const transport = await read('backend/src/http/transport.ts');
  assert.match(transport, /setCurrentDatabaseActor\(\{ userId, role: session\.user\.role \}\)/);
});

test('PostgreSQL core migration preserves legacy API shape with stronger constraints', async () => {
  const migration = await read('backend/migrations/postgres/0001_core.sql');
  for (const table of [
    'users','drugstores','pharmacy_memberships','medicines','inventory','orders',
    'order_drugstores','order_items','audit_logs','payments','subscriptions',
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
  assert.match(migration, /CHECK \(stock_count >= 0\)/);
  assert.match(migration, /inventory_store_medicine_unique UNIQUE/);
  assert.match(migration, /CHECK \(quantity > 0\)/);
  assert.match(migration, /CHECK \(price >= 0\)/);
  assert.match(migration, /CHECK \(total >= 0\)/);
  assert.match(migration, /CHECK \(amount >= 0\)/);
  assert.doesNotMatch(migration, /\buserId\b/);
});

test('application role is non-owner style and RLS is enabled and forced on protected tables', async () => {
  const bootstrap = await read('backend/postgres/bootstrap/001-roles.sh');
  const rls = await read('backend/migrations/postgres/0002_rls.sql');
  assert.match(bootstrap, /NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS/);
  assert.match(bootstrap, /CREATE EXTENSION IF NOT EXISTS vector/);
  for (const table of [
    'drugstores','pharmacy_memberships','medicines','inventory','orders',
    'order_drugstores','order_items','payments','subscriptions','audit_logs',
  ]) {
    assert.match(rls, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(rls, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
  }
  assert.match(rls, /nearpill\.current_actor_id\(\)/);
  assert.match(rls, /user_id = nearpill\.current_actor_id\(\)/);
  assert.match(rls, /pharmacy_memberships/);
  assert.match(rls, /WITH CHECK/);
});

test('request actor context is transaction-local and parameterized', async () => {
  const pool = fakePool(async (sql) => {
    if (/SELECT m\.generic_name/.test(sql)) return { rows: [{ genericname: 'Paracetamol' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const compat = createPostgresCompatPool(pool);
  const result = await runWithDatabaseActor({ userId: 42, role: 'admin' }, () =>
    compat.query('SELECT m.generic_name AS genericName FROM medicines m WHERE m.id = ?', [7]));
  assert.deepEqual(result[0], [{ genericName: 'Paracetamol' }]);
  const contextCall = pool.calls.find((call) => call.sql.includes("set_config('app.user_id'"));
  assert.deepEqual(contextCall.params, ['42', 'admin', '']);
  const dataCall = pool.calls.find((call) => call.sql.includes('m.generic_name'));
  assert.match(dataCall.sql, /m\.id = \$1/);
  assert.deepEqual(dataCall.params, [7]);
});

test('PostgreSQL compatibility executor preserves insertId semantics without SQL concatenation', async () => {
  const pool = fakePool(async (sql, params) => {
    assert.match(sql, /VALUES \(\$1, \$2\) RETURNING id$/);
    assert.deepEqual(params, ['A', 'B']);
    return { rows: [{ id: 91 }], rowCount: 1 };
  });
  const compat = createPostgresCompatPool(pool);
  const [result] = await compat.query('INSERT INTO example (a, b) VALUES (?, ?)', ['A', 'B']);
  assert.equal(result.insertId, 91);
  assert.equal(result.affectedRows, 1);
});

test('all Postgres adapters implement the existing repository ports', () => {
  const pool = fakePool();
  assertIdentityRepository(createPostgresIdentityRepository(pool));
  assertCatalogRepository(createPostgresCatalogRepository(pool));
  assertInventoryRepository(createPostgresInventoryRepository(pool));
  assertOrderRepository(createPostgresOrderRepository(pool));
  assertPaymentSubscriptionRepository(createPostgresPaymentSubscriptionRepository(pool));
  assertReportRepository(createPostgresReportRepository(pool));
});

test('Postgres adapters do not import or delegate to MySQL adapters', async () => {
  const names = [
    'identity-repository.js','catalog-repository.js','inventory-repository.js',
    'order-repository.js','payment-subscription-repository.js','report-repository.js',
  ];
  for (const name of names) {
    const source = await read(`backend/src/infrastructure/postgres/${name}`);
    assert.doesNotMatch(source, /infrastructure\/mysql|createMysql|mysql2/);
    assert.match(source, /createPostgresCompatPool/);
  }
});

test('migration runner is checksum-protected and import refuses a non-empty target', async () => {
  const migrate = await read('backend/scripts/migrate-postgres.mjs');
  const importer = await read('backend/scripts/import-mysql-to-postgres.mjs');
  const executor = await read('backend/scripts/lib/execute-reviewed-migration.mjs');
  assert.match(migrate, /createHash\('sha256'\)/);
  assert.match(migrate, /executeReviewedMigration/);
  assert.match(executor, /migration journal drift/);
  assert.match(executor, /BEGIN/);
  assert.match(executor, /ROLLBACK/);
  assert.match(executor, /pg_advisory_xact_lock/);
  assert.match(importer, /target is not empty; refusing legacy import/i);
  assert.match(importer, /delete copy\.userId/);
  assert.match(importer, /delete copy\.rx_required/);
  assert.match(importer, /legacyRestricted \? 'retired' : 'draft'/);
  assert.match(importer, /resetIdentity/);
});

test('data reconciliation includes integrity, RLS, role, and pgvector gates', async () => {
  const source = await read('backend/scripts/reconcile-postgres.mjs');
  assert.match(source, /invalid inventory invariant/);
  assert.match(source, /duplicate inventory/);
  assert.match(source, /negative centavos/);
  assert.match(source, /relrowsecurity/);
  assert.match(source, /relforcerowsecurity/);
  assert.match(source, /rolbypassrls/);
  assert.match(source, /pg_extension/);
});

test('Drizzle schema and config are version-controlled alongside reviewed SQL migrations', async () => {
  const schema = await read('backend/src/infrastructure/postgres/schema.ts');
  const config = await read('backend/drizzle.config.ts');
  assert.match(schema, /pgTable\('pharmacy_memberships'/);
  assert.match(schema, /pgTable\('orders'/);
  assert.match(schema, /pgTable\('payments'/);
  assert.match(config, /dialect: 'postgresql'/);
  assert.match(config, /schema: '\.\/src\/infrastructure\/postgres\/schema\.ts'/);
});


test('OTC catalog/discovery migration adds publication evidence, verification, search, geo indexes and public RLS', async () => {
  const migration = await read('backend/migrations/postgres/0005_catalog_discovery.sql');
  assert.match(migration, /CREATE EXTENSION IF NOT EXISTS pg_trgm/);
  assert.match(migration, /CREATE EXTENSION IF NOT EXISTS earthdistance/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS medicine_evidence/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS pharmacy_verifications/);
  assert.match(migration, /ALTER TABLE medicines DROP COLUMN IF EXISTS rx_required/);
  assert.match(migration, /USING GIN \(search_document\)/);
  assert.match(migration, /gin_trgm_ops/);
  assert.match(migration, /USING GIST/);
  assert.match(migration, /verification_status = 'verified'/);
  assert.match(migration, /publication_status = 'published'/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
});

test('backend dependency manifest selects current Postgres/Drizzle runtime packages', async () => {
  const manifest = JSON.parse(await read('backend/package.json'));
  assert.equal(manifest.dependencies.pg, '8.23.1');
  assert.equal(manifest.dependencies['drizzle-orm'], '0.45.4');
  assert.equal(manifest.devDependencies['drizzle-kit'], '0.31.11');
  assert.equal(manifest.devDependencies.mysql2, '^3.6.0');
  assert.ok(!manifest.dependencies.mysql2);
});


test('order/inventory migration introduces centavos, reservations, stock movements, idempotency and invariant constraints', async () => {
  const migration = await read('backend/migrations/postgres/0006_order_inventory.sql');
  assert.match(migration, /price_centavos BIGINT/);
  assert.match(migration, /stock_on_hand INTEGER/);
  assert.match(migration, /reserved_quantity INTEGER/);
  assert.match(migration, /reserved_quantity <= stock_on_hand/);
  assert.match(migration, /total_centavos BIGINT/);
  assert.match(migration, /idempotency_key VARCHAR\(128\)/);
  assert.match(migration, /orders_user_idempotency_unique/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS reservations/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS stock_movements/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
});


test('payment migration adds provider evidence, event idempotency, refunds, reconciliation and entitlements', async () => {
  const migration = await read('backend/migrations/postgres/0007_payment_reconciliation.sql');
  assert.match(migration, /provider_payment_id/);
  assert.match(migration, /payment_events_provider_event_unique UNIQUE\(provider, event_id\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS refunds/);
  assert.match(migration, /refunds_provider_idempotency_unique/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS payment_reconciliation/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS subscription_entitlements/);
  assert.match(migration, /payment_status IN \('paid','refunded'\)/);
  assert.match(migration, /reconciliation_required/);
  assert.match(migration, /payments_payment_mutation_select/);
  assert.match(migration, /orders_payment_mutation_update/);
  assert.match(migration, /inventory_payment_mutation_update/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
});
