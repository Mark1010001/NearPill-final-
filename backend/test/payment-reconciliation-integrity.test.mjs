import assert from 'node:assert/strict';
import test from 'node:test';

import { createPaymentSubscriptionService } from '../src/application/payment-subscription-service.js';
import { createPaymentProviderRegistry } from '../src/ports/payment-provider.js';
import { createPaymentPolicy } from '../src/domain/payments/policy.js';
import { createSignedFixturePaymentProvider, signFixtureWebhook } from './support/signed-payment-provider.mjs';

function identityRepository(role = 'partner') {
  const noop = async () => null;
  return {
    findIdByEmail: noop, findAuthUserByEmail: noop, createCustomer: noop, replacePasswordIfCurrent: noop,
    replacePassword: noop, findRecoveryAccountByEmail: noop, findProfileById: noop, updateProfile: noop,
    async findAuthorizationUserById(id) { return { id, role }; },
  };
}
function securityRepository() {
  return { async listActiveMemberships() { return [{ drugstoreId: 5, membershipRole: 'manager', isActive: true }]; } };
}

function memoryRepository() {
  const state = {
    order: { id: 9, reference: 'NP-9', userId: 4, totalCentavos: 12550, status: 'reserved' },
    payments: [], refunds: [], events: new Set(), reconciliations: [], reservations: [{ id: 1, inventoryId: 7, quantity: 1, status: 'active' }],
    entitlements: new Map(), subscriptions: new Map(), audits: [],
    eligible: true,
  };
  let paymentId = 1, refundId = 1, subscriptionId = 1;
  const tx = {
    async findOrderForPaymentActorForUpdate(orderId, userId) { return orderId === state.order.id && userId === state.order.userId ? state.order : null; },
    async findPaymentByIdempotency(orderId, key) { return state.payments.find((p) => p.orderId === orderId && p.idempotencyKey === key) || null; },
    async hasEligiblePickupItems() { return state.eligible; },
    async createPaymentIntent(input) { const p = { id: paymentId++, paymentStatus: 'pending', createdAt: new Date(), updatedAt: new Date(), ...input }; state.payments.push(p); return p.id; },
    async updateOrderStatus(_id, status) { state.order.status = status; for (const p of state.payments) p.orderStatus = status; },
    async insertProviderEvent(event) { const key = `${event.provider}:${event.eventId}`; if (state.events.has(key)) return false; state.events.add(key); return true; },
    async markProviderEvent() {},
    async findPaymentByExternalIdForUpdate(provider, external) { const p = state.payments.find((x) => x.provider === provider && x.providerPaymentId === external); return p ? { ...p, orderStatus: state.order.status, userId: state.order.userId, orderReference: state.order.reference } : null; },
    async findPaymentByIdForUpdate(id) { const p = state.payments.find((x) => x.id === id); return p ? { ...p, orderStatus: state.order.status, userId: state.order.userId, orderReference: state.order.reference } : null; },
    async updatePaymentStatus(id, status, reference = null) { const p = state.payments.find((x) => x.id === id); p.paymentStatus = status; if (reference) p.paymentReference = reference; },
    async createReconciliation(input) { state.reconciliations.push(input); return state.reconciliations.length; },
    async createRefund(input) { const r = { id: refundId++, status: 'pending', ...input }; state.refunds.push(r); return r.id; },
    async findRefundByExternalIdForUpdate(provider, external) { return state.refunds.find((x) => x.provider === provider && x.providerRefundId === external) || null; },
    async findPendingRefundForPaymentForUpdate(id) { return state.refunds.find((x) => x.paymentId === id && x.status === 'pending') || null; },
    async updateRefundStatus(id, status) { state.refunds.find((x) => x.id === id).status = status; },
    async listActiveReservationsForUpdate() { return state.reservations.filter((x) => x.status === 'active'); },
    async releaseReservation({ reservationId }) { const r = state.reservations.find((x) => x.id === reservationId); if (!r || r.status !== 'active') return false; r.status = 'released'; return true; },
    async appendAudit(userId, action, description) { state.audits.push({ userId, action, description }); },
  };
  return {
    state,
    async withTransaction(work) { const result = await work(tx); return result?.value; },
    async partnerDashboardForDrugstore() { return { totalSales: 0, totalOrders: 0, completedOrders: 0, pendingOrders: 0, expiredOrders: 0, cancelledOrders: 0 }; },
    async activeSubscriptionForDrugstore(id) { return [...state.subscriptions.values()].find((s) => s.drugstoreId === id && s.status === 'active') || null; },
    async listSubscriptions() { return [...state.subscriptions.values()]; },
    async findDrugstoreById() { return { id: 5 }; },
    async expireActiveSubscriptions(id) { for (const s of state.subscriptions.values()) if (s.drugstoreId === id && s.status === 'active') s.status = 'expired'; },
    async createSubscription(input) { const id = subscriptionId++; state.subscriptions.set(id, { id, ...input }); return id; },
    async findSubscriptionById(id) { const s = state.subscriptions.get(id); return s ? { id, pharmacy_id: s.drugstoreId, tier: s.tier, status: s.status, plan_version: s.planVersion, start_date: s.startDate, end_date: s.endDate } : null; },
    async updateSubscription(id, input) { Object.assign(state.subscriptions.get(id), input); return 1; },
    async replaceEntitlements(drugstoreId, _subscriptionId, keys) { state.entitlements.set(drugstoreId, [...keys]); },
    async listEntitlementsForDrugstore(drugstoreId) { return state.entitlements.get(drugstoreId) || []; },
    async appendAudit(userId, action, description) { state.audits.push({ userId, action, description }); },
    async findOrderPaymentForActor(orderId, userId) { return orderId === state.order.id && userId === state.order.userId ? (state.payments.at(-1) || null) : null; },
    async listDueTestPayments(afterId) { return state.payments.filter((p) => p.id > afterId && p.paymentStatus === 'pending'); },
    async findPaymentForActor(id, userId) { return userId === state.order.userId ? (state.payments.find((p) => p.id === id) || null) : null; },
    async findPendingRefundForPayment(id) { return state.refunds.find((r) => r.paymentId === id && r.status === 'pending') || null; },
    async findPaymentById(id) { return state.payments.find((p) => p.id === id) || null; },
  };
}

