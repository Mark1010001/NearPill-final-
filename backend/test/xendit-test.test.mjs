import assert from 'node:assert/strict';
import test from 'node:test';
import { createXenditTestProvider } from '../src/infrastructure/xendit-test.js';

const sessionId = 'ps-01234567-0123-0123-0123-012345678901';
const paymentId = 'py-01234567-0123-0123-0123-012345678901';
const reference = 'NP-TEST-1234567890-1234';
const checkoutUrl = 'https://checkout-staging.xendit.co/example';
const now = Date.UTC(2026, 10, 11);

function fixture() {
  const calls = [];
  const session = {
    payment_session_id: sessionId, payment_id: paymentId, business_id: 'fixture',
    session_type: 'PAY', mode: 'PAYMENT_LINK', country: 'PH', currency: 'PHP',
    reference_id: reference, amount: 12.34, status: 'ACTIVE', payment_link_url: checkoutUrl,
  };
  const payment = {
    payment_id: paymentId, business_id: 'fixture', reference_id: reference,
    country: 'PH', currency: 'PHP', channel_code: 'GCASH', status: 'SUCCEEDED',
    captures: [{ capture_amount: 12.34 }],
  };
  const provider = createXenditTestProvider({
    secretKey: 'xnd_development_fixture', webhookToken: 'fixture-token', publicAppUrl: 'http://localhost:5173',
    now: () => now,
    request: async (url, options) => {
      calls.push({ url, options });
      return Response.json(url.endsWith(paymentId) ? payment : session);
    },
  });
  return { calls, session, payment, provider };
}

test('hosted checkout sends only GCash, uses the reserved amount and rejects unexpected checkout hosts', async () => {
  const { provider, calls, session } = fixture();
  const order = { orderId: 1, orderReference: reference, amountCentavos: 1234, currency: 'PHP', expiresAt: new Date(now + 900_000) };
  assert.deepEqual(await provider.createIntent(order), { externalId: sessionId, reference, checkoutUrl });
  assert.equal(calls[0].url, 'https://api.xendit.co/sessions');
  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(body.allowed_payment_channels, ['GCASH']);
  assert.equal(body.amount, 12.34);
  assert.equal(body.expires_at, order.expiresAt.toISOString());
  assert.equal(body.success_return_url, undefined);
  session.payment_link_url = 'https://checkout.xendit.co/live';
  assert.equal(await provider.createIntent(order), null);
});

test('webhook token and server-verified GCash capture are both required for confirmation', async () => {
  const { provider, calls, session, payment } = fixture();
  session.status = 'COMPLETED';
  const rawBody = JSON.stringify({ event: 'payment_session.completed', data: { payment_session_id: sessionId } });
  assert.deepEqual(await provider.verifyWebhook({ rawBody, headers: {} }), { ok: false });
  assert.equal(calls.length, 0);
  const headers = { 'x-callback-token': 'fixture-token' };
  const result = await provider.verifyWebhook({ rawBody, headers });
  assert.equal(result.event.type, 'payment.confirmed');
  assert.equal(result.event.amountCentavos, 1234);
  assert.equal(result.event.providerPaymentId, sessionId);
  assert.equal(result.event.orderReference, reference);
  const lateExpiry = JSON.stringify({ event: 'payment_session.expired', data: { payment_session_id: sessionId } });
  assert.deepEqual(await provider.verifyWebhook({ rawBody: lateExpiry, headers }), { ok: true, ignored: true });
  assert.equal(calls[1].url, `https://api.xendit.co/v3/payments/${paymentId}`);
  payment.captures[0].capture_amount = 12.33;
  await assert.rejects(provider.verifyWebhook({ rawBody, headers }), /could not be verified/);
  payment.captures[0].capture_amount = 12.34;
  payment.channel_code = 'OTHER';
  await assert.rejects(provider.verifyWebhook({ rawBody, headers }), /could not be verified/);
});

test('the authenticated dashboard samples are acknowledged without looking up or confirming payments', async () => {
  const { provider, calls } = fixture();
  const headers = { 'x-callback-token': 'fixture-token' };
  const sample = { created: '2020-04-20T16:25:52Z', data: { id: 'ps-579c8d61f23fa4ca35e52da4' } };
  for (const event of ['payment_session.completed', 'payment_session.expired']) {
    const rawBody = JSON.stringify({ ...sample, event });
    assert.deepEqual(await provider.verifyWebhook({ rawBody, headers: {} }), { ok: false });
    assert.deepEqual(await provider.verifyWebhook({ rawBody, headers }), { ok: true, ignored: true });
  }
  assert.equal(calls.length, 0);
});
