import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertApprovedMigrationTarget, assertSafeMigrationSession } from '../scripts/lib/verify-migration-target.mjs';

const local = Object.freeze({
  NEARPILL_MIGRATION_TARGET: 'local', NODE_ENV: 'development',
  NEARPILL_MIGRATION_CONFIRMATION: 'I_APPROVE_REVIEWED_SQL_MIGRATIONS',
  DB_HOST: '127.0.0.1', NEARPILL_MIGRATION_EXPECTED_HOST: '127.0.0.1',
  DB_PORT: '5432', DB_NAME: 'nearpill', NEARPILL_MIGRATION_EXPECTED_DATABASE: 'nearpill',
  DB_USER: 'nearpill_migrator', MIGRATOR_DB_USER: 'nearpill_migrator',
  DB_PASSWORD: 'synthetic-test-only', DB_SSL: 'false',
});
const staging = Object.freeze({ ...local,
  NODE_ENV: 'staging', NEARPILL_MIGRATION_TARGET: 'staging',
  DB_HOST: 'db.example-project.supabase.co',
  NEARPILL_MIGRATION_EXPECTED_HOST: 'db.example-project.supabase.co',
  DB_NAME: 'postgres', NEARPILL_MIGRATION_EXPECTED_DATABASE: 'postgres',
  DB_SSL: 'true', NEARPILL_MIGRATION_PROJECT_REF: 'example-project',
  NEARPILL_MIGRATION_OWNER_APPROVED: 'true',
});

test('staging session pooler requires the exact project login and verified client TLS', async () => {
  const host = 'aws-0-ap-southeast-1.pooler.supabase.com';
  const user = 'nearpill_migrator.afqqozfjpiodanpogvfb';
  const env = { ...staging, DB_HOST: host, NEARPILL_MIGRATION_EXPECTED_HOST: host,
    NEARPILL_MIGRATION_PROJECT_REF: 'afqqozfjpiodanpogvfb', DB_USER: user, MIGRATOR_DB_USER: user };
  assert.equal(assertApprovedMigrationTarget(env).host, host);
  assert.throws(() => assertApprovedMigrationTarget({ ...env, DB_PORT: '6543' }), /Migration refused/);
  assert.throws(() => assertApprovedMigrationTarget({ ...env, NEARPILL_MIGRATION_PROJECT_REF: 'other-project' }), /Migration refused/);
  const row = { role_name: 'nearpill_migrator', session_role_name: 'nearpill_migrator', database_name: 'postgres',
    is_superuser: false, bypass_rls: false, can_create_roles: false, can_create_databases: false, can_replicate: false,
    elevated_role_membership: false, can_assume_database_owner: false, tls_active: false };
  const stream = { encrypted: true, authorized: true, servername: host };
  const client = { query: async () => ({ rows: [row] }), connection: { stream } };
  await assertSafeMigrationSession(client, env);
  stream.authorized = false;
  await assert.rejects(assertSafeMigrationSession(client, env), /Migration refused/);
});

test('explicit local developer migration remains supported without a second database', () => {
  assert.equal(assertApprovedMigrationTarget(local).target, 'local');
  assert.equal(assertApprovedMigrationTarget({ ...local, NODE_ENV: 'test', DB_PORT: '15432' }).port, 15432);
});

test('staging requires direct TLS Supabase endpoint bound to declared project', () => {
  assert.equal(assertApprovedMigrationTarget(staging).target, 'staging');
  for (const changes of [
    { DB_HOST: 'db.other-project.supabase.co', NEARPILL_MIGRATION_EXPECTED_HOST: 'db.other-project.supabase.co' },
    { DB_HOST: 'aws-0-region.pooler.supabase.com', NEARPILL_MIGRATION_EXPECTED_HOST: 'aws-0-region.pooler.supabase.com' },
    { DB_PORT: '6543' }, { DB_SSL: 'false' },
    { NEARPILL_MIGRATION_PROJECT_REF: 'other-project' },
    { NEARPILL_MIGRATION_OWNER_APPROVED: 'false' },
    { NODE_ENV: 'production' },
  ]) assert.throws(() => assertApprovedMigrationTarget({ ...staging, ...changes }), /Migration refused/);
});

