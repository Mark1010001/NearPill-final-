import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertCustomerOrderRlsNegatives } from '../scripts/lib/verify-order-tenant-isolation.mjs';
import { loadReviewedMigrationSources } from '../scripts/lib/reviewed-migration-sources.mjs';

const fixture = Object.freeze({ userA: 111, userB: 222, orderA: 333, orderB: 444, medicineId: 555, storeId: 777, inventoryId: 888, orderItemA: 6333, orderItemB: 6444, paymentA: 7333, paymentB: 7444 });

function recordingPool(options = {}) {
  const history = [];
  let acquired = 0;
  let released = 0;
  const pool = {
    history,
    get acquired() { return acquired; },
    get released() { return released; },
    async connect() {
      acquired += 1;
      let userId = null;
      return {
        async query(sql, params = []) {
          history.push({ sql, params });
          if (sql === 'BEGIN') return { rows: [] };
          if (sql === 'ROLLBACK') { if (!options.leak) userId = null; return { rows: [] }; }
          if (sql.includes("set_config('app.user_id'")) {
            userId = Number(params[0]);
            return { rows: [] };
          }
          if (sql.includes("current_setting('app.user_id'")) {
            return { rows: [{ user_id: userId === null ? '' : String(userId), role: userId === null ? '' : 'customer', capability: '' }] };
          }
          const mutationKind = sql.startsWith('UPDATE orders SET status = $2') ? 'ownStatusMutation'
            : sql.startsWith('UPDATE orders SET total_centavos') ? 'ownTotalMutation'
            : sql.startsWith('UPDATE orders SET user_id') ? 'ownershipTransfer'
            : sql.startsWith('UPDATE orders') ? 'orderUpdate'
            : sql.startsWith('DELETE FROM orders') ? 'orderDelete'
            : sql.startsWith('UPDATE users SET name') ? 'userUpdate'
            : sql.startsWith('DELETE FROM users') ? 'userDelete' : null;
          if (mutationKind && options.mutationError?.[mutationKind]) {
            const { code, message } = options.mutationError[mutationKind];
            throw Object.assign(new Error(message), { code });
          }
          const ownOrder = userId === fixture.userA ? fixture.orderA : fixture.orderB;
          const otherOrder = userId === fixture.userA ? fixture.orderB : fixture.orderA;
          if (sql.startsWith('SELECT id FROM users')) {
            return { rows: options.userReadLeak ? [{ id: userId }, { id: userId === fixture.userA ? fixture.userB : fixture.userA }] :
              options.noOwnUser ? [] : [{ id: userId }], rowCount: 1 };
          }
          if (sql.startsWith('SELECT id FROM pharmacies')) {
            return { rows: options.noPublicPharmacy ? [] : [{ id: fixture.storeId }],
              rowCount: options.noPublicPharmacy ? 0 : 1 };
          }
          if (sql.startsWith('SELECT id,pharmacy_id,medicine_id FROM stock')) {
            const rows = options.noVisibleInventory ? [] : [{
              id: fixture.inventoryId,
              pharmacy_id: options.wrongInventoryPharmacy ? 999 : fixture.storeId,
              medicine_id: fixture.medicineId,
            }];
            return { rows, rowCount: rows.length };
          }
          if (sql.startsWith('UPDATE stock SET')) {
            const field = ['stock_on_hand', 'reserved_quantity', 'price_centavos', 'availability'].find((name) => sql.includes(name));
            if (options.inventoryMutationError?.[field]) {
              const { code, message } = options.inventoryMutationError[field];
              throw Object.assign(new Error(message), { code });
            }
            return options.inventoryMutationSucceeds?.[field]
              ? { rows: [{ id: fixture.inventoryId }], rowCount: 1 }
              : { rows: [], rowCount: 0 };
          }
          if (sql.startsWith('DELETE FROM stock WHERE id = $1')) {
            if (options.inventoryDeleteError) {
              const { code, message } = options.inventoryDeleteError;
              throw Object.assign(new Error(message), { code });
            }
            return options.inventoryDeleteSucceeds
              ? { rows: [{ id: fixture.inventoryId }], rowCount: 1 }
              : { rows: [], rowCount: 0 };
          }
          if (sql.startsWith('SELECT id FROM medicines WHERE id = $1')) {
            return { rows: options.noPublishedMedicine ? [] : [{ id: fixture.medicineId }],
              rowCount: options.noPublishedMedicine ? 0 : 1 };
          }
          if (sql.startsWith('UPDATE medicines SET publication_status')) {
            if (options.medicinePublicationError) {
              const { code, message } = options.medicinePublicationError;
              throw Object.assign(new Error(message), { code });
            }
            return options.medicinePublicationUpdateSucceeds
              ? { rows: [{ id: fixture.medicineId }], rowCount: 1 } : { rows: [], rowCount: 0 };
          }
          if (sql.startsWith('DELETE FROM medicines WHERE id = $1')) {
            if (options.medicineDeleteError) {
              const { code, message } = options.medicineDeleteError;
              throw Object.assign(new Error(message), { code });
            }
            return options.medicineDeleteSucceeds
              ? { rows: [{ id: fixture.medicineId }], rowCount: 1 } : { rows: [], rowCount: 0 };
          }
          if (sql.startsWith('INSERT INTO medicines')) {
            if (options.medicineInsertError) {
              const { code, message } = options.medicineInsertError;
              throw Object.assign(new Error(message), { code });
            }
            if (options.medicineInsertSucceeds) return { rows: [{ id: 9999 }], rowCount: 1 };
            throw Object.assign(new Error('new row violates row-level security policy for table "medicines"'), { code: '42501' });
          }
          for (const [prefix, option] of [
            ['INSERT INTO medicine_evidence', 'medicineEvidence'],
            ['INSERT INTO pharmacy_verifications', 'pharmacyEvidence'],
          ]) {
            if (sql.startsWith(prefix)) {
              if (options[`${option}Error`]) {
                const { code, message } = options[`${option}Error`];
                throw Object.assign(new Error(message), { code });
              }
              if (options[`${option}InsertSucceeds`]) return { rows: [{ id: 9999 }], rowCount: 1 };
              const relation = option === 'medicineEvidence' ? 'medicine_evidence' : 'pharmacy_verifications';
              throw Object.assign(new Error(`new row violates row-level security policy for table "${relation}"`), { code: '42501' });
            }
          }
          if (sql.startsWith('UPDATE pharmacies SET verification_status')) {
            if (options.pharmacyUpdateError) {
              const { code, message } = options.pharmacyUpdateError;
              throw Object.assign(new Error(message), { code });
            }
            return options.pharmacyVerificationUpdateSucceeds
              ? { rows: [{ id: fixture.storeId }], rowCount: 1 } : { rows: [], rowCount: 0 };
          }
          if (sql.startsWith('DELETE FROM pharmacies')) {
            if (options.pharmacyDeleteError) {
              const { code, message } = options.pharmacyDeleteError;
              throw Object.assign(new Error(message), { code });
            }
            return options.pharmacyDeleteSucceeds
              ? { rows: [{ id: fixture.storeId }], rowCount: 1 } : { rows: [], rowCount: 0 };
          }
          if (sql.startsWith('INSERT INTO pharmacy_memberships')) {
            if (options.membershipInsertError) {
              const { code, message } = options.membershipInsertError;
              throw Object.assign(new Error(message), { code });
            }
            if (options.membershipInsertSucceeds) return { rows: [{ id: 1234 }], rowCount: 1 };
            throw Object.assign(new Error('new row violates row-level security policy for table "pharmacy_memberships"'), { code: '42501' });
          }
          if (sql.startsWith('INSERT INTO audit_logs')) {
            if (params[0] === userId) {
              if (options.ownAuditInsertError) {
                const { code, message } = options.ownAuditInsertError;
                throw Object.assign(new Error(message), { code });
              }
              return options.noOwnAuditFixture ? { rows: [], rowCount: 0 } :
                { rows: [], rowCount: 1 };
            }
            if (options.foreignAuditInsertError) {
              const { code, message } = options.foreignAuditInsertError;
              throw Object.assign(new Error(message), { code });
            }
            if (options.foreignAuditInsertSucceeds) {
              return { rows: [{ id: 9001 }], rowCount: 1 };
            }
            throw Object.assign(
              new Error('new row violates row-level security policy for table "audit_logs"'),
              { code: '42501' },
            );
          }
          if (sql.startsWith('UPDATE audit_logs SET') || sql.startsWith('DELETE FROM audit_logs')) {
            const operation = sql.startsWith('UPDATE') ? 'UPDATE' : 'DELETE';
            const error = options.auditMutationError?.[operation];
            if (error) throw Object.assign(new Error(error.message), { code: error.code });
            return options.auditMutationSucceeds?.[operation]
              ? { rows: [{ id: params[0] }], rowCount: 1 } : { rows: [], rowCount: 0 };
          }
          if (sql.startsWith('INSERT INTO users')) {
            if (options.privilegedUserInsertError) {
              throw Object.assign(new Error(options.privilegedUserInsertError.message), { code: options.privilegedUserInsertError.code });
            }
            if (options.privilegedUserInsertSucceeds || (options.privilegedUserInsertSucceedsFor && options.privilegedUserInsertSucceedsFor === params[1])) return { rows: [{ id: 777 }], rowCount: 1 };
            throw Object.assign(new Error('permission denied for table users'), { code: '42501' });
          }
          if (sql.startsWith('UPDATE users SET role')) {
            if (options.rolePromotionError) throw Object.assign(new Error(options.rolePromotionError.message), { code: options.rolePromotionError.code });
            return (options.rolePromotionLeak || (options.rolePromotionLeakFor && options.rolePromotionLeakFor === params[1])) ? { rows: [{ id: userId }], rowCount: 1 } : { rows: [], rowCount: 0 };
          }
          if (sql.startsWith('UPDATE users')) {
            return options.userUpdateLeak ? { rows: [{ id: userId === fixture.userA ? fixture.userB : fixture.userA }], rowCount: 1 } :
              { rows: [], rowCount: 0 };
          }
          if (sql.startsWith('DELETE FROM users')) {
            return options.userDeleteLeak ? { rows: [{ id: userId === fixture.userA ? fixture.userB : fixture.userA }], rowCount: 1 } :
              { rows: [], rowCount: 0 };
          }
          if (sql.startsWith('SELECT id,order_id FROM order_pharmacies')) {
            return { rows: options.noOwnChild ? [] : options.childReadLeak
              ? [{ id: ownOrder + 1000, order_id: ownOrder }, { id: otherOrder + 1000, order_id: otherOrder }]
              : [{ id: ownOrder + 1000, order_id: ownOrder }], rowCount: options.noOwnChild ? 0 : 1 };
          }
          if (sql.startsWith('SELECT id,order_pharmacy_id FROM order_items')) {
            const ownItem = userId === fixture.userA ? fixture.orderItemA : fixture.orderItemB;
            const otherItem = userId === fixture.userA ? fixture.orderItemB : fixture.orderItemA;
            const ownChild = ownOrder + 1000;
            return { rows: options.noOwnItem ? [] : options.itemReadLeak
              ? [{ id: ownItem, order_pharmacy_id: ownChild }, { id: otherItem, order_pharmacy_id: otherOrder + 1000 }]
              : [{ id: ownItem, order_pharmacy_id: ownChild }], rowCount: options.noOwnItem ? 0 : 1 };
          }
          if (sql.startsWith('UPDATE order_items SET unit_price_centavos')) {
            if (options.orderItemPriceUpdateError) {
              const { code, message } = options.orderItemPriceUpdateError;
              throw Object.assign(new Error(message), { code });
            }
            if (options.orderItemPriceUpdateSucceeds) return { rows: [{ id: params[0] }], rowCount: 1 };
            return { rows: [], rowCount: 0 };
          }
          if (sql.startsWith('DELETE FROM order_items')) {
            if (options.orderItemDeleteError) {
              const { code, message } = options.orderItemDeleteError;
              throw Object.assign(new Error(message), { code });
            }
            return options.orderItemDeleteSucceeds
              ? { rows: [{ id: params[0] }], rowCount: 1 }
              : { rows: [], rowCount: 0 };
          }
          if (sql.startsWith('INSERT INTO order_items')) {
            if (options.orderItemInsertError) {
              const { code, message } = options.orderItemInsertError;
              throw Object.assign(new Error(message), { code });
            }
            if (options.orderItemInsertSucceeds) return { rows: [{ id: 888 }], rowCount: 1 };
            throw Object.assign(new Error('new row violates row-level security policy for table "order_items"'), { code: '42501' });
          }
          if (sql.startsWith('DELETE FROM order_pharmacies WHERE id = $1')) {
            if (options.childDeleteError) {
              const { code, message } = options.childDeleteError;
              throw Object.assign(new Error(message), { code });
            }
            return options.childDeleteSucceeds
              ? { rows: [{ id: params[0] }], rowCount: 1 }
              : { rows: [], rowCount: 0 };
          }
          if (sql.startsWith('UPDATE order_pharmacies SET status')) {
            if (options.childMutationError) {
              const { code, message } = options.childMutationError;
              throw Object.assign(new Error(message), { code });
            }
            return options.childStatusMutationSucceeds
              ? { rows: [{ id: ownOrder + 1000 }], rowCount: 1 } : { rows: [], rowCount: 0 };
          }
          if (sql.startsWith('SELECT id,order_id FROM payments')) {
            const ownPayment = userId === fixture.userA ? fixture.paymentA : fixture.paymentB;
            const foreignPayment = userId === fixture.userA ? fixture.paymentB : fixture.paymentA;
            return { rows: options.noOwnPayment ? [] : options.paymentReadLeak ?
              [{ id: ownPayment, order_id: ownOrder }, { id: foreignPayment, order_id: otherOrder }] :
              [{ id: ownPayment, order_id: ownOrder }], rowCount: options.noOwnPayment ? 0 : 1 };
          }
          if (sql.startsWith('INSERT INTO payments')) {
            if (options.paymentInsertError) {
              const { code, message } = options.paymentInsertError;
              throw Object.assign(new Error(message), { code });
            }
            if (options.paymentInsertSucceeds) return { rows: [{ id: 9999 }], rowCount: 1 };
            throw Object.assign(new Error('new row violates row-level security policy for table "payments"'), { code: '42501' });
          }
          if (sql.startsWith('DELETE FROM payments')) {
            if (options.paymentDeleteError) {
              const { code, message } = options.paymentDeleteError;
              throw Object.assign(new Error(message), { code });
            }
            return options.paymentDeleteSucceeds
              ? { rows: [{ id: params[0] }], rowCount: 1 }
              : { rows: [], rowCount: 0 };
          }
          if (sql.startsWith('UPDATE payments SET')) {
            const column = sql.includes('payment_status') ? 'payment_status' : sql.includes('order_id') ? 'order_id' : 'amount_centavos';
            const error = options.paymentMutationError?.[column];
            if (error) throw Object.assign(new Error(error.message), { code: error.code });
            return options.paymentMutationSucceeds?.[column] ?
              { rows: [{ id: params[0] }], rowCount: 1 } : { rows: [], rowCount: 0 };
          }
          if (sql.startsWith('SELECT id FROM orders')) {
            return { rows: options.readLeak ? [{ id: ownOrder }, { id: otherOrder }] : options.noOwn ? [] : [{ id: ownOrder }], rowCount: 1 };
          }
          if (sql.startsWith('UPDATE orders SET status = $2')) {
            return options.ownStatusMutationSucceeds ? { rows: [{ id: ownOrder }], rowCount: 1 } : { rows: [], rowCount: 0 };
          }
          if (sql.startsWith('UPDATE orders SET total_centavos')) {
            return options.ownTotalMutationSucceeds
              ? { rows: [{ id: ownOrder }], rowCount: 1 }
              : { rows: [], rowCount: 0 };
          }
          if (sql.startsWith('UPDATE orders SET user_id')) {
            if (options.ownershipTransferError) {
              throw Object.assign(new Error(options.ownershipTransferError.message), { code: options.ownershipTransferError.code });
            }
            return options.ownershipTransferSucceeds ? { rows: [{ id: ownOrder }], rowCount: 1 } : { rows: [], rowCount: 0 };
          }
          if (sql.startsWith('UPDATE orders')) {
            return options.updateLeak ? { rows: [{ id: otherOrder }], rowCount: 1 } : { rows: [], rowCount: 0 };
          }
          if (sql.startsWith('DELETE FROM orders')) {
            return options.deleteLeak ? { rows: [{ id: otherOrder }], rowCount: 1 } : { rows: [], rowCount: 0 };
          }
          if (sql.includes('INSERT INTO orders')) {
            if (options.insertSucceeds) return { rows: [{ id: 999 }], rowCount: 1 };
            throw Object.assign(new Error(options.insertErrorMessage ?? 'new row violates row-level security policy for table \"orders\"'), { code: options.insertErrorCode ?? '42501' });
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        release() { released += 1; },
      };
    },
  };
  return pool;
}

test('both customers: own read, cross-tenant read/update/delete/insert denied using transaction-local identity', async () => {
  const pool = recordingPool();
  await assertCustomerOrderRlsNegatives({ pool, fixture });
  assert.equal(pool.acquired, 90);
  assert.equal(pool.released, 90);
  assert.equal(pool.history.filter((record) => record.sql === 'ROLLBACK').length, 90);
  assert.equal(pool.history.filter((record) => record.sql.startsWith('UPDATE orders SET status')).length, 4);
  assert.deepEqual(pool.history.filter((record) => record.sql.startsWith('UPDATE orders SET total_centavos')).map((r) => r.params), [[333, 1], [444, 1]]);
  assert.deepEqual(pool.history.filter((record) => record.sql.startsWith('UPDATE orders SET user_id')).map((r) => r.params), [[333, 222], [444, 111]]);
  assert.equal(pool.history.filter((record) => record.sql.startsWith('DELETE FROM orders')).length, 2);
  assert.equal(pool.history.filter((record) => record.sql.includes('INSERT INTO orders')).length, 2);
  assert.deepEqual(pool.history.filter((record) => record.sql.startsWith('UPDATE orders SET status = status')).map((r) => r.params), [[444], [333]]);
  assert.deepEqual(pool.history.filter((record) => record.sql.startsWith('UPDATE orders SET status = $2')).map((r) => r.params), [[333, 'completed'], [444, 'completed']]);
  assert.deepEqual(pool.history.filter((record) => record.sql.startsWith('DELETE FROM orders')).map((r) => r.params), [[444], [333]]);
  assert.deepEqual(pool.history.filter((record) => record.sql.startsWith('DELETE FROM order_items')).map((r) => r.params), [[6333], [6444]]);
  assert.deepEqual(pool.history.filter((record) => record.sql.startsWith('DELETE FROM stock')).map((r) => r.params), [[888], [888]]);
  assert.equal(pool.history.filter((record) => record.sql.includes("set_config('app.user_id'")).length, 90);
  assert.equal(pool.history.filter((record) => record.sql.includes("current_setting('app.user_id'")).length, 90);
  assert.equal(pool.history.filter((record) => record.sql.startsWith('SELECT id,order_id FROM order_pharmacies')).length, 2);
  assert.deepEqual(pool.history.filter((record) => record.sql.startsWith('UPDATE order_pharmacies SET status')).map((r) => r.params), [[333, 'completed'], [444, 'completed']]);
  assert.deepEqual(pool.history.filter((record) => record.sql.startsWith('DELETE FROM order_pharmacies')).map((r) => r.params), [[1333], [1444]]);
  assert.deepEqual(pool.history.filter((record) => record.sql.startsWith('INSERT INTO order_items')).map((r) => r.params),
    [[fixture.orderA + 1000, fixture.medicineId], [fixture.orderB + 1000, fixture.medicineId]]);
  assert.equal(pool.history.filter((record) => record.sql.startsWith('SELECT id FROM users')).length, 2);
  assert.equal(pool.history.filter((record) => record.sql.startsWith('UPDATE users SET name')).length, 2);
  assert.equal(pool.history.filter((record) => record.sql.startsWith('UPDATE users SET role')).length, 4);
  assert.deepEqual(pool.history.filter((record) => record.sql.startsWith('UPDATE users SET role')).map((r) => r.params), [[111, 'admin'], [111, 'partner'], [222, 'admin'], [222, 'partner']]);
  assert.deepEqual(pool.history.filter(({ sql }) => sql.startsWith('INSERT INTO pharmacy_memberships')).map(({ params }) => params),
    [[fixture.userA, fixture.storeId], [fixture.userB, fixture.storeId]]);
  assert.deepEqual(pool.history.filter(({ sql }) => sql.startsWith('INSERT INTO pharmacy_verifications'))
    .map(({ params }) => params[0]), [fixture.storeId, fixture.storeId]);
  assert.deepEqual(pool.history.filter(({ sql, params }) => sql.startsWith('INSERT INTO audit_logs') &&
    params[1] === 'RLS_FOREIGN_ATTRIBUTION_PROBE')
    .map(({ params }) => params), [
      [fixture.userB, 'RLS_FOREIGN_ATTRIBUTION_PROBE', 'uncommitted synthetic fixture'],
      [fixture.userA, 'RLS_FOREIGN_ATTRIBUTION_PROBE', 'uncommitted synthetic fixture'],
    ]);
  assert.equal(pool.history.filter((record) => record.sql.startsWith('INSERT INTO users')).length, 4);
  assert.ok(pool.history.filter((record) => record.sql.startsWith('INSERT INTO users')).every((r) =>
    r.params.length === 2 && r.params[0].endsWith('@example.test') &&
    ['admin', 'partner'].includes(r.params[1]) && r.sql.includes('RETURNING id')));
  assert.equal(pool.history.filter((record) => record.sql.startsWith('DELETE FROM users')).length, 2);
  assert.deepEqual(pool.history.filter((record) => record.sql.startsWith('DELETE FROM users')).map((r) => r.params), [[222], [111]]);
});

test('published OTC medicine must be visible before customer publication-security probes', async () => {
  const pool = recordingPool({ noPublishedMedicine: true });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
    /published synthetic medicine is not visible/);
  assert.equal(pool.acquired, pool.released);
});

test('customers cannot retire the authoritative published OTC catalog', async () => {
  const pool = recordingPool({ medicinePublicationUpdateSucceeds: true });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
    /customer can change published medicine publication_status/);
  assert.deepEqual(pool.history.filter(({ sql }) => sql.startsWith('UPDATE medicines SET publication_status'))
    .map(({ params }) => params), [[fixture.medicineId, 'retired']]);
  assert.equal(pool.acquired, pool.released);
});

