import { assertIsolatedOrderVerifierTarget } from './lib/verify-fixture-target.mjs';
import { assertSafeLiveFixtureConnections } from './lib/verify-live-fixture-connection.mjs';
import { settleFixtureAttempts } from './lib/verify-concurrent-attempts.mjs';
import { cleanupSyntheticOrderVerifierFixtures } from './lib/cleanup-order-fixtures.mjs';
import { assertEmptyOrderBaseline, assertOnlyFixtureExpiryCandidate, assertNoExpiryCandidates } from './lib/verify-order-expiry-scope.mjs';
import pg from 'pg';

import { createOrderService } from '../src/application/order-service.js';
import { runWithDatabaseActor } from '../src/infrastructure/postgres/context.js';
import { createPostgresOrderRepository } from '../src/infrastructure/postgres/order-repository.js';

// Stop before any database connection or fixture write without an explicit test target.
// Unlike fixture-scoped checks, expireOldOrders() mutates every expired order.
// Never run this verifier on staging, even if its fixture target is approved.
assertIsolatedOrderVerifierTarget(process.env);

const { Pool } = pg;
const base = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'nearpill',
};
const appPool = new Pool({
  ...base,
  user: process.env.DB_USER || 'nearpill_app',
  password: process.env.DB_PASSWORD || '',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
  max: 20,
});
const migratorPool = new Pool({
  ...base,
  host: process.env.MIGRATOR_DB_HOST || process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.MIGRATOR_DB_PORT || process.env.DB_PORT || 5432),
  user: process.env.MIGRATOR_DB_USER || 'nearpill_migrator',
  password: process.env.MIGRATOR_DB_PASSWORD || '',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
  max: 2,
});

const marker = `${Date.now()}-${process.pid}`;
const fixture = {};
const service = createOrderService({
  repository: createPostgresOrderRepository(appPool),
  reservationTtlMs: 60 * 60 * 1000,
  checkoutAvailable: true,
});

async function asCustomer(work) {
  return runWithDatabaseActor({ userId: fixture.userId, role: 'customer' }, work);
}

async function asSystem(work) {
  return runWithDatabaseActor({ role: 'system' }, work);
}

async function inventoryState() {
  const result = await migratorPool.query(
    `SELECT stock_on_hand, reserved_quantity, stock_on_hand - reserved_quantity AS sellable
     FROM inventory WHERE id = $1`,
    [fixture.inventoryId],
  );
  return result.rows[0];
}

