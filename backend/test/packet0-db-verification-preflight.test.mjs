import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertApprovedFixtureTarget, assertIsolatedOrderVerifierTarget } from '../scripts/lib/verify-fixture-target.mjs';

const local = Object.freeze({
  NODE_ENV: 'test',
  NEARPILL_VERIFICATION_TARGET: 'local-test',
  NEARPILL_VERIFICATION_CONFIRMATION: 'I_APPROVE_TEST_FIXTURE_WRITES',
  DB_HOST: '127.0.0.1',
  DB_PORT: '5432',
  DB_NAME: 'nearpill_test',
  NEARPILL_VERIFICATION_EXPECTED_HOST: '127.0.0.1',
  NEARPILL_VERIFICATION_EXPECTED_DATABASE: 'nearpill_test',
  DB_USER: 'nearpill_app',
  MIGRATOR_DB_USER: 'nearpill_migrator',
});
const staging = Object.freeze({
  ...local,
  NODE_ENV: 'staging',
  NEARPILL_VERIFICATION_TARGET: 'staging',
  DB_HOST: 'db.example-project.supabase.co',
  DB_NAME: 'postgres',
  NEARPILL_VERIFICATION_EXPECTED_HOST: 'db.example-project.supabase.co',
  NEARPILL_VERIFICATION_EXPECTED_DATABASE: 'postgres',
  DB_SSL: 'true',
  DB_PASSWORD: 'not-a-real-secret',
  MIGRATOR_DB_HOST: 'db.example-project.supabase.co',
  MIGRATOR_DB_PORT: '5432',
  NEARPILL_VERIFICATION_EXPECTED_MIGRATOR_HOST: 'db.example-project.supabase.co',
  MIGRATOR_DB_PASSWORD: 'not-a-real-secret',
  NEARPILL_VERIFICATION_PROJECT_REF: 'example-project',
  NEARPILL_VERIFICATION_OWNER_APPROVED: 'true',
});

test('deliberately confirmed disposable local test database is accepted', () => {
  assert.equal(assertApprovedFixtureTarget(local), 'local-test');
});

test('deliberately confirmed staging target passes the operator preflight only', () => {
  assert.equal(assertApprovedFixtureTarget(staging), 'staging');
});

test('missing confirmation or unspecified target fails closed', () => {
  for (const update of [
    { NEARPILL_VERIFICATION_TARGET: undefined },
    { NEARPILL_VERIFICATION_CONFIRMATION: undefined },
    { NEARPILL_VERIFICATION_CONFIRMATION: 'yes' },
  ]) {
    assert.throws(() => assertApprovedFixtureTarget({ ...local, ...update }));
  }
});

test('production and mismatched NODE_ENV are always rejected', () => {
  for (const target of [local, staging]) {
    assert.throws(() => assertApprovedFixtureTarget({ ...target, NODE_ENV: 'production' }));
  }
  assert.throws(() => assertApprovedFixtureTarget({ ...local, NODE_ENV: 'development' }));
});

test('host and database must match independently supplied expected values', () => {
  for (const update of [
    { DB_HOST: 'db.unapproved.supabase.co' },
    { DB_NAME: 'production' },
    { NEARPILL_VERIFICATION_EXPECTED_DATABASE: undefined },
    { NEARPILL_VERIFICATION_EXPECTED_HOST: undefined },
  ]) {
    assert.throws(() => assertApprovedFixtureTarget({ ...local, ...update }));
  }
});

test('local-test cannot target a remote host or a non-test database', () => {
  for (const update of [
    { DB_HOST: 'db.remote.test', NEARPILL_VERIFICATION_EXPECTED_HOST: 'db.remote.test' },
    { DB_NAME: 'nearpill', NEARPILL_VERIFICATION_EXPECTED_DATABASE: 'nearpill' },
  ]) {
    assert.throws(() => assertApprovedFixtureTarget({ ...local, ...update }));
  }
});

test('fixture verification requires an explicit numeric PostgreSQL port', () => {
  for (const value of [undefined, '', ' ', 'not-a-port', '0', '-1', '65536', '5432.0', '54 32', '6543;DROP']) {
    assert.throws(
      () => assertApprovedFixtureTarget({ ...local, DB_PORT: value }),
      /explicit valid DB_PORT/,
      `port ${String(value)} must not be accepted`,
    );
  }
  assert.equal(assertApprovedFixtureTarget({ ...local, DB_PORT: '55432' }), 'local-test',
    'a disposable local database may use an explicitly named alternative port');
});