test('published OTC catalog probe rejects unrelated permission or schema errors', async () => {
  await assertCustomerOrderRlsNegatives({ pool: recordingPool({ medicinePublicationError: {
    code: '42501', message: 'permission denied for table medicines',
  } }), fixture });
  for (const error of [
    { code: '42501', message: 'permission denied for table payments' },
    { code: '42501', message: 'new row violates row-level security policy for table users' },
    { code: '23514', message: 'invalid medicine publication status' },
  ]) {
    const pool = recordingPool({ medicinePublicationError: error });
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
      (caught) => caught.code === error.code && caught.message === error.message);
    assert.equal(pool.acquired, pool.released);
  }
});

test('published OTC catalog cannot be deleted by a customer', async () => {
  const pool = recordingPool({ medicineDeleteSucceeds: true });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
    /customer can DELETE published medicine/);
  assert.deepEqual(pool.history.filter(({ sql }) => sql.startsWith('DELETE FROM medicines')).map(({ params }) => params),
    [[fixture.medicineId]]);
  assert.equal(pool.acquired, pool.released);
});

test('customer cannot forge a published OTC catalog entry', async () => {
  const pool = recordingPool({ medicineInsertSucceeds: true });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
    /customer can INSERT published medicine/);
  const insert = pool.history.find(({ sql }) => sql.startsWith('INSERT INTO medicines'));
  assert.ok(insert?.sql.includes('publication_status') && insert.sql.includes('RETURNING id'));
  assert.equal(insert?.params[0], 'published');
  assert.equal(pool.acquired, pool.released);
});