function fixture({ mode = 'full', refundsEnabled = true, now = () => 1_800_000_000_000 } = {}) {
  const repository = memoryRepository();
  const provider = createSignedFixturePaymentProvider({ now, secret: 'test-secret' });
  const service = createPaymentSubscriptionService({
    repository,
    identityRepository: identityRepository(),
    securityRepository: securityRepository(),
    providerRegistry: createPaymentProviderRegistry([provider]),
    paymentPolicy: createPaymentPolicy({ mode, version: 'test-v1', refundsEnabled }),
  });
  return { repository, provider, service, now };
}

async function createIntent(f) {
  const result = await f.service.createPaymentIntent(4, 9, { provider: 'fixture', paymentPlan: 'full', idempotencyKey: 'payment-key-0001' });
  assert.equal(result.status, 201);
  return result.body.payment;
}

function signedEvent({ provider, now, payload, secret = 'test-secret' }) {
  const rawBody = JSON.stringify(payload);
  const timestamp = Math.floor(now() / 1000);
  return { rawBody, headers: { 'x-fixture-timestamp': String(timestamp), 'x-fixture-signature': signFixtureWebhook({ secret, timestamp, rawBody }) } };
}

test('staging deposits use half or the minimum for each pharmacy order', () => {
  const policy = createPaymentPolicy({ mode: 'deposit_or_full', depositBasisPoints: 5000, minimumDepositCentavos: 10000 });
  assert.equal(policy.quote(12000, 'deposit').amountCentavos, 10000);
  assert.equal(policy.quote(20000, 'deposit').amountCentavos, 10000);
  assert.equal(policy.quote(23001, 'deposit').amountCentavos, 11501);
  assert.equal(policy.quote(9999, 'deposit').ok, false);
  assert.equal(policy.quote(10000, 'deposit').ok, false);
  assert.equal(policy.quote(10000, 'full').amountCentavos, 10000);
  assert.equal(policy.quote(9999, 'full').amountCentavos, 9999);
});

