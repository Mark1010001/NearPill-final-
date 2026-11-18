/** Packet 0 / NP-040 recording-pool regression only; no live RLS claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertPartnerReservationDeleteDenied } from '../scripts/lib/verify-order-tenant-isolation.mjs';
import { cleanupSyntheticRlsVerifierFixtures } from '../scripts/lib/cleanup-rls-fixtures.mjs';

const fixture = Object.freeze({
  userAdmin: 301, userPartner: 302, partnerMembershipId: 303,
  storeId: 304, inventoryId: 305, orderB: 306,
  reservationId: 307, reservationInventoryId: 308, reservationMedicineId: 309,
  reservationMovementId: 310,
});

function recordingPool({ missingAdmin = false, wrongAdminRole = false, adminDeletionDenied = false,
  adminDeletionNoop = false, inconsistentStock = false, missingMovement = false, inactiveMembership = false,
  missingMembership = false, wrongMembershipStore = false, invisibleReservation = false,
  wrongReservationStatus = false, partnerCanDelete = false, partnerError = null,
  partnerMalformed = false, contextLeak = false, rollbackFails = false } = {}) {
  const calls = [], released = [];
  let sessions = 0;
  return {
    calls, released, get sessions() { return sessions; },
    async connect() {
      sessions++;
      let role = '', actor = '', capability = '';
      return {
        async query(sql, params = []) {
          calls.push({ sql, params, role });
          if (sql === 'BEGIN') return { rows: [] };
          if (sql === 'ROLLBACK') {
            if (rollbackFails) throw new Error('simulated rollback failed');
            if (!contextLeak) role = actor = capability = '';
            return { rows: [] };
          }
          if (sql.includes("set_config('app.user_id'")) {
            [actor, role] = params;
            capability = '';
            return { rows: [] };
          }
          if (sql.includes("current_setting('app.user_id'")) {
            return { rows: [{ user_id: actor, role, capability }] };
          }
          if (sql.startsWith('SELECT id,role FROM users')) {
            return { rows: missingAdmin ? [] : [{ id: fixture.userAdmin, role: wrongAdminRole ? 'partner' : 'admin' }] };
          }
          if (sql.includes('FROM reservations r JOIN inventory i')) {
            return { rows: [{ id: fixture.reservationId, order_id: fixture.orderB,
              inventory_id: fixture.reservationInventoryId, drugstore_id: fixture.storeId,
              quantity: 1, reserved_quantity: inconsistentStock ? 0 : 1,
              status: wrongReservationStatus ? 'released' : 'active' }] };
          }
          if (sql.includes('FROM stock_movements WHERE id=$1')) {
            return { rows: missingMovement ? [] : [{ id: fixture.reservationMovementId,
              inventory_id: fixture.reservationInventoryId, order_id: fixture.orderB,
              movement_type: 'reserve', reserved_delta: 1, stock_on_hand_delta: 0 }] };
          }
          if (sql.startsWith('SELECT id,drugstore_id,is_active FROM pharmacy_memberships')) {
            return { rows: missingMembership ? [] : [{ id: fixture.partnerMembershipId,
              drugstore_id: wrongMembershipStore ? 999 : fixture.storeId,
              is_active: inactiveMembership ? 0 : 1 }] };
          }
          if (sql.startsWith('SELECT id,order_id,inventory_id,status FROM reservations')) {
            return { rows: invisibleReservation ? [] : [{ id: fixture.reservationId,
              order_id: fixture.orderB, inventory_id: fixture.reservationInventoryId,
              status: wrongReservationStatus ? 'released' : 'active' }] };
          }
          if (sql.startsWith('DELETE FROM reservations')) {
            if (role === 'admin') {
              if (adminDeletionDenied) throw Object.assign(new Error('permission denied for table reservations'), { code: '42501' });
              return adminDeletionNoop ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{ id: fixture.reservationId }] };
            }
            if (partnerError) throw Object.assign(new Error(partnerError.message), { code: partnerError.code });
            if (partnerMalformed) return { rowCount: 0 };
            return partnerCanDelete ? { rowCount: 1, rows: [{ id: fixture.reservationId }] } : { rowCount: 0, rows: [] };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        release(discard) { released.push(discard); },
      };
    },
  };
}

test('NP-040 real reservation admin DELETE control, then member denial, both rollback', async () => {
  const pool = recordingPool();
  await assertPartnerReservationDeleteDenied({ pool, fixture });
  assert.equal(pool.sessions, 2);
  assert.equal(pool.calls.filter(({ sql }) => sql === 'BEGIN').length, 2);
  assert.equal(pool.calls.filter(({ sql }) => sql === 'ROLLBACK').length, 2);
  assert.deepEqual(pool.released, [false, false]);
  assert.deepEqual(pool.calls.filter(({ sql }) => sql.startsWith('DELETE FROM reservations')).map((x) => x.role), ['admin', 'partner']);
});

test('NP-040 detects when member can delete their own pharmacy reservation', async () => {
  const pool = recordingPool({ partnerCanDelete: true });
  await assert.rejects(assertPartnerReservationDeleteDenied({ pool, fixture }), /pharmacy member can DELETE/);
  assert.deepEqual(pool.released, [false, false]);
});

test('NP-040 requires a real admin and effective admin DELETE before member probe', async () => {
  for (const config of [{ missingAdmin: true }, { wrongAdminRole: true }, { adminDeletionDenied: true }, { adminDeletionNoop: true }]) {
    const pool = recordingPool(config);
    await assert.rejects(assertPartnerReservationDeleteDenied({ pool, fixture }));
    assert.equal(pool.sessions, 1);
    assert.deepEqual(pool.released, [false]);
  }
});

test('NP-040 refuses inconsistent reserved stock, missing movement, or inactive reservation', async () => {
  for (const config of [{ inconsistentStock: true }, { wrongReservationStatus: true }, { missingMovement: true }]) {
    const pool = recordingPool(config);
    await assert.rejects(assertPartnerReservationDeleteDenied({ pool, fixture }), /real, consistent, active reservation|authentic matching reserve movement/);
    assert.equal(pool.sessions, 1);
    assert.deepEqual(pool.released, [false]);
  }
});

test('NP-040 requires real active member and partner-visible reservation', async () => {
  for (const config of [{ missingMembership: true }, { wrongMembershipStore: true },
    { inactiveMembership: true }, { invisibleReservation: true }]) {
    const pool = recordingPool(config);
    await assert.rejects(assertPartnerReservationDeleteDenied({ pool, fixture }));
    assert.equal(pool.sessions, 2);
    assert.deepEqual(pool.released, [false, false]);
  }
});

test('NP-040 accepts relation-specific 42501 or RLS filtered zero rows only', async () => {
  for (const message of ['permission denied for table reservations',
    'new row violates row-level security policy for table reservations']) {
    const pool = recordingPool({ partnerError: { code: '42501', message } });
    await assertPartnerReservationDeleteDenied({ pool, fixture });
    assert.deepEqual(pool.released, [false, false]);
  }
  for (const error of [{ code: '42501', message: 'permission denied for table orders' },
    { code: '23503', message: 'foreign key violation' },
    { code: '42P01', message: 'relation reservations does not exist' }]) {
    const pool = recordingPool({ partnerError: error });
    await assert.rejects(assertPartnerReservationDeleteDenied({ pool, fixture }));
    assert.deepEqual(pool.released, [false, false]);
  }
  const malformed = recordingPool({ partnerMalformed: true });
  await assert.rejects(assertPartnerReservationDeleteDenied({ pool: malformed, fixture }), /pharmacy member can DELETE/);
});

test('NP-040 rejects invalid or non-independent fixture identifiers without DB calls', async () => {
  for (const variant of [{ reservationId: 0 }, { reservationId: '307' },
    { reservationInventoryId: fixture.inventoryId }, { userPartner: fixture.userAdmin },
    { reservationMovementId: -1 }]) {
    const pool = recordingPool();
    await assert.rejects(assertPartnerReservationDeleteDenied({ pool, fixture: { ...fixture, ...variant } }), /NP-040 requires/);
    assert.equal(pool.sessions, 0);
  }
});

test('NP-040 discards bad sessions following failed rollback or leaked tenant context', async () => {
  for (const config of [{ rollbackFails: true }, { contextLeak: true }]) {
    const pool = recordingPool(config);
    await assert.rejects(assertPartnerReservationDeleteDenied({ pool, fixture }));
    assert.deepEqual(pool.released, [true]);
  }
});

test('NP-040 cleanup validates new IDs and removes dedicated inventory/medicine in dependency order', async () => {
  const calls = [];
  const migratorPool = { async query(sql, params) {
    calls.push({ sql, params });
    return { rowCount: sql.includes('ANY($1::int[])') ? params[0].length : 1 };
  } };
  await cleanupSyntheticRlsVerifierFixtures({ migratorPool, fixture, fixtureCommitted: true });
  assert.ok(calls.findIndex(({ sql }) => sql.startsWith('DELETE FROM orders')) <
    calls.findIndex(({ sql }) => sql === 'DELETE FROM inventory WHERE id=$1'));
  assert.deepEqual(calls.filter(({ sql }) => sql === 'DELETE FROM inventory WHERE id=$1').map(({ params }) => params[0]),
    [fixture.inventoryId, fixture.reservationInventoryId]);
  assert.deepEqual(calls.filter(({ sql }) => sql === 'DELETE FROM medicines WHERE id=$1').map(({ params }) => params[0]),
    [fixture.reservationMedicineId]);
  for (const variant of [{ reservationId: '307' }, { reservationMovementId: -2 },
    { reservationInventoryId: Number.MAX_SAFE_INTEGER + 1 }]) {
    const priorCount = calls.length;
    await assert.rejects(cleanupSyntheticRlsVerifierFixtures({ migratorPool, fixture: { ...fixture, ...variant }, fixtureCommitted: false }), /invalid synthetic/);
    assert.equal(calls.length, priorCount);
  }
});

test('NP-040 reviewed schema has membership-based reservations FOR ALL and app grants', async () => {
  const sql = await readFile(new URL('../migrations/postgres/0006_order_inventory.sql', import.meta.url), 'utf8');
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON reservations, stock_movements TO nearpill_app/);
  assert.match(sql, /CREATE POLICY reservations_app ON reservations FOR ALL TO nearpill_app/);
  assert.match(sql, /pm\.user_id = nearpill\.current_actor_id\(\)/);
  assert.match(sql, /WITH CHECK \(\s*nearpill\.current_actor_role\(\) IN \('admin','system'\)/);
  const verifier = await readFile(new URL('../scripts/verify-postgres-security.mjs', import.meta.url), 'utf8');
  assert.match(verifier, /await assertPartnerReservationDeleteDenied\(\{ pool: appPool, fixture \}\)/);
  assert.match(verifier, /fixture\.reservationId = Number/);
  assert.match(verifier, /INSERT INTO stock_movements/);
});
