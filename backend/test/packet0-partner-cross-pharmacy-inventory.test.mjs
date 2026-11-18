/** Packet 0 only: recording pool verifies live-test logic, NOT live RLS. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertPartnerCrossPharmacyInventoryDenied } from '../scripts/lib/verify-order-tenant-isolation.mjs';
import { cleanupSyntheticRlsVerifierFixtures } from '../scripts/lib/cleanup-rls-fixtures.mjs';

const fixture = Object.freeze({
  userPartner: 11, partnerMembershipId: 12, storeId: 13, otherStoreId: 14,
  inventoryId: 15, otherInventoryId: 16,
});

function poolFor({ partnerOtherMembership = false, visible = true, crossAvailabilityAllowed = false,
  crossPriceAllowed = false, failWith, failureCode = '42601', contextLeak = false,
  failedRollback = false, mismatchedStore = false, inactiveMembership = false,
  ownDeleteAllowed = false, foreignDeleteAllowed = false, deleteFailure = null,
  ownInventoryHidden = false } = {}) {
  const queries = [];
  const releases = [];
  return {
    queries, releases,
    async connect() {
      let actor = '', role = '', capability = '';
      return {
        async query(sql, params = []) {
          queries.push({ sql, params });
          if (sql === 'BEGIN') return { rows: [] };
          if (sql === 'ROLLBACK') {
            if (failedRollback) throw new Error('rollback failed');
            if (!contextLeak) { actor = ''; role = ''; capability = ''; }
            return { rows: [] };
          }
          if (sql.includes("set_config('app.user_id'")) {
            actor = params[0]; role = params[1]; capability = '';
            return { rows: [] };
          }
          if (sql.includes("current_setting('app.user_id'")) {
            return { rows: [{ user_id: actor, role, capability }] };
          }
          if (sql.includes('FROM pharmacy_memberships') && sql.includes('WHERE id = $1')) {
            return { rows: [{ id: fixture.partnerMembershipId, drugstore_id: fixture.storeId, is_active: inactiveMembership ? 0 : 1 }] };
          }
          if (sql.includes('FROM pharmacy_memberships') && sql.includes('WHERE drugstore_id = $1')) {
            return { rows: partnerOtherMembership ? [{ id: 99 }] : [] };
          }
          if (sql.startsWith('SELECT id,drugstore_id,availability,price_centavos FROM inventory')) {
            const owned = params[0] === fixture.inventoryId;
            return { rows: (!visible || (owned && ownInventoryHidden)) ? [] : [{
              id: owned ? fixture.inventoryId : fixture.otherInventoryId,
              drugstore_id: owned ? fixture.storeId : (mismatchedStore ? fixture.storeId : fixture.otherStoreId),
              availability: 1, price_centavos: 1000,
            }] };
          }
          if (sql.startsWith('DELETE FROM inventory WHERE id = $1 RETURNING id')) {
            if (deleteFailure && deleteFailure.target === params[0]) {
              throw Object.assign(new Error(deleteFailure.message), { code: deleteFailure.code });
            }
            const permitted = params[0] === fixture.inventoryId ? ownDeleteAllowed : foreignDeleteAllowed;
            return permitted ? { rows: [{ id: params[0] }], rowCount: 1 } : { rows: [], rowCount: 0 };
          }
          if (sql.startsWith('UPDATE inventory SET ')) {
            const column = sql.includes('SET availability') ? 'availability' : 'price_centavos';
            if (failWith === column) throw Object.assign(new Error('unexpected SQL failure'), { code: failureCode });
            const allowed = column === 'availability' ? crossAvailabilityAllowed : crossPriceAllowed;
            return allowed ? { rows: [{ id: fixture.otherInventoryId }], rowCount: 1 } : { rows: [], rowCount: 0 };
          }
          throw new Error(`Unknown test statement: ${sql}`);
        },
        release(discard) { releases.push(discard); },
      };
    },
  };
}

test('partner can read published foreign stock but neither mutate availability nor price', async () => {
  const pool = poolFor();
  await assertPartnerCrossPharmacyInventoryDenied({ pool, fixture });
  assert.equal(pool.queries.filter(({ sql }) => sql === 'BEGIN').length, 5);
  assert.equal(pool.queries.filter(({ sql }) => sql === 'ROLLBACK').length, 5);
  assert.deepEqual(pool.releases, [false, false, false, false, false]);
  const deletes = pool.queries.filter(({ sql }) => sql.startsWith('DELETE FROM inventory WHERE'));
  assert.deepEqual(deletes.map(({ params }) => params), [[fixture.inventoryId], [fixture.otherInventoryId]]);
  const writes = pool.queries.filter(({ sql }) => sql.startsWith('UPDATE inventory SET'));
  assert.deepEqual(writes.map(({ params }) => params), [[fixture.otherInventoryId, 0], [fixture.otherInventoryId, 1]]);
  assert.deepEqual(writes.map(({ sql }) => sql.includes('SET availability') ? 'availability' : 'price_centavos'),
    ['availability', 'price_centavos']);
  assert.ok(pool.queries.every(({ sql }) => sql !== 'COMMIT'));
});

test('NP-037 partner cannot DELETE either its own or a foreign published inventory listing', async () => {
  for (const flag of ['ownDeleteAllowed', 'foreignDeleteAllowed']) {
    const pool = poolFor({ [flag]: true });
    await assert.rejects(assertPartnerCrossPharmacyInventoryDenied({ pool, fixture }),
      /NP-037 RLS verification failed: partner can DELETE/);
    assert.ok(pool.queries.some(({ sql }) => sql === 'ROLLBACK'));
    assert.ok(pool.releases.every((discard) => discard === false));
    assert.ok(!pool.queries.some(({ sql }) => sql === 'COMMIT'));
  }
});

test('NP-037 refuses a missing owned row or unrelated SQL error as security proof', async () => {
  const absent = poolFor({ ownInventoryHidden: true });
  await assert.rejects(assertPartnerCrossPharmacyInventoryDenied({ pool: absent, fixture }),
    /NP-037 DELETE verification requires visible own-pharmacy inventory/);
  assert.equal(absent.queries.filter(({ sql }) => sql.startsWith('DELETE FROM inventory')).length, 0);
  for (const deleteFailure of [
    { target: fixture.inventoryId, code: '23503', message: 'foreign key violation' },
    { target: fixture.inventoryId, code: '42501', message: 'permission denied for table users' },
  ]) {
    const pool = poolFor({ deleteFailure });
    await assert.rejects(assertPartnerCrossPharmacyInventoryDenied({ pool, fixture }));
    assert.ok(pool.releases.every((discard) => discard === false));
  }
});

test('NP-037 accepts only inventory-specific SQLSTATE 42501 as an explicit DELETE denial', async () => {
  const pool = poolFor({ deleteFailure: { target: fixture.inventoryId, code: '42501',
    message: 'permission denied for table inventory' } });
  await assertPartnerCrossPharmacyInventoryDenied({ pool, fixture });
  assert.deepEqual(pool.releases, [false, false, false, false, false]);
});

test('partner cross-pharmacy write acceptance fails if availability OR price changes', async () => {
  for (const flag of ['crossAvailabilityAllowed', 'crossPriceAllowed']) {
    const pool = poolFor({ [flag]: true });
    await assert.rejects(assertPartnerCrossPharmacyInventoryDenied({ pool, fixture }),
      new RegExp(`partner can change another pharmacy's ${flag === 'crossAvailabilityAllowed' ? 'availability' : 'price_centavos'}`));
    assert.ok(pool.queries.some(({ sql }) => sql === 'ROLLBACK'));
    assert.ok(pool.releases.every((discard) => discard === false));
  }
});

test('second pharmacy must really be distinct, visible and outside member scope', async () => {
  for (const option of [
    { partnerOtherMembership: true }, { visible: false }, { mismatchedStore: true },
    { inactiveMembership: true },
  ]) {
    const pool = poolFor(option);
    await assert.rejects(assertPartnerCrossPharmacyInventoryDenied({ pool, fixture }));
    assert.deepEqual(pool.releases, [false]);
    assert.equal(pool.queries.filter(({ sql }) => sql.startsWith('UPDATE inventory SET')).length, 0);
  }
});

test('unrelated database errors must not be counted as tenant security success', async () => {
  for (const column of ['availability', 'price_centavos']) {
    const pool = poolFor({ failWith: column });
    await assert.rejects(assertPartnerCrossPharmacyInventoryDenied({ pool, fixture }),
      /unexpected SQL failure/);
    assert.equal(pool.releases.length, column === 'availability' ? 4 : 5);
  }
});

test('rollback failure or actor context leak discards the physical connection', async () => {
  for (const option of [{ contextLeak: true }, { failedRollback: true }]) {
    const pool = poolFor(option);
    await assert.rejects(assertPartnerCrossPharmacyInventoryDenied({ pool, fixture }));
    assert.deepEqual(pool.releases, [true]);
  }
});

test('requires actual distinct positive numeric IDs without any SQL connection', async () => {
  for (const bad of [
    { otherStoreId: fixture.storeId }, { otherInventoryId: fixture.inventoryId },
    { otherStoreId: '14' }, { userPartner: undefined }, { otherInventoryId: -1 },
  ]) {
    const pool = poolFor();
    await assert.rejects(assertPartnerCrossPharmacyInventoryDenied({ pool, fixture: { ...fixture, ...bad } }),
      /two distinct recorded pharmacy fixtures/);
    assert.equal(pool.queries.length, 0);
  }
});

test('cleanup removes both pharmacies and both inventories by their recorded IDs', async () => {
  const calls = [];
  const migratorPool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: sql.includes('ANY($1::int[])') ? params[0].length : 1 };
    },
  };
  await cleanupSyntheticRlsVerifierFixtures({ migratorPool, fixture, fixtureCommitted: true });
  const deletes = calls.filter(({ sql }) => /^DELETE FROM (?:inventory|drugstores)\b/.test(sql));
  assert.deepEqual(deletes.map(({ params }) => params[0]),
    [fixture.inventoryId, fixture.otherInventoryId, fixture.storeId, fixture.otherStoreId]);
  for (const field of ['otherStoreId', 'otherInventoryId']) {
    const badCalls = [];
    await assert.rejects(cleanupSyntheticRlsVerifierFixtures({
      migratorPool: { async query(...args) { badCalls.push(args); return { rowCount: 1 }; } },
      fixture: { ...fixture, [field]: 0 }, fixtureCommitted: false,
    }), /invalid synthetic/);
    assert.equal(badCalls.length, 0);
  }
});

test('real DB verifier inserts, probes, and cleans only the second synthetic tenant', async () => {
  const [runner, cleanup] = await Promise.all([
    readFile(new URL('../scripts/verify-postgres-security.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/lib/cleanup-rls-fixtures.mjs', import.meta.url), 'utf8'),
  ]);
  const insertSecondStore = runner.indexOf('fixture.otherStoreId = Number(');
  const insertSecondInventory = runner.indexOf('fixture.otherInventoryId = Number(');
  const actualProbe = runner.indexOf('await assertPartnerCrossPharmacyInventoryDenied({ pool: appPool, fixture })');
  const commit = runner.indexOf("await migrationClient.query('COMMIT')");
  assert.ok(insertSecondStore >= 0 && insertSecondInventory > insertSecondStore && commit > insertSecondInventory);
  assert.ok(actualProbe > commit);
  assert.match(cleanup, /\['other_inventory', 'DELETE FROM inventory WHERE id=\$1', fixture\.otherInventoryId\]/);
  assert.match(cleanup, /\['other_drugstore', 'DELETE FROM drugstores WHERE id=\$1', fixture\.otherStoreId\]/);
});