test('catalog INSERT/DELETE negatives distinguish scoped denials from unrelated errors', async () => {
  await assertCustomerOrderRlsNegatives({ pool: recordingPool({ medicineDeleteError: {
    code: '42501', message: 'permission denied for table medicines',
  } }), fixture });
  await assertCustomerOrderRlsNegatives({ pool: recordingPool({ medicineInsertError: {
    code: '42501', message: 'new row violates row-level security policy for table medicines',
  } }), fixture });
  for (const [option, errors] of [
    ['medicineDeleteError', [
      { code: '42501', message: 'permission denied for table orders' },
      { code: '23503', message: 'medicine is referenced by inventory' },
    ]],
    ['medicineInsertError', [
      { code: '42501', message: 'permission denied for table medicines' },
      { code: '42501', message: 'new row violates row-level security policy for table payments' },
      { code: '23514', message: 'violates medicine CHECK constraint' },
    ]],
  ]) {
    for (const error of errors) {
      const pool = recordingPool({ [option]: error });
      await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
        (caught) => caught.code === error.code && caught.message === error.message);
      assert.equal(pool.acquired, pool.released);
    }
  }
});

test('ordinary customers cannot forge verified pharmacy evidence (medicine_evidence was removed by 0053)', async () => {
  for (const [option, relation] of [
    ['pharmacyEvidenceInsertSucceeds', 'pharmacy_verifications'],
  ]) {
    const pool = recordingPool({ [option]: true });
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
      new RegExp(`customer can INSERT verified pharmacy evidence`));
    assert.ok(pool.history.some(({ sql }) => sql.startsWith(`INSERT INTO ${relation}`)));
    assert.equal(pool.acquired, pool.released);
  }
});

test('pharmacy-verification INSERT probes reject unrelated permission or constraint failures', async () => {
  for (const option of ['pharmacyEvidenceError']) {
    for (const error of [
      { code: '42501', message: 'new row violates row-level security policy for table payments' },
      { code: '42501', message: 'permission denied for table pharmacy_verifications' },
      { code: '23503', message: 'foreign key violation' },
    ]) {
      const pool = recordingPool({ [option]: error });
      await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
        (caught) => caught.code === error.code && caught.message === error.message);
      assert.equal(pool.acquired, pool.released);
    }
  }
});