test('payment policy defaults can truthfully disable online collection', async () => {
  const f = fixture({ mode: 'disabled' });
  const result = await f.service.createPaymentIntent(4, 9, { provider: 'fixture', paymentPlan: 'full', idempotencyKey: 'payment-key-0001' });
  assert.equal(result.status, 503);
  assert.equal(f.repository.state.payments.length, 0);
});

test('provider-backed intent uses authoritative order centavos and idempotent replay', async () => {
  const f = fixture();
  const first = await createIntent(f);
  assert.equal(first.amountCentavos, 12550);
  assert.equal(first.currency, 'PHP');
  assert.equal(f.repository.state.order.status, 'awaiting_payment');
  const replay = await f.service.createPaymentIntent(4, 9, { provider: 'fixture', paymentPlan: 'full', idempotencyKey: 'payment-key-0001' });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.idempotentReplay, true);
  assert.equal(f.repository.state.payments.length, 1);
});

test('forged webhook is rejected before any payment state mutation', async () => {
  const f = fixture();
  const payment = await createIntent(f);
  const rawBody = JSON.stringify({ eventId: 'evt_bad', type: 'payment.confirmed', providerPaymentId: payment.providerPaymentId, amountCentavos: 12550, currency: 'PHP' });
  const result = await f.service.processProviderWebhook('fixture', { rawBody, headers: { 'x-fixture-timestamp': String(Math.floor(f.now() / 1000)), 'x-fixture-signature': '00'.repeat(32) } });
  assert.equal(result.status, 401);
  assert.equal(f.repository.state.payments[0].paymentStatus, 'pending');
});

test('signed confirmed webhook is deduplicated and confirms order exactly once', async () => {
  const f = fixture();
  const payment = await createIntent(f);
  const delivery = signedEvent({ provider: f.provider, now: f.now, payload: { eventId: 'evt_1', type: 'payment.confirmed', providerPaymentId: payment.providerPaymentId, amountCentavos: 12550, currency: 'PHP' } });
  const first = await f.service.processProviderWebhook('fixture', delivery);
  assert.equal(first.status, 200);
  assert.equal(f.repository.state.payments[0].paymentStatus, 'confirmed');
  assert.equal(f.repository.state.order.status, 'confirmed');
  const duplicate = await f.service.processProviderWebhook('fixture', delivery);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(f.repository.state.events.size, 1);
});

test('an out-of-order failure cannot overwrite a confirmed payment', async () => {
  const f = fixture();
  const payment = await createIntent(f);
  const send = (type, eventId) => f.service.processProviderWebhook('fixture', signedEvent({
    now: f.now, payload: { eventId, type, providerPaymentId: payment.providerPaymentId, amountCentavos: 12550, currency: 'PHP' },
  }));
  await send('payment.confirmed', 'evt_confirmed');
  await send('payment.failed', 'evt_late_failure');
  assert.equal(f.repository.state.payments[0].paymentStatus, 'confirmed');
});

test('customer refresh records a provider-verified closed initial GCash session', async () => {
  const repository = memoryRepository();
  const provider = createSignedFixturePaymentProvider({ secret: 'test-secret' });
  Object.assign(repository.state.order, { reference: 'NP-TEST-9', status: 'awaiting_payment' });
  repository.state.payments.push({ id: 1, orderId: 9, provider: 'xendit-test', providerPaymentId: 'ps_test', paymentPlan: 'full',
    paymentStatus: 'pending', amountCentavos: 12550, currency: 'PHP' });
  const service = createPaymentSubscriptionService({ repository, identityRepository: identityRepository(), securityRepository: securityRepository(),
    providerRegistry: createPaymentProviderRegistry([{ ...provider, id: 'xendit-test',
      async getPayment() { return { status: 'failed', amountCentavos: 12550, currency: 'PHP', orderReference: 'NP-TEST-9' }; },
    }]), paymentPolicy: createPaymentPolicy({ mode: 'full' }),
  });
  assert.equal((await service.refreshTestOrderPayment(4, 9)).body.payment.paymentStatus, 'failed');
});

