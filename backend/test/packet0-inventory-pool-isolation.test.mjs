import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { attemptFixtureInventoryReservation } from '../scripts/lib/verify-inventory-pool-isolation.mjs';

function poolFixture({ resultRows = [{ id: 42 }], failAt, leakedContext = false } = {}) {
  const events = [];
  const releases = [];
  const pool = {
    async connect() {
      events.push('CONNECT');
      return {
        async query(sql, params = []) {
          const kind = sql.trim().split(/\s+/)[0].toUpperCase();
          events.push(kind);
          if ((failAt === kind && kind !== 'SELECT') ||
              (failAt === 'SELECT' && sql.includes('set_config')) ||
              (failAt === 'RESET' && sql.includes('current_setting'))) throw new Error(`${failAt} failed`);
          if (kind === 'UPDATE') {
            assert.deepEqual(params, [42]);
            return { rowCount: resultRows.length, rows: resultRows };
          }
          if (sql.includes('current_setting')) {
            return { rows: [{ user_id: leakedContext ? '999' : '', role: '', capability: leakedContext ? 'order_mutation' : '' }] };
          }
          return { rows: [] };
        },
        release(destroy) { releases.push(Boolean(destroy)); },
      };
    },
  };
  return { pool, events, releases };
}

test('reuses app-role connection only after COMMIT and actor/capability reset', async () => {
  const f = poolFixture();
  assert.equal(await attemptFixtureInventoryReservation({ pool: f.pool, inventoryId: 42 }), true);
  assert.deepEqual(f.events, ['CONNECT', 'BEGIN', 'SELECT', 'UPDATE', 'COMMIT', 'SELECT']);
  assert.deepEqual(f.releases, [false]);
});

test('out-of-stock update returns false without leaking transaction-local capability', async () => {
  const f = poolFixture({ resultRows: [] });
  assert.equal(await attemptFixtureInventoryReservation({ pool: f.pool, inventoryId: 42 }), false);
  assert.deepEqual(f.releases, [false]);
});

for (const stage of ['BEGIN', 'UPDATE', 'COMMIT', 'SELECT', 'RESET']) {
  test(`destroys pooled client when ${stage} fails`, async () => {
    const f = poolFixture({ failAt: stage });
    await assert.rejects(attemptFixtureInventoryReservation({ pool: f.pool, inventoryId: 42 }), new RegExp(`${stage} failed`));
    assert.deepEqual(f.releases, [true]);
    if (stage === 'UPDATE' || stage === 'COMMIT' || stage === 'SELECT') assert.ok(f.events.includes('ROLLBACK'));
    if (stage === 'BEGIN' || stage === 'RESET') assert.ok(!f.events.includes('ROLLBACK'));
  });
}

test('destroys pooled client on rollback failure after an update error', async () => {
  const events = [];
  const releases = [];
  const pool = { async connect() { return {
    async query(sql) {
      const kind = sql.trim().split(/\s+/)[0].toUpperCase();
      events.push(kind);
      if (kind === 'UPDATE' || kind === 'ROLLBACK') throw new Error(`${kind} failed`);
      return { rows: [] };
    },
    release(destroy) { releases.push(Boolean(destroy)); },
  }; } };
  await assert.rejects(attemptFixtureInventoryReservation({ pool, inventoryId: 42 }), /UPDATE failed/);
  assert.ok(events.includes('ROLLBACK'));
  assert.deepEqual(releases, [true]);
});

test('destroys pooled client if actor/capability context persists after COMMIT', async () => {
  const f = poolFixture({ leakedContext: true });
  await assert.rejects(attemptFixtureInventoryReservation({ pool: f.pool, inventoryId: 42 }), /state leaked after COMMIT/);
  assert.deepEqual(f.releases, [true]);
  assert.ok(!f.events.includes('ROLLBACK'));
});

test('rejects malformed or unexpected reservation rows without committing', async () => {
  const f = poolFixture({ resultRows: [{ id: 999 }] });
  await assert.rejects(attemptFixtureInventoryReservation({ pool: f.pool, inventoryId: 42 }), /invalid reservation result/);
  assert.ok(f.events.includes('ROLLBACK'));
  assert.ok(!f.events.includes('COMMIT'));
  assert.deepEqual(f.releases, [true]);
});

test('validates fixture identity before opening database connection', async () => {
  const f = poolFixture();
  await assert.rejects(attemptFixtureInventoryReservation({ pool: f.pool, inventoryId: -1 }), /synthetic inventory ID/);
  assert.deepEqual(f.events, []);
});

test('canonical live 100-way inventory verifier uses the fail-closed pooled transaction helper', async () => {
  const source = await readFile(new URL('../scripts/verify-postgres-security.mjs', import.meta.url), 'utf8');
  assert.match(source, /settleFixtureAttempts\(100/);
  assert.match(source, /attemptFixtureInventoryReservation\(\{ pool: appPool, inventoryId: fixture\.inventoryId \}\)/);
  assert.doesNotMatch(source, /catch\s*\{\s*\}\s*\n\s*throw error;\s*\n\s*\}\s*finally\s*\{\s*client\.release\(\)/);
});