test('Supabase staging rejects transaction pooling and non-session ports', () => {
  assert.equal(assertApprovedFixtureTarget(staging), 'staging');
  for (const port of ['6543', '5433', '6432', '15432']) {
    assert.throws(
      () => assertApprovedFixtureTarget({ ...staging, DB_PORT: port }),
      /port 5432; transaction pooling is forbidden/,
    );
  }
  const session = {
    ...staging,
    DB_HOST: 'aws-0-ap-southeast-1.pooler.supabase.com',
    NEARPILL_VERIFICATION_EXPECTED_HOST: 'aws-0-ap-southeast-1.pooler.supabase.com',
    DB_USER: 'nearpill_app.example-project',
  };
  assert.equal(assertApprovedFixtureTarget(session), 'staging');
  assert.throws(() => assertApprovedFixtureTarget({ ...session, DB_PORT: '6543' }),
    /port 5432; transaction pooling is forbidden/);
});

test('ordinary application role must differ from migrator and cannot be an admin role', () => {
  for (const appRole of ['postgres', 'postgres.example', 'service_role', 'supabase_admin', 'nearpill_migrator', '']) {
    assert.throws(() => assertApprovedFixtureTarget({ ...local, DB_USER: appRole }));
  }
});

test('fixture preflight refuses a predefined PostgreSQL role as either connection login', () => {
  for (const name of ['pg_read_all_data', 'pg_write_all_data', 'pg_monitor']) {
    for (const field of ['DB_USER', 'MIGRATOR_DB_USER']) {
      assert.throws(() => assertApprovedFixtureTarget({ ...local, [field]: name }),
        /Fixture verification requires/, `${field}=${name} must fail without connecting`);
    }
  }
});

test('fixture preflight rejects case-varied predefined/admin roles before connecting', () => {
  for (const role of ['POSTGRES', 'Service_Role', 'Supabase_Admin', 'PG_READ_ALL_DATA', 'PG_monitor']) {
    for (const key of ['DB_USER', 'MIGRATOR_DB_USER']) {
      for (const target of [local, staging]) {
        assert.throws(
          () => assertApprovedFixtureTarget({ ...target, [key]: role }),
          /fixture verification requires distinct|staging host and application login/i,
          `${target.NEARPILL_VERIFICATION_TARGET}: ${key}=${role} must be rejected`,
        );
      }
    }
  }
});

test('fixture preflight refuses NearPill database-owner logins before any connection', () => {
  // The reviewed roles bootstrap reserves nearpill_owner for DDL ownership.
  // No fixture-writing app or migrator connection may assume that authority,
  // even with quoted-case aliases or a Supabase session-pooler role suffix.
  for (const target of [local, staging]) {
    for (const name of ['nearpill_owner', 'NearPill_Owner']) {
      for (const field of ['DB_USER', 'MIGRATOR_DB_USER']) {
        assert.throws(
          () => assertApprovedFixtureTarget({ ...target, [field]: name }),
          /fixture verification requires distinct/i,
          `${target.NEARPILL_VERIFICATION_TARGET}: ${field}=${name} must be rejected before connecting`,
        );
      }
    }
  }
  const pooled = {
    ...staging,
    DB_HOST: 'aws-0-ap-southeast-1.pooler.supabase.com',
    NEARPILL_VERIFICATION_EXPECTED_HOST: 'aws-0-ap-southeast-1.pooler.supabase.com',
    DB_USER: 'nearpill_owner.example-project',
  };
  assert.throws(() => assertApprovedFixtureTarget(pooled), /fixture verification requires distinct/i);
});

test('fixture preflight refuses control or whitespace within database login names', () => {
  // Never treat a malformed username as evidence of an explicitly verified
  // application or migration role. No connection should be attempted.
  const malformed = ['nearpill_app other', 'nearpill_app\nother', 'nearpill_app\u0000other', 'nearpill_app\u200bother'];
  for (const target of [local, staging]) {
    for (const field of ['DB_USER', 'MIGRATOR_DB_USER']) {
      for (const name of malformed) {
        assert.throws(
          () => assertApprovedFixtureTarget({ ...target, [field]: name }),
          /fixture verification requires distinct/i,
          `${target.NEARPILL_VERIFICATION_TARGET}: ${field} should reject malformed role identity`,
        );
      }
    }
  }
});

test('fixture preflight rejects padded raw connection values before any pool', () => {
  // A fixture executor passes process.env directly to pg.Pool. Accepting
  // sanitized copies creates a mismatch between the reviewed target and
  // the host, database or role the client is told to use.
  for (const target of [local, staging]) {
    for (const field of ['DB_HOST', 'DB_NAME', 'DB_PORT', 'DB_USER', 'MIGRATOR_DB_USER']) {
      assert.throws(
        () => assertApprovedFixtureTarget({ ...target, [field]: ` ${target[field]}` }),
        /fixture|port|target|migrator|host/i,
        `${target.NEARPILL_VERIFICATION_TARGET}: padded ${field} must be refused`,
      );
    }
  }
  for (const field of ['MIGRATOR_DB_HOST', 'MIGRATOR_DB_PORT']) {
    assert.throws(() => assertApprovedFixtureTarget({ ...staging, [field]: ` ${staging[field]}` }),
      /fixture|migrator|port|target/i, `staging: padded ${field} must be refused`);
  }
  assert.equal(assertApprovedFixtureTarget(local), 'local-test');
  assert.equal(assertApprovedFixtureTarget(staging), 'staging');
});

