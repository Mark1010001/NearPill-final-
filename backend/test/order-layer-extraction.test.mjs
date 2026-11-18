import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createOrderService } from '../src/application/order-service.js';
import { canTransitionOrder, normalizeOrderStatus, orderStatuses } from '../src/domain/orders/status.js';

const routeSource = await readFile(new URL('../src/http/routes/v1/register.ts', import.meta.url), 'utf8');
const repositorySource = await readFile(new URL('../src/infrastructure/postgres/order-repository.js', import.meta.url), 'utf8');

const sqlShape = /\b(?:SELECT\s+[a-z0-9_*.,`]|INSERT\s+INTO\s+[a-z0-9_`]|UPDATE\s+(?:orders|order_drugstores|inventory|payments|reservations)\s+SET|DELETE\s+FROM\s+[a-z0-9_`])/i;

test('order Hono adapter stays thin and delegates to one order service', () => {
  assert.doesNotMatch(routeSource, sqlShape);
  assert.match(routeSource, /orders\.createOrder/);
  assert.match(routeSource, /orders\.updateStatus/);
  assert.match(routeSource, /orders\.cancelOwnOrder/);
  assert.match(routeSource, /idempotencyKey/);
});

test('order state machine normalizes legacy labels but rejects invalid transitions', () => {
  assert.equal(normalizeOrderStatus(' pending '), 'reserved');
  assert.equal(normalizeOrderStatus('approved'), 'confirmed');
  assert.equal(normalizeOrderStatus('rejected'), 'cancelled');
  assert.ok(orderStatuses.includes('cancellation_pending'));
  assert.equal(canTransitionOrder('reserved', 'confirmed'), true);
  assert.equal(canTransitionOrder('confirmed', 'completed'), false);
  assert.equal(canTransitionOrder('ready_for_pickup', 'completed'), true);
});

function fakeRepository() {
  const state = {
    reserved: 0,
    released: 0,
    fulfilled: 0,
    created: null,
    audits: [],
    status: 'reserved',
    pickupPaymentStatus: 'pending',
    pickupFullyPaid: false,
    pickupBalance: null,
    latestPaymentStatus: 'pending',
    expiredOrders: [],
    eligible: true,
    idempotency: null,
  };
  return {
    state,
    async withTransaction(work) {
      const tx = {
        async lockIdempotencyKey() {},
        async findOrderByIdempotency(_userId, key) { return state.idempotency?.key === key ? state.idempotency.order : null; },
        async findCustomerById() { return { id: 1 }; },
        async findStoreById() { return { id: 5, name: 'Store', is_active: 1 }; },
        async findInventoryForUpdate(_store, medicineId) {
          const stockOnHand = state.stockOnHand ?? 5;
          return { prescriptionRequired: state.prescriptionRequired, prescriptionApproved: state.prescriptionApproved, inventoryId: medicineId, priceCentavos: state.priceCentavos ?? 1050, sellingUnit: state.sellingUnit, stockOnHand, reservedQuantity: state.reserved, sellableQuantity: stockOnHand - state.reserved, availability: 1, medicineName: 'Medicine', drugstoreName: 'Store' };
        },
        async createOrder(input) { state.created = input; state.idempotency = { key: input.idempotencyKey, order: { id: 11, reference: input.reference, totalCentavos: input.totalCentavos, status: 'reserved', expiresAt: input.expiresAt, idempotencyFingerprint: input.idempotencyFingerprint } }; return 11; },
        async createOrderDrugstore() { return 21; },
        async createOrderItem(item) { state.orderItem = item; },
        async reserveInventory({ quantity }) { state.reserved += quantity; return true; },
        async appendAudit(userId, action, description) { state.audits.push({ userId, action, description }); },
        async findOrderForUpdate() { return { id: 11, reference: 'NP-1', status: state.status }; },
        async findPartnerPickupForUpdate() { return { id: 11, reference: 'NP-TEST-1', status: state.status, branchStatus: state.status, paymentStatus: state.pickupPaymentStatus }; },
        async advancePartnerPickup(_order, _store, status) { state.status = status; return true; },
        async hasEligiblePickupItems() { return state.eligible; },
        async isPartnerPickupFullyPaid() { return state.pickupFullyPaid; },
        async findPartnerPickupBalance() { return state.pickupBalance; },
        async findOwnedOrderForUpdate() { return { id: 11, reference: 'NP-1', status: state.status, expiresAt: null }; },
        async latestPaymentStatus() { return state.latestPaymentStatus; },
        async listActiveReservationsForUpdate() { return state.reserved > 0 ? [{ id: 1, inventoryId: 9, drugstoreId: 5, quantity: state.reserved }] : []; },
        async releaseReservation({ quantity }) { state.released += quantity; state.reserved -= quantity; return true; },
        async fulfillReservation({ quantity }) { state.fulfilled += quantity; state.reserved -= quantity; if (state.stockOnHand !== undefined) state.stockOnHand -= quantity; return true; },
        async updateOrderStatus(_id, next) { state.status = next; },
        async findExpiredOrdersForUpdate() { return state.expiredOrders; },
      };
      const result = await work(tx);
      return result?.value;
    },
    async listCustomerOrders() { return []; },
    async listItemsForOrders() { return []; },
    async findCustomerOrder() { return null; },
    async listItemsForOrder() { return []; },
    async listAdminOrders() { return []; },
    async listAdminItemsForOrders() { return []; },
    async findAdminOrder() { return null; },
    async listAdminItemsForOrder() { return []; },
    async listPartnerOrderItems() { return []; },
  };
}

test('capsules and whole boxes reserve and deduct the reviewed selling quantity', async () => {
  for (const [sellingUnit, stockOnHand, priceCentavos] of [['Capsule', 30, 600], ['Box of 10', 3, 6000]]) {
    const repository = fakeRepository();
    Object.assign(repository.state, { sellingUnit, stockOnHand, priceCentavos });
    const service = createOrderService({ repository, checkoutAvailable: true, testCheckout: true });
    const create = (expectedSellingUnit) => service.createOrder(1, { idempotencyKey: 'unit-test-order', items: [
      { id: 9, drugstoreId: 5, quantity: 2, expectedUnitPriceCentavos: priceCentavos, expectedSellingUnit },
    ] });
    assert.equal((await create(undefined)).status, 409);
    assert.equal((await create('Tablet')).status, 409);
    const order = await create(sellingUnit);
    assert.equal(order.status, 201);
    assert.equal(order.body.totalCentavos, 2 * priceCentavos);
    assert.equal(repository.state.orderItem.sellingUnit, sellingUnit);
    assert.equal(repository.state.orderItem.quantity, 2);
    assert.equal(repository.state.reserved, 2);
    assert.equal(repository.state.stockOnHand, stockOnHand);
    assert.equal((await create('Tablet')).status, 409);
    Object.assign(repository.state, { status: 'ready_for_pickup', pickupPaymentStatus: 'confirmed', pickupFullyPaid: true });
    const partner = { role: 'partner', memberships: [{ drugstoreId: 5, membershipRole: 'staff' }] };
    assert.equal((await service.updatePartnerPickup(4, partner, 11, { drugstoreId: 5, status: 'completed' })).status, 200);
    assert.equal(repository.state.stockOnHand, stockOnHand - 2);
    assert.equal(repository.state.reserved, 0);
  }
});

test('partner pickup requires its branch, confirmed payment and valid transitions', async () => {
  const repository = fakeRepository();
  const service = createOrderService({ repository });
  const partner = { role: 'partner', memberships: [{ drugstoreId: 5, membershipRole: 'staff' }] };
  const set = (drugstoreId, status) => service.updatePartnerPickup(4, partner, 11, { drugstoreId, status });
  assert.equal((await set(6, 'preparing')).status, 403);
  assert.equal((await set(5, 'preparing')).status, 409);
  repository.state.status = 'confirmed';
  repository.state.pickupPaymentStatus = 'confirmed';
  assert.equal((await set(5, 'ready_for_pickup')).status, 409);
  assert.equal((await set(5, 'preparing')).status, 200);
  assert.equal((await set(5, 'ready_for_pickup')).status, 200);
  assert.equal(repository.state.status, 'ready_for_pickup');
  repository.state.reserved = 1;
  assert.equal((await set(5, 'completed')).status, 409);
  assert.equal(repository.state.reserved, 1);
  repository.state.pickupFullyPaid = true;
  repository.state.eligible = false;
  assert.equal((await set(5, 'completed')).status, 409);
  assert.equal(repository.state.reserved, 1);
  repository.state.eligible = true;
  assert.equal((await set(5, 'completed')).status, 200);
  assert.equal((await set(5, 'completed')).status, 200);
  assert.equal(repository.state.status, 'completed');
  assert.equal(repository.state.fulfilled, 1);
});

test('partner records only the authoritative balance on collection and never records it twice', async () => {
  const repository = fakeRepository();
  Object.assign(repository.state, { status: 'ready_for_pickup', reserved: 1, pickupPaymentStatus: 'confirmed', pickupBalance: { paymentPlan: 'deposit', balanceCentavos: 2000 } });
  const service = createOrderService({ repository });
  const partner = { role: 'partner', memberships: [{ drugstoreId: 5, membershipRole: 'staff' }] };
  const complete = (drugstoreId, amountCentavos, method = 'cash') => service.updatePartnerPickup(4, partner, 11, { drugstoreId, status: 'completed', balancePayment: { method, amountCentavos } });
  assert.equal((await complete(6, 2000)).status, 403);
  assert.equal((await complete(5, 2000, 'gcash')).status, 400);
  assert.equal((await complete(5, 10000)).status, 409);
  assert.equal((await complete(5, 2000)).status, 200);
  assert.equal((await complete(5, 2000)).status, 200);
  assert.equal(repository.state.fulfilled, 1);
  assert.equal(repository.state.audits.filter((entry) => entry.action === 'RECORD_PICKUP_BALANCE').length, 1);
});

test('online balance blocks manual collection until verified, then permits pickup alone', async () => {
  const repository = fakeRepository();
  Object.assign(repository.state, { status: 'ready_for_pickup', reserved: 1, pickupPaymentStatus: 'confirmed' });
  const service = createOrderService({ repository });
  const partner = { role: 'partner', memberships: [{ drugstoreId: 5, membershipRole: 'staff' }] };
  const pickup = { drugstoreId: 5, status: 'completed' };
  const collect = (body) => service.updatePartnerPickup(4, partner, 11, body);
  const cash = { ...pickup, balancePayment: { method: 'cash', amountCentavos: 2000 } };
  assert.equal((await collect(cash)).status, 409);
  assert.equal((await collect(pickup)).status, 409);
  repository.state.pickupFullyPaid = true;
  assert.equal((await collect(cash)).status, 409);
  assert.equal((await collect(pickup)).status, 200);
  assert.equal(repository.state.fulfilled, 1);
  assert.equal(repository.state.audits.some((entry) => entry.action === 'RECORD_PICKUP_BALANCE'), false);
});

test('checkout is single-pharmacy, authoritative-centavo and idempotent', async () => {
  const repository = fakeRepository();
  const service = createOrderService({ repository, now: () => 1000, nextRandom: () => 1234, checkoutAvailable: true });

  const mixed = await service.createOrder(1, { idempotencyKey: 'checkout-0001', requireIdempotency: true, items: [
    { id: 9, drugstoreId: 5, quantity: 1 }, { id: 10, drugstoreId: 6, quantity: 1 },
  ] });
  assert.equal(mixed.status, 409);

  const priceChanged = await service.createOrder(1, { idempotencyKey: 'checkout-0002', items: [
    { id: 9, drugstoreId: 5, quantity: 3, expectedUnitPriceCentavos: 1000 },
  ] });
  assert.equal(priceChanged.status, 409);
  assert.match(priceChanged.body.error, /price.*changed/i);
  assert.equal(repository.state.reserved, 0);

  const created = await service.createOrder(1, { idempotencyKey: 'checkout-0002', requireIdempotency: true, items: [
    { id: 9, drugstoreId: 5, quantity: 1, price: 0.01, expectedUnitPriceCentavos: 1050 },
    { id: 9, drugstoreId: 5, quantity: 2, price: 9999 },
  ] });
  assert.equal(created.status, 201);
  assert.equal(created.body.totalCentavos, 3150);
  assert.equal(created.body.total, 31.5);
  assert.equal(created.body.status, 'reserved');
  assert.equal(repository.state.reserved, 3);
  assert.equal('payment' in repository.state, false);

  const replay = await service.createOrder(1, { idempotencyKey: 'checkout-0002', requireIdempotency: true, items: [{ id: 9, drugstoreId: 5, quantity: 3 }] });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.idempotentReplay, true);
  assert.equal(repository.state.reserved, 3);

  const mismatch = await service.createOrder(1, { idempotencyKey: 'checkout-0002', requireIdempotency: true, items: [{ id: 10, drugstoreId: 5, quantity: 1 }] });
  assert.equal(mismatch.status, 409);
  assert.match(mismatch.body.error, /different order request/i);
});

test('orders fail closed without GCash and previous requests can still replay', async () => {
  const repository = fakeRepository();
  const order = { idempotencyKey: 'checkout-closed', items: [{ id: 9, drugstoreId: 5, quantity: 1 }] };
  const unavailable = createOrderService({ repository });
  const denied = await unavailable.createOrder(1, order);
  assert.equal(denied.status, 503);
  assert.equal(repository.state.created, null);
  assert.equal(repository.state.reserved, 0);

  const configuredFixture = createOrderService({ repository, checkoutAvailable: true });
  assert.equal((await configuredFixture.createOrder(1, order)).status, 201);
  assert.equal((await unavailable.createOrder(1, order)).body.idempotentReplay, true);
  assert.equal(repository.state.reserved, 1);
  assert.equal((await unavailable.updateStatus(2, 11, { status: 'confirmed' })).status, 409);
  assert.equal((await unavailable.updateStatus(2, 11, { status: 'awaiting_payment' })).status, 409);
  assert.equal(repository.state.status, 'reserved');
});

test('the grouped minimum uses each pharmacy’s authoritative subtotal', async () => {
  const repository = fakeRepository();
  const service = createOrderService({ repository, checkoutAvailable: true, testCheckout: true });
  const items = [{ id: 9, drugstoreId: 5, quantity: 1, expectedUnitPriceCentavos: 1050 }];
  assert.equal((await service.createOrder(1, { checkoutMode: 'grouped', items })).status, 422);
  assert.equal(repository.state.reserved, 0);
  assert.equal((await service.createOrder(1, { items })).status, 201);
});

test('expiry keeps stock reserved while a test payment is unresolved', async () => {
  const repository = fakeRepository();
  Object.assign(repository.state, { reserved: 1, status: 'awaiting_payment',
    expiredOrders: [{ id: 11, user_id: 4, reference: 'NP-TEST-11' }] });
  const service = createOrderService({ repository });
  assert.equal(await service.expireOldOrders(), 0);
  assert.equal(repository.state.reserved, 1);
  repository.state.latestPaymentStatus = 'failed';
  assert.equal(await service.expireOldOrders(), 1);
  assert.equal(repository.state.status, 'expired');
  assert.equal(repository.state.released, 1);
});

test('order transitions release or fulfill reservations exactly once', async () => {
  const repository = fakeRepository();
  repository.state.reserved = 2;
  repository.state.status = 'reserved';
  const service = createOrderService({ repository });

  const cancelled = await service.updateStatus(99, 11, { status: 'cancelled', reason: 'No longer needed' });
  assert.equal(cancelled.status, 200);
  assert.equal(repository.state.released, 2);
  assert.equal(repository.state.reserved, 0);

  const repeat = await service.updateStatus(99, 11, { status: 'cancelled' });
  assert.equal(repeat.status, 200);
  assert.equal(repository.state.released, 2);

  repository.state.status = 'ready_for_pickup';
  repository.state.reserved = 2;
  const completed = await service.updateStatus(99, 11, { status: 'completed' });
  assert.equal(completed.status, 200);
  assert.equal(repository.state.fulfilled, 2);
  assert.equal(repository.state.reserved, 0);
});

test('PostgreSQL order repository uses row locks, reservation ledger and centavos', () => {
  assert.match(repositorySource, /FOR UPDATE/);
  assert.match(repositorySource, /reserved_quantity = reserved_quantity \+ \?/);
  assert.match(repositorySource, /INSERT INTO reservations/);
  assert.match(repositorySource, /INSERT INTO stock_movements/);
  assert.match(repositorySource, /total_centavos/);
  assert.match(repositorySource, /unit_price_centavos/);
  assert.doesNotMatch(repositorySource, /stock_count\s*=\s*stock_count\s*-/);
  assert.doesNotMatch(repositorySource, /WHEN payment_status = 'paid' THEN 'refunded'/);
});

test('a prescription item cannot be reserved until the pharmacy approved the customer prescription', async () => {
  const repository = fakeRepository();
  Object.assign(repository.state, { sellingUnit: 'Tablet', priceCentavos: 1500, prescriptionRequired: true, prescriptionApproved: false });
  const service = createOrderService({ repository, checkoutAvailable: true, testCheckout: true });
  const create = (key) => service.createOrder(1, { idempotencyKey: key, items: [{ id: 9, drugstoreId: 5, quantity: 1, expectedUnitPriceCentavos: 1500, expectedSellingUnit: 'Tablet' }] });
  const blocked = await create('rx-blocked-order');
  assert.equal(blocked.status, 403);
  assert.match(blocked.body.error, /approved prescription/);
  assert.equal(repository.state.reserved, 0);
  repository.state.prescriptionApproved = true;
  assert.equal((await create('rx-approved-order')).status, 201);
  assert.equal(repository.state.reserved, 1);
});