test('wrong-amount signed event is quarantined for reconciliation and does not confirm order', async () => {
  const f = fixture();
  const payment = await createIntent(f);
  const delivery = signedEvent({ provider: f.provider, now: f.now, payload: { eventId: 'evt_wrong', type: 'payment.confirmed', providerPaymentId: payment.providerPaymentId, amountCentavos: 1, currency: 'PHP' } });
  const result = await f.service.processProviderWebhook('fixture', delivery);
  assert.equal(result.body.reconciliationRequired, true);
  assert.equal(f.repository.state.payments[0].paymentStatus, 'reconciliation_required');
  assert.equal(f.repository.state.order.status, 'awaiting_payment');
  assert.equal(f.repository.state.reconciliations[0].reason, 'amount_mismatch');
  const wrongCurrency = signedEvent({ now: f.now, payload: {
    eventId: 'evt_wrong_currency', type: 'payment.confirmed', providerPaymentId: payment.providerPaymentId,
    amountCentavos: 12550, currency: 'USD',
  } });
  assert.equal((await f.service.processProviderWebhook('fixture', wrongCurrency)).body.reconciliationRequired, true);
  assert.equal(f.repository.state.reconciliations[1].reason, 'currency_mismatch');
  assert.equal(f.repository.state.order.status, 'awaiting_payment');
});

test('customer test payment refresh checks ownership and verifies the provider amount', async () => {
  const repository = memoryRepository();
  const provider = createSignedFixturePaymentProvider({ secret: 'test-secret' });
  let lookups = 0;
  let amount = 1;
  let orderReference = 'NP-TEST-other';
  Object.assign(repository.state.order, { status: 'awaiting_payment', reference: 'NP-TEST-9' });
  repository.state.payments.push({ id: 1, orderId: 9, provider: 'xendit-test', providerPaymentId: 'ps_test', paymentStatus: 'pending', amountCentavos: 12550, currency: 'PHP' });
  const service = createPaymentSubscriptionService({ repository, identityRepository: identityRepository(), securityRepository: securityRepository(),
    providerRegistry: createPaymentProviderRegistry([{ ...provider, id: 'xendit-test', async getPayment() { lookups++; return { status: 'confirmed', amountCentavos: amount, currency: 'PHP', orderReference }; } }]),
    paymentPolicy: createPaymentPolicy({ mode: 'full', version: 'test-v1' }),
  });
  assert.equal((await service.refreshTestOrderPayment(8, 9)).body.payment, null);
  assert.equal(lookups, 0);
  assert.equal((await service.refreshTestOrderPayment(4, 9)).status, 409);
  assert.equal(repository.state.order.status, 'awaiting_payment');
  amount = 12550;
  assert.equal((await service.refreshTestOrderPayment(4, 9)).status, 409);
  orderReference = 'NP-TEST-9';
  assert.equal((await service.refreshTestOrderPayment(4, 9)).body.payment.paymentStatus, 'confirmed');
  assert.equal(repository.state.order.status, 'confirmed');
});