test('staging direct migration login must use an unqualified PostgreSQL role', () => {
  // A shared Supabase pooler expects <role>.<project-ref>, but the reviewed
  // migrator MUST use the direct db.<ref>.supabase.co:5432 endpoint. A
  // qualified login must fail before the runner can construct a DB pool.
  assert.equal(assertApprovedMigrationTarget(staging).migrator, 'nearpill_migrator');
  for (const username of [
    'nearpill_migrator.example-project',
    'nearpill_migrator.other-project',
    'nearpill_migrator.extra.example-project',
  ]) {
    assert.throws(
      () => assertApprovedMigrationTarget({
        ...staging, DB_USER: username, MIGRATOR_DB_USER: username,
      }),
      /Migration refused: staging direct login/i,
      `direct migrator must reject ${username}`,
    );
  }
  // Disposable local PostgreSQL configurations retain their existing rules.
  assert.equal(assertApprovedMigrationTarget(local).target, 'local');
});

test('refuses implicit production, empty consent and a mismatched database target', () => {
  for (const changes of [
    { NEARPILL_MIGRATION_TARGET: undefined }, { NEARPILL_MIGRATION_TARGET: 'production' },
    { NEARPILL_MIGRATION_CONFIRMATION: undefined },
    { DB_HOST: undefined }, { DB_NAME: undefined },
    { NEARPILL_MIGRATION_EXPECTED_DATABASE: 'not-nearpill' },
    { DB_PORT: undefined }, { DB_PORT: '0' }, { DB_PORT: '6543foo' }, { DB_PORT: '65536' },
  ]) assert.throws(() => assertApprovedMigrationTarget({ ...local, ...changes }), /Migration refused/);
});

test('ordinary application and elevated role credentials cannot run reviewed migrations', () => {
  for (const role of ['nearpill_app', 'postgres', 'supabase_admin', 'service_role', 'nearpill_owner']) {
    assert.throws(() => assertApprovedMigrationTarget({ ...local, DB_USER: role, MIGRATOR_DB_USER: role }), /Migration refused/);
  }
  assert.throws(() => assertApprovedMigrationTarget({ ...local, MIGRATOR_DB_USER: 'unrelated_migrator' }), /Migration refused/);
  assert.throws(() => assertApprovedMigrationTarget({ ...local, DB_PASSWORD: '' }), /Migration refused/);
});

test('predefined PostgreSQL roles cannot act as the direct migrator login', () => {
  for (const name of ['pg_read_all_data', 'pg_write_all_data', 'pg_monitor', 'pg_signal_backend']) {
    assert.throws(
      () => assertApprovedMigrationTarget({ ...local, DB_USER: name, MIGRATOR_DB_USER: name }),
      /Migration refused/,
      `predefined PostgreSQL login ${name} must fail before any connection`,
    );
  }
});

test('migration operator preflight rejects case-varied privileged and predefined login names', () => {
  // PostgreSQL quoted roles can preserve mixed case. Local and staging role
  // configuration must fail before opening a pool, not only at the live probe.
  for (const role of [
    'Postgres', 'SUPABASE_ADMIN', 'Service_Role', 'NearPill_App',
    'NearPill_Owner', 'PG_read_all_data', 'PG_MONITOR',
  ]) {
    for (const target of [local, staging]) {
      assert.throws(
        () => assertApprovedMigrationTarget({ ...target, DB_USER: role, MIGRATOR_DB_USER: role }),
        /Migration refused/,
        `${target.NEARPILL_MIGRATION_TARGET}: ${role} must not be a migrator login`,
      );
    }
  }
});

