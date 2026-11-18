import { createHash, timingSafeEqual } from 'node:crypto';

const apiOrigin = 'https://api.xendit.co';
const testCheckoutHosts = new Set(['checkout-staging.xendit.co', 'dev.xen.to']);
const sessionIdPattern = /^ps-[a-z0-9-]{20,64}$/i;
const paymentIdPattern = /^py-[a-z0-9-]{20,64}$/i;

function centavos(amount) {
  if (typeof amount !== 'number' || !/^\d+(\.\d{1,2})?$/.test(String(amount))) return null;
  const result = Math.round(amount * 100);
  return Number.isSafeInteger(result) ? result : null;
}

function testCheckoutUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.port && !url.username && !url.password && testCheckoutHosts.has(url.hostname)) {
      return url.href;
    }
  } catch {}
  return null;
}

function matchesToken(received, expected) {
  return typeof received === 'string' && timingSafeEqual(
    createHash('sha256').update(received).digest(),
    createHash('sha256').update(expected).digest(),
  );
}

export function createXenditTestProvider({ secretKey, webhookToken, publicAppUrl, request = fetch, now = Date.now }) {
  if (!/^xnd_development_[A-Za-z0-9_-]+$/.test(secretKey) || !webhookToken) {
    throw new TypeError('Xendit Test Mode credentials are required.');
  }
  const authorization = `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`;

  async function call(path, body) {
    const response = await request(`${apiOrigin}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: authorization, 'Content-Type': 'application/json', ...(path.startsWith('/v3/payments/') ? { 'api-version': '2024-11-11' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    });
    if (response.status === 404 && !body) return null;
    if (!response.ok) throw new Error('Xendit Test Mode did not accept the payment request.');
    return response.json();
  }

  function isTestSession(session, id) {
    return session?.payment_session_id === id && sessionIdPattern.test(id) &&
      session.session_type === 'PAY' && session.mode === 'PAYMENT_LINK' &&
      session.country === 'PH' && session.currency === 'PHP' &&
      /^NP-TEST-/.test(session.reference_id ?? '');
  }

  async function getPayment(sessionId) {
    if (typeof sessionId !== 'string' || !sessionIdPattern.test(sessionId)) return null;
    const session = await call(`/sessions/${sessionId}`);
    if (!isTestSession(session, sessionId)) return null;
    const amountCentavos = centavos(session.amount);
    if (amountCentavos === null || amountCentavos <= 0) return null;
    const base = { amountCentavos, currency: 'PHP', reference: session.reference_id, orderReference: session.reference_id };
    if (session.status === 'ACTIVE') {
      return { ...base, status: 'pending', checkoutUrl: testCheckoutUrl(session.payment_link_url) };
    }
    if (['EXPIRED', 'CANCELED'].includes(session.status)) return { ...base, status: 'failed' };
    if (session.status !== 'COMPLETED' || typeof session.payment_id !== 'string' || !paymentIdPattern.test(session.payment_id)) return null;

    const payment = await call(`/v3/payments/${session.payment_id}`);
    if (!payment || payment.payment_id !== session.payment_id || payment.status !== 'SUCCEEDED' ||
        payment.country !== 'PH' || payment.currency !== 'PHP' || payment.channel_code !== 'GCASH' ||
        payment.reference_id !== session.reference_id || payment.business_id !== session.business_id ||
        !Array.isArray(payment.captures) || payment.captures.length === 0) return null;
    const captures = payment.captures.map((capture) => centavos(capture?.capture_amount));
    if (captures.some((amount) => amount === null || amount <= 0) ||
        captures.reduce((total, amount) => total + amount, 0) !== amountCentavos) return null;
    return { ...base, status: 'confirmed', reference: payment.payment_id };
  }

  return Object.freeze({
    id: 'xendit-test',
    async createIntent({ orderId, orderReference, amountCentavos, currency, expiresAt }) {
      const currentTime = now();
      const deadline = Math.min(new Date(expiresAt).getTime(), currentTime + 30 * 60_000);
      if (currency !== 'PHP' || !Number.isSafeInteger(amountCentavos) || amountCentavos < 100 || amountCentavos > 10_000_000 ||
          !/^NP-TEST-/.test(orderReference) || !Number.isFinite(deadline) || deadline - currentTime < 11 * 60_000) return null;
      const returnUrl = publicAppUrl.startsWith('https://')
        ? new URL(`/app/orders?testOrder=${orderId}`, publicAppUrl).href : null;
      const session = await call('/sessions', {
        reference_id: orderReference,
        session_type: 'PAY',
        mode: 'PAYMENT_LINK',
        country: 'PH',
        currency: 'PHP',
        amount: amountCentavos / 100,
        allowed_payment_channels: ['GCASH'],
        allow_save_payment_method: 'DISABLED',
        expires_at: new Date(deadline).toISOString(),
        description: 'NearPill test order',
        ...(returnUrl ? { success_return_url: returnUrl, cancel_return_url: returnUrl } : {}),
      });
      const sessionId = session?.payment_session_id;
      const checkoutUrl = testCheckoutUrl(session?.payment_link_url);
      if (!isTestSession(session, sessionId) || session.reference_id !== orderReference || session.status !== 'ACTIVE' ||
          centavos(session.amount) !== amountCentavos || !checkoutUrl) return null;
      return { externalId: sessionId, reference: orderReference, checkoutUrl };
    },
    getPayment,
    async verifyWebhook({ rawBody, headers }) {
      if (!matchesToken(headers['x-callback-token'], webhookToken)) return { ok: false };
      let body;
      try { body = JSON.parse(rawBody); } catch { return { ok: false }; }
      if (!body || typeof body.event !== 'string') return { ok: false };
      const completed = body.event === 'payment_session.completed';
      if (!completed && body.event !== 'payment_session.expired') return { ok: true, ignored: true };
      const sessionId = body.data?.payment_session_id;
      // The Test and save sample uses a fixed legacy ID and never represents a checkout.
      if (sessionId === undefined && body.data?.id === 'ps-579c8d61f23fa4ca35e52da4' &&
          body.created === '2020-04-20T16:25:52Z') return { ok: true, ignored: true };
      const payment = await getPayment(sessionId);
      if (!completed && payment?.status === 'confirmed') return { ok: true, ignored: true };
      // A mismatched or temporarily unavailable provider read must never confirm a payment.
      if (payment?.status !== (completed ? 'confirmed' : 'failed')) throw new Error('Xendit session state could not be verified.');
      return {
        ok: true,
        event: {
          type: completed ? 'payment.confirmed' : 'payment.failed',
          eventId: `${sessionId}:${body.event}`,
          providerPaymentId: sessionId,
          amountCentavos: payment.amountCentavos,
          currency: payment.currency,
          reference: payment.reference,
          orderReference: payment.orderReference,
        },
      };
    },
    async requestRefund() { return null; },
    async getRefund() { return null; },
  });
}