let verificationError;
try {
  await assertSafeLiveFixtureConnections({ appPool, migratorPool, env: process.env });
  // The production expiry use case scans all due orders; reject any existing
  // orders before our first fixture write, even in an approved local test DB.
  await assertEmptyOrderBaseline(migratorPool);
  fixture.userId = Number((await migratorPool.query(
    `INSERT INTO users (name,email,password,role)
     VALUES ('Order Integrity Fixture',$1,'fixture','customer') RETURNING id`,
    [`order-integrity-${marker}@example.test`],
  )).rows[0].id);
  fixture.storeId = Number((await migratorPool.query(
    `INSERT INTO drugstores
       (name,address,latitude,longitude,is_active,verification_status,verified_at,public_profile_published_at)
     VALUES ($1,'fixture',10.3157,123.8854,1,'verified',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
     RETURNING id`,
    [`Order Integrity Store ${marker}`],
  )).rows[0].id);
  fixture.medicineId = Number((await migratorPool.query(
    `INSERT INTO medicines (brand_name,generic_name,publication_status,published_at)
     VALUES ($1,'fixture','published',CURRENT_TIMESTAMP) RETURNING id`,
    [`Order Integrity Medicine ${marker}`],
  )).rows[0].id);
  fixture.inventoryId = Number((await migratorPool.query(
    `INSERT INTO inventory
       (drugstore_id,medicine_id,price_centavos,stock_on_hand,reserved_quantity,availability)
     VALUES ($1,$2,1000,3,0,1) RETURNING id`,
    [fixture.storeId, fixture.medicineId],
  )).rows[0].id);

  const attempts = await settleFixtureAttempts(100, async (index) => asCustomer(() => service.createOrder(
    fixture.userId,
    {
      requireIdempotency: true,
      idempotencyKey: `verify:${marker}:${index}`,
      items: [{ id: fixture.medicineId, drugstoreId: fixture.storeId, quantity: 1 }],
    },
  )), 'Canonical order contention');

  const successes = attempts.filter((result) => result.status === 201);
  const conflicts = attempts.filter((result) => result.status === 409);
  if (successes.length !== 3 || conflicts.length !== 97) {
    throw new Error(`Expected 3 successful reservations and 97 conflicts; got ${successes.length}/${conflicts.length}.`);
  }
  // Once all 100 attempts settle, cleanup must remove all three committed
  // orders; a zero-row DELETE must never be reported as a successful teardown.
  fixture.expectedOrderCount = successes.length;

  let state = await inventoryState();
  if (Number(state.stock_on_hand) !== 3 || Number(state.reserved_quantity) !== 3 || Number(state.sellable) !== 0) {
    throw new Error(`Inventory invariant failed after contention: ${JSON.stringify(state)}`);
  }

  const firstAttempt = attempts[0];
  if (firstAttempt.status !== 201) {
    // Locate one successful request/key because concurrency scheduling does not guarantee index 0 wins.
    const successIndex = attempts.findIndex((result) => result.status === 201);
    if (successIndex < 0) throw new Error('No successful order available for idempotency verification.');
    fixture.replayIndex = successIndex;
  } else {
    fixture.replayIndex = 0;
  }
  const replayKey = `verify:${marker}:${fixture.replayIndex}`;
  const replay = await asCustomer(() => service.createOrder(fixture.userId, {
    requireIdempotency: true,
    idempotencyKey: replayKey,
    items: [{ id: fixture.medicineId, drugstoreId: fixture.storeId, quantity: 1 }],
  }));
  if (replay.status !== 200 || replay.body?.idempotentReplay !== true) {
    throw new Error(`Idempotency replay failed: ${JSON.stringify(replay)}`);
  }
  state = await inventoryState();
  if (Number(state.reserved_quantity) !== 3) throw new Error('Idempotency replay created an extra reservation.');

  const mismatch = await asCustomer(() => service.createOrder(fixture.userId, {
    requireIdempotency: true,
    idempotencyKey: replayKey,
    items: [{ id: fixture.medicineId, drugstoreId: fixture.storeId, quantity: 2 }],
  }));
  if (mismatch.status !== 409) throw new Error('Idempotency key reuse with a different payload was not rejected.');

  const successOrders = successes.map((result) => Number(result.body.id));
  const cancelledOrderId = Number(replay.body.id);
  const cancelled = await asCustomer(() => service.cancelOwnOrder(fixture.userId, cancelledOrderId));
  if (cancelled.status !== 200 || cancelled.body?.status !== 'cancelled') throw new Error('Cancellation did not release the reservation.');
  const repeatedCancel = await asCustomer(() => service.cancelOwnOrder(fixture.userId, cancelledOrderId));
  if (repeatedCancel.status !== 409) throw new Error('Repeated cancellation was not rejected.');
  const releases = await migratorPool.query(
    `SELECT COUNT(*)::int AS count FROM stock_movements
     WHERE order_id = $1 AND movement_type = 'release'`,
    [cancelledOrderId],
  );
  if (Number(releases.rows[0].count) !== 1) throw new Error('Cancellation released inventory more than once.');

  const remaining = successOrders.filter((id) => id !== cancelledOrderId);
  const expiredOrderId = remaining[0];
  await migratorPool.query(`UPDATE orders SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE id = $1`, [expiredOrderId]);
  // Recheck immediately before invoking the global expiry use case; an
  // unrelated due order must not be modified by a characterization script.
  await assertOnlyFixtureExpiryCandidate(migratorPool, expiredOrderId);
  const expiredCount = await asSystem(() => service.expireOldOrders());
  if (expiredCount !== 1) throw new Error(`Expected one expired reservation; got ${expiredCount}.`);
  // Refuse the second global sweep if any due order remains or appeared since the first.
  await assertNoExpiryCandidates(migratorPool);
  const secondExpiry = await asSystem(() => service.expireOldOrders());
  if (secondExpiry !== 0) throw new Error('Expiry release was not idempotent.');

  const fulfillOrderId = remaining[1];
  for (const status of ['confirmed', 'preparing', 'ready_for_pickup', 'completed']) {
    const transitioned = await asSystem(() => service.updateStatus(0, fulfillOrderId, { status }));
    if (transitioned.status !== 200) throw new Error(`Unable to transition order ${fulfillOrderId} to ${status}.`);
  }

  state = await inventoryState();
  if (Number(state.stock_on_hand) !== 2 || Number(state.reserved_quantity) !== 0 || Number(state.sellable) !== 2) {
    throw new Error(`Final inventory reconciliation failed: ${JSON.stringify(state)}`);
  }

  const activeReservations = await migratorPool.query(
    `SELECT COUNT(*)::int AS count FROM reservations WHERE inventory_id = $1 AND status = 'active'`,
    [fixture.inventoryId],
  );
  if (Number(activeReservations.rows[0].count) !== 0) throw new Error('Active reservations remained after cancellation/expiry/fulfillment.');

} catch (error) {
  verificationError = error;
  throw error;
} finally {
  let cleanupError;
  try {
    await cleanupSyntheticOrderVerifierFixtures({ migratorPool, fixture });
  } catch (error) {
    cleanupError = error;
  }
  // Close both pools even when cleanup or a previous verifier step failed.
  const closed = await Promise.allSettled([appPool.end(), migratorPool.end()]);
  const closingErrors = closed.filter((item) => item.status === 'rejected').map((item) => item.reason);
  if (cleanupError || closingErrors.length) {
    throw new AggregateError(
      [...(verificationError ? [verificationError] : []), ...(cleanupError ? [cleanupError] : []), ...closingErrors],
      'Order verification or its fixture cleanup failed; results are not accepted.',
    );
  }
}

// PASS is emitted only after all synthetic fixture removals and pool shutdowns succeed.
console.log('PASS 100-way canonical order contention: 3/100 reserved, replay did not duplicate, cancellation/expiry released once, fulfillment reconciled stock');
