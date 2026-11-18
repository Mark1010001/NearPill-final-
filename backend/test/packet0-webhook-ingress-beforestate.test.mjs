import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { readWebhookBodyWithinLimit } from '../src/http/webhook-ingress.js';

// Packet 0: source-level wiring test against the existing Hono middleware
// callback, plus real Web Request streaming tests of the bounded raw-body
// reader. No installed Hono, network, or provider is claimed by these tests.
const appSource = readFileSync(new URL('../src/http/app.ts', import.meta.url), 'utf8');
const declaration = "app.use('/api/v1/*', async (c, next) => {";
const begin = appSource.indexOf(declaration);
assert.ok(begin >= 0, 'canonical API request middleware is present');
const end = appSource.indexOf('\n  });', begin);
assert.ok(end > begin, 'canonical API request middleware boundary is present');
const registration = appSource.slice(begin, end + '\n  });'.length);

function executeCurrentApiMiddleware(path, body, { declaredLength, streaming = false, preconsume = false } = {}) {
  const events = [];
  let middleware;
  const raw = new Request(`https://test.invalid${path}`, {
    method: 'POST',
    headers: declaredLength === undefined ? undefined : { 'content-length': String(declaredLength) },
    body: body,
    ...(streaming ? { duplex: 'half' } : {}),
  });
  const context = {
    req: { path, method: 'POST', raw },
    header: () => {},
    set: (key, value) => {
      if (key === 'trustedProxyIps') {
        assert.ok(value instanceof Set, 'proxy trust must be a reviewed server-side Set');
        events.push('proxy-trust-injected');
      } else {
        events.push(`set:${key}:${value.length}`);
      }
    },
    json: (value, status) => ({ value, status }),
  };
  const adapters = {
    app: { use: (_path, handler) => { middleware = handler; } },
    services: {},
    reviewedProxyPeers: new Set(),
    bodyLimit: ({ maxSize, onError }) => async (c, next) => {
      events.push('size-limiter-entered');
      // This adapter intentionally trusts the declared length to simulate a
      // misleading Content-Length. The independent byte reader must not.
      if (declaredLength !== undefined && declaredLength > maxSize) return onError(c);
      return next();
    },
    readWebhookBodyWithinLimit: async (request, limit) => {
      events.push('bounded-body-read');
      return readWebhookBodyWithinLimit(request, limit);
    },
    requestContext: async (_c, next) => { events.push('request-context'); return next(); },
  };
  runInNewContext(registration, adapters, { timeout: 1000 });
  assert.equal(typeof middleware, 'function');
  return (async () => {
    if (preconsume) await raw.text();
    const response = await middleware(context, async () => { events.push('downstream'); });
    return { events, response };
  })();
}

test('Packet 0: oversized webhook is rejected before unbounded capture or business logic', async () => {
  const { events, response } = await executeCurrentApiMiddleware(
    '/api/v1/payments/webhooks/fixture', 'x'.repeat(128 * 1024), { declaredLength: 32 },
  );
  assert.deepEqual(events, ['proxy-trust-injected', 'size-limiter-entered', 'bounded-body-read']);
  assert.equal(response.status, 413);
});

test('Packet 0: oversized declared length short-circuits without any raw body read', async () => {
  const { events, response } = await executeCurrentApiMiddleware(
    '/api/v1/payments/webhooks/fixture', 'x'.repeat(128 * 1024), { declaredLength: 128 * 1024 },
  );
  assert.deepEqual(events, ['proxy-trust-injected', 'size-limiter-entered']);
  assert.equal(response.status, 413);
});

test('Packet 0: non-webhook request uses existing Hono limiter and downstream context', async () => {
  const { events } = await executeCurrentApiMiddleware('/api/v1/orders', '{}');
  assert.deepEqual(events, ['proxy-trust-injected', 'size-limiter-entered', 'request-context', 'downstream']);
});

test('Packet 0: accepted webhook preserves the UTF-8 text for the signature-verifier contract', async () => {
  const { events } = await executeCurrentApiMiddleware('/api/v1/payments/webhooks/fixture', '{"a":"é"}');
  assert.deepEqual(events, ['proxy-trust-injected', 'size-limiter-entered', 'bounded-body-read', 'set:rawWebhookBody:9', 'request-context', 'downstream']);
});

test('Packet 0: missing Content-Length with chunked oversized stream rejects without reading the whole request', async () => {
  let pulls = 0;
  const body = new ReadableStream({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(16 * 1024).fill(120));
      if (pulls >= 30) controller.close();
    },
  });
  const { events, response } = await executeCurrentApiMiddleware(
    '/api/v1/payments/webhooks/fixture', body, { streaming: true },
  );
  assert.equal(response.status, 413);
  assert.deepEqual(events, ['proxy-trust-injected', 'size-limiter-entered', 'bounded-body-read']);
  assert.ok(pulls < 30, `stream read the entire untrusted request (${pulls} chunks)`);
});