test('public verified pharmacy must exist before customer pharmacy-write negatives', async () => {
  const pool = recordingPool({ noPublicPharmacy: true });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
    /public synthetic pharmacy is not visible/);
  assert.equal(pool.acquired, pool.released);
});

test('customers cannot forge pharmacy verification status or DELETE a verified pharmacy', async () => {
  for (const [option, expected] of [
    ['pharmacyVerificationUpdateSucceeds', /customer can alter verified pharmacy status/],
    ['pharmacyDeleteSucceeds', /customer can DELETE verified pharmacy/],
  ]) {
    const pool = recordingPool({ [option]: true });
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }), expected);
    assert.equal(pool.acquired, pool.released);
  }
});

test('pharmacy-write verifier rejects unrelated SQL errors instead of counting them as policy denials', async () => {
  for (const [option, statement] of [
    ['pharmacyUpdateError', 'UPDATE pharmacies SET verification_status'],
    ['pharmacyDeleteError', 'DELETE FROM pharmacies'],
  ]) {
    const pool = recordingPool({ [option]: { code: '42501', message: 'permission denied for table users' } });
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
      (error) => error.code === '42501' && /table users/.test(error.message));
    assert.ok(pool.history.some(({ sql }) => sql.startsWith(statement)));
    assert.equal(pool.acquired, pool.released);
  }
});

test('customer cannot self-enroll as pharmacy manager by inserting a membership', async () => {
  const pool = recordingPool({ membershipInsertSucceeds: true });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
    /customer can create their own pharmacy manager membership/);
  assert.deepEqual(pool.history.filter(({ sql }) => sql.startsWith('INSERT INTO pharmacy_memberships')).map(({ params }) => params),
    [[fixture.userA, fixture.storeId]]);
  assert.equal(pool.acquired, pool.released);
  assert.equal(pool.history.filter(({ sql }) => sql === 'ROLLBACK').length, pool.acquired);
});

test('membership self-enrollment probe refuses unrelated permissions and constraint errors', async () => {
  await assertCustomerOrderRlsNegatives({ pool: recordingPool({ membershipInsertError: {
    code: '42501', message: 'new row violates row-level security policy for table "pharmacy_memberships"',
  } }), fixture });
  for (const error of [
    { code: '42501', message: 'new row violates row-level security policy for table "users"' },
    { code: '42501', message: 'permission denied for table pharmacy_memberships' },
    { code: '23505', message: 'duplicate membership' },
  ]) {
    const pool = recordingPool({ membershipInsertError: error });
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
      (caught) => caught.code === error.code && caught.message === error.message);
    assert.equal(pool.acquired, pool.released);
  }
});

test('customer cannot bypass order transitions by setting own reserved order to completed', async () => {
  const pool = recordingPool({ ownStatusMutationSucceeds: true });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
    /customer can advance own order status directly/);
  assert.ok(pool.history.some(({ sql, params }) =>
    sql.startsWith('UPDATE orders SET status = $2') && params[0] === fixture.orderA && params[1] === 'completed'));
  assert.equal(pool.released, pool.acquired);
});

test('owned-order status probe accepts only an orders/status-specific permission denial', async () => {
  await assertCustomerOrderRlsNegatives({ pool: recordingPool({ mutationError: {
    ownStatusMutation: { code: '42501', message: 'permission denied for column status' },
  } }), fixture });
  for (const error of [
    { code: '42501', message: 'permission denied for table payments' },
    { code: '42501', message: 'new row violates row-level security policy for table users' },
    { code: '23514', message: 'invalid status constraint' },
  ]) {
    const pool = recordingPool({ mutationError: { ownStatusMutation: error } });
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
      (caught) => caught.code === error.code && caught.message === error.message);
    assert.equal(pool.released, pool.acquired);
  }
});

test('customer cannot directly replace an owned order authoritative total in centavos', async () => {
  const pool = recordingPool({ ownTotalMutationSucceeds: true });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
    /customer can alter own order authoritative total_centavos/);
  assert.ok(pool.history.some(({ sql, params }) =>
    sql.startsWith('UPDATE orders SET total_centavos') &&
    params[0] === fixture.orderA && params[1] === 1));
  assert.equal(pool.released, pool.acquired);
});

test('customer total mutation probe fails closed on unrelated database errors', async () => {
  await assertCustomerOrderRlsNegatives({ pool: recordingPool({
    mutationError: { ownTotalMutation: { code: '42501', message: 'permission denied for column total_centavos' } },
  }), fixture });
  for (const error of [
    { code: '42501', message: 'permission denied for table unrelated' },
    { code: '23514', message: 'check constraint violation' },
    { code: '42501', message: 'permission denied for column role' },
  ]) {
    const pool = recordingPool({ mutationError: { ownTotalMutation: error } });
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
      (caught) => caught.code === error.code && caught.message === error.message);
    assert.equal(pool.released, pool.acquired);
  }
});

test('NP-035: customer cannot delete an owned order-line snapshot outside the checkout state machine', async () => {
  const pool = recordingPool({ orderItemDeleteSucceeds: true });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
    /customer can DELETE own order-line snapshot/);
  assert.deepEqual(pool.history.filter(({ sql }) => sql.startsWith('DELETE FROM order_items')).map(({ params }) => params),
    [[fixture.orderItemA]]);
  assert.equal(pool.released, pool.acquired);
});

test('NP-035: owned order-line DELETE requires a relevant permission denial, never unrelated errors', async () => {
  await assertCustomerOrderRlsNegatives({ pool: recordingPool({ orderItemDeleteError: {
    code: '42501', message: 'permission denied for table order_items',
  } }), fixture });
  for (const error of [
    { code: '42501', message: 'permission denied for table payments' },
    { code: '42501', message: 'new row violates row-level security policy for table orders' },
    { code: '23503', message: 'foreign key violation' },
  ]) {
    const pool = recordingPool({ orderItemDeleteError: error });
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
      (caught) => caught.code === error.code && caught.message === error.message);
    assert.equal(pool.released, pool.acquired);
  }
});

test('customer must not transfer an owned order to another customer through orders.user_id', async () => {
  const pool = recordingPool({ ownershipTransferSucceeds: true });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
    /customer can transfer own order to another customer/);
  assert.ok(pool.history.some(({ sql, params }) =>
    sql.startsWith('UPDATE orders SET user_id') && params[0] === fixture.orderA && params[1] === fixture.userB));
  assert.equal(pool.released, pool.acquired);
});

test('ownership transfer only accepts orders-scoped RLS denial, never unrelated errors', async () => {
  await assertCustomerOrderRlsNegatives({
    pool: recordingPool({ ownershipTransferError: {
      code: '42501', message: 'new row violates row-level security policy for table "orders"',
    } }), fixture,
  });
  for (const error of [
    { code: '42501', message: 'new row violates row-level security policy for table "users"' },
    { code: '42501', message: 'permission denied for table orders' },
    { code: '23503', message: 'foreign key violation' },
  ]) {
    const pool = recordingPool({ ownershipTransferError: error });
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
      (caught) => caught.code === error.code && caught.message === error.message);
    assert.equal(pool.released, pool.acquired);
  }
});

test('cross-customer writes accept explicit table/column permission denials without bypassing rollback checks', async () => {
  const pool = recordingPool({ mutationError: {
    orderUpdate: { code: '42501', message: 'permission denied for table orders' },
    orderDelete: { code: '42501', message: 'permission denied for table orders' },
    userUpdate: { code: '42501', message: 'permission denied for column name' },
    userDelete: { code: '42501', message: 'permission denied for table users' },
  } });
  await assertCustomerOrderRlsNegatives({ pool, fixture });
  assert.equal(pool.history.filter((r) => r.sql === 'ROLLBACK').length, 90);
  assert.equal(pool.released, 90);
});

test('cross-customer write denial must not accept wrong-table or unrelated SQLSTATE 42501 errors', async () => {
  for (const mutationKind of ['orderUpdate', 'orderDelete', 'userUpdate', 'userDelete']) {
    const pool = recordingPool({ mutationError: {
      [mutationKind]: { code: '42501', message: 'permission denied for table unrelated' },
    } });
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }), /permission denied for table unrelated/);
    assert.equal(pool.released, pool.acquired);
  }
});

test('cross-customer write denial must not accept constraint failures or generic permission errors', async () => {
  for (const mutationKind of ['orderUpdate', 'orderDelete', 'userUpdate', 'userDelete']) {
    for (const rejectedError of [
      { code: '23503', message: 'foreign key constraint failed' },
      { code: '42501', message: 'permission denied to connect' },
    ]) {
      const pool = recordingPool({ mutationError: { [mutationKind]: rejectedError } });
      await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
        (err) => err.code === rejectedError.code && err.message === rejectedError.message);
      assert.equal(pool.released, pool.acquired);
    }
  }
});

test('NP-031: refuses another customer user-row visibility, not only order visibility', async () => {
  const pool = recordingPool({ userReadLeak: true });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }), /customer can read another customer user/);
  assert.equal(pool.released, 27);
});

