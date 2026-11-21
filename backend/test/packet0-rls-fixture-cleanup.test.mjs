import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cleanupSyntheticRlsVerifierFixtures } from '../scripts/lib/cleanup-rls-fixtures.mjs';

const fixture = Object.freeze({
  userA: 81, userB: 82, orderA: 91, orderB: 92,
  inventoryId: 93, medicineId: 94, storeId: 95,
});

function recorder({ failingTables = [] } = {}) {
  const calls = [];
  return {
    calls,
    migratorPool: {
      async query(sql, params) {
        calls.push({ sql, params });
        if (failingTables.some((table) => sql.startsWith(`DELETE FROM ${table} `))) {
          throw new Error(`synthetic ${sql} failure`);
        }
        return { rowCount: 1, rows: [] };
      },
    },
  };
}

test('removes exactly the recorded synthetic RLS IDs in dependency-safe order', async () => {
  const r = recorder();
  await cleanupSyntheticRlsVerifierFixtures({ migratorPool: r.migratorPool, fixture, fixtureCommitted: false });
  assert.deepEqual(r.calls.map((c) => c.sql), [
    'DELETE FROM orders WHERE id = ANY($1::int[])',
    'DELETE FROM stock WHERE id=$1',
    'DELETE FROM medicines WHERE id=$1',
    'DELETE FROM pharmacies WHERE id=$1',
    'DELETE FROM users WHERE id = ANY($1::int[])',
  ]);
  assert.deepEqual(r.calls.map((c) => c.params), [
    [[91, 92]], [93], [94], [95], [[81, 82]],
  ]);
});

test('continues through every cleanup step when a child deletion fails', async () => {
  const r = recorder({ failingTables: ['orders'] });
  await assert.rejects(
    cleanupSyntheticRlsVerifierFixtures({ migratorPool: r.migratorPool, fixture, fixtureCommitted: false }),
    (err) => err instanceof AggregateError && err.errors.length === 1 && /orders/.test(err.errors[0].message),
  );
  assert.equal(r.calls.length, 5);
});

test('reports multiple fixture deletion failures rather than a false PASS', async () => {
  const r = recorder({ failingTables: ['orders', 'medicines', 'users'] });
  await assert.rejects(
    cleanupSyntheticRlsVerifierFixtures({ migratorPool: r.migratorPool, fixture, fixtureCommitted: false }),
    (err) => err instanceof AggregateError && err.errors.length === 3,
  );
  assert.equal(r.calls.length, 5);
});

test('partial fixture creation cleans only IDs recorded from successful inserts', async () => {
  const r = recorder();
  await cleanupSyntheticRlsVerifierFixtures({ migratorPool: r.migratorPool, fixtureCommitted: false, fixture: { userA: 81, userB: 82, storeId: 95 } });
  assert.deepEqual(r.calls.map((c) => c.sql), [
    'DELETE FROM pharmacies WHERE id=$1',
    'DELETE FROM users WHERE id = ANY($1::int[])',
  ]);
});

test('no recorded IDs means no deletes', async () => {
  const r = recorder();
  await cleanupSyntheticRlsVerifierFixtures({ migratorPool: r.migratorPool, fixtureCommitted: false, fixture: {} });
  assert.equal(r.calls.length, 0);
});

test('rejects invalid IDs atomically before executing a DELETE', async () => {
  for (const bad of ['82', 0, -10, NaN, 1.25, Number.MAX_SAFE_INTEGER + 1]) {
    const r = recorder();
    await assert.rejects(
      cleanupSyntheticRlsVerifierFixtures({ migratorPool: r.migratorPool, fixtureCommitted: false, fixture: { ...fixture, userB: bad } }),
      /invalid synthetic userB/,
    );
    assert.equal(r.calls.length, 0);
  }
});

test('requires recorded fixtures and an explicit migration-role query adapter', async () => {
  await assert.rejects(cleanupSyntheticRlsVerifierFixtures({ migratorPool: null, fixture, fixtureCommitted: false }), /migration-role query adapter/);
  await assert.rejects(cleanupSyntheticRlsVerifierFixtures({ migratorPool: recorder().migratorPool, fixture: [], fixtureCommitted: false }), /recorded synthetic IDs/);
});

