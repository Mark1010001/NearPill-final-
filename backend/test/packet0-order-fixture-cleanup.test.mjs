import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cleanupSyntheticOrderVerifierFixtures } from '../scripts/lib/cleanup-order-fixtures.mjs';

const synthetic = { userId: 71, storeId: 72, medicineId: 73, inventoryId: 74 };

function recorder({ fail = [], counts = {} } = {}) {
  const calls = [];
  const migratorPool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (fail.some((text) => sql.includes(text))) throw new Error('synthetic deletion failed');
      const name = sql.includes('FROM orders') ? 'orders' :
        sql.includes('FROM stock') ? 'stock' :
        sql.includes('FROM medicines') ? 'medicines' :
        sql.includes('FROM pharmacies') ? 'pharmacies' : 'users';
      return { rowCount: Object.hasOwn(counts, name) ? counts[name] : 1, rows: [] };
    },
  };
  return { migratorPool, calls };
}

test('removes only recorded synthetic fixtures in dependency-safe order', async () => {
  const r = recorder();
  await cleanupSyntheticOrderVerifierFixtures({ migratorPool: r.migratorPool, fixture: synthetic });
  assert.deepEqual(r.calls.map(({ sql }) => sql), [
    'DELETE FROM orders WHERE user_id = $1',
    'DELETE FROM stock WHERE id = $1',
    'DELETE FROM medicines WHERE id = $1',
    'DELETE FROM pharmacies WHERE id = $1',
    'DELETE FROM users WHERE id = $1',
  ]);
  assert.deepEqual(r.calls.map(({ params }) => params), [[71], [74], [73], [72], [71]]);
});

test('failed child deletion does not prevent attempts to remove other fixture rows', async () => {
  const r = recorder({ fail: ['DELETE FROM stock'] });
  await assert.rejects(cleanupSyntheticOrderVerifierFixtures({ migratorPool: r.migratorPool, fixture: synthetic }), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.match(error.message, /stock/);
    assert.equal(error.errors.length, 1);
    return true;
  });
  assert.equal(r.calls.length, 5);
});

test('reports all cleanup failures instead of treating a partial cleanup as success', async () => {
  const r = recorder({ fail: ['DELETE FROM orders', 'DELETE FROM stock'] });
  await assert.rejects(cleanupSyntheticOrderVerifierFixtures({ migratorPool: r.migratorPool, fixture: synthetic }), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    assert.match(error.message, /orders.*stock/);
    return true;
  });
  assert.equal(r.calls.length, 5);
});

test('a partially created synthetic user still gets its order and user cleanup attempted', async () => {
  const r = recorder();
  await cleanupSyntheticOrderVerifierFixtures({ migratorPool: r.migratorPool, fixture: { userId: 71 } });
  assert.deepEqual(r.calls.map(({ sql }) => sql), [
    'DELETE FROM orders WHERE user_id = $1',
    'DELETE FROM users WHERE id = $1',
  ]);
});

test('invalid synthetic IDs are rejected before any DELETE', async () => {
  const r = recorder();
  await assert.rejects(cleanupSyntheticOrderVerifierFixtures({ migratorPool: r.migratorPool, fixture: { ...synthetic, inventoryId: '74' } }), /invalid synthetic inventoryId/);
  assert.equal(r.calls.length, 0);
});

test('rejects missing query adapter before attempting fixture deletion', async () => {
  await assert.rejects(cleanupSyntheticOrderVerifierFixtures({ migratorPool: null, fixture: synthetic }), /migration-role query adapter/);
});

test('canonical verifier always delegates cleanup and closes both database pools', async () => {
  const source = await readFile(new URL('../scripts/verify-order-inventory.mjs', import.meta.url), 'utf8');
  assert.match(source, /await cleanupSyntheticOrderVerifierFixtures\(\{ migratorPool, fixture \}\)/);
  assert.doesNotMatch(source, /if \(fixture\.inventoryId\) await migratorPool\.query\('DELETE/);
  assert.match(source, /appPool\.end\(\)/);
  assert.match(source, /migratorPool\.end\(\)/);
  assert.ok(source.indexOf('await cleanupSyntheticOrderVerifierFixtures') < source.indexOf("console.log('PASS 100-way canonical"), 'PASS must only be printed after fixture cleanup');
});


test('complete contention teardown verifies all three committed orders were deleted', async () => {
  const fixture = { ...synthetic, expectedOrderCount: 3 };
  const r = recorder({ counts: { orders: 3 } });
  await cleanupSyntheticOrderVerifierFixtures({ migratorPool: r.migratorPool, fixture });
  assert.equal(r.calls.length, 5);
});

for (const affected of [0, 2, 4, undefined, -1, 1.25, NaN]) {
  test(`rejects wrong or invalid committed order deletion count ${String(affected)}`, async () => {
    const r = recorder({ counts: { orders: affected } });
    await assert.rejects(
      cleanupSyntheticOrderVerifierFixtures({ migratorPool: r.migratorPool, fixture: { ...synthetic, expectedOrderCount: 3 } }),
      (error) => error instanceof AggregateError && /orders/.test(error.message),
    );
    assert.equal(r.calls.length, 5, 'teardown still attempts every remaining fixture');
  });
}

test('partial verifier permits zero orders but rejects unexpected broad cleanup', async () => {
  await cleanupSyntheticOrderVerifierFixtures({ migratorPool: recorder({ counts: { orders: 0 } }).migratorPool, fixture: synthetic });
  const r = recorder({ counts: { orders: 101 } });
  await assert.rejects(cleanupSyntheticOrderVerifierFixtures({ migratorPool: r.migratorPool, fixture: synthetic }), /cleanup incomplete/);
  assert.equal(r.calls.length, 5);
});

for (const invalid of [null, -1, 101, 0.5, '3']) {
  test(`rejects invalid expected order count ${String(invalid)} before deleting anything`, async () => {
    const r = recorder();
    await assert.rejects(cleanupSyntheticOrderVerifierFixtures({ migratorPool: r.migratorPool, fixture: { ...synthetic, expectedOrderCount: invalid } }), /invalid expected order count/);
    assert.equal(r.calls.length, 0);
  });
}

test('rejects a successful SQL DELETE that silently leaves a recorded singleton', async () => {
  const r = recorder({ counts: { stock: 0 } });
  await assert.rejects(cleanupSyntheticOrderVerifierFixtures({ migratorPool: r.migratorPool, fixture: synthetic }), /cleanup incomplete/);
  assert.equal(r.calls.length, 5);
});

test('rejects missing or malformed singleton deletion counts', async () => {
  for (const count of [undefined, -1, 2, 1.5]) {
    const r = recorder({ counts: { users: count } });
    await assert.rejects(cleanupSyntheticOrderVerifierFixtures({ migratorPool: r.migratorPool, fixture: synthetic }), /cleanup incomplete/);
  }
});

test('canonical order verifier records expected committed count before integrity checks', async () => {
  const source = await readFile(new URL('../scripts/verify-order-inventory.mjs', import.meta.url), 'utf8');
  assert.match(source, /fixture\.expectedOrderCount = successes\.length/);
});