test('NP-031: refuses missing own-user visibility so an all-deny policy cannot appear accepted', async () => {
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool: recordingPool({ noOwnUser: true }), fixture }),
    /cannot read own user/);
});

test('NP-031: refuses cross-customer user UPDATE even when order RLS is correct', async () => {
  const pool = recordingPool({ userUpdateLeak: true });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }), /customer can UPDATE another customer user/);
  assert.equal(pool.released, 28);
});

test('NP-031: refuses cross-customer user DELETE even when user reads and updates are isolated', async () => {
  const pool = recordingPool({ userDeleteLeak: true });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }), /customer can DELETE another customer user/);
  assert.equal(pool.released, 42);
  assert.equal(pool.history.filter((r) => r.sql === 'ROLLBACK').length, 42);
});

test('NP-031: refuses customer INSERT of a new admin user and rolls back', async () => {
  const pool = recordingPool({ privilegedUserInsertSucceeds: true });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }), /customer can INSERT an admin user/);
  assert.equal(pool.history.filter((r) => r.sql.startsWith('INSERT INTO users')).length, 1);
  assert.equal(pool.history.filter((r) => r.sql === 'ROLLBACK').length, 40);
});

test('NP-031: admin-user INSERT denial must be explicit, not a constraint or connection error', async () => {
  await assertCustomerOrderRlsNegatives({ pool: recordingPool({ privilegedUserInsertError: { code: '42501', message: 'new row violates row-level security policy for table users' } }), fixture });
  await assert.rejects(
    assertCustomerOrderRlsNegatives({ pool: recordingPool({ privilegedUserInsertError: { code: '23505', message: 'duplicate key value' } }), fixture }),
    (err) => err.code === '23505',
  );
  await assert.rejects(
    assertCustomerOrderRlsNegatives({ pool: recordingPool({ privilegedUserInsertError: { code: '42501', message: 'database connection lost' } }), fixture }),
    /database connection lost/,
  );
});

test('NP-031: refuses self-promotion to admin under a customer transaction', async () => {
  const pool = recordingPool({ rolePromotionLeak: true });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }), /customer can elevate own user role/);
  assert.equal(pool.history.filter((r) => r.sql.startsWith('UPDATE users SET role')).length, 1);
  assert.equal(pool.history.filter((r) => r.sql === 'ROLLBACK').length, 38);
});

test('NP-031: only explicit permission/RLS denials can satisfy the self-promotion probe', async () => {
  await assertCustomerOrderRlsNegatives({ pool: recordingPool({ rolePromotionError: { code: '42501', message: 'permission denied for column role' } }), fixture });
  await assert.rejects(
    assertCustomerOrderRlsNegatives({ pool: recordingPool({ rolePromotionError: { code: '23514', message: 'check constraint failed' } }), fixture }),
    (err) => err.code === '23514',
  );
  await assert.rejects(
    assertCustomerOrderRlsNegatives({ pool: recordingPool({ rolePromotionError: { code: '42501', message: 'failed to reach database' } }), fixture }),
    /failed to reach database/,
  );
});

test('NP-031: self-role UPDATE must reject an unrelated 42501 permission/RLS denial', async () => {
  for (const message of [
    'permission denied for table unrelated',
    'permission denied for column email',
    'new row violates row-level security policy for table orders',
  ]) {
    const pool = recordingPool({ rolePromotionError: { code: '42501', message } });
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
      (error) => error.code === '42501' && error.message === message);
    assert.equal(pool.released, pool.acquired);
  }
});

test('NP-031: admin-user INSERT must reject an unrelated 42501 denial but recognize users role-column denial', async () => {
  for (const message of [
    'permission denied for table unrelated',
    'permission denied for column email',
    'new row violates row-level security policy for table orders',
  ]) {
    const pool = recordingPool({ privilegedUserInsertError: { code: '42501', message } });
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
      (error) => error.code === '42501' && error.message === message);
    assert.equal(pool.released, pool.acquired);
  }
  await assertCustomerOrderRlsNegatives({
    pool: recordingPool({ privilegedUserInsertError: { code: '42501', message: 'permission denied for column role' } }),
    fixture,
  });
});

test('refuses cross-tenant visibility even if expected own order is visible', async () => {
  const pool = recordingPool({ readLeak: true });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }), /can read another customer order/);
  assert.equal(pool.released, 1);
  assert.equal(pool.history.filter((r) => r.sql === 'ROLLBACK').length, 1);
});

test('refuses missing own-order visibility (avoids vacuous denial)', async () => {
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool: recordingPool({ noOwn: true }), fixture }), /cannot read own order/);
});

test('refuses a successful cross-customer UPDATE and rolls back', async () => {
  const pool = recordingPool({ updateLeak: true });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }), /can UPDATE another customer order/);
  assert.equal(pool.released, 5);
  assert.equal(pool.history.filter((r) => r.sql === 'ROLLBACK').length, 5);
});

test('refuses a successful cross-customer DELETE and rolls back', async () => {
  const pool = recordingPool({ deleteLeak: true });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }), /can DELETE another customer order/);
  assert.equal(pool.released, 6);
  assert.equal(pool.history.filter((r) => r.sql === 'ROLLBACK').length, 6);
});

test('order INSERT must not mistake unrelated RLS or generic 42501 failures for orders policy enforcement', async () => {
  for (const message of [
    'new row violates row-level security policy for table "users"',
    'new row violates row-level security policy for table stock',
    'row-level security policy denied access',
    'permission denied for table orders',
  ]) {
    const pool = recordingPool({ insertErrorMessage: message });
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
      (error) => error.code === '42501' && error.message === message);
    assert.equal(pool.released, pool.acquired);
  }
  // Quoted and unquoted PostgreSQL relation names are acceptable only for orders.
  await assertCustomerOrderRlsNegatives({
    pool: recordingPool({ insertErrorMessage: 'new row violates row-level security policy for table orders' }),
    fixture,
  });
});

test('requires SQLSTATE 42501 when PostgreSQL rejects a cross-customer INSERT', async () => {
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool: recordingPool({ insertSucceeds: true }), fixture }), /can INSERT an order/);
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool: recordingPool({ insertErrorCode: '23505' }), fixture }), (error) => error.code === '23505');
  // SQLSTATE 42501 also covers missing SQL grants. A missing INSERT grant must
  // NOT masquerade as evidence that the row-level policy rejected the row.
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool: recordingPool({ insertErrorMessage: 'permission denied for table orders' }), fixture }), (error) => error.code === '42501' && /permission denied/.test(error.message));
});

test('refuses transaction-local actor/capability state leaking after ROLLBACK', async () => {
  const pool = recordingPool({ leak: true });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }), /context leaked/);
  assert.equal(pool.released, 1);
});

test('rejects incomplete, reused, or non-synthetic fixture identities before database connection', async () => {
  const pool = recordingPool();
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture: { ...fixture, userA: '111' } }), /synthetic userA/);
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture: { ...fixture, userA: fixture.userB } }), /distinct synthetic/);
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture: { ...fixture, orderB: -1 } }), /synthetic orderB/);
  assert.equal(pool.acquired, 0);
});


test('the canonical live verifier runs negative write cases after approved-target and live-role preflight', async () => {
  const source = await readFile(new URL('../scripts/verify-postgres-security.mjs', import.meta.url), 'utf8');
  const target = source.indexOf('assertApprovedFixtureTarget(process.env)');
  const liveRoles = source.indexOf('await assertSafeLiveFixtureConnections(');
  const negative = source.indexOf('await assertCustomerOrderRlsNegatives({ pool: appPool, fixture })');
  assert.ok(target >= 0 && liveRoles > target && negative > liveRoles,
    'live RLS negatives must run only after owner-approved fixture and actual-role checks');
});

// 'partner' is also an elevated role in the actual users table. Tests must
// catch it independently of admin, including when admin probes are denied.
test('NP-031: rejects self-promotion to partner even if admin escalation is denied', async () => {
  const pool = recordingPool({ rolePromotionLeakFor: 'partner' });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
    /customer can elevate own user role to partner/);
  assert.ok(pool.history.some(({ sql, params }) => sql.startsWith('UPDATE users SET role') && params[1] === 'partner'));
  assert.equal(pool.released, pool.acquired);
});

test('NP-031: rejects INSERT of partner user even if admin user creation is denied', async () => {
  const pool = recordingPool({ privilegedUserInsertSucceedsFor: 'partner' });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
    /customer can INSERT a partner user/);
  assert.ok(pool.history.some(({ sql, params }) => sql.startsWith('INSERT INTO users') && params[1] === 'partner'));
  assert.equal(pool.released, pool.acquired);
});


test('NP-034: customer may not advance an owned pharmacy-order status directly', async () => {
  const pool = recordingPool({ childStatusMutationSucceeds: true });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
    /customer can advance own pharmacy-order status directly/);
  assert.ok(pool.history.some(({ sql, params }) =>
    sql.startsWith('UPDATE order_pharmacies SET status') && params[0] === fixture.orderA && params[1] === 'completed'));
  assert.equal(pool.released, pool.acquired);
});

