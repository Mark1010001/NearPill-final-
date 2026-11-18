import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCustomerOrderRlsNegatives } from '../scripts/lib/verify-order-tenant-isolation.mjs';

const fixture = { userA: 101, userB: 102, orderA: 201, orderB: 202, medicineId: 303, storeId: 404, inventoryId: 505, orderItemA: 6201, orderItemB: 6202, paymentA: 7201, paymentB: 7202 };

function recordingPool({ failBegin = false, failRollback = false, failContextReset = false, throwDuringReset = false } = {}) {
  const releases = [];
  const statements = [];
  return {
    releases,
    statements,
    async connect() {
      let actor;
      return {
        async query(sql, params) {
          statements.push(sql);
          if (sql === 'BEGIN') {
            if (failBegin) throw new Error('BEGIN connection failure');
            return { rows: [] };
          }
          if (sql === 'ROLLBACK') {
            if (failRollback) throw new Error('ROLLBACK failed');
            return { rows: [] };
          }
          if (sql.includes("set_config('app.user_id'")) {
            actor = Number(params[0]);
            return { rows: [{}] };
          }
          if (sql.includes("current_setting('app.user_id'")) {
            if (throwDuringReset) throw new Error('connection terminated during reset check');
            return { rows: [failContextReset ? { user_id: String(actor), role: 'customer', capability: 'order_mutation' } : { user_id: '', role: '', capability: '' }] };
          }
          if (sql.startsWith('INSERT INTO audit_logs')) {
            if (Number(params[0]) === actor) return { rows: [], rowCount: 1 };
            const error = new Error('new row violates row-level security policy for table "audit_logs"');
            error.code = '42501';
            throw error;
          }
          if (sql.startsWith('UPDATE audit_logs') || sql.startsWith('DELETE FROM audit_logs')) {
            return { rows: [], rowCount: 0 };
          }
          if (sql.startsWith('SELECT id FROM users')) {
            return { rows: [{ id: actor }] };
          }
          if (sql.startsWith('INSERT INTO users')) {
            const error = new Error('permission denied for table users');
            error.code = '42501';
            throw error;
          }
          if (sql.startsWith('UPDATE users SET role')) {
            const error = new Error('permission denied for column role');
            error.code = '42501';
            throw error;
          }
          if (sql.startsWith('UPDATE users') || sql.startsWith('DELETE FROM users')) {
            return { rows: [], rowCount: 0 };
          }
          if (sql.startsWith('SELECT id,order_id FROM order_drugstores')) {
            const orderId = actor === fixture.userA ? fixture.orderA : fixture.orderB;
            return { rows: [{ id: orderId + 1000, order_id: orderId }] };
          }
          if (sql.startsWith('SELECT id,order_drugstore_id FROM order_items')) {
            const orderId = actor === fixture.userA ? fixture.orderA : fixture.orderB;
            return { rows: [{ id: actor === fixture.userA ? fixture.orderItemA : fixture.orderItemB,
              order_drugstore_id: orderId + 1000 }] };
          }
          if (sql.startsWith('UPDATE order_items SET unit_price_centavos')) {
            return { rows: [], rowCount: 0 };
          }
          if (sql.startsWith('DELETE FROM order_items')) return { rows: [], rowCount: 0 };
          if (sql.startsWith('INSERT INTO order_items')) {
            const error = new Error('new row violates row-level security policy for table "order_items"');
            error.code = '42501';
            throw error;
          }
          if (sql.startsWith('DELETE FROM order_drugstores WHERE id = $1')) return { rows: [], rowCount: 0 };
          if (sql.startsWith('UPDATE order_drugstores SET status')) {
            return { rows: [], rowCount: 0 };
          }
          if (sql.startsWith('SELECT id,order_id FROM payments')) {
            return { rows: [{ id: actor === fixture.userA ? fixture.paymentA : fixture.paymentB,
              order_id: actor === fixture.userA ? fixture.orderA : fixture.orderB }] };
          }
          if (sql.startsWith('SELECT id,drugstore_id,medicine_id FROM inventory')) {
            return { rows: [{ id: fixture.inventoryId, drugstore_id: fixture.storeId, medicine_id: fixture.medicineId }], rowCount: 1 };
          }
          if (sql.startsWith('UPDATE inventory SET') || sql.startsWith('DELETE FROM inventory')) return { rows: [], rowCount: 0 };
          if (sql.startsWith('SELECT id FROM medicines WHERE id = $1')) {
            return { rows: [{ id: fixture.medicineId }], rowCount: 1 };
          }
          if (sql.startsWith('UPDATE medicines SET publication_status')) {
            return { rows: [], rowCount: 0 };
          }
          if (sql.startsWith('DELETE FROM medicines')) return { rows: [], rowCount: 0 };
          if (sql.startsWith('INSERT INTO medicines')) {
            const error = new Error('new row violates row-level security policy for table "medicines"');
            error.code = '42501';
            throw error;
          }
          if (sql.startsWith('INSERT INTO medicine_evidence') ||
              sql.startsWith('INSERT INTO pharmacy_verifications')) {
            const table = sql.startsWith('INSERT INTO medicine_evidence')
              ? 'medicine_evidence' : 'pharmacy_verifications';
            const error = new Error(`new row violates row-level security policy for table "${table}"`);
            error.code = '42501';
            throw error;
          }
          if (sql.startsWith('SELECT id FROM drugstores')) {
            return { rows: [{ id: fixture.storeId }], rowCount: 1 };
          }
          if (sql.startsWith('UPDATE drugstores SET verification_status') ||
              sql.startsWith('DELETE FROM drugstores')) {
            return { rows: [], rowCount: 0 };
          }
          if (sql.startsWith('INSERT INTO pharmacy_memberships')) {
            const error = new Error('new row violates row-level security policy for table "pharmacy_memberships"');
            error.code = '42501';
            throw error;
          }
          if (sql.startsWith('DELETE FROM payments')) return { rows: [], rowCount: 0 };
          if (sql.startsWith('UPDATE payments SET')) return { rows: [], rowCount: 0 };
          if (sql.startsWith('INSERT INTO payments')) {
            const error = new Error('new row violates row-level security policy for table "payments"');
            error.code = '42501';
            throw error;
          }
          if (sql.startsWith('SELECT id FROM orders')) {
            return { rows: [{ id: actor === fixture.userA ? fixture.orderA : fixture.orderB }] };
          }
          if (sql.startsWith('UPDATE orders') || sql.startsWith('DELETE FROM orders')) {
            return { rows: [], rowCount: 0 };
          }
          if (sql.includes('INSERT INTO orders')) {
            const err = new Error('new row violates row-level security policy for table "orders"');
            err.code = '42501';
            throw err;
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        release(destroy) { releases.push(Boolean(destroy)); },
      };
    },
  };
}

test('successful RLS verification returns only cleanly reset connections to the pool', async () => {
  const pool = recordingPool();
  await assertCustomerOrderRlsNegatives({ pool, fixture });
  assert.equal(pool.releases.length, 92);
  assert.deepEqual(pool.releases, Array(92).fill(false));
  assert.equal(pool.statements.filter((sql) => sql === 'ROLLBACK').length, 92);
});

for (const [label, overrides, expected] of [
  ['BEGIN failure', { failBegin: true }, /BEGIN connection failure/],
  ['ROLLBACK failure', { failRollback: true }, /ROLLBACK failed/],
  ['identity context persists after rollback', { failContextReset: true }, /context leaked past ROLLBACK/],
  ['reset inspection fails', { throwDuringReset: true }, /connection terminated during reset check/],
]) {
  test(`RLS verifier destroys the pooled connection when ${label}`, async () => {
    const pool = recordingPool(overrides);
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }), expected);
    assert.deepEqual(pool.releases, [true], 'unsafe connections must never return to the reusable pool');
  });
}