test('migration preflight rejects ambiguous app/migrator identity text before any connection', () => {
  // These are distinct from valid PostgreSQL role identifiers and must not
  // be silently treated as an explicitly reviewed direct migrator login.
  for (const role of [
    'nearpill migrator', 'nearpill\tmigrator', 'nearpill\nmigrator',
    'nearpill\u0000migrator', 'nearpill\u200bmigrator',
  ]) {
    for (const target of [local, staging]) {
      assert.throws(
        () => assertApprovedMigrationTarget({ ...target, DB_USER: role, MIGRATOR_DB_USER: role }),
        /Migration refused/,
        `${target.NEARPILL_MIGRATION_TARGET}: malformed migrator identity must be rejected`,
      );
    }
  }
  // Preserve the normal direct migrator workflow in both environments.
  assert.equal(assertApprovedMigrationTarget(local).migrator, 'nearpill_migrator');
  assert.equal(assertApprovedMigrationTarget(staging).migrator, 'nearpill_migrator');
});

test('migration preflight rejects padded raw connection values before opening a pool', () => {
  // The pg driver receives raw environment values, not the trimmed copies
  // used by the old operator gate. Never approve one value and connect with
  // another, even when the expected host/database are separately confirmed.
  for (const target of [local, staging]) {
    for (const field of ['DB_HOST', 'DB_NAME', 'DB_PORT']) {
      assert.throws(
        () => assertApprovedMigrationTarget({ ...target, [field]: ` ${target[field]}` }),
        /Migration refused/,
        `${target.NEARPILL_MIGRATION_TARGET}: padded ${field} must fail before connection`,
      );
    }
    assert.throws(
      () => assertApprovedMigrationTarget({ ...target,
        DB_USER: ` ${target.DB_USER}`, MIGRATOR_DB_USER: ` ${target.MIGRATOR_DB_USER}` }),
      /Migration refused/,
      'a consistently padded login must not bypass the raw-value boundary',
    );
  }
  assert.equal(assertApprovedMigrationTarget(local).target, 'local');
  assert.equal(assertApprovedMigrationTarget(staging).target, 'staging');
});

test('live migrator role probe checks direct self-role privilege and future pg_ roles', async () => {
  const session = recordingSession();
  await assertSafeMigrationSession(session, local);
  const sql = session.calls[0];
  assert.doesNotMatch(sql, /privileged\.oid\s*<>\s*r\.oid/,
    'a privileged login must not be removed from its own membership probe');
  assert.match(sql, /left\(privileged\.rolname,\s*3\)\s*=\s*'pg_'/,
    'the check should cover future PostgreSQL predefined pg_ roles');
});

test('local migrations cannot target remote hosts even when host confirmation is forged', () => {
  for (const changes of [
    { DB_HOST: 'db.example-project.supabase.co', NEARPILL_MIGRATION_EXPECTED_HOST: 'db.example-project.supabase.co' },
    { NODE_ENV: 'production' }, { DB_SSL: 'true' },
  ]) assert.throws(() => assertApprovedMigrationTarget({ ...local, ...changes }), /Migration refused/);
});

test('the canonical migration runner validates before creating pg.Pool and keeps checksum/transaction invariants', async () => {
  const source = await readFile(new URL('../scripts/migrate-postgres.mjs', import.meta.url), 'utf8');
  assert.ok(source.indexOf('assertApprovedMigrationTarget(process.env)') < source.indexOf('new Pool('));
  assert.ok(source.indexOf('await assertSafeMigrationSession(client, process.env)') < source.indexOf('executeReviewedMigration(client, { filename, sql, sha256, reviewedMigrations })'));
  assert.match(source, /createHash\('sha256'\)/);
  const executor = await readFile(new URL('../scripts/lib/execute-reviewed-migration.mjs', import.meta.url), 'utf8');
  assert.match(executor, /ROLLBACK/);
  assert.match(executor, /COMMIT/);
  assert.match(executor, /pg_advisory_xact_lock/);
  assert.doesNotMatch(source, /DB_HOST \|\| '127\.0\.0\.1'/);
  assert.doesNotMatch(source, /DB_USER \|\| 'nearpill_migrator'/);
});