test('staging refuses missing SSL, identity, owner approval or credentials', () => {
  for (const update of [
    { DB_SSL: 'false' },
    { DB_SSL: undefined },
    { DB_PASSWORD: undefined },
    { MIGRATOR_DB_PASSWORD: undefined },
    { NEARPILL_VERIFICATION_PROJECT_REF: undefined },
    { NEARPILL_VERIFICATION_OWNER_APPROVED: undefined },
    { NEARPILL_VERIFICATION_OWNER_APPROVED: 'false' },
    { MIGRATOR_DB_HOST: undefined },
    { MIGRATOR_DB_PORT: undefined },
    { NEARPILL_VERIFICATION_EXPECTED_MIGRATOR_HOST: undefined },
  ]) {
    assert.throws(() => assertApprovedFixtureTarget({ ...staging, ...update }));
  }
});


test('staging binds the expected Supabase project reference to its direct host or session pooler role suffix', () => {
  for (const update of [
    { NEARPILL_VERIFICATION_PROJECT_REF: 'another-project' },
    { DB_HOST: 'db.other-project.supabase.co', NEARPILL_VERIFICATION_EXPECTED_HOST: 'db.other-project.supabase.co' },
    { DB_HOST: 'db.example-project.supabase.co.attacker.com', NEARPILL_VERIFICATION_EXPECTED_HOST: 'db.example-project.supabase.co.attacker.com' },
    { NEARPILL_VERIFICATION_PROJECT_REF: '../../x' },
  ]) {
    assert.throws(() => assertApprovedFixtureTarget({ ...staging, ...update }));
  }
  const pooled = {
    ...staging,
    DB_HOST: 'aws-0-ap-southeast-1.pooler.supabase.com',
    NEARPILL_VERIFICATION_EXPECTED_HOST: 'aws-0-ap-southeast-1.pooler.supabase.com',
    DB_USER: 'nearpill_app.example-project',
  };
  assert.equal(assertApprovedFixtureTarget(pooled), 'staging');
  assert.throws(() => assertApprovedFixtureTarget({ ...pooled, DB_USER: 'nearpill_app.other-project' }));
  assert.throws(() => assertApprovedFixtureTarget({ ...pooled, MIGRATOR_DB_USER: 'nearpill_migrator.other-project' }));
});


test('staging rejects connection-mode username ambiguity before constructing any pool', () => {
  const pooled = {
    ...staging,
    DB_HOST: 'aws-0-ap-southeast-1.pooler.supabase.com',
    NEARPILL_VERIFICATION_EXPECTED_HOST: 'aws-0-ap-southeast-1.pooler.supabase.com',
    DB_USER: 'nearpill_app.example-project',
  };
  assert.equal(assertApprovedFixtureTarget(staging), 'staging');
  assert.equal(assertApprovedFixtureTarget(pooled), 'staging');
  // A direct PostgreSQL login is an unqualified role, unlike a shared
  // session-pooler username. Mixing modes must fail before any connection.
  for (const DB_USER of [
    'nearpill_app.example-project',
    'nearpill_app.other-project',
    'nearpill_app.example-project.evil',
  ]) {
    assert.throws(() => assertApprovedFixtureTarget({ ...staging, DB_USER }),
      /staging host and application login/i, `direct mode must reject ${DB_USER}`);
  }
  for (const DB_USER of [
    'nearpill_app',
    'nearpill_app.extra.example-project',
    '.example-project',
    'nearpill_app.other-project',
  ]) {
    assert.throws(() => assertApprovedFixtureTarget({ ...pooled, DB_USER }),
      /staging host and application login/i, `pooler mode must reject ${DB_USER}`);
  }
});

