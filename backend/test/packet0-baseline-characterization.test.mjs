import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const bootstrapSource = await readFile(new URL('../src/bootstrap/server.ts', import.meta.url), 'utf8');
const httpAppSource = await readFile(new URL('../src/http/app.ts', import.meta.url), 'utf8');
const routeSource = await readFile(new URL('../src/http/routes/v1/register.ts', import.meta.url), 'utf8');
const authServiceSource = await readFile(new URL('../src/application/auth-service.js', import.meta.url), 'utf8');
const securityRepositorySource = await readFile(new URL('../src/infrastructure/postgres/security-repository.js', import.meta.url), 'utf8');
const paymentSubscriptionServiceSource = await readFile(new URL('../src/application/payment-subscription-service.js', import.meta.url), 'utf8');
const orderServiceSource = await readFile(new URL('../src/application/order-service.js', import.meta.url), 'utf8');
const orderRepositorySource = await readFile(new URL('../src/infrastructure/postgres/order-repository.js', import.meta.url), 'utf8');
const webAppSource = await readFile(new URL('../../web/src/app/App.tsx', import.meta.url), 'utf8');
const webApiSource = await readFile(new URL('../../web/src/api/client.ts', import.meta.url), 'utf8');
const mobileApiSource = await readFile(new URL('../../lib/core/api/api_client.dart', import.meta.url), 'utf8');