test('canonical security verifier closes both pools and prints PASS only after fixture cleanup', async () => {
  const script = await readFile(new URL('../scripts/verify-postgres-security.mjs', import.meta.url), 'utf8');
  assert.match(script, /await cleanupSyntheticRlsVerifierFixtures\(\{ migratorPool, fixture, fixtureCommitted \}\)/);
  assert.doesNotMatch(script, /if \(fixture\.inventoryId\) await migrationClient\.query\('DELETE/);
  assert.match(script, /migrationClient\.release\(discard\)/);
  assert.match(script, /const poolClosures = await Promise\.allSettled\(\[appPool\.end\(\), migratorPool\.end\(\)\]\)/);
  const cleanup = script.indexOf('await cleanupSyntheticRlsVerifierFixtures');
  const pass = script.indexOf("console.log('PASS cross-customer order RLS');");
  assert.ok(pass > cleanup);
  assert.ok(pass > script.indexOf('if (verificationError) throw verificationError;'));
  assert.ok(script.indexOf('await assertSafeLiveFixtureConnections') < script.indexOf("await migrationClient.query('BEGIN')"));
});


test('committed fixture cleanup refuses successful DELETE statements that remove too few rows', async () => {
  const calls = [];
  const migratorPool = {
    async query(sql, params) {
      calls.push(sql);
      const expected = sql.includes('ANY($1::int[])') ? params[0].length : 1;
      return { rowCount: sql.startsWith('DELETE FROM stock ') ? 0 : expected, rows: [] };
    },
  };
  await assert.rejects(
    cleanupSyntheticRlsVerifierFixtures({ migratorPool, fixture, fixtureCommitted: true }),
    (error) => error instanceof AggregateError && /inventory/.test(error.errors[0].message),
  );
  assert.equal(calls.length, 5, 'all other fixtures must still be cleaned up');
});

test('committed fixture cleanup rejects malformed or excessive affected-row counts', async () => {
  for (const bad of [undefined, null, -1, 1.5, 3]) {
    const calls = [];
    const migratorPool = {
      async query(sql, params) {
        calls.push(sql);
        const expected = sql.includes('ANY($1::int[])') ? params[0].length : 1;
        return { rowCount: sql.startsWith('DELETE FROM orders ') ? bad : expected, rows: [] };
      },
    };
    await assert.rejects(
      cleanupSyntheticRlsVerifierFixtures({ migratorPool, fixture, fixtureCommitted: true }),
      (error) => error instanceof AggregateError && /orders/.test(error.errors[0].message),
    );
    assert.equal(calls.length, 5);
  }
});

test('uncommitted/rolled-back fixture may legitimately have zero affected rows', async () => {
  const calls = [];
  const migratorPool = { async query(sql) { calls.push(sql); return { rowCount: 0, rows: [] }; } };
  await cleanupSyntheticRlsVerifierFixtures({ migratorPool, fixture, fixtureCommitted: false });
  assert.equal(calls.length, 5);
});

test('canonical verifier passes its actual commit state into RLS fixture cleanup', async () => {
  const source = await readFile(new URL('../scripts/verify-postgres-security.mjs', import.meta.url), 'utf8');
  assert.match(source, /fixtureCommitted = true;/);
  assert.match(source, /cleanupSyntheticRlsVerifierFixtures\(\{ migratorPool, fixture, fixtureCommitted \}\)/);
});


test('missing or nonboolean transaction outcome cannot silently skip committed-row validation', async () => {
  const r = recorder();
  for (const value of [undefined, null, 'false', 0]) {
    await assert.rejects(
      cleanupSyntheticRlsVerifierFixtures({ migratorPool: r.migratorPool, fixture, fixtureCommitted: value }),
      /explicit boolean commit state/,
    );
  }
  assert.equal(r.calls.length, 0);
});

test('NP-036 cleans recorded synthetic partner membership before pharmacy and account deletion', async () => {
  const r = recorder();
  await cleanupSyntheticRlsVerifierFixtures({
    migratorPool: r.migratorPool,
    fixture: { ...fixture, userPartner: 83, userAdmin: 84, partnerMembershipId: 96 },
    fixtureCommitted: false,
  });
  assert.deepEqual(r.calls.map((c) => c.sql), [
    'DELETE FROM orders WHERE id = ANY($1::int[])',
    'DELETE FROM stock WHERE id=$1',
    'DELETE FROM pharmacy_memberships WHERE id=$1',
    'DELETE FROM medicines WHERE id=$1',
    'DELETE FROM pharmacies WHERE id=$1',
    'DELETE FROM users WHERE id = ANY($1::int[])',
  ]);
  assert.deepEqual(r.calls[2].params, [96]);
  assert.deepEqual(r.calls[5].params, [[81, 82, 83, 84]]);
});

test('NP-036 synthetic admin fixture cannot have a static login password', async () => {
  const source = await readFile(new URL('../scripts/verify-postgres-security.mjs', import.meta.url), 'utf8');
  assert.match(source, /RLS Admin.*\$1,\$2,'admin'/s);
  assert.match(source, /randomBytes\(32\)\.toString\('hex'\)/);
  assert.doesNotMatch(source, /'RLS Admin',\$1,'fixture','admin'/);
});

test('NP-036 refuses invalid partner fixture identifiers before touching any table', async () => {
  for (const wrong of [{ userPartner: '83' }, { userAdmin: '84' }, { partnerMembershipId: -1 }]) {
    const r = recorder();
    await assert.rejects(
      cleanupSyntheticRlsVerifierFixtures({
        migratorPool: r.migratorPool,
        fixture: { ...fixture, ...wrong },
        fixtureCommitted: false,
      }),
      /invalid synthetic/,
    );
    assert.equal(r.calls.length, 0);
  }
});