test('NP-034: child-order status probe refuses missing own fixture or irrelevant PostgreSQL denial', async () => {
  await assert.rejects(assertCustomerOrderRlsNegatives({
    pool: recordingPool({ noOwnChild: true }), fixture,
  }), /missing synthetic pharmacy-order row/);
  await assertCustomerOrderRlsNegatives({
    pool: recordingPool({ childMutationError: { code: '42501', message: 'permission denied for table order_pharmacies' } }), fixture,
  });
  for (const error of [
    { code: '42501', message: 'permission denied for table payments' },
    { code: '42501', message: 'new row violates row-level security policy for table orders' },
    { code: '23514', message: 'invalid order status constraint' },
  ]) {
    const pool = recordingPool({ childMutationError: error });
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
      (caught) => caught.code === error.code && caught.message === error.message);
    assert.equal(pool.released, pool.acquired);
  }
});

// NP-042: deleting an owned pharmacy-order child can cascade the immutable
// order lines. The fixture has a visible owned child; the negative cannot pass
// merely because the row does not exist or belongs to another customer.
test('NP-042: customer cannot DELETE own existing pharmacy-order child', async () => {
  const pool = recordingPool({ childDeleteSucceeds: true });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
    /NP-042 RLS verification failed: customer can DELETE own pharmacy-order child/);
  assert.deepEqual(pool.history.filter(({ sql }) => sql.startsWith('DELETE FROM order_pharmacies'))
    .map(({ params }) => params), [[1333]]);
  assert.equal(pool.released, pool.acquired);
  assert.equal(pool.history.filter(({ sql }) => sql === 'ROLLBACK').length, pool.acquired);
});

test('NP-042: a child-scoped 42501 or zero affected rows denies deletion; unrelated errors fail closed', async () => {
  await assertCustomerOrderRlsNegatives({ pool: recordingPool({ childDeleteError: {
    code: '42501', message: 'permission denied for table order_pharmacies',
  } }), fixture });
  for (const error of [
    { code: '42501', message: 'permission denied for table orders' },
    { code: '23503', message: 'foreign key constraint violation' },
    { code: '42P01', message: 'relation order_pharmacies does not exist' },
  ]) {
    const pool = recordingPool({ childDeleteError: error });
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
      (caught) => caught.code === error.code && caught.message === error.message);
    assert.equal(pool.released, pool.acquired);
  }
});

test('NP-042: effective reviewed migrations retire the old FOR ALL child policy before testing DELETE', async () => {
  // Do not attribute the policy from 0002 to the FINAL deployed schema:
  // 0004 drops it and installs operation-specific policies. This is a
  // source-order assertion, not a substitute for live RLS acceptance.
  const migrations = await loadReviewedMigrationSources(new URL('../migrations/postgres/', import.meta.url));
  const first = migrations.find(({ filename }) => filename === '0002_rls.sql');
  const replacement = migrations.find(({ filename }) => filename === '0004_identity_security.sql');
  assert.ok(first && replacement);
  assert.match(first.sql, /CREATE POLICY order_drugstores_access ON order_drugstores FOR ALL TO nearpill_app/);
  assert.match(replacement.sql, /DROP POLICY IF EXISTS order_drugstores_access ON order_drugstores/);
  for (const operation of ['SELECT', 'INSERT', 'UPDATE']) {
    assert.match(replacement.sql, new RegExp(`CREATE POLICY order_drugstores_\\w+ ON order_drugstores FOR ${operation} TO nearpill_app`));
  }
  // Later migrations must not silently restore a permissive DELETE/ALL
  // policy under another name, including in the same 0004 migration.
  for (const { filename, sql } of migrations.filter(({ filename }) => filename >= '0004_identity_security.sql')) {
    const executable = sql.replace(/--[^\n]*/g, '');
    assert.doesNotMatch(executable,
      /CREATE\s+POLICY\s+\w+\s+ON\s+(?:public\.)?(?:order_drugstores|order_pharmacies)\s+FOR\s+(?:ALL|DELETE)\s+TO\s+nearpill_app\b/i,
      `${filename} must not reintroduce customer DELETE eligibility`);
  }
  const verifier = await readFile(new URL('../scripts/lib/verify-order-tenant-isolation.mjs', import.meta.url), 'utf8');
  assert.match(verifier, /DELETE FROM order_pharmacies WHERE id = \$1 RETURNING id/);
  assert.match(verifier, /customer can DELETE own pharmacy-order child/);
});

test('NP-042: the reviewed later policy must not be misread as a continuing DELETE grant', async () => {
  const later = await readFile(new URL('../migrations/postgres/0004_identity_security.sql', import.meta.url), 'utf8');
  assert.match(later, /DROP POLICY IF EXISTS order_drugstores_access/);
  assert.doesNotMatch(later, /CREATE POLICY order_drugstores_delete/i);
  // This remaining UPDATE policy is a DISTINCT lifecycle-status risk (NP-034),
  // so correcting the DELETE finding must not hide the outstanding finding.
  assert.match(later, /CREATE POLICY order_drugstores_update ON order_drugstores FOR UPDATE TO nearpill_app/);
});

// NP-035: customer ownership must not authorize a direct low-priced order line.
// The test uses a real synthetic child row and medicine ID, and all mutations
// must be rolled back even when the policy unexpectedly allows INSERT.
test('NP-035: refuses direct customer insertion of a cheap order item into owned order', async () => {
  const pool = recordingPool({ orderItemInsertSucceeds: true });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
    /customer can INSERT an order line outside checkout/);
  assert.ok(pool.history.some(({ sql, params }) =>
    sql.startsWith('INSERT INTO order_items') && params[0] === fixture.orderA + 1000 && params[1] === fixture.medicineId));
  assert.equal(pool.released, pool.acquired);
  assert.equal(pool.history.filter((r) => r.sql === 'ROLLBACK').length, pool.acquired);
});

test('NP-035: live order-line probe uses the final post-0006 centavo-only schema', async () => {
  // Record/replay pools do not parse SQL columns. Without this schema check,
  // a removed legacy column makes the live probe fail before exercising RLS.
  const migration = await readFile(new URL('../migrations/postgres/0006_order_inventory.sql', import.meta.url), 'utf8');
  const verifier = await readFile(new URL('../scripts/lib/verify-order-tenant-isolation.mjs', import.meta.url), 'utf8');
  assert.match(migration, /ALTER TABLE order_items DROP COLUMN IF EXISTS price\s*;/);
  const insert = verifier.match(/INSERT INTO order_items\s*\(([^)]+)\)\s*VALUES\s*\(/i);
  assert.ok(insert, 'expected live order-line RLS probe INSERT');
  const columns = insert[1].split(',').map((column) => column.trim());
  assert.deepEqual(columns, ['order_pharmacy_id', 'medicine_id', 'quantity', 'unit_price_centavos'],
    'the probe must use only columns present after the reviewed centavo migration');
});

test('NP-035: own order-item INSERT requires an order_items-specific RLS rejection', async () => {
  const allowedDenial = recordingPool({ orderItemInsertError: {
    code: '42501', message: 'new row violates row-level security policy for table "order_items"',
  } });
  await assertCustomerOrderRlsNegatives({ pool: allowedDenial, fixture });
  for (const error of [
    { code: '42501', message: 'new row violates row-level security policy for table orders' },
    { code: '42501', message: 'permission denied for table order_items' },
    { code: '23503', message: 'foreign key violation' },
  ]) {
    const pool = recordingPool({ orderItemInsertError: error });
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
      (caught) => caught.code === error.code && caught.message === error.message);
    assert.equal(pool.released, pool.acquired);
  }
  const pool = recordingPool();
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture: { ...fixture, medicineId: 0 } }),
    /synthetic medicineId/);
  assert.equal(pool.acquired, 0);
});


// NP-035 follow-through: immutable price snapshots on existing lines must not
// be editable by a customer with a valid own-order read capability.
test('NP-035: blocks own order-line price changes even when the row is visible', async () => {
  const pool = recordingPool({ orderItemPriceUpdateSucceeds: true });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
    /customer can change own order-line unit_price_centavos/);
  assert.ok(pool.history.some(({ sql }) => sql.startsWith('UPDATE order_items SET unit_price_centavos')),
    'verifier must attempt a real price update on an existing synthetic order line');
  assert.equal(pool.released, pool.acquired);
});

test('NP-035: rejects unrelated failures while testing existing order-line price integrity', async () => {
  for (const error of [
    { code: '42501', message: 'permission denied for table payments' },
    { code: '23503', message: 'invalid order line foreign key' },
  ]) {
    const pool = recordingPool({ orderItemPriceUpdateError: error });
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
      (caught) => caught.code === error.code && caught.message === error.message);
    assert.equal(pool.released, pool.acquired);
  }
});