test('staging migrator must use an explicit, independently approved direct TLS project endpoint', () => {
  const pooled = {
    ...staging,
    DB_HOST: 'aws-0-ap-southeast-1.pooler.supabase.com',
    NEARPILL_VERIFICATION_EXPECTED_HOST: 'aws-0-ap-southeast-1.pooler.supabase.com',
    DB_USER: 'nearpill_app.example-project',
  };
  assert.equal(assertApprovedFixtureTarget(pooled), 'staging');
  for (const change of [
    { MIGRATOR_DB_HOST: undefined },
    { MIGRATOR_DB_HOST: 'aws-0-ap-southeast-1.pooler.supabase.com', NEARPILL_VERIFICATION_EXPECTED_MIGRATOR_HOST: 'aws-0-ap-southeast-1.pooler.supabase.com' },
    { MIGRATOR_DB_HOST: 'db.other-project.supabase.co', NEARPILL_VERIFICATION_EXPECTED_MIGRATOR_HOST: 'db.other-project.supabase.co' },
    { MIGRATOR_DB_HOST: 'db.example-project.supabase.co.attacker.invalid', NEARPILL_VERIFICATION_EXPECTED_MIGRATOR_HOST: 'db.example-project.supabase.co.attacker.invalid' },
    { MIGRATOR_DB_HOST: 'db.example-project.supabase.co', NEARPILL_VERIFICATION_EXPECTED_MIGRATOR_HOST: 'db.other-project.supabase.co' },
    { MIGRATOR_DB_PORT: undefined },
    { MIGRATOR_DB_PORT: '6543' },
    { MIGRATOR_DB_PORT: '5433' },
    { MIGRATOR_DB_USER: 'nearpill_migrator.example-project' },
    { DB_USER: 'nearpill_migrator.example-project' },
  ]) {
    assert.throws(() => assertApprovedFixtureTarget({ ...pooled, ...change }),
      /migrator|direct/i, JSON.stringify(change));
  }
  // On an approved direct app endpoint, the roles are still separate although
  // the hostname can match. The migrator may not fall back to a pooler.
  assert.equal(assertApprovedFixtureTarget(staging), 'staging');
});

test('fixture-writing verifiers use the separately configured migration endpoint', async () => {
  for (const name of ['verify-postgres-security.mjs', 'verify-identity-security.mjs', 'verify-order-inventory.mjs', 'reconcile-postgres.mjs']) {
    const source = await readFile(new URL(`../scripts/${name}`, import.meta.url), 'utf8');
    assert.match(source, /MIGRATOR_DB_HOST/, `${name}: migrator must have an independent host`);
    assert.match(source, /MIGRATOR_DB_PORT/, `${name}: migrator must have an independent port`);
    assert.ok(source.indexOf('assertApprovedFixtureTarget(process.env)') >= 0 ||
      source.indexOf('assertIsolatedOrderVerifierTarget(process.env)') >= 0);
  }
});

test('each fixture-writing DB verifier applies the guard before constructing pools', async () => {
  for (const name of [
    'verify-postgres-security.mjs',
    'verify-identity-security.mjs',
    'verify-order-inventory.mjs',
  ]) {
    const source = await readFile(new URL(`../scripts/${name}`, import.meta.url), 'utf8');
    const guardName = name === 'verify-order-inventory.mjs'
      ? 'assertIsolatedOrderVerifierTarget' : 'assertApprovedFixtureTarget';
    assert.ok(source.includes(`import { ${guardName} }`));
    assert.ok(source.indexOf(`${guardName}(process.env)`) < source.indexOf('new Pool('));
    // A staging env flag alone is insufficient; each pool must actually honor TLS.
    const pools = [...source.matchAll(/new Pool\(\{/g)].length;
    const tlsFlags = [...source.matchAll(/ssl: process\.env\.DB_SSL === 'true'/g)].length;
    assert.equal(tlsFlags, pools, `${name}: every pool must receive an explicit SSL configuration`);
  }
});


test('global order-expiry integration verifier only permits an approved disposable local test database', () => {
  assert.equal(assertIsolatedOrderVerifierTarget(local), 'local-test');
  assert.throws(() => assertIsolatedOrderVerifierTarget(staging), /local-test only/);
  for (const update of [
    { NODE_ENV: 'production' },
    { DB_NAME: 'nearpill', NEARPILL_VERIFICATION_EXPECTED_DATABASE: 'nearpill' },
    { DB_HOST: 'db.example-project.supabase.co', NEARPILL_VERIFICATION_EXPECTED_HOST: 'db.example-project.supabase.co' },
  ]) {
    assert.throws(() => assertIsolatedOrderVerifierTarget({ ...local, ...update }));
  }
});

test('order-expiry verifier must refuse staging before creating a PostgreSQL pool or running global expiry', async () => {
  const source = await readFile(new URL('../scripts/verify-order-inventory.mjs', import.meta.url), 'utf8');
  const guard = source.indexOf('assertIsolatedOrderVerifierTarget(process.env)');
  const firstPool = source.indexOf('new Pool(');
  const globalExpiry = source.indexOf('service.expireOldOrders()');
  assert.ok(guard >= 0 && guard < firstPool && firstPool < globalExpiry);
  assert.doesNotMatch(source, /assertApprovedFixtureTarget\(process.env\)/);
});