test('Packet 0: UTF-8 multibyte body is rejected by bytes, not decoded character count', async () => {
  const result = await readWebhookBodyWithinLimit(new Request('https://test.invalid', {
    method: 'POST', body: 'é'.repeat(40_000),
  }), 64 * 1024);
  assert.equal(result.ok, false);
});

test('Packet 0: exact byte limit is accepted and retains original body text', async () => {
  const text = '{"signature":"' + 'ø'.repeat(32756) + '"}';
  const bytes = new TextEncoder().encode(text).byteLength;
  const result = await readWebhookBodyWithinLimit(new Request('https://test.invalid', {
    method: 'POST', body: text,
  }), bytes);
  assert.deepEqual(result, { ok: true, rawBody: text });
});

// Packet 0 negative: the signed webhook contract cannot silently replace
// malformed UTF-8 bytes with U+FFFD before provider signature verification.
// This would make different byte strings share the same decoded HMAC input.
test('Packet 0: malformed UTF-8 webhook is rejected before signature verification', async () => {
  const malformed = new Blob([Uint8Array.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0xff, 0x7d])]);
  const direct = await readWebhookBodyWithinLimit(new Request('https://test.invalid', {
    method: 'POST', body: malformed,
  }), 64 * 1024);
  assert.deepEqual(direct, { ok: false, reason: 'invalid-utf8' });
  const { events, response } = await executeCurrentApiMiddleware(
    '/api/v1/payments/webhooks/fixture', malformed,
  );
  assert.deepEqual(events, ['proxy-trust-injected', 'size-limiter-entered', 'bounded-body-read']);
  assert.equal(response.status, 400);
});

test('Packet 0: valid literal U+FFFD remains valid signed UTF-8 text', async () => {
  const body = '{"a":"\uFFFD"}';
  const accepted = await readWebhookBodyWithinLimit(new Request('https://test.invalid', {
    method: 'POST', body,
  }), 64 * 1024);
  assert.deepEqual(accepted, { ok: true, rawBody: body });
});

test('Packet 0: UTF-8 BOM bytes are not silently stripped from signed webhook text', async () => {
  const signedBytes = new Blob([Uint8Array.from([0xef, 0xbb, 0xbf]), '{"id":1}']);
  const result = await readWebhookBodyWithinLimit(new Request('https://test.invalid', {
    method: 'POST', body: signedBytes,
  }), 64 * 1024);
  assert.deepEqual(result, { ok: true, rawBody: '\uFEFF{"id":1}' });
});

// Packet 0 negative: a hostile or interrupted upload stream is not a valid
// signed payload. Reject a failed read with a stable client error instead of
// allowing the thrown stream exception to escape the Hono middleware as 500.
test('Packet 0: failed mid-stream webhook body rejects before downstream payment handling', async () => {
  function brokenBody() {
    let readCount = 0;
    return new ReadableStream({
      pull(controller) {
        readCount += 1;
        if (readCount === 1) controller.enqueue(new TextEncoder().encode('{"id":'));
        else controller.error(new Error('private simulated upload error'));
      },
    });
  }
  const direct = await readWebhookBodyWithinLimit(new Request('https://test.invalid/', {
    method: 'POST', body: brokenBody(), duplex: 'half',
  }), 64 * 1024);
  assert.deepEqual(direct, { ok: false, reason: 'read-error' });

  const { events, response } = await executeCurrentApiMiddleware(
    '/api/v1/payments/webhooks/fixture', brokenBody(), { streaming: true },
  );
  assert.equal(response.status, 400);
  assert.deepEqual(events, ['proxy-trust-injected', 'size-limiter-entered', 'bounded-body-read']);
  assert.doesNotMatch(JSON.stringify(response), /private simulated upload error/u);
});

// Packet 0 negative: request bodies can be disturbed by an upstream reader.
// Request.clone() throws on a consumed body; the ingress must reject the
// request without treating that failure as an internal payment error.
test('Packet 0: consumed webhook body fails closed when Request.clone cannot run', async () => {
  const request = new Request('https://test.invalid/api/v1/payments/webhooks/fixture', {
    method: 'POST', body: '{"id":"fixture"}',
  });
  await request.text();
  const result = await readWebhookBodyWithinLimit(request, 64 * 1024);
  assert.deepEqual(result, { ok: false, reason: 'read-error' });
  const { events, response } = await executeCurrentApiMiddleware(
    '/api/v1/payments/webhooks/fixture', '{"id":"fixture"}', { preconsume: true },
  );
  assert.equal(response.status, 400);
  assert.deepEqual(events, ['proxy-trust-injected', 'size-limiter-entered', 'bounded-body-read']);
  assert.doesNotMatch(JSON.stringify(response), /unusable|Internal server error/u);
});