test('NP-035: order-line price probe refuses missing fixture and cross-customer line visibility', async () => {
  for (const [options, text] of [
    [{ noOwnItem: true }, /missing own order-line fixture/],
    [{ itemReadLeak: true }, /foreign order line visible/],
  ]) {
    const pool = recordingPool(options);
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }), text);
    assert.equal(pool.released, pool.acquired);
  }
});

test('NP-035: price update accepts scoped denial but never another table/column denial', async () => {
  await assertCustomerOrderRlsNegatives({ pool: recordingPool({ orderItemPriceUpdateError: {
    code: '42501', message: 'permission denied for column unit_price_centavos',
  } }), fixture });
  for (const error of [
    { code: '42501', message: 'permission denied for column role' },
    { code: '42501', message: 'new row violates row-level security policy for table payments' },
  ]) {
    const pool = recordingPool({ orderItemPriceUpdateError: error });
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
      (caught) => caught.code === error.code && caught.message === error.message);
    assert.equal(pool.released, pool.acquired);
  }
});


test('NP-035: live fixture writer creates real centavo-only order lines with returned IDs', async () => {
  const source = await readFile(new URL('../scripts/verify-postgres-security.mjs', import.meta.url), 'utf8');
  assert.match(source, /INSERT INTO order_items\s*\(order_pharmacy_id,medicine_id,quantity,unit_price_centavos\)/);
  assert.match(source, /RETURNING id,order_pharmacy_id/);
  assert.match(source, /fixture\.orderItemA = lineFor\(childFor\(fixture\.orderA\)\)/);
  assert.match(source, /fixture\.orderItemB = lineFor\(childFor\(fixture\.orderB\)\)/);
  const pool = recordingPool();
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture: { ...fixture, orderItemB: 0 } }),
    /valid synthetic orderItemB/);
  assert.equal(pool.acquired, 0, 'invalid fixture must not open a connection');
});

// A fake app-role response must never be mistaken for real payment authority.
test('Packet 0: customer payment status and centavos cannot be mutated without payment_mutation', async () => {
  const pool = recordingPool();
  await assertCustomerOrderRlsNegatives({ pool, fixture });
  assert.deepEqual(pool.history.filter((r) => r.sql.startsWith('UPDATE payments SET')).map((r) => r.params),
    [[fixture.paymentA, 'confirmed'], [fixture.paymentA, 1], [fixture.paymentA, fixture.orderB], [fixture.paymentB, 'confirmed'], [fixture.paymentB, 1], [fixture.paymentB, fixture.orderA]]);
});

test('Packet 0: a customer cannot reassign an existing payment to a different customer order', async () => {
  const pool = recordingPool({ paymentMutationSucceeds: { order_id: true } });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
    /customer can reassign own payment to another order/);
  assert.deepEqual(pool.history.filter((r) => r.sql.startsWith('UPDATE payments SET order_id')).map((r) => r.params),
    [[fixture.paymentA, fixture.orderB]]);
  assert.equal(pool.history.filter((r) => r.sql === 'ROLLBACK').length, pool.released);
});

test('Packet 0: payment ownership transfer rejects unrelated permission or constraint errors', async () => {
  const allowed = recordingPool({ paymentMutationError: { order_id: {
    code: '42501', message: 'permission denied for column order_id',
  } } });
  await assertCustomerOrderRlsNegatives({ pool: allowed, fixture });
  assert.deepEqual(allowed.history.filter((r) => r.sql.startsWith('UPDATE payments SET order_id')).map((r) => r.params),
    [[fixture.paymentA, fixture.orderB], [fixture.paymentB, fixture.orderA]]);
  for (const error of [
    { code: '42501', message: 'permission denied for table orders' },
    { code: '42501', message: 'permission denied for column role' },
    { code: '23503', message: 'foreign key violation' },
  ]) {
    const pool = recordingPool({ paymentMutationError: { order_id: error } });
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
      (actual) => actual.code === error.code && actual.message === error.message);
    assert.equal(pool.released, pool.acquired);
  }
});

test('Packet 0: a customer cannot mint a confirmed one-centavo payment without payment_mutation', async () => {
  const pool = recordingPool({ paymentInsertSucceeds: true });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
    /customer can INSERT a confirmed payment outside provider verification/);
  assert.deepEqual(pool.history.filter((r) => r.sql.startsWith('INSERT INTO payments')).map((r) => r.params),
    [[fixture.orderA, 1, 'confirmed', 'PHP']]);
  assert.equal(pool.history.filter((r) => r.sql === 'ROLLBACK').length,
    pool.released, 'every attempted payment mutation must settle before release');
});

test('Packet 0: payment INSERT must be denied by payments RLS, never by unrelated SQL errors or missing grants', async () => {
  const pool = recordingPool();
  await assertCustomerOrderRlsNegatives({ pool, fixture });
  assert.deepEqual(pool.history.filter((r) => r.sql.startsWith('INSERT INTO payments')).map((r) => r.params),
    [[fixture.orderA, 1, 'confirmed', 'PHP'], [fixture.orderB, 1, 'confirmed', 'PHP']]);
  for (const error of [
    { code: '42501', message: 'permission denied for table payments' },
    { code: '42501', message: 'new row violates row-level security policy for table orders' },
    { code: '23514', message: 'invalid payment status' },
  ]) {
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool: recordingPool({ paymentInsertError: error }), fixture }),
      (actual) => actual.code === error.code && actual.message === error.message);
  }
});

test('Packet 0: customers cannot DELETE their own authoritative payment records', async () => {
  const pool = recordingPool({ paymentDeleteSucceeds: true });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
    /customer can DELETE own payment record/);
  assert.deepEqual(pool.history.filter((r) => r.sql.startsWith('DELETE FROM payments')).map((r) => r.params),
    [[fixture.paymentA]]);
  assert.equal(pool.history.filter((r) => r.sql === 'ROLLBACK').length, pool.released);
});

test('Packet 0: payment DELETE requires a payments-specific permission denial or zero affected rows', async () => {
  const pool = recordingPool();
  await assertCustomerOrderRlsNegatives({ pool, fixture });
  assert.deepEqual(pool.history.filter((r) => r.sql.startsWith('DELETE FROM payments')).map((r) => r.params),
    [[fixture.paymentA], [fixture.paymentB]]);
  await assertCustomerOrderRlsNegatives({ pool: recordingPool({ paymentDeleteError: {
    code: '42501', message: 'permission denied for table payments',
  } }), fixture });
  for (const error of [
    { code: '42501', message: 'permission denied for table orders' },
    { code: '42501', message: 'new row violates row-level security policy for table users' },
    { code: '23503', message: 'foreign key violation' },
  ]) {
    const errorPool = recordingPool({ paymentDeleteError: error });
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool: errorPool, fixture }),
      (actual) => actual.code === error.code && actual.message === error.message);
    assert.equal(errorPool.released, errorPool.acquired);
  }
});

test('Packet 0: customer payment reads require own fixture and must hide foreign payment', async () => {
  for (const options of [{ noOwnPayment: true }, { paymentReadLeak: true }]) {
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool: recordingPool(options), fixture }),
      /missing own payment or foreign customer payment visible/);
  }
});

test('Packet 0: permitted payment status or amount tampering fails security verification', async () => {
  for (const column of ['payment_status', 'amount_centavos']) {
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool: recordingPool({ paymentMutationSucceeds: { [column]: true } }), fixture }),
      new RegExp(`customer can change own payment ${column}`));
  }
});

test('Packet 0: unrelated payment errors cannot count as an authorization denial', async () => {
  await assertCustomerOrderRlsNegatives({ pool: recordingPool({ paymentMutationError: {
    payment_status: { code: '42501', message: 'permission denied for table payments' },
    amount_centavos: { code: '42501', message: 'permission denied for column amount_centavos' },
  } }), fixture });
  for (const error of [
    { code: '42501', message: 'permission denied for table unrelated' },
    { code: '23514', message: 'invalid payment state' },
  ]) {
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool: recordingPool({ paymentMutationError: { payment_status: error } }), fixture }),
      (actual) => actual.code === error.code && actual.message === error.message);
  }
});

test('Packet 0: live payment fixtures use reviewed post-0007 schema and checked parent-order cleanup', async () => {
  const writer = await readFile(new URL('../scripts/verify-postgres-security.mjs', import.meta.url), 'utf8');
  const cleanup = await readFile(new URL('../scripts/lib/cleanup-rls-fixtures.mjs', import.meta.url), 'utf8');
  assert.match(writer, /INSERT INTO payments \(order_id,amount_centavos,payment_status,currency\)/);
  assert.match(writer, /fixture\.paymentA = paymentFor\(fixture\.orderA\)/);
  assert.match(writer, /fixture\.paymentB = paymentFor\(fixture\.orderB\)/);
  assert.match(cleanup, /DELETE FROM orders WHERE id = ANY\(\$1::int\[\]\)/);
  const schema = await readFile(new URL('../migrations/postgres/0007_payment_reconciliation.sql', import.meta.url), 'utf8');
  assert.match(schema, /payment_status IN \(\s*'pending','confirmed'/);
});


test('Packet 0: public inventory fixture must be visible and linked to reviewed pharmacy and medicine', async () => {
  for (const options of [{ noVisibleInventory: true }, { wrongInventoryPharmacy: true }]) {
    const pool = recordingPool(options);
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }), /public synthetic inventory fixture/);
    assert.equal(pool.acquired, pool.released);
  }
});

