import { createHmac, timingSafeEqual } from 'node:crypto';

function signature(secret, timestamp, rawBody) {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export function signFixtureWebhook({ secret, timestamp, rawBody }) {
  return signature(secret, timestamp, rawBody);
}

export function createSignedFixturePaymentProvider({
  id = 'fixture',
  secret = 'fixture-secret',
  now = () => Date.now(),
  toleranceMs = 5 * 60 * 1000,
} = {}) {
  const intents = new Map();
  const intentsByIdempotency = new Map();
  const refunds = new Map();
  const refundsByIdempotency = new Map();
  let nextPayment = 1;
  let nextRefund = 1;

  return Object.freeze({
    id,
    async createIntent(input) {
      if (intentsByIdempotency.has(input.idempotencyKey)) return intentsByIdempotency.get(input.idempotencyKey);
      const externalId = `pay_${nextPayment++}`;
      const record = { externalId, status: 'pending', amountCentavos: input.amountCentavos, currency: input.currency, checkoutUrl: `https://payments.invalid/${externalId}` };
      intents.set(externalId, record);
      intentsByIdempotency.set(input.idempotencyKey, record);
      return record;
    },
    async verifyWebhook({ rawBody, headers }) {
      const timestamp = Number(headers['x-fixture-timestamp']);
      const supplied = String(headers['x-fixture-signature'] || '');
      if (!Number.isFinite(timestamp) || Math.abs(now() - timestamp * 1000) > toleranceMs) return { ok: false, reason: 'stale' };
      const expected = signature(secret, timestamp, rawBody);
      const left = Buffer.from(supplied, 'hex');
      const right = Buffer.from(expected, 'hex');
      if (left.length !== right.length || !timingSafeEqual(left, right)) return { ok: false, reason: 'signature' };
      let payload;
      try { payload = JSON.parse(rawBody); } catch { return { ok: false, reason: 'payload' }; }
      return { ok: true, event: payload };
    },
    async getPayment(externalId) { return intents.get(externalId) ?? null; },
    async requestRefund({ paymentExternalId, amountCentavos, idempotencyKey }) {
      if (refundsByIdempotency.has(idempotencyKey)) return refundsByIdempotency.get(idempotencyKey);
      const externalId = `ref_${nextRefund++}`;
      const record = { externalId, paymentExternalId, amountCentavos, status: 'pending' };
      refunds.set(externalId, record);
      refundsByIdempotency.set(idempotencyKey, record);
      return record;
    },
    async getRefund(externalId) { return refunds.get(externalId) ?? null; },
    setPayment(externalId, patch) { intents.set(externalId, { ...(intents.get(externalId) || { externalId }), ...patch }); },
    setRefund(externalId, patch) { refunds.set(externalId, { ...(refunds.get(externalId) || { externalId }), ...patch }); },
  });
}