test('a ready test pickup can open only its confirmed deposit balance', async () => {
  const repository = memoryRepository();
  Object.assign(repository.state.order, { reference: 'NP-TEST-9', status: 'ready_for_pickup', totalCentavos: 16000 });
  const provider = createSignedFixturePaymentProvider({ secret: 'test-secret' });
  const requests = [];
  const service = createPaymentSubscriptionService({ repository, identityRepository: identityRepository(), securityRepository: securityRepository(),
    providerRegistry: createPaymentProviderRegistry([{ ...provider, id: 'xendit-test',
      async createIntent(input) { requests.push(input); return { externalId: 'balance-session', checkoutUrl: 'https://dev.xen.to/test' }; },
      async getPayment() { return { status: 'confirmed', amountCentavos: 6000, currency: 'PHP', orderReference: 'NP-TEST-9-BALANCE' }; },
    }]), paymentPolicy: createPaymentPolicy({ mode: 'deposit_or_full', depositBasisPoints: 5000, minimumDepositCentavos: 10000 }),
  });
  const request = { provider: 'xendit-test', paymentPlan: 'balance', idempotencyKey: 'balance-check' };
  assert.equal((await service.createPaymentIntent(4, 9, request)).status, 409);
  repository.state.payments.push({ id: 17, orderId: 9, provider: 'xendit-test', paymentPlan: 'deposit', paymentStatus: 'confirmed', amountCentavos: 10000, currency: 'PHP', idempotencyKey: 'xendit-test:9', policyVersion: 'test-v1' });
  assert.equal((await service.createPaymentIntent(8, 9, request)).status, 404);
  repository.state.eligible = false;
  assert.equal((await service.createPaymentIntent(4, 9, request)).status, 409);
  assert.equal(requests.length, 0);
  repository.state.eligible = true;
  assert.equal((await service.createPaymentIntent(4, 9, request)).status, 201);
  assert.equal((await service.createPaymentIntent(4, 9, request)).status, 200);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].amountCentavos, 6000);
  assert.equal(requests[0].orderReference, 'NP-TEST-9-BALANCE');
  assert.equal((await service.refreshTestOrderPayment(4, 9)).body.payment.paymentStatus, 'confirmed');
  assert.equal(repository.state.order.status, 'ready_for_pickup');
});

test('the scheduled check verifies an expired balance and quarantines a late capture after collection', async () => {
  const repository = memoryRepository();
  const provider = createSignedFixturePaymentProvider({ secret: 'test-secret' });
  Object.assign(repository.state.order, { reference: 'NP-TEST-9', status: 'ready_for_pickup' });
  const balance = { id: 3, orderId: 9, provider: 'xendit-test', providerPaymentId: 'ps_balance', paymentPlan: 'balance', paymentStatus: 'pending', amountCentavos: 2550, currency: 'PHP' };
  repository.state.payments.push(balance);
  let providerStatus = 'failed';
  const service = createPaymentSubscriptionService({ repository, identityRepository: identityRepository(), securityRepository: securityRepository(),
    providerRegistry: createPaymentProviderRegistry([{ ...provider, id: 'xendit-test',
      async getPayment() { return { status: providerStatus, amountCentavos: 2550, currency: 'PHP', orderReference: 'NP-TEST-9-BALANCE' }; },
    }]), paymentPolicy: createPaymentPolicy({ mode: 'full' }),
  });
  assert.equal(await service.refreshDueTestPayments(0), 3);
  assert.equal(balance.paymentStatus, 'failed');
  assert.equal(repository.state.order.status, 'ready_for_pickup');
  repository.state.order.status = 'completed';
  providerStatus = 'confirmed';
  assert.equal((await service.reconcilePayment(1, balance.id)).body.payment.paymentStatus, 'reconciliation_required');
  assert.equal(repository.state.order.status, 'completed');
});

test('deposit policy computes exact centavos without floating-point authority', async () => {
  const repository = memoryRepository();
  const provider = createSignedFixturePaymentProvider({ secret: 'test-secret' });
  repository.state.order.totalCentavos = 10001;
  const service = createPaymentSubscriptionService({
    repository,
    identityRepository: identityRepository(), securityRepository: securityRepository(),
    providerRegistry: createPaymentProviderRegistry([provider]),
    paymentPolicy: createPaymentPolicy({ mode: 'deposit_or_full', version: 'deposit-test', depositBasisPoints: 3333, refundsEnabled: true }),
  });
  const result = await service.createPaymentIntent(4, 9, { provider: 'fixture', paymentPlan: 'deposit', idempotencyKey: 'deposit-key-0001' });
  assert.equal(result.status, 201);
  assert.equal(result.body.payment.amountCentavos, 3334);
});