test('Packet 0: customer cannot directly change stock, reservations, or the authoritative price', async () => {
  for (const column of ['stock_on_hand', 'reserved_quantity', 'price_centavos']) {
    const pool = recordingPool({ inventoryMutationSucceeds: { [column]: true } });
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
      new RegExp(`customer can directly alter inventory ${column}`));
    assert.equal(pool.acquired, pool.released);
    const statements = pool.history.filter(({ sql }) => sql.startsWith('UPDATE stock SET'));
    assert.ok(statements.some(({ sql, params }) => sql.includes(column) && params[0] === fixture.inventoryId));
  }
});

test('Packet 0: customer price mutation rejects unrelated errors and accepts inventory-scoped denials', async () => {
  const expected = recordingPool({ inventoryMutationError: {
    price_centavos: { code: '42501', message: 'permission denied for column price_centavos' },
  } });
  await assertCustomerOrderRlsNegatives({ pool: expected, fixture });
  assert.deepEqual(expected.history.filter(({sql}) => sql.startsWith('UPDATE stock SET price_centavos')).map(({params}) => params),
    [[fixture.inventoryId, 1], [fixture.inventoryId, 1]]);
  for (const error of [
    { code: '42501', message: 'permission denied for table payments' },
    { code: '23514', message: 'price constraint rejected' },
  ]) {
    const pool = recordingPool({ inventoryMutationError: { price_centavos: error } });
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
      (caught) => caught.code === error.code && caught.message === error.message);
    assert.equal(pool.acquired, pool.released);
  }
});

test('Packet 0: inventory denial accepts only an object-scoped permission error, not unrelated errors', async () => {
  await assertCustomerOrderRlsNegatives({ pool: recordingPool({ inventoryMutationError: {
    stock_on_hand: { code: '42501', message: 'permission denied for table stock' },
  } }), fixture });
  for (const error of [
    { code: '42501', message: 'permission denied for table payments' },
    { code: '42501', message: 'new row violates row-level security policy for table orders' },
    { code: '23514', message: 'inventory stock constraint violated' },
  ]) {
    const pool = recordingPool({ inventoryMutationError: { reserved_quantity: error } });
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
      (caught) => caught.code === error.code && caught.message === error.message);
    assert.equal(pool.acquired, pool.released);
  }
});


test('Packet 0: customer cannot DELETE a published inventory listing', async () => {
  const pool = recordingPool({ inventoryDeleteSucceeds: true });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
    /customer can DELETE published inventory listing/);
  assert.equal(pool.acquired, pool.released);
  assert.ok(pool.history.some(({sql,params}) =>
    sql === 'DELETE FROM stock WHERE id = $1 RETURNING id' && params[0] === fixture.inventoryId));
});

test('Packet 0: inventory DELETE accepts only inventory-scoped permission denials', async () => {
  const expected = recordingPool({ inventoryDeleteError: {
    code: '42501', message: 'permission denied for table stock',
  } });
  await assertCustomerOrderRlsNegatives({ pool: expected, fixture });
  assert.equal(expected.history.filter(({sql}) => sql.startsWith('DELETE FROM stock')).length, 2);
  for (const error of [
    { code: '42501', message: 'permission denied for table payments' },
    { code: '23503', message: 'foreign key constraint prevents removal' },
  ]) {
    const pool = recordingPool({ inventoryDeleteError: error });
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
      (caught) => caught.code === error.code && caught.message === error.message);
    assert.equal(pool.acquired, pool.released);
  }
});


test('Packet 0: customer cannot hide a published pharmacy inventory listing by changing availability', async () => {
  const pool = recordingPool({ inventoryMutationSucceeds: { availability: true } });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
    /customer can directly alter inventory availability/);
  assert.equal(pool.acquired, pool.released);
  assert.deepEqual(pool.history.filter(({ sql }) => sql.startsWith('UPDATE stock SET availability')).map(({params}) => params),
    [[fixture.inventoryId, 0]]);
});

test('Packet 0: availability denial must be inventory-scoped and fail on unrelated errors', async () => {
  const allowed = recordingPool({ inventoryMutationError: { availability: { code: '42501', message: 'permission denied for column availability' } } });
  await assertCustomerOrderRlsNegatives({ pool: allowed, fixture });
  assert.equal(allowed.history.filter(({ sql }) => sql.startsWith('UPDATE stock SET availability')).length, 2);
  for (const error of [
    { code: '42501', message: 'permission denied for table payments' },
    { code: '23514', message: 'violates an availability constraint' },
  ]) {
    const pool = recordingPool({ inventoryMutationError: { availability: error } });
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
      (caught) => caught.code === error.code && caught.message === error.message);
    assert.equal(pool.acquired, pool.released);
  }
});

// Packet 0 audit authenticity: the reviewed 0002 policy permits customer
// attribution only for the current actor. Do not let one customer forge an
// audit entry attributed to another account (even if the action is synthetic).
test('audit attribution: both customers must not INSERT entries attributed to the other user', async () => {
  const pool = recordingPool({ foreignAuditInsertSucceeds: true });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
    /customer can forge another user audit event/);
  assert.ok(pool.history.some(({ sql, params }) => sql.startsWith('INSERT INTO audit_logs') &&
    params[0] === fixture.userB));
  assert.equal(pool.acquired, pool.released);
  assert.equal(pool.history.filter(({ sql }) => sql === 'ROLLBACK').length, pool.acquired);
});

test('audit attribution: only audit_logs-specific WITH CHECK denials prove the INSERT boundary', async () => {
  await assertCustomerOrderRlsNegatives({ pool: recordingPool({
    foreignAuditInsertError: {
      code: '42501', message: 'new row violates row-level security policy for table "audit_logs"',
    },
  }), fixture });
  for (const error of [
    { code: '42501', message: 'new row violates row-level security policy for table "payments"' },
    { code: '42501', message: 'permission denied for table audit_logs' },
    { code: '23503', message: 'foreign key violation' },
  ]) {
    const pool = recordingPool({ foreignAuditInsertError: error });
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
      (caught) => caught.code === error.code && caught.message === error.message);
    assert.equal(pool.acquired, pool.released);
  }
});

// Packet 0: audit evidence remains immutable even when a customer may INSERT
// their own audit event. Synthetic rows exist only inside rollback-only probes.
test('audit immutability: customers cannot UPDATE or DELETE an existing own audit event', async () => {
  for (const operation of ['UPDATE', 'DELETE']) {
    const pool = recordingPool({ auditMutationSucceeds: { [operation]: true } });
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
      new RegExp(`customer can ${operation} own audit evidence`));
    assert.equal(pool.acquired, pool.released);
    assert.equal(pool.history.filter(({ sql }) => sql === 'ROLLBACK').length, pool.acquired);
  }
});

test('audit immutability: missing own-event fixture fails before UPDATE or DELETE', async () => {
  const pool = recordingPool({ noOwnAuditFixture: true });
  await assert.rejects(assertCustomerOrderRlsNegatives({ pool, fixture }),
    /own synthetic audit fixture was not created/);
  assert.equal(pool.history.some(({ sql }) => sql.startsWith('UPDATE audit_logs') || sql.startsWith('DELETE FROM audit_logs')), false);
  assert.equal(pool.acquired, pool.released);
});

test('audit immutability: only audit_logs-specific 42501 denials count as blocked writes', async () => {
  const pool = recordingPool({ auditMutationError: {
    UPDATE: { code: '42501', message: 'permission denied for table audit_logs' },
    DELETE: { code: '42501', message: 'permission denied for table audit_logs' },
  } });
  await assertCustomerOrderRlsNegatives({ pool, fixture });
  assert.equal(pool.history.filter(({ sql }) => sql.startsWith('UPDATE audit_logs')).length, 2);
  assert.equal(pool.history.filter(({ sql }) => sql.startsWith('DELETE FROM audit_logs')).length, 2);
  assert.equal(pool.acquired, pool.released);
  for (const error of [
    { code: '42501', message: 'permission denied for table payments' },
    { code: '23503', message: 'unrelated foreign key constraint' },
  ]) {
    const failed = recordingPool({ auditMutationError: { UPDATE: error } });
    await assert.rejects(assertCustomerOrderRlsNegatives({ pool: failed, fixture }),
      (caught) => caught.code === error.code && caught.message === error.message);
    assert.equal(failed.acquired, failed.released);
  }
});
