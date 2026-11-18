/** Packet 0: mocked SQL transport characterizes NP-038. NOT live Supabase RLS proof. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { assertPartnerInventoryInsertDenied } from '../scripts/lib/verify-order-tenant-isolation.mjs';
import { cleanupSyntheticRlsVerifierFixtures } from '../scripts/lib/cleanup-rls-fixtures.mjs';

const fixture = Object.freeze({
  userPartner: 11, userAdmin: 12, partnerMembershipId: 13,
  storeId: 14, otherStoreId: 17, medicineId: 15, priceProbeMedicineId: 16,
});

function recordingPool(options = {}) {
  const queries = [];
  const releases = [];
  const rlserror = { code: '42501', message: 'new row violates row-level security policy for table "inventory"' };
  return {
    queries, releases,
    async connect() {
      let user = '', role = '', capability = '';
      return {
        async query(sql, params = []) {
          queries.push({ sql, params });
          if (sql === 'BEGIN') return { rows: [] };
          if (sql === 'ROLLBACK') {
            if (options.rollbackFails) throw new Error('rollback failed');
            if (!options.leaks) { user = ''; role = ''; capability = ''; }
            return { rows: [] };
          }
          if (sql.includes("set_config('app.user_id'")) {
            [user, role] = params;
            return { rows: [] };
          }
          if (sql.includes("current_setting('app.user_id'")) {
            return { rows: [{ user_id: user, role, capability }] };
          }
          if (sql === 'SELECT id,role FROM users WHERE id = $1') {
            return { rows: options.adminMissing ? [] : [{ id: fixture.userAdmin, role: options.adminRole ?? 'admin' }] };
          }
          if (sql === 'SELECT id,publication_status FROM medicines WHERE id = $1') {
            return { rows: options.medicineMissing ? [] : [{ id: fixture.priceProbeMedicineId, publication_status: options.medicineStatus ?? 'published' }] };
          }
          if (sql.includes('FROM pharmacy_memberships')) {
            if (params[1] === fixture.otherStoreId) {
              return { rows: options.foreignMembership ? [{ id: 444 }] : [] };
            }
            return { rows: options.membershipMissing ? [] : [{ id: fixture.partnerMembershipId }] };
          }
          if (sql === 'SELECT id,is_active FROM drugstores WHERE id = $1') {
            return { rows: options.foreignStoreMissing ? [] : [
              { id: fixture.otherStoreId, is_active: options.foreignStoreInactive ? 0 : 1 },
            ] };
          }
          if (sql.startsWith('INSERT INTO inventory')) {
            if (options.insertError &&
                (options.insertError.role === role || !options.insertError.role) &&
                (options.insertError.storeId === undefined || options.insertError.storeId === params[0])) {
              throw Object.assign(new Error(options.insertError.message), { code: options.insertError.code });
            }
            if (role === 'admin') {
              if (options.adminIneffective || (options.foreignAdminIneffective && params[0] === fixture.otherStoreId)) {
                return { rowCount: 0, rows: [] };
              }
              return { rowCount: 1, rows: [{
                id: 77, drugstore_id: params[0],
                medicine_id: fixture.priceProbeMedicineId, price_centavos: options.adminPrice ?? 1000,
              }] };
            }
            if (options.memberInsertAllowed ||
                (options.foreignMemberInsertAllowed && params[0] === fixture.otherStoreId)) {
              return { rowCount: 1, rows: [{ id: 78 }] };
            }
            throw Object.assign(new Error(rlserror.message), { code: rlserror.code });
          }
          throw new Error(`Unexpected query: ${sql}`);
        },
        release(discard) { releases.push(discard); },
      };
    },
  };
}

test('NP-038 own/foreign admin INSERTs succeed and roll back; member INSERTs must receive inventory RLS denials', async () => {
  const pool = recordingPool();
  await assertPartnerInventoryInsertDenied({ pool, fixture });
  const inserts = pool.queries.filter(({ sql }) => sql.startsWith('INSERT INTO inventory'));
  assert.equal(inserts.length, 4);
  assert.deepEqual(inserts.map(({ params }) => params), [
    [fixture.storeId, fixture.priceProbeMedicineId, 1000],
    [fixture.storeId, fixture.priceProbeMedicineId, 1],
    [fixture.otherStoreId, fixture.priceProbeMedicineId, 1000],
    [fixture.otherStoreId, fixture.priceProbeMedicineId, 1000],
  ]);
  assert.deepEqual(pool.releases, [false, false, false, false]);
  assert.equal(pool.queries.filter(({ sql }) => sql === 'ROLLBACK').length, 4);
  assert.equal(pool.queries.some(({ sql }) => sql === 'COMMIT'), false);
});

test('NP-038 rejects a pharmacy-member arbitrary-price INSERT even when rollback succeeds', async () => {
  const pool = recordingPool({ memberInsertAllowed: true });
  await assert.rejects(assertPartnerInventoryInsertDenied({ pool, fixture }), /NP-038 RLS verification failed/);
  assert.deepEqual(pool.releases, [false, false]);
});

test('NP-038 foreign-pharmacy insert must be denied even at the valid price', async () => {
  const pool = recordingPool({ foreignMemberInsertAllowed: true });
  await assert.rejects(assertPartnerInventoryInsertDenied({ pool, fixture }), /NP-038 tenant isolation failed/);
  assert.deepEqual(pool.releases, [false, false, false, false]);
});

test('NP-038 foreign pharmacy must exist, remain active, and have no member authorization', async () => {
  for (const options of [{ foreignStoreMissing: true }, { foreignStoreInactive: true }, { foreignMembership: true }]) {
    const pool = recordingPool(options);
    await assert.rejects(assertPartnerInventoryInsertDenied({ pool, fixture }), /NP-038 foreign INSERT/);
    assert.ok(pool.releases.length >= 3);
    assert.ok(pool.releases.every((discard) => discard === false));
  }
});

test('NP-038 foreign admin insert must be effective; no partner foreign insert after failed control', async () => {
  for (const options of [
    { foreignAdminIneffective: true },
    { insertError: { role: 'admin', storeId: fixture.otherStoreId, code: '42501', message: 'permission denied for inventory' } },
  ]) {
    const pool = recordingPool(options);
    await assert.rejects(assertPartnerInventoryInsertDenied({ pool, fixture }), /NP-038 foreign admin INSERT/);
    assert.deepEqual(pool.releases, [false, false, false]);
  }
});

test('NP-038 foreign insert does not accept wrong-table RLS denial or ordinary permission error', async () => {
  for (const [code, message] of [
    ['42501', 'permission denied for table inventory'],
    ['42501', 'new row violates row-level security policy for table "medicines"'],
    ['23505', 'duplicate key violates unique constraint'],
  ]) {
    const pool = recordingPool({ insertError: { role: 'partner', storeId: fixture.otherStoreId, code, message } });
    await assert.rejects(assertPartnerInventoryInsertDenied({ pool, fixture }));
    assert.deepEqual(pool.releases, [false, false, false, false]);
  }
});

test('NP-038 rejects unrelated SQL errors, including missing privilege and duplicate inventory key', async () => {
  for (const [code, message] of [
    ['23505', 'duplicate key value violates unique constraint inventory_store_medicine_unique'],
    ['23503', 'insert or update on table inventory violates foreign key constraint'],
    ['42501', 'permission denied for table inventory'],
    ['42501', 'new row violates row-level security policy for table medicines'],
    ['42601', 'syntax error'],
  ]) {
    const pool = recordingPool({ insertError: { role: 'partner', code, message } });
    await assert.rejects(assertPartnerInventoryInsertDenied({ pool, fixture }));
    assert.deepEqual(pool.releases, [false, false], `unexpected release ${code} ${message}`);
  }
});

test('NP-038 positive control rejects absent admin, unavailable published medicine, and ineffective admin INSERT', async () => {
  for (const options of [
    { adminMissing: true }, { adminRole: 'customer' }, { medicineMissing: true },
    { medicineStatus: 'draft' }, { adminIneffective: true }, { adminPrice: 1 },
    { insertError: { role: 'admin', code: '42501', message: 'permission denied for table inventory' } },
  ]) {
    const pool = recordingPool(options);
    await assert.rejects(assertPartnerInventoryInsertDenied({ pool, fixture }), /NP-038/);
    assert.equal(pool.queries.some(({ sql, params }) => sql.startsWith('INSERT INTO inventory') && params[2] === 1), false);
    assert.deepEqual(pool.releases, [false]);
  }
});

test('NP-038 cannot pass with absent partner membership; always rolls back', async () => {
  const pool = recordingPool({ membershipMissing: true });
  await assert.rejects(assertPartnerInventoryInsertDenied({ pool, fixture }), /active partner membership/);
  assert.deepEqual(pool.releases, [false, false]);
});

test('NP-038 fails closed on actor transaction context leak or failed rollback', async () => {
  for (const options of [{ rollbackFails: true }, { leaks: true }]) {
    const pool = recordingPool(options);
    await assert.rejects(assertPartnerInventoryInsertDenied({ pool, fixture }));
    assert.deepEqual(pool.releases, [true]);
  }
});

test('NP-038 rejects invalid or duplicated IDs before any database interaction', async () => {
  for (const invalid of [
    { priceProbeMedicineId: fixture.medicineId }, { priceProbeMedicineId: 0 },
    { partnerMembershipId: undefined }, { userAdmin: fixture.userPartner },
    { storeId: '14' }, { otherStoreId: undefined },
    { otherStoreId: fixture.storeId },
  ]) {
    const pool = recordingPool();
    await assert.rejects(assertPartnerInventoryInsertDenied({ pool, fixture: { ...fixture, ...invalid } }), /NP-038 requires/);
    assert.deepEqual(pool.queries, []);
  }
});

test('NP-038 new medicine is committed only as fixture and cleaned by recorded ID in correct order', async () => {
  const [runner, cleanup] = await Promise.all([
    readFile(new URL('../scripts/verify-postgres-security.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/lib/cleanup-rls-fixtures.mjs', import.meta.url), 'utf8'),
  ]);
  const create = runner.indexOf('fixture.priceProbeMedicineId = Number(');
  const commit = runner.indexOf("await migrationClient.query('COMMIT')");
  const probe = runner.indexOf('await assertPartnerInventoryInsertDenied({ pool: appPool, fixture })');
  assert.ok(create >= 0 && create < commit && probe > commit);
  assert.match(cleanup, /\['price_probe_medicine', 'DELETE FROM medicines WHERE id=\$1', fixture\.priceProbeMedicineId\]/);
  const calls = [];
  const fakeMigrator = { async query(sql, params) {
    calls.push({ sql, params });
    return { rowCount: Array.isArray(params[0]) ? params[0].length : 1 };
  } };
  await cleanupSyntheticRlsVerifierFixtures({ migratorPool: fakeMigrator, fixture: {
    ...fixture, userA: 1, userB: 2, orderA: 3, orderB: 4, inventoryId: 5,
    otherInventoryId: 6, otherStoreId: 7,
  }, fixtureCommitted: true });
  const priceProbeDelete = calls.find(({ sql, params }) => sql === 'DELETE FROM medicines WHERE id=$1' && params[0] === fixture.priceProbeMedicineId);
  assert.ok(priceProbeDelete);
  const ownMedDelete = calls.findIndex(({ sql, params }) => sql === 'DELETE FROM medicines WHERE id=$1' && params[0] === fixture.medicineId);
  assert.ok(calls.indexOf(priceProbeDelete) > ownMedDelete);
  const inventoryLast = calls.map(({ sql }) => sql).lastIndexOf('DELETE FROM inventory WHERE id=$1');
  assert.ok(calls.indexOf(priceProbeDelete) > inventoryLast);
});

test('NP-038 reviewed migration currently grants member INSERT through inventory FOR ALL policy', async () => {
  const migration = await readFile(new URL('../migrations/postgres/0002_rls.sql', import.meta.url), 'utf8');
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nearpill_app/);
  assert.match(migration, /CREATE POLICY inventory_write ON inventory FOR ALL TO nearpill_app/);
  assert.match(migration, /pm\.drugstore_id = inventory\.drugstore_id/);
  // Source characterization deliberately records a dangerous possibility.
  // PASS here means the current source shape was found, never that RLS passes.
});
