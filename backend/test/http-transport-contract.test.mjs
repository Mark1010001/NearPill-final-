import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');
const packageJson = JSON.parse(await read('package.json'));
const bootstrap = await read('src/bootstrap/server.ts');
const app = await read('src/http/app.ts');
const routes = await read('src/http/routes/v1/register.ts');
const contracts = await read('src/http/contracts.ts');
const login = await read('src/application/login-service.js');
const recovery = await read('src/application/password-recovery-service.js');
const nginx = await read('../infra/nginx/nginx.conf');

const expectedApi = new Set([
  'GET /stores/:id/route',
  'POST /auth/delete-account',
  'POST /auth/register','POST /auth/send-otp','POST /auth/verify-otp','POST /auth/login',
  'POST /auth/forgot-password','POST /auth/reset-password','POST /auth/refresh','POST /auth/logout',
  'POST /auth/logout-all','GET /auth/me','PUT /auth/me','POST /auth/change-password',
  'GET /admin/pharmacies/:id/memberships','POST /admin/pharmacies/:id/memberships','POST /admin/pharmacies/:id/partner-accounts','POST /admin/partner-accounts/check-email','DELETE /admin/pharmacies/:id','GET /admin/customers','DELETE /admin/customers/:id','POST /admin/pharmacies/:id/memberships/:userId/login-email','DELETE /admin/pharmacies/:id/memberships/:userId',
  'GET /medicines','GET /medicines/:id','GET /stores','GET /stores/nearby','GET /stores/:id','GET /stores/:id/inventory',
  'GET /admin/pharmacies','POST /admin/pharmacies','PUT /admin/pharmacies/:id','GET /admin/pharmacies/:id/go-live','PUT /admin/pharmacies/:id/go-live',
  'GET /admin/medicines','POST /admin/medicines','PUT /admin/medicines/:id','PUT /admin/medicines/:id/publication',
  'POST /inventory/update','GET /admin/inventory','PUT /admin/inventory/:id/price',
  'POST /assistant/chat','POST /orders','GET /orders','GET /orders/:id','GET /admin/orders','GET /admin/orders/:id',
  'PUT /orders/:id/status','PUT /orders/:id/cancel','PUT /orders/:id/pickup',
  'GET /partner/dashboard','GET /partner/orders','PUT /partner/orders/:id/pickup','GET /partner/inventory','GET /partner/inventory/catalog','POST /partner/stock-submissions','GET /partner/stock-submissions','GET /admin/stock-submissions','GET /partner/subscription','GET /partner/entitlements','GET /partner/reports/sales',
  'GET /admin/subscriptions','GET /subscription-plans','POST /admin/subscriptions','PUT /admin/subscriptions/:id',
  'POST /orders/:id/payments','POST /payments/webhooks/:provider','GET /orders/:id/payment','POST /orders/:id/payment','GET /payments/:id',
  'POST /admin/payments/:id/refunds','POST /admin/payments/:id/reconcile',
  'GET /admin/metrics','GET /admin/reports/sales','GET /admin/reports/medicines','GET /admin/reports/drugstores','GET /admin/audit-logs',
]);

