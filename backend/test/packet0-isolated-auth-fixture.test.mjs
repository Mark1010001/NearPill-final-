import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { withIsolatedRefreshProbeUser } from '../scripts/lib/with-isolated-refresh-probe-user.mjs';

function fakeMigrationPool({ failInsert = false, failDelete = false } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.startsWith('INSERT INTO users')) {
        if (failInsert) throw new Error('INSERT denied');
        return { rows: [{ id: 8357 }], rowCount: 1 };
      }
      if (sql.startsWith('DELETE FROM users')) {
        if (failDelete) throw new Error('DELETE denied');
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected fixture query: ${sql}`);
    },
  };
}

test('creates a unique synthetic user and cleans precisely that user after successful token assertions', async () => {
  const pool = fakeMigrationPool();
  const seen = [];
  const value = await withIsolatedRefreshProbeUser({
    pool,
    marker: 'packet0-unique-marker',
    verify: async (id) => { seen.push(id); return 'rotated-replay-revoked'; },
  });
  assert.equal(value, 'rotated-replay-revoked');
  assert.deepEqual(seen, [8357]);
  assert.equal(pool.queries.length, 2);
  assert.match(pool.queries[0].sql, /^INSERT INTO users/);
  assert.deepEqual(pool.queries[0].params, ['Packet 0 Refresh Probe', 'packet0-unique-marker-refresh@example.invalid', 'fixture-no-login', 'customer']);
  assert.match(pool.queries[1].sql, /^DELETE FROM users/);
  assert.deepEqual(pool.queries[1].params, [8357, 'packet0-unique-marker-refresh@example.invalid']);
  assert.ok(!pool.queries.some(({ sql }) => /SELECT.*FROM users/i.test(sql)));
});

test('cleans the synthetic user even when refresh/session validation fails', async () => {
  const pool = fakeMigrationPool();
  await assert.rejects(withIsolatedRefreshProbeUser({
    pool,
    marker: 'packet0-unique-marker',
    verify: async () => { throw new Error('refresh replay failure'); },
  }), /refresh replay failure/);
  assert.deepEqual(pool.queries.map(({ sql }) => sql.split(' ')[0]), ['INSERT', 'DELETE']);
});

test('does not call token validation if synthetic user INSERT failed', async () => {
  const pool = fakeMigrationPool({ failInsert: true });
  let called = false;
  await assert.rejects(withIsolatedRefreshProbeUser({
    pool,
    marker: 'packet0-unique-marker',
    verify: async () => { called = true; },
  }), /INSERT denied/);
  assert.equal(called, false);
  assert.equal(pool.queries.length, 1);
});

test('rejects missing/unsafe marker and failed user cleanup rather than claiming PASS', async () => {
  const pool = fakeMigrationPool();
  for (const marker of ['', 'a/b', 'a@example.com', ' ']) {
    await assert.rejects(withIsolatedRefreshProbeUser({ pool, marker, verify: async () => {} }));
  }
  assert.equal(pool.queries.length, 0);
  await assert.rejects(withIsolatedRefreshProbeUser({
    pool: fakeMigrationPool({ failDelete: true }), marker: 'packet0-safe', verify: async () => {},
  }), /DELETE denied/);
});

test('live verifier never selects an existing user for refresh family tests', async () => {
  const script = await readFile(new URL('../scripts/verify-identity-security.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(script, /SELECT\s+id\s+FROM\s+users\s+ORDER\s+BY/i);
  assert.match(script, /await withIsolatedRefreshProbeUser\(/);
  assert.match(script, /await assertSafeLiveFixtureConnections\(\{ appPool: pool, migratorPool, env: process\.env \}\)/);
});
