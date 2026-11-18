import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assertEmptyOrderBaseline,
  assertOnlyFixtureExpiryCandidate,
  assertNoExpiryCandidates,
} from '../scripts/lib/verify-order-expiry-scope.mjs';

function recorder(rows) {
  const queries = [];
  return {
    queries,
    adapter: {
      async query(sql) {
        queries.push(sql);
        return { rows };
      },
    },
  };
}

test('accepts only a genuinely empty order database before fixture creation', async () => {
  const r = recorder([]);
  await assertEmptyOrderBaseline(r.adapter);
  assert.match(r.queries[0], /FROM orders.*LIMIT 1/);
});

test('rejects an existing order before fixture insertion', async () => {
  const r = recorder([{ id: 9 }]);
  await assert.rejects(assertEmptyOrderBaseline(r.adapter), /pre-existing orders/);
});

test('rejects missing query adapters and malformed baseline results', async () => {
  await assert.rejects(assertEmptyOrderBaseline(null), /migrator query adapter/);
  await assert.rejects(assertEmptyOrderBaseline({ async query() { return {}; } }), /invalid result/);
});

test('allows only the recorded synthetic order to be globally expired', async () => {
  const r = recorder([{ id: '42' }]);
  await assertOnlyFixtureExpiryCandidate(r.adapter, 42);
  assert.match(r.queries[0], /expires_at IS NOT NULL/);
  assert.match(r.queries[0], /status IN \('reserved','awaiting_payment'\)/);
  assert.match(r.queries[0], /ORDER BY id ASC LIMIT 2/);
});

for (const rows of [[], [{ id: 43 }], [{ id: 42 }, { id: 43 }], [{ id: null }]]) {
  test(`rejects unsafe expiry candidate set ${JSON.stringify(rows)}`, async () => {
    const r = recorder(rows);
    await assert.rejects(assertOnlyFixtureExpiryCandidate(r.adapter, 42), /refused global expiry/);
  });
}

test('invalid synthetic order ID is rejected without executing SQL', async () => {
  const r = recorder([{ id: 42 }]);
  await assert.rejects(assertOnlyFixtureExpiryCandidate(r.adapter, '42'), /valid recorded synthetic order ID/);
  assert.equal(r.queries.length, 0);
});

test('malformed expiry query result cannot be treated as no competing orders', async () => {
  await assert.rejects(assertOnlyFixtureExpiryCandidate({ async query() { return null; } }, 42), /invalid result/);
});

test('canonical local verifier executes both guards in order before global expiry', async () => {
  const source = await readFile(new URL('../scripts/verify-order-inventory.mjs', import.meta.url), 'utf8');
  const conn = source.indexOf('await assertSafeLiveFixtureConnections(');
  const baseline = source.indexOf('await assertEmptyOrderBaseline(migratorPool)');
  const firstFixture = source.indexOf('fixture.userId = Number(');
  const candidate = source.indexOf('await assertOnlyFixtureExpiryCandidate(migratorPool, expiredOrderId)');
  const expiry = source.indexOf('service.expireOldOrders()');
  assert.ok(conn >= 0 && conn < baseline && baseline < firstFixture);
  assert.ok(candidate > firstFixture && candidate < expiry);
});

test('repeat global expiry requires zero eligible orders', async () => {
  const safe = recorder([]);
  await assertNoExpiryCandidates(safe.adapter);
  assert.match(safe.queries[0], /status IN \('reserved','awaiting_payment'\)/);
  assert.match(safe.queries[0], /LIMIT 1/);
  await assert.rejects(assertNoExpiryCandidates(recorder([{ id: 71 }]).adapter), /refused repeat global expiry/);
  await assert.rejects(assertNoExpiryCandidates({ query: async () => ({}) }), /invalid result/);
});

test('canonical verifier checks empty expiry candidate set before repeat global expiry', async () => {
  const source = await readFile(new URL('../scripts/verify-order-inventory.mjs', import.meta.url), 'utf8');
  const first = source.indexOf('const expiredCount = await asSystem(() => service.expireOldOrders())');
  const guard = source.indexOf('await assertNoExpiryCandidates(migratorPool)');
  const repeat = source.indexOf('const secondExpiry = await asSystem(() => service.expireOldOrders())');
  assert.ok(first >= 0 && first < guard && guard < repeat);
});

test('expiry scope read failures fail closed rather than permitting a global sweep', async () => {
  const failing = { async query() { throw new Error('database unavailable'); } };
  await assert.rejects(assertEmptyOrderBaseline(failing), /database unavailable/);
  await assert.rejects(assertOnlyFixtureExpiryCandidate(failing, 42), /database unavailable/);
  await assert.rejects(assertNoExpiryCandidates(failing), /database unavailable/);
});

test('local-only target guard precedes pool construction and fixture writes', async () => {
  const source = await readFile(new URL('../scripts/verify-order-inventory.mjs', import.meta.url), 'utf8');
  const guard = source.indexOf('assertIsolatedOrderVerifierTarget(process.env)');
  const firstPool = source.indexOf('new Pool(');
  const firstInsert = source.indexOf('INSERT INTO users');
  assert.ok(guard >= 0 && guard < firstPool && firstPool < firstInsert);
  assert.match(source, /Never run this verifier on staging/);
});

test('expiry candidate probe stays bounded for unexpectedly large order tables', async () => {
  const r = recorder([{ id: 42 }, { id: 43 }]);
  await assert.rejects(assertOnlyFixtureExpiryCandidate(r.adapter, 42), /refused global expiry/);
  assert.match(r.queries[0], /LIMIT 2/);
});
