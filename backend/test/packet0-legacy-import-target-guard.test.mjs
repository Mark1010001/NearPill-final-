import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertApprovedLegacyImportTarget } from '../scripts/lib/verify-legacy-import-target.mjs';

const synthetic = Object.freeze({
  NODE_ENV: 'test',
  NEARPILL_LEGACY_IMPORT_TARGET: 'local-test',
  NEARPILL_LEGACY_IMPORT_SYNTHETIC_SOURCE: 'true',
  NEARPILL_LEGACY_IMPORT_CONFIRMATION: 'I_APPROVE_SYNTHETIC_LEGACY_IMPORT',
  LEGACY_DB_HOST: '127.0.0.1', LEGACY_DB_PORT: '3306',
  LEGACY_DB_NAME: 'legacy_test_fixture', LEGACY_DB_USER: 'nearpill_legacy_reader',
  LEGACY_DB_PASSWORD: 'synthetic-password',
  NEARPILL_LEGACY_IMPORT_EXPECTED_SOURCE_HOST: '127.0.0.1',
  NEARPILL_LEGACY_IMPORT_EXPECTED_SOURCE_DATABASE: 'legacy_test_fixture',
  DB_HOST: '127.0.0.1', DB_PORT: '5432', DB_NAME: 'nearpill_test_fixture',
  DB_USER: 'nearpill_migrator', DB_PASSWORD: 'synthetic-password', DB_SSL: 'false',
  MIGRATOR_DB_USER: 'nearpill_migrator',
  NEARPILL_LEGACY_IMPORT_EXPECTED_TARGET_HOST: '127.0.0.1',
  NEARPILL_LEGACY_IMPORT_EXPECTED_TARGET_DATABASE: 'nearpill_test_fixture',
});

const check = (changes = {}) => assertApprovedLegacyImportTarget({ ...synthetic, ...changes });

test('synthetic local import remains possible only with explicitly confirmed endpoints', () => {
  assert.deepEqual(check(), { mysqlPort: 3306, postgresPort: 5432 });
  assert.equal(check({ LEGACY_DB_PORT: '13306', DB_PORT: '15432' }).postgresPort, 15432);
});

test('implicit imports, production, staging and absence of explicit consent fail closed', () => {
  for (const changes of [
    { NEARPILL_LEGACY_IMPORT_TARGET: undefined },
    { NEARPILL_LEGACY_IMPORT_TARGET: 'staging' },
    { NEARPILL_LEGACY_IMPORT_TARGET: 'production' },
    { NODE_ENV: 'production' }, { NODE_ENV: 'staging' },
    { NEARPILL_LEGACY_IMPORT_SYNTHETIC_SOURCE: 'false' },
    { NEARPILL_LEGACY_IMPORT_CONFIRMATION: undefined },
  ]) assert.throws(() => check(changes), /Legacy import refused/);
});

test('both independently confirmed database identities must name local test databases', () => {
  for (const changes of [
    { LEGACY_DB_HOST: 'db.example.supabase.co', NEARPILL_LEGACY_IMPORT_EXPECTED_SOURCE_HOST: 'db.example.supabase.co' },
    { DB_HOST: 'db.example.supabase.co', NEARPILL_LEGACY_IMPORT_EXPECTED_TARGET_HOST: 'db.example.supabase.co' },
    { LEGACY_DB_NAME: 'customer_data', NEARPILL_LEGACY_IMPORT_EXPECTED_SOURCE_DATABASE: 'customer_data' },
    { DB_NAME: 'postgres', NEARPILL_LEGACY_IMPORT_EXPECTED_TARGET_DATABASE: 'postgres' },
    { LEGACY_DB_NAME: 'different_test' },
    { DB_NAME: 'nearpill_test_other' },
    { NEARPILL_LEGACY_IMPORT_EXPECTED_TARGET_HOST: 'localhost' },
  ]) assert.throws(() => check(changes), /Legacy import refused/);
});

test('rejects implied ports, invalid ports and privileged or ambiguous credentials', () => {
  for (const changes of [
    { DB_PORT: undefined }, { LEGACY_DB_PORT: undefined },
    { DB_PORT: '6543foo' }, { LEGACY_DB_PORT: '0' }, { DB_PORT: '65536' },
    { DB_USER: 'postgres', MIGRATOR_DB_USER: 'postgres' },
    { DB_USER: 'nearpill_app', MIGRATOR_DB_USER: 'nearpill_app' },
    { DB_USER: 'service_role', MIGRATOR_DB_USER: 'service_role' },
    { LEGACY_DB_USER: 'root' },
    { DB_USER: 'postgres.any-project', MIGRATOR_DB_USER: 'postgres.any-project' }, { MIGRATOR_DB_USER: 'other_role' },
    { LEGACY_DB_PASSWORD: '' }, { DB_PASSWORD: '' }, { DB_SSL: 'true' },
  ]) assert.throws(() => check(changes), /Legacy import refused/);
});

test('legacy synthetic import refuses reserved pg_ migrators including case variants', () => {
  for (const role of ['pg_read_all_data', 'PG_MONITOR', 'PG_create_subscription']) {
    assert.throws(
      () => check({ DB_USER: role, MIGRATOR_DB_USER: role }),
      /Legacy import refused/,
      `${role} may never import into PostgreSQL as a migrator`,
    );
  }
});

test('legacy import checks target before any pool and verifies actual PostgreSQL migrator before transaction', async () => {
  const source = await readFile(new URL('../scripts/import-mysql-to-postgres.mjs', import.meta.url), 'utf8');
  assert.ok(source.indexOf('assertApprovedLegacyImportTarget(process.env)') < source.indexOf('mysql.createPool('));
  assert.ok(source.indexOf('assertApprovedLegacyImportTarget(process.env)') < source.indexOf('new Pool('));
  assert.ok(source.indexOf('await assertSafeMigrationSession(pgClient, process.env)') < source.indexOf("await pgClient.query('BEGIN')"));
  assert.match(source, /await ensureEmpty\(pgClient\)/);
  assert.match(source, /await pgClient.query\('ROLLBACK'\)/);
  assert.match(source, /Promise\.allSettled\(\[postgresPool\.end\(\), mysqlPool\.end\(\)\]\)/);
  assert.doesNotMatch(source, /LEGACY_DB_USER \|\| 'root'|DB_HOST \|\| '127\.0\.0\.1'/);
});