test('refund request remains pending until signed provider confirmation', async () => {
  const f = fixture();
  const payment = await createIntent(f);
  f.repository.state.payments[0].paymentStatus = 'confirmed';
  f.repository.state.order.status = 'cancellation_pending';
  const requested = await f.service.requestRefund(1, payment.id, { reason: 'Approved cancellation' });
  assert.equal(requested.status, 201);
  assert.equal(f.repository.state.payments[0].paymentStatus, 'refund_pending');
  assert.equal(f.repository.state.refunds[0].status, 'pending');
  const replay = await f.service.requestRefund(1, payment.id, { reason: 'Approved cancellation' });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.refund.idempotentReplay, true);
  assert.equal(f.repository.state.refunds.length, 1);
  const delivery = signedEvent({ provider: f.provider, now: f.now, payload: { eventId: 'evt_refund', type: 'refund.confirmed', providerPaymentId: payment.providerPaymentId, providerRefundId: requested.body.refund.providerRefundId, amountCentavos: 12550, currency: 'PHP' } });
  await f.service.processProviderWebhook('fixture', delivery);
  assert.equal(f.repository.state.payments[0].paymentStatus, 'refunded');
  assert.equal(f.repository.state.refunds[0].status, 'confirmed');
  assert.equal(f.repository.state.order.status, 'cancelled');
  assert.equal(f.repository.state.reservations[0].status, 'released');
});

test('provider reconciliation can confirm a pending payment from provider evidence', async () => {
  const f = fixture();
  const payment = await createIntent(f);
  f.provider.setPayment(payment.providerPaymentId, {
    status: 'confirmed', amountCentavos: 12550, currency: 'PHP', reference: 'provider-confirmed',
  });
  const reconciled = await f.service.reconcilePayment(1, payment.id);
  assert.equal(reconciled.status, 200);
  assert.equal(f.repository.state.payments[0].paymentStatus, 'confirmed');
  assert.equal(f.repository.state.order.status, 'confirmed');
  assert.equal(reconciled.body.reconciled, true);
});

test('premium subscription grants server-owned report entitlement and cancellation revokes it', async () => {
  const f = fixture();
  const created = await f.service.createSubscription(1, { drugstoreId: 5, tier: 'Pro', status: 'active', planVersion: 'pro-2026-11', startDate: '2026-10-17' });
  assert.deepEqual(created.body.entitlements, ['reports:view:premium', 'reports:history:full']);
  assert.equal((await f.service.requirePartnerEntitlement(3, 'reports:view:premium')).status, 200);
  const updated = await f.service.updateSubscription(1, created.body.id, { status: 'cancelled' });
  assert.deepEqual(updated.body.entitlements, []);
  assert.equal((await f.service.requirePartnerEntitlement(3, 'reports:view:premium')).status, 403);
});

test('subscription end date must be a real date, not before the start, and not in the past for an active plan', async () => {
  const f = fixture();
  const base = { drugstoreId: 5, tier: 'Plus', status: 'active', planVersion: 'plus-v1', startDate: '2026-10-17' };
  assert.equal((await f.service.createSubscription(1, { ...base, endDate: '2026-10-01' })).status, 400);
  assert.equal((await f.service.createSubscription(1, { ...base, endDate: '2026-02-30' })).status, 400);
  assert.equal((await f.service.createSubscription(1, { ...base, endDate: '2026-10-20' })).status, 400);
  assert.equal((await f.service.createSubscription(1, { ...base, endDate: '2099-12-31' })).status, 201);
  assert.equal((await f.service.createSubscription(1, { ...base, endDate: '' })).status, 201);
});

test('subscription end date is set automatically: Basic 3 months, Plus 6 months, Pro 1 year', async () => {
  const f = fixture();
  const end = async (tier, startDate) => (await f.service.createSubscription(1, { drugstoreId: 5, tier, status: 'active', planVersion: 'v1', startDate })).body.endDate;
  assert.equal(await end('Basic', '2099-11-17'), '2100-02-17');
  assert.equal(await end('Plus', '2099-11-17'), '2100-05-17');
  assert.equal(await end('Pro', '2099-11-17'), '2100-11-17');
  assert.equal(await end('Plus', '2099-08-31'), '2100-02-28');
});