function routeSpecs(source) {
  return [...source.matchAll(/\{ id: '([^']+)', method: '([^']+)', path: '([^']+)'/g)]
    .map(([, id, method, path]) => ({ id, method: method.toUpperCase(), path }));
}

// Snapshot the declared auth mode for every canonical route. This catches
// accidental public exposure at the transport contract boundary, but does
// not attest middleware execution, tenant ownership, RLS, or live staging.
const reviewedPublicOperations = new Set([
  'authRegister', 'authSendOtp', 'authVerifyOtp', 'authLogin',
  'authForgotPassword', 'authResetPassword', 'authRefresh', 'authLogout',
  'listMedicines', 'getMedicine', 'listStores', 'nearbyStores',
  'getStore', 'getStoreInventory', 'paymentProviderWebhook',
]);

function assertRouteAuthenticationInventory(source) {
  const matches = [...source.matchAll(/\{ id: '([^']+)', method: '([^']+)', path: '([^']+)'/g)];
  assert.equal(matches.length, 84, 'Packet 0 route inventory changed without review');
  const end = source.indexOf('\n  ];', matches.at(-1).index);
  assert.ok(end > matches.at(-1).index, 'routeSpecs array boundary missing');
  const counts = { none: 0, user: 0, admin: 0 };
  const ids = new Set();
  for (let i = 0; i < matches.length; i++) {
    const [, id, method, path] = matches[i];
    assert.ok(!ids.has(id), `duplicate operationId: ${id}`);
    ids.add(id);
    // Every route is currently a literal one-line RouteSpec with invoke last.
    // The prefix keeps nested handler logic from looking like route metadata.
    const header = source.slice(matches[i].index,
      i + 1 < matches.length ? matches[i + 1].index : end).split(/\binvoke:/)[0];
    const declaredAuth = header.match(/\bauth:\s*'(none|user|admin)'/);
    const actual = declaredAuth?.[1] || 'none';
    const expected = reviewedPublicOperations.has(id) ? 'none'
      : (path.startsWith('/admin/') || id === 'adminUpdateOrderStatus') ? 'admin' : 'user';
    assert.equal(actual, expected, `${id} ${method.toUpperCase()} ${path} route authorization drift`);
    counts[actual]++;
    if (id === 'paymentProviderWebhook') {
      assert.match(header, /\brawBody:\s*true\b/, 'provider webhook must preserve signed raw bytes');
    }
  }
  assert.deepEqual(counts, { none: 15, user: 33, admin: 36 });
  return counts;
}

test('Packet 0: all Hono operations preserve reviewed public, user and admin authentication modes', () => {
  assertRouteAuthenticationInventory(routeSource);
});

test('Packet 0: altered admin, private and webhook route declarations fail the auth inventory gate', () => {
  const weakenedAdmin = routeSource.replace(
    /(id: 'adminAuditLogs'[^\n]*auth: )'admin'/,
    "$1'user'",
  );
  assert.notEqual(weakenedAdmin, routeSource);
  assert.throws(() => assertRouteAuthenticationInventory(weakenedAdmin), /adminAuditLogs.*authorization drift/);

  const exposedOrder = routeSource.replace(
    /(id: 'getOrderPayment'[^\n]*), auth: 'user'/,
    '$1',
  );
  assert.notEqual(exposedOrder, routeSource);
  assert.throws(() => assertRouteAuthenticationInventory(exposedOrder), /getOrderPayment.*authorization drift/);

  const unsignedBody = routeSource.replace(
    /(id: 'paymentProviderWebhook'[^\n]*), rawBody: true/,
    '$1',
  );
  assert.notEqual(unsignedBody, routeSource);
  assert.throws(() => assertRouteAuthenticationInventory(unsignedBody), /provider webhook must preserve signed raw bytes/);
});

// A route metadata inventory alone cannot prove the shared Hono adapter
// actually enforces the declared mode. This source-only characterization
// freezes the current short-circuit order; live HTTP/BFLA tests are still
// required on an installed Node 24 environment.
function assertSharedHonoAuthEnforcement(source) {
  const handlerStart = source.indexOf('function makeHandler(spec: RouteSpec, services: any, prevalidated = false)');
  const specStart = source.indexOf('function routeSpecs(services: any): RouteSpec[]');
  assert.ok(handlerStart >= 0 && specStart > handlerStart, 'canonical shared handler missing');
  const handler = source.slice(handlerStart, specStart);
  const markers = [
    "if (spec.auth && spec.auth !== 'none') {",
    'const authResult = await authenticateContext(c, services.auth);',
    'if (!authResult.ok) return c.json(authResult.body, authResult.status);',
    "if (spec.auth === 'admin' && !adminAccepted(c)) {",
    "return c.json({ error: 'Administrator access required.' }, 403);",
    'const outcome = await spec.invoke({',
  ];
  const positions = markers.map((marker) => {
    const offset = handler.indexOf(marker);
    assert.ok(offset >= 0, `missing shared auth enforcement: ${marker}`);
    assert.equal(handler.indexOf(marker, offset + marker.length), -1,
      `ambiguous duplicate shared auth enforcement: ${marker}`);
    return offset;
  });
  for (let i = 1; i < positions.length; i++) {
    assert.ok(positions[i - 1] < positions[i],
      'authentication, rejection and admin permission must precede invocation');
  }
  assert.match(source, /const v1Handler = makeHandler\(spec, services, true\);/);
  assert.match(source, /app\.openapi\(route, v1Handler as any\);/);
}

test('Packet 0: the single Hono route handler rejects unauthenticated/non-admin requests before invoking use cases', () => {
  assertSharedHonoAuthEnforcement(routeSource);
});

test('Packet 0: removing, bypassing, or deferring shared auth rejection is detected even when all route metadata stays valid', () => {
  const mutations = [
    routeSource.replace("if (spec.auth && spec.auth !== 'none') {", 'if (false) {'),
    routeSource.replace('if (!authResult.ok) return c.json(authResult.body, authResult.status);',
      'if (!authResult.ok) { /* no rejection */ }'),
    routeSource.replace("if (spec.auth === 'admin' && !adminAccepted(c)) {",
      "if (spec.auth === 'admin' && false) {"),
    routeSource.replace("return c.json({ error: 'Administrator access required.' }, 403);",
      "return c.json({ error: 'Administrator access required.' }, 200);"),
    routeSource.replace('const v1Handler = makeHandler(spec, services, true);',
      'const v1Handler = async (c: any) => spec.invoke({ c });'),
  ];
  for (const [index, mutated] of mutations.entries()) {
    assert.notEqual(mutated, routeSource, `negative fixture ${index + 1} must alter a real source boundary`);
    assert.throws(() => assertSharedHonoAuthEnforcement(mutated),
      undefined, `negative fixture ${index + 1} must be rejected`);
    assertRouteAuthenticationInventory(mutated);
  }
});

test('durable auth separates access/refresh/web credentials and stores credential hashes', () => {
  assert.match(authServiceSource, /findActiveSession\(hashCredential\(bearer\), \['access'\]\)/);
  assert.match(authServiceSource, /findActiveSession\(hashCredential\(rawCookie\), \['web'\]\)/);
  assert.match(authServiceSource, /rotateRefreshToken/);
  assert.match(securityRepositorySource, /token_hash/);
  assert.doesNotMatch(securityRepositorySource, /INSERT INTO auth_sessions[^;]*raw_token/is);
});

test('Hono v1 contract preserves the secured API surface after compatibility retirement', () => {
  const specs = routeSpecs(routeSource);
  const unique = new Set(specs.map(({ method, path }) => `${method} ${path}`));
  assert.equal(specs.length, 84);
  assert.equal(unique.size, 84);
  assert.ok(unique.has('POST /auth/change-password'));
  assert.ok(unique.has('POST /auth/logout-all'));
  assert.ok(unique.has('GET /admin/pharmacies/:id/memberships'));
  assert.ok(unique.has('POST /admin/pharmacies/:id/memberships'));
  assert.ok(unique.has('DELETE /admin/pharmacies/:id/memberships/:userId'));
  assert.match(httpAppSource, /app\.get\('\/api\/v1\/health'/);
  assert.doesNotMatch(httpAppSource, /app\.get\('\/api\/health'/);
  assert.match(httpAppSource, /app\.doc\('\/api\/v1\/openapi\.json'/);
  assert.doesNotMatch(routeSource, /compatibilityHandler|app\.on\(spec\.method/);
  assert.match(bootstrapSource, /createHttpApp\(/);
  assert.doesNotMatch(bootstrapSource, /\bexpress\b|app\.listen\(/);
});

test('order behavior is characterized as one-pharmacy reservation with centavo authority', () => {
  assert.match(orderServiceSource, /drugstoreIds\.length !== 1/);
  assert.match(orderServiceSource, /idempotencyKey/);
  assert.match(orderRepositorySource, /FOR UPDATE/);
  assert.match(orderRepositorySource, /reserved_quantity = reserved_quantity \+ \?/);
  assert.match(orderRepositorySource, /INSERT INTO reservations/);
  assert.match(orderRepositorySource, /INSERT INTO stock_movements/);
  assert.match(orderRepositorySource, /total_centavos|unit_price_centavos/);
  assert.doesNotMatch(orderRepositorySource, /stock_count\s*=\s*stock_count\s*-\s*\?/);
  assert.doesNotMatch(orderRepositorySource, /WHEN\s+payment_status\s*=\s*'paid'\s+THEN\s+'refunded'/);
});

test('partner dashboard and subscription derive pharmacy context from active server memberships', () => {
  assert.match(paymentSubscriptionServiceSource, /listActiveMemberships/);
  assert.match(paymentSubscriptionServiceSource, /partnerDashboardForDrugstore/);
  assert.match(paymentSubscriptionServiceSource, /activeSubscriptionForDrugstore/);
  assert.doesNotMatch(paymentSubscriptionServiceSource, /mapping is not configured/i);
});

test('portal session and tenant authority are server-owned', () => {
  assert.match(webApiSource, /credentials:\s*['"]same-origin['"]/);
  assert.match(webApiSource, /\/auth\/me/);
  assert.match(webApiSource, /x-csrf-token/i);
  assert.doesNotMatch(webAppSource, /localStorage\.setItem\(['"]nearpill_session/);
  assert.doesNotMatch(webAppSource, /email\.includes\(['"]admin['"]\)/);
  assert.doesNotMatch(webApiSource, /orders\s*=\s*orders\.filter/);
});

test('mobile refresh persists both rotated credentials after the client migration', () => {
  assert.match(mobileApiSource, /newAccessToken/);
  assert.match(mobileApiSource, /newRefreshToken/);
  assert.match(mobileApiSource, /replaceTokensIfCurrent\(\s*refreshToken,\s*newAccessToken,\s*newRefreshToken/s);
  assert.doesNotMatch(mobileApiSource, /replaceTokensIfCurrent\(\s*refreshToken,\s*newAccessToken,\s*refreshToken/s);
});
