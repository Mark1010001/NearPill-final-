import { createHash } from 'node:crypto';
import { assertIdentityRepository } from '../ports/identity-repository.js';
import { assertPaymentSubscriptionRepository } from '../ports/payment-subscription-repository.js';
import { isSettledPayment, normalizeProviderEventType } from '../domain/payments/status.js';
import { failure, success } from './result.js';
import { subscriptionPlans, tierEntitlements, validTiers } from '../domain/subscriptions/plans.js';

const validSubscriptionStatuses = ['active', 'expired', 'cancelled'];
const payableOrderStatuses = new Set(['reserved', 'awaiting_payment']);

function headersObject(headers = {}) {
  if (typeof headers.entries === 'function') return Object.fromEntries([...headers.entries()].map(([key, value]) => [key.toLowerCase(), value]));
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

function paymentView(payment) {
  if (!payment) return null;
  return {
    ...payment,
    id: Number(payment.id),
    orderId: Number(payment.orderId),
    amountCentavos: Number(payment.amountCentavos),
    amount: Number(payment.amountCentavos) / 100,
  };
}

function expectedTestReference(reference, plan) {
  return plan === 'balance' ? `${reference}-BALANCE` : reference;
}

function matchesPayment(payment, snapshot) {
  return Number(snapshot.amountCentavos) === Number(payment.amountCentavos) && snapshot.currency === payment.currency &&
    (payment.provider !== 'xendit-test' || snapshot.orderReference === expectedTestReference(payment.orderReference, payment.paymentPlan));
}

async function releaseReservations(transaction, orderId, actorId, reason) {
  const reservations = await transaction.listActiveReservationsForUpdate(orderId);
  for (const reservation of reservations) {
    await transaction.releaseReservation({
      reservationId: Number(reservation.id),
      inventoryId: Number(reservation.inventoryId),
      orderId,
      quantity: Number(reservation.quantity),
      actorId,
      reason,
    });
  }
}

const PLAN_MONTHS = { Basic: 3, Plus: 6, Pro: 12 };
/** Start date plus the plan length, clamped to the end of a shorter month (31 Aug + 6 months = 28 Feb). */
export function planEndDate(startDate, tier) {
  const [y, m, d] = startDate.split('-').map(Number);
  const total = (m - 1) + (PLAN_MONTHS[tier] || 0);
  const year = y + Math.floor(total / 12), month = total % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

export function createPaymentSubscriptionService({
  repository,
  identityRepository,
  securityRepository,
  providerRegistry,
  paymentPolicy,
}) {
  assertPaymentSubscriptionRepository(repository);
  assertIdentityRepository(identityRepository);
  if (!securityRepository || typeof securityRepository.listActiveMemberships !== 'function') {
    throw new TypeError('Security repository with pharmacy memberships is required.');
  }
  if (!providerRegistry || typeof providerRegistry.get !== 'function') throw new TypeError('Payment provider registry is required.');
  if (!paymentPolicy || typeof paymentPolicy.quote !== 'function') throw new TypeError('Payment policy is required.');

  async function partnerContext(userIdValue) {
    const userId = Number(userIdValue);
    const user = await identityRepository.findAuthorizationUserById(userId);
    if (!user) return failure(401, 'User not found.');
    if (user.role !== 'partner') return failure(403, 'Partner access required.');
    const memberships = await securityRepository.listActiveMemberships(userId);
    if (memberships.length === 0) return failure(403, 'No active pharmacy membership.');
    return success({ user, membership: memberships[0], memberships });
  }

  async function syncSubscriptionEntitlements({ drugstoreId, subscriptionId, tier, status }) {
    const keys = status === 'active' ? (tierEntitlements[tier] || []) : [];
    await repository.replaceEntitlements(drugstoreId, subscriptionId, keys);
    return keys;
  }

  async function applyConfirmedPayment(transaction, payment, reference = null, eventId = null) {
    if (isSettledPayment(payment.paymentStatus)) return true;
    if (payment.provider === 'xendit-test' && (['cancelled', 'expired', 'cancellation_pending', 'completed'].includes(payment.orderStatus) ||
        (payment.paymentPlan === 'balance' && payment.orderStatus !== 'ready_for_pickup'))) {
      if (payment.paymentStatus !== 'reconciliation_required') {
        await transaction.updatePaymentStatus(Number(payment.id), 'reconciliation_required');
        await transaction.createReconciliation({ paymentId: Number(payment.id), provider: payment.provider, eventId, reason: 'payment_after_order_closed' });
      }
      return false;
    }
    await transaction.updatePaymentStatus(Number(payment.id), 'confirmed', reference);
    if (['reserved', 'awaiting_payment'].includes(String(payment.orderStatus))) {
      await transaction.updateOrderStatus(Number(payment.orderId), 'confirmed');
    }
    return true;
  }

  async function applyFailedPayment(transaction, payment, reference) {
    if (payment.paymentStatus === 'pending') await transaction.updatePaymentStatus(Number(payment.id), 'failed', reference || null);
  }

  async function refreshPendingTestPayment(current, userId) {
    let snapshot;
    try {
      snapshot = await providerRegistry.get('xendit-test')?.getPayment(current.providerPaymentId);
    } catch {
      return failure(503, 'Could not check the test payment with Xendit. Try again.');
    }
    if (!snapshot) return failure(503, 'Could not check the test payment with Xendit. Try again.');
    return repository.withTransaction(async (transaction) => {
      const locked = await transaction.findPaymentByIdForUpdate(Number(current.id));
      if (!locked || Number(locked.orderId) !== Number(current.orderId) ||
          (userId !== undefined && Number(locked.userId) !== Number(userId))) {
        return { rollback: true, value: failure(404, 'Payment not found.') };
      }
      if (locked.paymentStatus !== 'pending') return { value: success({ payment: paymentView(locked) }) };
      if (locked.provider !== 'xendit-test' || locked.providerPaymentId !== current.providerPaymentId || !matchesPayment(locked, snapshot)) {
        return { rollback: true, value: failure(409, 'Xendit payment details need staff review.') };
      }
      if (snapshot.status === 'failed') await applyFailedPayment(transaction, locked, snapshot.reference);
      else if (snapshot.status === 'confirmed') await applyConfirmedPayment(transaction, locked, snapshot.reference || null);
      else return { value: success({ payment: paymentView(locked) }) };
      return { value: success({ payment: paymentView(await transaction.findPaymentByIdForUpdate(Number(current.id))) }) };
    });
  }

  async function applyConfirmedRefund(transaction, payment, refund) {
    await transaction.updateRefundStatus(Number(refund.id), 'confirmed');
    if (Number(refund.amountCentavos) !== Number(payment.amountCentavos)) {
      await transaction.updatePaymentStatus(Number(payment.id), 'reconciliation_required');
      await transaction.createReconciliation({
        paymentId: Number(payment.id), provider: payment.provider, reason: 'partial_or_mismatched_refund',
        details: `Expected ${payment.amountCentavos} centavos but provider confirmed ${refund.amountCentavos}.`,
      });
      return;
    }
    await transaction.updatePaymentStatus(Number(payment.id), 'refunded');
    if (String(payment.orderStatus) === 'cancellation_pending') {
      await releaseReservations(transaction, Number(payment.orderId), Number(payment.userId || 0) || null, 'Provider-confirmed refund completed.');
      await transaction.updateOrderStatus(Number(payment.orderId), 'cancelled');
    }
  }

  return Object.freeze({
    async partnerDashboard(userId) {
      const actor = await partnerContext(userId);
      if (!actor.ok) return actor;
      const data = await repository.partnerDashboardForDrugstore(actor.body.membership.drugstoreId);
      return success({
        drugstoreId: actor.body.membership.drugstoreId,
        membershipRole: actor.body.membership.membershipRole,
        branch: data.branch ?? null,
        totalSales: Number(data.totalSales || 0),
        totalOrders: Number(data.totalOrders || 0),
        completedOrders: Number(data.completedOrders || 0),
        pendingOrders: Number(data.pendingOrders || 0),
        expiredOrders: Number(data.expiredOrders || 0),
        cancelledOrders: Number(data.cancelledOrders || 0),
      });
    },

    async partnerSubscription(userId) {
      const actor = await partnerContext(userId);
      if (!actor.ok) return actor;
      const drugstoreId = actor.body.membership.drugstoreId;
      return success({
        drugstoreId,
        subscription: await repository.activeSubscriptionForDrugstore(drugstoreId),
        entitlements: await repository.listEntitlementsForDrugstore(drugstoreId),
      });
    },

    async partnerEntitlements(userId) {
      const actor = await partnerContext(userId);
      if (!actor.ok) return actor;
      const drugstoreId = actor.body.membership.drugstoreId;
      return success({ drugstoreId, entitlements: await repository.listEntitlementsForDrugstore(drugstoreId) });
    },

    async requirePartnerEntitlement(userId, entitlementKey) {
      const actor = await partnerContext(userId);
      if (!actor.ok) return actor;
      const drugstoreId = actor.body.membership.drugstoreId;
      const entitlements = await repository.listEntitlementsForDrugstore(drugstoreId);
      if (!entitlements.includes(entitlementKey)) return failure(403, 'This feature is not included in the active subscription.');
      return success({ drugstoreId, entitlementKey, entitlements });
    },

    subscriptionPlans() { return success(subscriptionPlans); },

    async listSubscriptions() { return success(await repository.listSubscriptions()); },

    async createSubscription(actorId, body = {}) {
      const drugstoreId = Number(body.drugstoreId);
      const tier = body.tier;
      const status = body.status || 'active';
      const startDate = body.startDate;
      let endDate = body.endDate;
      const planVersion = String(body.planVersion || 'legacy-v1');
      if (!Number.isInteger(drugstoreId) || drugstoreId <= 0) return failure(400, 'Valid drugstoreId is required.');
      if (!validTiers.includes(tier)) return failure(400, 'Tier must be Basic, Plus or Pro.');
      if (!validSubscriptionStatuses.includes(status)) return failure(400, 'Invalid subscription status.');
      if (!startDate) return failure(400, 'startDate is required.');
      const isoDay = /^\d{4}-\d{2}-\d{2}$/;
      const validDay = (value) => isoDay.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
        new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
      if (!validDay(String(startDate))) return failure(400, 'Start date must be a valid date.');
      // The plan length is server-owned: Basic 3 months, Plus 6 months, Pro 1 year, counted from the start date.
      if (!endDate) endDate = planEndDate(String(startDate), tier);
      if (endDate) {
        if (!validDay(String(endDate))) return failure(400, 'End date must be a valid date.');
        if (String(endDate) < String(startDate)) return failure(400, 'End date cannot be before the start date.');
        if (status === 'active' && String(endDate) < new Date().toISOString().slice(0, 10)) return failure(400, 'An active plan cannot end in the past.');
      }
      if (!(await repository.findDrugstoreById(drugstoreId))) return failure(404, 'Drugstore not found.');
      if (status === 'active') await repository.expireActiveSubscriptions(drugstoreId);
      const id = await repository.createSubscription({ drugstoreId, tier, status, planVersion, startDate, endDate: endDate || null });
      const entitlements = await syncSubscriptionEntitlements({ drugstoreId, subscriptionId: id, tier, status });
      await repository.appendBillingEvent({ drugstoreId, subscriptionId: id, actorId, eventType: 'subscription.created', details: JSON.stringify({ tier, status, planVersion, entitlements }) });
      await repository.appendAudit(actorId, 'CREATE_SUBSCRIPTION', `Created ${tier} subscription for drugstore ${drugstoreId}.`);
      return success({ id, drugstoreId, tier, status, planVersion, startDate, endDate: endDate || null, entitlements }, 201);
    },

    async updateSubscription(actorId, idValue, body = {}) {
      const subscriptionId = Number(idValue);
      if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) return failure(400, 'Invalid subscription ID.');
      if (body.tier !== undefined && !validTiers.includes(body.tier)) return failure(400, 'Invalid subscription tier.');
      if (body.status !== undefined && !validSubscriptionStatuses.includes(body.status)) return failure(400, 'Invalid subscription status.');
      const existing = await repository.findSubscriptionById(subscriptionId);
      if (!existing) return failure(404, 'Subscription not found.');
      const tier = body.tier ?? existing.tier;
      const status = body.status ?? existing.status;
      const planVersion = body.planVersion ?? existing.plan_version ?? 'legacy-v1';
      const endDate = body.endDate !== undefined ? body.endDate : existing.end_date;
      const drugstoreId = Number(existing.drugstore_id);
      await repository.updateSubscription(subscriptionId, { tier, status, planVersion, endDate: endDate || null });
      const entitlements = await syncSubscriptionEntitlements({ drugstoreId, subscriptionId, tier, status });
      await repository.appendBillingEvent({ drugstoreId, subscriptionId, actorId, eventType: 'subscription.updated', details: JSON.stringify({ tier, status, planVersion, entitlements }) });
      await repository.appendAudit(actorId, 'UPDATE_SUBSCRIPTION', `Updated subscription ${subscriptionId}.`);
      return success({ id: subscriptionId, drugstoreId, tier, status, planVersion, startDate: existing.start_date, endDate: endDate || null, entitlements });
    },

    async createPaymentIntent(userIdValue, orderIdValue, body = {}) {
      const userId = Number(userIdValue);
      const orderId = Number(orderIdValue);
      const providerId = String(body.provider || '').trim().toLowerCase();
      const requestedKey = String(body.idempotencyKey || '').trim();
      if (!Number.isInteger(orderId) || orderId <= 0) return failure(400, 'Invalid order ID.');
      if (!providerId || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(providerId)) return failure(400, 'A valid payment provider is required.');
      if (!requestedKey || requestedKey.length > 128) return failure(400, 'A valid payment idempotency key is required.');
      const provider = providerRegistry.get(providerId);
      if (!provider) return failure(503, 'Requested payment provider is not configured.');

      const xenditTest = providerId === 'xendit-test';
      const balancePayment = body.paymentPlan === 'balance';
      if (balancePayment && (!xenditTest || paymentPolicy.mode !== 'deposit_or_full')) return failure(400, 'Online balance payment is unavailable.');
      const idempotencyKey = xenditTest ? `xendit-test:${orderId}${balancePayment ? ':balance' : ''}` : requestedKey;
      return repository.withTransaction(async (transaction) => {
        const order = await transaction.findOrderForPaymentActorForUpdate(orderId, userId);
        if (!order) return { rollback: true, value: failure(404, 'Order not found.') };
        if (xenditTest && (Number(order.userId) !== userId || !/^NP-TEST-/.test(order.reference))) {
          return { rollback: true, value: failure(404, 'Test order not found.') };
        }
        if (balancePayment ? order.status !== 'ready_for_pickup' : !payableOrderStatuses.has(String(order.status))) return { rollback: true, value: failure(409, 'Order is not eligible for a new payment intent.') };
        if (xenditTest && !balancePayment && !(new Date(order.expiresAt).getTime() > Date.now())) {
          return { rollback: true, value: failure(409, 'This test order reservation has expired.') };
        }
        const existing = await transaction.findPaymentByIdempotency(orderId, idempotencyKey);
        let quote;
        if (balancePayment) {
          const deposit = await transaction.findPaymentByIdempotency(orderId, `xendit-test:${orderId}`);
          const amountCentavos = Number(order.totalCentavos) - Number(deposit?.amountCentavos);
          if (deposit?.provider !== 'xendit-test' || deposit.paymentPlan !== 'deposit' || deposit.paymentStatus !== 'confirmed' || deposit.currency !== 'PHP' || !Number.isSafeInteger(amountCentavos) || amountCentavos < 100) {
            return { rollback: true, value: failure(409, 'No eligible online balance remains. Pay any outstanding balance at pickup.') };
          }
          quote = { ok: true, paymentPlan: 'balance', amountCentavos, currency: 'PHP', policyVersion: deposit.policyVersion };
        } else {
          quote = paymentPolicy.quote(Number(order.totalCentavos), body.paymentPlan ?? (xenditTest ? existing?.paymentPlan : undefined));
        }
        if (!quote.ok) return { rollback: true, value: failure(quote.unavailable ? 503 : 400, quote.reason) };
        if (existing) {
          if (existing.provider !== providerId || existing.paymentPlan !== quote.paymentPlan || Number(existing.amountCentavos) !== quote.amountCentavos) {
            return { rollback: true, value: failure(409, 'Payment idempotency key was already used for a different request.') };
          }
          if (xenditTest && existing.paymentStatus === 'pending') {
            let snapshot;
            try {
              snapshot = await provider.getPayment(existing.providerPaymentId);
            } catch {
              return { rollback: true, value: failure(503, 'Could not retrieve the existing test checkout. Try again.') };
            }
            if (!snapshot) return { rollback: true, value: failure(503, 'Could not retrieve the existing test checkout. Try again.') };
            const payment = { ...existing, orderStatus: order.status, orderReference: order.reference };
            if (!matchesPayment(payment, snapshot)) return { rollback: true, value: failure(409, 'Xendit payment details need staff review.') };
            if (snapshot.status === 'confirmed') await applyConfirmedPayment(transaction, payment, snapshot.reference || null);
            else if (snapshot.status === 'failed') await applyFailedPayment(transaction, payment, snapshot.reference);
            else if (snapshot.status === 'pending') {
              if (!await transaction.hasEligiblePickupItems(orderId)) return { rollback: true, value: failure(409, 'This order contains a listing that is no longer eligible for pickup. Contact support.') };
              if (!snapshot.checkoutUrl) return { rollback: true, value: failure(503, 'Could not retrieve the existing test checkout. Try again.') };
              return { value: success({ payment: { ...paymentView(payment), checkoutUrl: snapshot.checkoutUrl }, idempotentReplay: true }) };
            }
            return { value: success({ payment: paymentView(await transaction.findPaymentByIdForUpdate(Number(existing.id))), idempotentReplay: true }) };
          }
          return { value: success({ payment: paymentView(existing), idempotentReplay: true }) };
        }
        if (xenditTest && !await transaction.hasEligiblePickupItems(orderId)) {
          return { rollback: true, value: failure(409, 'This order contains a listing that is no longer eligible for pickup. Contact support.') };
        }
        // The order lock prevents parallel requests from exposing multiple hosted checkouts.
        let providerIntent;
        try {
          providerIntent = await provider.createIntent({
            orderId, orderReference: expectedTestReference(order.reference, quote.paymentPlan),
            expiresAt: balancePayment ? new Date(Date.now() + 20 * 60_000) : order.expiresAt, amountCentavos: quote.amountCentavos,
            currency: quote.currency, paymentPlan: quote.paymentPlan, policyVersion: quote.policyVersion,
            idempotencyKey: `nearpill:order:${orderId}:${idempotencyKey}`,
          });
        } catch {
          return { rollback: true, value: failure(503, 'Payment provider is unavailable. Try again from your order.') };
        }
        if (!providerIntent?.externalId) return { rollback: true, value: failure(503, 'Payment provider did not create an intent.') };
        const paymentId = await transaction.createPaymentIntent({
          orderId, amountCentavos: quote.amountCentavos, currency: quote.currency,
          provider: providerId, providerPaymentId: providerIntent.externalId, paymentMethod: providerId,
          paymentPlan: quote.paymentPlan, policyVersion: quote.policyVersion,
          paymentReference: providerIntent.reference || null, idempotencyKey,
        });
        if (String(order.status) === 'reserved') await transaction.updateOrderStatus(orderId, 'awaiting_payment');
        await transaction.appendAudit(userId, 'CREATE_PAYMENT_INTENT', `Created provider payment intent for order ${order.reference}.`);
        return { value: success({
          payment: { id: paymentId, orderId, amountCentavos: quote.amountCentavos, amount: quote.amountCentavos / 100,
            currency: quote.currency, provider: providerId, providerPaymentId: providerIntent.externalId,
            paymentPlan: quote.paymentPlan, policyVersion: quote.policyVersion, paymentStatus: 'pending',
            checkoutUrl: providerIntent.checkoutUrl || null },
          idempotentReplay: false,
        }, 201) };
      });
    },

    async processProviderWebhook(providerIdValue, { rawBody = '', headers = {} } = {}) {
      const providerId = String(providerIdValue || '').trim().toLowerCase();
      const provider = providerRegistry.get(providerId);
      if (!provider) return failure(404, 'Payment provider is not configured.');
      const verified = await provider.verifyWebhook({ rawBody: String(rawBody), headers: headersObject(headers) });
      if (!verified?.ok) return failure(401, 'Invalid webhook signature.');
      if (verified.ignored) return success({ received: true, ignored: true });
      const event = verified.event || {};
      const eventType = normalizeProviderEventType(event.type);
      const eventId = String(event.eventId || '').trim();
      if (!eventType || !eventId || eventId.length > 200) return failure(400, 'Invalid payment event.');
      const rawBodyHash = createHash('sha256').update(String(rawBody)).digest('hex');

      return repository.withTransaction(async (transaction) => {
        const inserted = await transaction.insertProviderEvent({
          provider: providerId, eventId, eventType,
          providerPaymentId: event.providerPaymentId || null,
          providerRefundId: event.providerRefundId || null,
          amountCentavos: event.amountCentavos ?? null,
          currency: event.currency || null,
          rawBodyHash, occurredAt: event.occurredAt || null,
        });
        if (!inserted) return { value: success({ received: true, duplicate: true }) };

        const payment = event.providerPaymentId
          ? await transaction.findPaymentByExternalIdForUpdate(providerId, event.providerPaymentId)
          : null;
        if (!payment) {
          await transaction.createReconciliation({ provider: providerId, eventId, reason: 'unmatched_provider_event', details: event.providerPaymentId || event.providerRefundId || null });
          await transaction.markProviderEvent(eventId, providerId, 'reconciliation_required');
          return { value: success({ received: true, reconciliationRequired: true }) };
        }
        payment.userId = payment.userId || null;
        const mismatch = event.amountCentavos !== undefined && Number(event.amountCentavos) !== Number(payment.amountCentavos) ? 'amount_mismatch'
          : event.currency && event.currency !== payment.currency ? 'currency_mismatch'
          : providerId === 'xendit-test' && event.orderReference !== expectedTestReference(payment.orderReference, payment.paymentPlan) ? 'order_reference_mismatch' : null;
        if (mismatch) {
          if (!isSettledPayment(payment.paymentStatus)) await transaction.updatePaymentStatus(Number(payment.id), 'reconciliation_required');
          await transaction.createReconciliation({ paymentId: Number(payment.id), provider: providerId, eventId, reason: mismatch });
          await transaction.markProviderEvent(eventId, providerId, 'reconciliation_required');
          return { value: success({ received: true, reconciliationRequired: true }) };
        }

        if (eventType === 'payment.confirmed' && !(await applyConfirmedPayment(transaction, payment, event.reference || null, eventId))) {
          await transaction.markProviderEvent(eventId, providerId, 'reconciliation_required');
          return { value: success({ received: true, reconciliationRequired: true }) };
        }
        if (eventType === 'payment.failed') await applyFailedPayment(transaction, payment, event.reference);
        if (eventType.startsWith('refund.')) {
          if (!event.providerRefundId) {
            await transaction.createReconciliation({ paymentId: Number(payment.id), provider: providerId, eventId, reason: 'missing_refund_identifier' });
            await transaction.markProviderEvent(eventId, providerId, 'reconciliation_required');
            return { value: success({ received: true, reconciliationRequired: true }) };
          }
          const refund = await transaction.findRefundByExternalIdForUpdate(providerId, event.providerRefundId);
          if (!refund) {
            await transaction.createReconciliation({ paymentId: Number(payment.id), provider: providerId, eventId, reason: 'unmatched_refund_event', details: event.providerRefundId });
            await transaction.markProviderEvent(eventId, providerId, 'reconciliation_required');
            return { value: success({ received: true, reconciliationRequired: true }) };
          }
          if (event.amountCentavos !== undefined && Number(event.amountCentavos) !== Number(refund.amountCentavos)) {
            await transaction.updatePaymentStatus(Number(payment.id), 'reconciliation_required');
            await transaction.createReconciliation({ paymentId: Number(payment.id), provider: providerId, eventId, reason: 'refund_amount_mismatch' });
          } else if (eventType === 'refund.confirmed') {
            await applyConfirmedRefund(transaction, payment, refund);
          } else {
            await transaction.updateRefundStatus(Number(refund.id), 'failed');
            await transaction.updatePaymentStatus(Number(payment.id), 'confirmed');
          }
        }
        await transaction.markProviderEvent(eventId, providerId, 'processed');
        return { value: success({ received: true, duplicate: false }) };
      });
    },

    async requestRefund(actorIdValue, paymentIdValue, body = {}) {
      const actorId = Number(actorIdValue);
      const paymentId = Number(paymentIdValue);
      if (!paymentPolicy.refundsEnabled) return failure(409, 'Refund requests are not enabled by the configured payment policy.');
      if (!Number.isInteger(paymentId) || paymentId <= 0) return failure(400, 'Invalid payment ID.');
      const reason = String(body.reason || '').trim();
      if (!reason || reason.length > 1000) return failure(400, 'A refund reason is required.');
      const current = await repository.findPaymentById(paymentId);
      if (!current) return failure(404, 'Payment not found.');
      const existingRefund = await repository.findPendingRefundForPayment(paymentId);
      if (existingRefund) {
        return success({ refund: { ...existingRefund, amountCentavos: Number(existingRefund.amountCentavos), idempotentReplay: true } });
      }
      if (current.paymentStatus !== 'confirmed') return failure(409, 'Only confirmed payments can enter refund processing.');
      const provider = providerRegistry.get(current.provider);
      if (!provider) return failure(503, 'Payment provider is not configured.');
      const refundIdempotencyKey = `nearpill:refund:${paymentId}`;
      const providerRefund = await provider.requestRefund({
        paymentExternalId: current.providerPaymentId,
        amountCentavos: Number(current.amountCentavos),
        currency: current.currency,
        reason,
        idempotencyKey: refundIdempotencyKey,
      });
      if (!providerRefund?.externalId) return failure(503, 'Payment provider did not accept the refund request.');
      return repository.withTransaction(async (transaction) => {
        const locked = await transaction.findPaymentByIdForUpdate(paymentId);
        if (!locked) return { rollback: true, value: failure(404, 'Payment not found.') };
        if (locked.paymentStatus !== 'confirmed') return { rollback: true, value: failure(409, 'Payment is no longer eligible for refund.') };
        const refundId = await transaction.createRefund({ paymentId, amountCentavos: Number(locked.amountCentavos), provider: locked.provider, providerRefundId: providerRefund.externalId, idempotencyKey: refundIdempotencyKey, reason, requestedBy: actorId });
        await transaction.updatePaymentStatus(paymentId, 'refund_pending');
        await transaction.appendAudit(actorId, 'REQUEST_REFUND', `Requested provider refund for payment ${paymentId}.`);
        return { value: success({ refund: { id: refundId, paymentId, amountCentavos: Number(locked.amountCentavos), provider: locked.provider, providerRefundId: providerRefund.externalId, status: 'pending' } }, 201) };
      });
    },

    async reconcilePayment(actorIdValue, paymentIdValue) {
      const actorId = Number(actorIdValue);
      const paymentId = Number(paymentIdValue);
      if (!Number.isInteger(paymentId) || paymentId <= 0) return failure(400, 'Invalid payment ID.');
      const current = await repository.findPaymentById(paymentId);
      if (!current) return failure(404, 'Payment not found.');
      const provider = providerRegistry.get(current.provider);
      if (!provider) return failure(503, 'Payment provider is not configured.');
      const snapshot = await provider.getPayment(current.providerPaymentId);
      if (!snapshot) return failure(503, 'Payment provider lookup failed.');
      const pendingRefund = await repository.findPendingRefundForPayment(paymentId);
      const refundSnapshot = pendingRefund ? await provider.getRefund(pendingRefund.providerRefundId) : null;
      return repository.withTransaction(async (transaction) => {
        const locked = await transaction.findPaymentByIdForUpdate(paymentId);
        if (!locked) return { rollback: true, value: failure(404, 'Payment not found.') };
        if (!matchesPayment(locked, snapshot)) {
          if (!isSettledPayment(locked.paymentStatus)) await transaction.updatePaymentStatus(paymentId, 'reconciliation_required');
          await transaction.createReconciliation({ paymentId, provider: locked.provider, reason: 'provider_snapshot_mismatch', details: JSON.stringify({ amountCentavos: snapshot.amountCentavos, currency: snapshot.currency }) });
        } else if (snapshot.status === 'confirmed') {
          await applyConfirmedPayment(transaction, locked, snapshot.reference || null);
        } else if (snapshot.status === 'failed' && !isSettledPayment(locked.paymentStatus)) {
          await transaction.updatePaymentStatus(paymentId, 'failed', snapshot.reference || null);
        }
        const refund = await transaction.findPendingRefundForPaymentForUpdate(paymentId);
        if (refund && refundSnapshot?.status === 'confirmed') await applyConfirmedRefund(transaction, locked, refund);
        if (refund && refundSnapshot?.status === 'failed') {
          await transaction.updateRefundStatus(Number(refund.id), 'failed');
          await transaction.updatePaymentStatus(paymentId, 'confirmed');
        }
        await transaction.appendAudit(actorId, 'RECONCILE_PAYMENT', `Reconciled payment ${paymentId} against provider evidence.`);
        const refreshed = await transaction.findPaymentByIdForUpdate(paymentId);
        return { value: success({ payment: paymentView(refreshed), reconciled: true }) };
      });
    },

    async getOrderPayment(userIdValue, orderIdValue) {
      const userId = Number(userIdValue); const orderId = Number(orderIdValue);
      if (!Number.isInteger(orderId) || orderId <= 0) return failure(400, 'Invalid order ID.');
      return success({ payment: paymentView(await repository.findOrderPaymentForActor(orderId, userId)) });
    },

    async refreshTestOrderPayment(userId, orderId) {
      const current = await repository.findOrderPaymentForActor(orderId, userId);
      if (!current || current.provider !== 'xendit-test' || current.paymentStatus !== 'pending' || !current.providerPaymentId) {
        return success({ payment: paymentView(current) });
      }
      return refreshPendingTestPayment(current, userId);
    },

    async refreshDueTestPayments(afterId) {
      const due = await repository.listDueTestPayments(afterId);
      for (const payment of due) {
        try { await refreshPendingTestPayment(payment); }
        catch (error) { console.error('scheduled_payment_check_failed', { code: error?.code }); }
      }
      return Number(due.at(-1)?.id ?? 0);
    },

    async getPayment(userIdValue, paymentIdValue) {
      const userId = Number(userIdValue); const paymentId = Number(paymentIdValue);
      if (!Number.isInteger(paymentId) || paymentId <= 0) return failure(400, 'Invalid payment ID.');
      const payment = await repository.findPaymentForActor(paymentId, userId);
      if (!payment) return failure(404, 'Payment not found.');
      return success(paymentView(payment));
    },
  });
}