const trusted = Object.freeze({
  role_name: 'nearpill_migrator', session_role_name: 'nearpill_migrator',
  database_name: 'nearpill', is_superuser: false, bypass_rls: false,
  can_create_roles: false, can_create_databases: false, can_replicate: false,
  elevated_role_membership: false, can_assume_database_owner: false, tls_active: false,
});
function recordingSession(record = trusted) {
  const calls = [];
  return { calls, async query(sql) { calls.push(sql); return { rows: [record] }; } };
}

test('read-only live connection probe verifies actual migrator and database identity', async () => {
  const client = recordingSession();
  await assertSafeMigrationSession(client, local);
  assert.equal(client.calls.length, 1);
  assert.match(client.calls[0], /current_user AS role_name/);
  assert.match(client.calls[0], /session_user AS session_role_name/);
  assert.match(client.calls[0], /pg_has_role\(r\.oid, privileged\.oid, 'MEMBER'\)/);
  assert.match(client.calls[0], /AS can_assume_database_owner/);
  assert.match(client.calls[0], /pg_database/);
  assert.match(client.calls[0], /pg_stat_ssl/);
  assert.equal(client.calls[0].trim().startsWith('SELECT'), true);
});

test('migration session role inventory refuses inherited or SET-able predefined PostgreSQL privileges', async () => {
  // A non-superuser/non-BYPASSRLS login may still inherit pg_read_all_data,
  // pg_write_all_data, replication subscription, reserved-connection,
  // autovacuum-signaling or server-file/program authority. This is a SQL-shape
  // contract for the actual read-only role probe; live pg_roles evidence is
  // mandatory before any staging migration, and this mock is not that proof.
  const client = recordingSession();
  await assertSafeMigrationSession(client, local);
  const sql = client.calls[0];
  for (const role of [
    'pg_read_all_data', 'pg_write_all_data', 'pg_maintain',
    'pg_read_server_files', 'pg_write_server_files', 'pg_execute_server_program',
    'pg_monitor', 'pg_read_all_settings', 'pg_read_all_stats',
    'pg_stat_scan_tables', 'pg_signal_backend', 'pg_checkpoint',
    'pg_create_subscription', 'pg_use_reserved_connections',
    'pg_signal_autovacuum_worker',
  ]) {
    assert.ok(sql.includes(`'${role}'`), `missing predefined elevated-role denial: ${role}`);
  }
  assert.match(sql, /pg_has_role\(r\.oid, privileged\.oid, 'MEMBER'\)/);
  await assert.rejects(
    assertSafeMigrationSession(recordingSession({ ...trusted, elevated_role_membership: true }), local),
    /Migration refused/,
  );
});

test('live migration connection rejects privilege escalation, different login, missing TLS and malformed role results', async () => {
  for (const override of [
    { is_superuser: true }, { bypass_rls: true }, { elevated_role_membership: true },
    { can_assume_database_owner: true }, { can_assume_database_owner: null },
    { can_create_roles: true }, { can_create_databases: true }, { can_replicate: true },
    { session_role_name: 'postgres' }, { role_name: 'nearpill_app' },
    { database_name: 'other_database' }, { bypass_rls: null },
  ]) await assert.rejects(assertSafeMigrationSession(recordingSession({ ...trusted, ...override }), local), /Migration refused/);
  const stagingSession = { ...trusted, database_name: 'postgres', tls_active: true };
  await assertSafeMigrationSession(recordingSession(stagingSession), staging);
  await assert.rejects(assertSafeMigrationSession(recordingSession({ ...stagingSession, tls_active: false }), staging), /Migration refused/);
  await assert.rejects(assertSafeMigrationSession({ query: async () => ({ rows: [] }) }, local), /Migration refused/);
});