test('production backend entrypoint is Hono on Node and Express is not a runtime dependency', () => {
  assert.equal(packageJson.main, 'src/bootstrap/server.ts');
  assert.equal(packageJson.scripts.start, 'node --env-file-if-exists=.env src/bootstrap/server.ts');
  assert.equal(packageJson.dependencies.hono, '4.13.13');
  assert.equal(packageJson.dependencies['@hono/node-server'], '2.1.5');
  assert.equal(packageJson.dependencies['@hono/zod-openapi'], '1.6.3');
  assert.equal(packageJson.dependencies.zod, '4.6.7');
  assert.equal(packageJson.dependencies.express, undefined);
  assert.equal(packageJson.dependencies.cors, undefined);
  assert.match(bootstrap, /serve\(\{ fetch: app\.fetch/);
  assert.doesNotMatch(bootstrap, /\bexpress\b|app\.listen\(/);
});

test('v1 transport preserves every pre-cutover API operation through one route table', async () => {
  const { registerApiRoutes } = await import('../src/http/routes/v1/register.ts');
  const specs = registerApiRoutes({ openapi() {} }, {});
  assert.equal(specs.length, expectedApi.size);
  assert.deepEqual(new Set(specs.map(({ method, path }) => `${method.toUpperCase()} ${path}`)), expectedApi);
  assert.match(routes, /app\.openapi\(route, v1Handler as any\)/);
  assert.doesNotMatch(routes, /compatibilityHandler|app\.on\(spec\.method/);
});

test('only the staging review configuration registers prescription routes', async () => {
  const { registerApiRoutes } = await import('../src/http/routes/v1/register.ts');
  const specs = registerApiRoutes({ openapi() {} }, { prescriptionReviewEnabled: true });
  assert.deepEqual(specs.filter(({ path }) => path.includes('prescription-reviews')).map(({ method, path, auth }) => `${method} ${path} ${auth}`), [
    'get /prescription-reviews user', 'post /prescription-reviews user', 'get /partner/prescription-reviews user',
    'get /partner/prescription-reviews/:id/photo user', 'put /partner/prescription-reviews/:id user',
  ]);
});

test('OpenAPI is generated from Zod-backed route definitions under /api/v1', () => {
  assert.match(app, /new OpenAPIHono(?:<[^\n]+>)?\(/);
  assert.match(app, /app\.doc\('\/api\/v1\/openapi\.json'/);
  assert.match(routes, /createRoute\(/);
  assert.match(routes, /request\.body/);
  assert.match(contracts, /from '@hono\/zod-openapi'/);
  assert.match(contracts, /RegisterSchema/);
  assert.match(contracts, /PrescriptionDecisionSchema[\s\S]*reason: z\.string\(\)\.trim\(\)\.min\(3\)\.max\(200\)\.optional\(\)[\s\S]*Give a reason when rejecting/);
  assert.match(contracts, /OrderCreateSchema/);
  assert.match(contracts, /PaymentIntentCreateSchema/);
  assert.match(contracts, /RefundRequestSchema/);
  assert.match(contracts, /\.strict\(\)/);
});

test('health model is exposed only through the canonical v1 API', () => {
  assert.match(app, /app\.get\('\/api\/v1\/live'/);
  assert.match(app, /app\.get\('\/api\/v1\/ready', health\)/);
  assert.match(app, /app\.get\('\/api\/v1\/health', health\)/);
  assert.doesNotMatch(app, /app\.get\('\/api\/health'/);
});

test('superseded unversioned API compatibility is removed after web and mobile cutover', () => {
  assert.doesNotMatch(app, /Deprecation|successor-version|X-NearPill-Compatibility/);
  assert.doesNotMatch(routes, /`\/api\$\{spec\.path\}`/);
});

test('login and password recovery are transport-agnostic application services', () => {
  assert.doesNotMatch(login, /\breq\b|\bres\b|res\.status|res\.json/);
  assert.doesNotMatch(recovery, /res\.status|res\.json|req\.body/);
  assert.match(login, /findAuthUserByEmail/);
  assert.match(login, /webSessionCookieHeaders/);
  assert.match(recovery, /resetPasswordWithChallenge/);
});

test('v1 authentication remains server-owned with CSRF enforcement and administrator checks', async () => {
  const transport = await read('src/http/transport.ts');
  assert.match(transport, /auth\.authenticate\(requestEnvelope\(c\)\)/);
  assert.match(transport, /auth\.csrfAccepted\(requestEnvelope\(c\), session\)/);
  assert.match(transport, /actorHasPermission\(actor, 'admin:access'\)/);
  assert.match(transport, /setCurrentDatabaseActor\(\{ userId, role: session\.user\.role \}\)/);
});

test('browser order history rejects a switched session before querying and keeps the existing mobile contract', async () => {
  const { createHttpApp } = await import('../src/http/app.ts');
  const readFor = [];
  const paymentRequests = [];
  const { app: http } = createHttpApp({ services: {
    auth: {
      authenticate: ({ headers }) => headers.cookie === 'session=customer-8'
        ? { userId: 8, user: { role: 'customer' } }
        : headers.cookie === 'session=partner-9' ? { userId: 9, user: { role: 'partner' } } : null,
      csrfAccepted: () => true,
    },
    orders: {
      listCustomerOrders: async (userId) => {
        readFor.push(userId);
        return { status: 200, body: [{ id: 81 }] };
      },
    },
    payments: {
      createPaymentIntent: async (userId, orderId) => {
        paymentRequests.push([userId, orderId]);
        return { status: 201, body: { payment: null } };
      },
    },
  } });
  const list = (headers) => http.request('/api/v1/orders', { headers });

  assert.equal((await list({ 'X-NearPill-Account': '8' })).status, 401);
  assert.equal((await list({ Cookie: 'session=customer-8', 'X-NearPill-Account': '7' })).status, 409);
  assert.equal((await list({ Cookie: 'session=partner-9', 'X-NearPill-Account': '9' })).status, 409);
  assert.deepEqual(readFor, []);
  const owned = await list({ Cookie: 'session=customer-8', 'X-NearPill-Account': '8' });
  assert.equal(owned.status, 200);
  assert.equal(owned.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(await owned.json(), [{ id: 81 }]);
  assert.equal((await list({ Cookie: 'session=customer-8' })).status, 200);
  assert.deepEqual(readFor, [8, 8]);
  const startPayment = (account) => http.request('/api/v1/orders/81/payments', {
    method: 'POST',
    headers: { Cookie: 'session=customer-8', 'X-NearPill-Account': account, 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'xendit-test', idempotencyKey: 'test-payment' }),
  });
  assert.equal((await startPayment('7')).status, 409);
  assert.deepEqual(paymentRequests, []);
  assert.equal((await startPayment('8')).status, 201);
  assert.deepEqual(paymentRequests, [[8, 81]]);
});

test('cookie logout requires CSRF even alongside a bearer token and preserves expired-cookie and mobile logout', async () => {
  const { createHttpApp } = await import('../src/http/app.ts');
  const { createAuthService } = await import('../src/application/auth-service.js');
  const { hashCredential } = await import('../src/domain/identity/tokens.js');
  const revoked = [];
  const auth = createAuthService({ production: false, repository: new Proxy({
    findActiveSession: async (hash) => hash === hashCredential('fixture-web')
      ? { userId: 7, csrfHash: hashCredential('fixture-csrf'), user: { role: 'customer' } } : null,
  }, { get: (target, key) => target[key] ?? (() => { throw new Error('Unexpected repository operation'); }) }) });
  const { app: http } = createHttpApp({ services: {
    auth,
    identity: { logout: async (tokens) => { revoked.push(tokens); return { status: 200, body: { success: true } }; } },
  } });
  const logout = (headers, body) => http.request('/api/v1/auth/logout', { method: 'POST', headers, body });
  const cookie = { Cookie: 'nearpill_session=fixture-web', Origin: 'https://untrusted.example.test' };
  const rejected = await logout(cookie);
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get('Set-Cookie'), null);
  assert.equal((await logout({ ...cookie, Authorization: 'Bearer fixture-access' })).status, 403);
  assert.equal(revoked.length, 0);
  const browser = await logout({ ...cookie, 'X-CSRF-Token': 'fixture-csrf' });
  assert.equal(browser.status, 200);
  assert.match(browser.headers.get('Set-Cookie'), /Max-Age=0/);
  assert.equal((await logout({ Cookie: 'nearpill_session=expired' })).status, 200);
  assert.equal((await logout({ Authorization: 'Bearer fixture-access' })).status, 200);
  assert.equal((await logout({ 'Content-Type': 'application/json' }, JSON.stringify({ refreshToken: 'fixture-refresh' }))).status, 200);
  assert.equal(revoked.length, 4);
  assert.equal(revoked[0].cookieToken, 'fixture-web');
  assert.equal(revoked[2].bearerToken, 'fixture-access');
  assert.equal(revoked[3].refreshToken, 'fixture-refresh');
});

test('the authenticated profile supplies remaining session lifetime without exposing credentials', async () => {
  const { createHttpApp } = await import('../src/http/app.ts');
  const { app: http } = createHttpApp({ services: {
    auth: {
      authenticate: () => ({ userId: 7, user: { role: 'customer' }, expiresAt: new Date(Date.now() + 20_000) }),
      csrfAccepted: () => true,
    },
    identity: { getProfile: async () => ({ status: 200, body: { id: '7', role: 'customer' } }) },
  } });
  const response = await http.request('/api/v1/auth/me');
  const profile = await response.json();
  assert.equal(response.status, 200);
  assert.ok(profile.sessionExpiresInMs > 0 && profile.sessionExpiresInMs <= 20_000);
  assert.deepEqual(Object.keys(profile).sort(), ['id', 'role', 'sessionExpiresInMs']);
});

test('superseded Express production transport files are absent after cutover', async () => {
  const removed = [
    'server.js', 'auth-validation.js', 'login-handler.js', 'password-recovery.js',
    'src/http/auth-middleware.js', 'src/http/respond.js',
    'src/http/routes/auth-routes.js', 'src/http/routes/catalog-routes.js',
    'src/http/routes/inventory-routes.js', 'src/http/routes/membership-routes.js',
    'src/http/routes/order-routes.js', 'src/http/routes/payment-subscription-routes.js',
    'src/http/routes/report-routes.js',
  ];
  for (const path of removed) {
    await assert.rejects(stat(new URL(`../${path}`, import.meta.url)));
  }
});

test('gateway overwrites forwarded client IP before authentication throttling consumes it', () => {
  const apiBlock = nginx.match(/location \/api\/ \{[\s\S]*?^    \}/m)?.[0] || '';
  assert.match(apiBlock, /proxy_set_header X-Forwarded-For \$remote_addr;/);
  assert.doesNotMatch(apiBlock, /\$proxy_add_x_forwarded_for/);
});
