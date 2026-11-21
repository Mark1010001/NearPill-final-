/** Packet 0 / NP-041. Recording-pool security characterization, NOT live RLS acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertCustomerReservationDeleteDenied } from '../scripts/lib/verify-order-tenant-isolation.mjs';

const fixture = Object.freeze({ userA: 801, userB: 802, orderA: 803, orderB: 804,
  reservationId: 805, reservationInventoryId: 806, inventoryId: 807 });

function recordingPool({ missingOwnedOrder = false, incorrectOwner = false, missingReservation = false,
  inactiveReservation = false, wrongReservationOrder = false, foreignOrderMissing = false,
  foreignCanRead = false, ownerCanDelete = false, foreignCanDelete = false,
  ownerError = null, foreignError = null, malformedOwnerDeletion = false,
  rollbackFails = false, contextLeaks = false } = {}) {
  const calls = [], releases = [];
  let sessions = 0;
  return {
    calls, releases, get sessions() { return sessions; },
    async connect() {
      sessions++;
      let actor = '', role = '', capability = '';
      return {
        async query(sql, params = []) {
          calls.push({ sql, params, actor, role });
          if (sql === 'BEGIN') return { rows: [] };
          if (sql === 'ROLLBACK') {
            if (rollbackFails) throw Error('rollback failed');
            if (!contextLeaks) actor = role = capability = '';
            return { rows: [] };
          }
          if (sql.includes("set_config('app.user_id'")) {
            [actor, role] = params; capability = '';
            return { rows: [] };
          }
          if (sql.includes("current_setting('app.user_id'")) {
            return { rows: [{ user_id: actor, role, capability }] };
          }
          if (sql.startsWith('SELECT id,user_id,status FROM orders')) {
            if ((actor === String(fixture.userB) && missingOwnedOrder) ||
                (actor === String(fixture.userA) && foreignOrderMissing)) return { rows: [] };
            const id = actor === String(fixture.userB) ? fixture.orderB : fixture.orderA;
            const user_id = incorrectOwner ? fixture.userA : Number(actor);
            return { rows: [{ id, user_id, status: 'reserved' }] };
          }
          if (sql.startsWith('SELECT id,order_id,stock_id,quantity,status FROM reservations')) {
            return { rows: missingReservation ? [] : [{ id: fixture.reservationId,
              order_id: wrongReservationOrder ? fixture.orderA : fixture.orderB,
              stock_id: fixture.reservationInventoryId, quantity: 1,
              status: inactiveReservation ? 'released' : 'active' }] };
          }
          if (sql.startsWith('SELECT id FROM reservations')) {
            return { rows: foreignCanRead ? [{ id: fixture.reservationId }] : [] };
          }
          if (sql.startsWith('DELETE FROM reservations')) {
            const isOwner = actor === String(fixture.userB);
            const failure = isOwner ? ownerError : foreignError;
            if (failure) throw Object.assign(new Error(failure.message), { code: failure.code });
            if (isOwner && malformedOwnerDeletion) return { rowCount: 0 };
            const canDelete = isOwner ? ownerCanDelete : foreignCanDelete;
            return canDelete ? { rowCount: 1, rows: [{ id: fixture.reservationId }] } : { rowCount: 0, rows: [] };
          }
          throw Error(`Unexpected SQL: ${sql}`);
        },
        release(discard) { releases.push(discard); },
      };
    },
  };
}

test('NP-041 owner-visible reservation cannot be deleted; other customer cannot read/delete', async () => {
  const pool = recordingPool();
  await assertCustomerReservationDeleteDenied({ pool, fixture });
  assert.equal(pool.sessions, 2);
  assert.equal(pool.calls.filter(({ sql }) => sql === 'BEGIN').length, 2);
  assert.equal(pool.calls.filter(({ sql }) => sql === 'ROLLBACK').length, 2);
  assert.deepEqual(pool.calls.filter(({ sql }) => sql.startsWith('DELETE FROM reservations')).map(({ actor }) => actor), ['802', '801']);
  assert.deepEqual(pool.releases, [false, false]);
  assert.ok(pool.calls.filter(({ sql }) => sql.includes("set_config('app.user_id'"))
    .every(({ sql }) => sql.includes("set_config('app.capability', '', true)")));
});

test('NP-041 detects direct active-reservation deletion by the owning customer', async () => {
  const pool = recordingPool({ ownerCanDelete: true });
  await assert.rejects(assertCustomerReservationDeleteDenied({ pool, fixture }), /customer can DELETE their own active reservation/);
  assert.deepEqual(pool.releases, [false]);
});

test('NP-041 requires effective owner visibility and correct synthetic ownership', async () => {
  for (const config of [
    { missingOwnedOrder: true }, { incorrectOwner: true }, { missingReservation: true },
    { inactiveReservation: true }, { wrongReservationOrder: true },
  ]) {
    const pool = recordingPool(config);
    await assert.rejects(assertCustomerReservationDeleteDenied({ pool, fixture }), /NP-041 owner control/);
    assert.equal(pool.sessions, 1);
    assert.deepEqual(pool.releases, [false]);
  }
});

test('NP-041 refuses a foreign reservation read, deletion, or missing positive order', async () => {
  for (const [config, message] of [
    [{ foreignCanRead: true }, /unrelated customer can read/],
    [{ foreignCanDelete: true }, /customer can DELETE a foreign/],
    [{ foreignOrderMissing: true }, /foreign control/],
  ]) {
    const pool = recordingPool(config);
    await assert.rejects(assertCustomerReservationDeleteDenied({ pool, fixture }), message);
    assert.deepEqual(pool.releases, [false, false]);
  }
});

test('NP-041 accepts only reservations-scoped permission failures or zero-row denial', async () => {
  for (const failure of [
    { code: '42501', message: 'permission denied for table reservations' },
    { code: '42501', message: 'permission denied for relation reservations' },
  ]) {
    await assertCustomerReservationDeleteDenied({ pool: recordingPool({ ownerError: failure }), fixture });
    await assertCustomerReservationDeleteDenied({ pool: recordingPool({ foreignError: failure }), fixture });
  }
  for (const failure of [
    { code: '42501', message: 'permission denied for table orders' },
    { code: '23503', message: 'foreign key constraint violation' },
    { code: '42P01', message: 'relation reservations does not exist' },
  ]) {
    await assert.rejects(assertCustomerReservationDeleteDenied({ pool: recordingPool({ ownerError: failure }), fixture }));
    await assert.rejects(assertCustomerReservationDeleteDenied({ pool: recordingPool({ foreignError: failure }), fixture }));
  }
  await assert.rejects(assertCustomerReservationDeleteDenied({ pool: recordingPool({ malformedOwnerDeletion: true }), fixture }),
    /customer can DELETE their own active reservation/);
});

test('NP-041 rejects invalid, ambiguous fixture IDs without starting any transaction', async () => {
  for (const change of [{ reservationId: 0 }, { reservationInventoryId: fixture.inventoryId },
    { userA: fixture.userB }, { orderB: '804' }, { orderA: fixture.orderB }]) {
    const pool = recordingPool();
    await assert.rejects(assertCustomerReservationDeleteDenied({ pool, fixture: { ...fixture, ...change } }), /NP-041 requires/);
    assert.equal(pool.sessions, 0);
  }
});

test('NP-041 rejects and discards a connection with unproven transaction cleanup', async () => {
  for (const configuration of [{ rollbackFails: true }, { contextLeaks: true }]) {
    const pool = recordingPool(configuration);
    await assert.rejects(assertCustomerReservationDeleteDenied({ pool, fixture }));
    assert.deepEqual(pool.releases, [true]);
  }
});

test('NP-041 migration uses FOR ALL owner predicate, verifier is wired after partner deletion check', async () => {
  const sql = await readFile(new URL('../migrations/postgres/0006_order_inventory.sql', import.meta.url), 'utf8');
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON reservations, stock_movements TO nearpill_app/);
  assert.match(sql, /CREATE POLICY reservations_app ON reservations FOR ALL TO nearpill_app/);
  assert.match(sql, /o\.id = order_id AND o\.user_id = nearpill\.current_actor_id\(\)/);
  const verifier = await readFile(new URL('../scripts/verify-postgres-security.mjs', import.meta.url), 'utf8');
  assert.match(verifier, /await assertPartnerReservationDeleteDenied\(\{ pool: appPool, fixture \}\)/);
  assert.match(verifier, /await assertCustomerReservationDeleteDenied\(\{ pool: appPool, fixture \}\)/);
});
