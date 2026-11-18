/** Packet 0 NP-039: recording-pool contracts ONLY, not deployed Supabase proof. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertPartnerReservedQuantityDenied } from '../scripts/lib/verify-order-tenant-isolation.mjs';

const fixture = Object.freeze({ userAdmin: 51, userPartner: 52, partnerMembershipId: 53, storeId: 54, inventoryId: 55 });

function poolFor({ adminMissing = false, adminWrongRole = false, adminCannotWrite = false,
  adminNoop = false, inactiveMember = false, missingMember = false,
  wrongStore = false, wrongStock = false, reservedAlreadyOne = false,
  partnerCanWrite = false, partnerError, contextLeak = false, rollbackFailure = false,
  malformedPartnerResult = false } = {}) {
  const queries = []; const releases = [];
  let connections = 0;
  return {
    queries, releases, get connections() { return connections; },
    async connect() {
      connections++;
      let actor = '', role = '', capability = '';
      return {
        async query(sql, params = []) {
          queries.push({ sql, params });
          if (sql === 'BEGIN') return { rows: [] };
          if (sql === 'ROLLBACK') {
            if (rollbackFailure) throw new Error('rollback failed');
            if (!contextLeak) actor = role = capability = '';
            return { rows: [] };
          }
          if (sql.includes("set_config('app.user_id'")) {
            [actor, role] = params; capability = '';
            return { rows: [] };
          }
          if (sql.includes("current_setting('app.user_id'")) {
            return { rows: [{ user_id: actor, role, capability }] };
          }
          if (sql.startsWith('SELECT id,role FROM users')) {
            return { rows: adminMissing ? [] : [{ id: fixture.userAdmin, role: adminWrongRole ? 'partner' : 'admin' }] };
          }
          if (sql.startsWith('SELECT id,drugstore_id,is_active FROM pharmacy_memberships')) {
            return { rows: missingMember ? [] : [{ id: fixture.partnerMembershipId,
              drugstore_id: wrongStore ? 1000 : fixture.storeId, is_active: inactiveMember ? 0 : 1 }] };
          }
          if (sql.startsWith('SELECT id,drugstore_id,stock_on_hand,reserved_quantity FROM inventory')) {
            return { rows: [{ id: fixture.inventoryId, drugstore_id: fixture.storeId,
              stock_on_hand: wrongStock ? 2 : 3, reserved_quantity: reservedAlreadyOne ? 1 : 0 }] };
          }
          if (sql.startsWith('UPDATE inventory SET reserved_quantity=')) {
            if (role === 'admin') {
              return adminCannotWrite ? { rows: [], rowCount: 0 } : { rows: [{ id: fixture.inventoryId,
                reserved_quantity: adminNoop ? 0 : 1, stock_on_hand: 3 }], rowCount: 1 };
            }
            if (partnerError) throw Object.assign(new Error(partnerError.message), { code: partnerError.code });
            if (malformedPartnerResult) return { rowCount: 1 };
            return partnerCanWrite ? { rows: [{ id: fixture.inventoryId, reserved_quantity: 1,
              stock_on_hand: 3 }], rowCount: 1 } : { rows: [], rowCount: 0 };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        release(discard) { releases.push(discard); },
      };
    },
  };
}

test('NP-039 admin write parity then partner reserved-quantity denial: independent rollback-only sessions', async () => {
  const pool = poolFor();
  await assertPartnerReservedQuantityDenied({ pool, fixture });
  assert.equal(pool.connections, 2);
  assert.equal(pool.queries.filter(({ sql }) => sql === 'BEGIN').length, 2);
  assert.equal(pool.queries.filter(({ sql }) => sql === 'ROLLBACK').length, 2);
  assert.deepEqual(pool.releases, [false, false]);
  assert.deepEqual(pool.queries.filter(({ sql }) => sql.startsWith('UPDATE inventory SET reserved_quantity='))
    .map(({ params }) => params), [[fixture.inventoryId, 1], [fixture.inventoryId, 1]]);
  assert.deepEqual(pool.queries.filter(({ sql }) => sql.includes("set_config('app.user_id'"))
    .map(({ params }) => params), [[String(fixture.userAdmin), 'admin'], [String(fixture.userPartner), 'partner']]);
  assert.ok(!pool.queries.some(({ sql }) => sql === 'COMMIT'));
});

test('NP-039 rejects a directly writable reservation quantity', async () => {
  const pool = poolFor({ partnerCanWrite: true });
  await assert.rejects(assertPartnerReservedQuantityDenied({ pool, fixture }), /NP-039 RLS verification failed/);
  assert.deepEqual(pool.releases, [false, false]);
});

test('NP-039 rejects broken admin positive controls or invalid inventory state', async () => {
  for (const flag of ['adminMissing', 'adminWrongRole', 'adminCannotWrite', 'adminNoop', 'wrongStock', 'reservedAlreadyOne']) {
    const pool = poolFor({ [flag]: true });
    await assert.rejects(assertPartnerReservedQuantityDenied({ pool, fixture }), /NP-039/, flag);
    assert.equal(pool.connections, 1, flag);
    assert.deepEqual(pool.releases, [false]);
  }
});

test('NP-039 refuses absent/inactive/cross-store partner membership', async () => {
  for (const flag of ['missingMember', 'inactiveMember', 'wrongStore']) {
    const pool = poolFor({ [flag]: true });
    await assert.rejects(assertPartnerReservedQuantityDenied({ pool, fixture }), /NP-039 requires a real active member/, flag);
    assert.deepEqual(pool.releases, [false, false]);
    assert.equal(pool.queries.filter(({ sql }) => sql.startsWith('UPDATE inventory SET reserved_quantity=')).length, 1);
  }
});

test('NP-039 accepts only inventory-specific permissions/RLS denial; unrelated errors fail closed', async () => {
  for (const message of ['permission denied for column reserved_quantity',
    'permission denied for table inventory', 'new row violates row-level security policy for table inventory']) {
    const pool = poolFor({ partnerError: { code: '42501', message } });
    await assertPartnerReservedQuantityDenied({ pool, fixture });
    assert.deepEqual(pool.releases, [false, false]);
  }
  for (const partnerError of [
    { code: '23514', message: 'check constraint violation' },
    { code: '42501', message: 'permission denied for table payments' },
    { code: '42703', message: 'column missing' },
  ]) {
    const pool = poolFor({ partnerError });
    await assert.rejects(assertPartnerReservedQuantityDenied({ pool, fixture }));
    assert.deepEqual(pool.releases, [false, false]);
  }
});

test('NP-039 rejects malformed mutation results and invalid fixture identifiers', async () => {
  const malformed = poolFor({ malformedPartnerResult: true });
  await assert.rejects(assertPartnerReservedQuantityDenied({ pool: malformed, fixture }), /NP-039 RLS verification failed/);
  for (const bad of [
    { userAdmin: fixture.userPartner }, { inventoryId: -1 },
    { partnerMembershipId: '53' }, { storeId: undefined },
  ]) {
    const pool = poolFor();
    await assert.rejects(assertPartnerReservedQuantityDenied({ pool, fixture: { ...fixture, ...bad } }), /NP-039 requires distinct/);
    assert.equal(pool.connections, 0);
  }
});

test('NP-039 discards connections after failed rollback or leaked tenant context', async () => {
  for (const opts of [{ contextLeak: true }, { rollbackFailure: true }]) {
    const pool = poolFor(opts);
    await assert.rejects(assertPartnerReservedQuantityDenied({ pool, fixture }));
    assert.deepEqual(pool.releases, [true]);
  }
});

test('NP-039 risk originates in original FOR ALL policy and order mutation writes reserved_quantity', async () => {
  const migration = await readFile(new URL('../migrations/postgres/0002_rls.sql', import.meta.url), 'utf8');
  const orderRepo = await readFile(new URL('../src/infrastructure/postgres/order-repository.js', import.meta.url), 'utf8');
  assert.match(migration, /CREATE POLICY inventory_write ON inventory FOR ALL TO nearpill_app/);
  assert.match(migration, /pm\.user_id = nearpill\.current_actor_id\(\)/);
  assert.match(orderRepo, /SET reserved_quantity = reserved_quantity \+ \?/);
  assert.match(orderRepo, /INSERT INTO stock_movements/);
});
