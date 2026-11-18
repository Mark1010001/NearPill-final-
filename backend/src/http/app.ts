import { readFile } from 'node:fs/promises';
import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { registerApiRoutes } from './routes/v1/register.ts';
import { HealthSchema, ErrorSchema } from './contracts.ts';
import { requestContext } from './transport.ts';
import { readWebhookBodyWithinLimit } from './webhook-ingress.js';
import { invalidInputMessage } from '../domain/identity/input-policy.js';

function publicAsset(name: string) {
  return new URL(`../../public/${name}`, import.meta.url);
}

export function createHttpApp({ services, pool, databaseName, corsOrigins, trustedProxyIps = [] }: any) {
  const app = new OpenAPIHono<{ Variables: { trustedProxyIps: Set<string>; rawWebhookBody: string } }>({
    defaultHook: (result: any, c: any) => {
      if (!result.success) return c.json({ error: invalidInputMessage }, 400);
    },
  });
  const origins = new Set(corsOrigins || []);
  const reviewedProxyPeers = new Set<string>(trustedProxyIps);

  app.use('*', cors({
    origin: (origin) => origins.has(origin) ? origin : undefined,
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  }));

  app.use('/api/v1/*', async (c, next) => {
    c.set('trustedProxyIps', reviewedProxyPeers);
    if (c.req.path.startsWith('/api/v1/prescription-reviews') || c.req.path.startsWith('/api/v1/partner/prescription-reviews')) {
      c.header('Cache-Control', 'private, no-store');
    }
    const prescriptionUpload = services.prescriptionReviewEnabled === true && c.req.path === '/api/v1/prescription-reviews' && c.req.method === 'POST';
    const maxSize = prescriptionUpload ? 1450000 : c.req.path.includes('/auth/') ? 4 * 1024 : 64 * 1024;
    let webhookBodyRejection = null;
    // Run Hono's declared body limit before reading a public webhook body.
    // Independently count bytes in the cloned stream: a misleading
    // Content-Length must never authorize an unbounded .text() allocation.
    const limited = await bodyLimit({
      maxSize,
      onError: (context) => context.json({ error: 'Request body is too large.' }, 413),
    })(c, async () => {
      if (c.req.path.includes('/payments/webhooks/')) {
        const bounded = await readWebhookBodyWithinLimit(c.req.raw, maxSize);
        if (!bounded.ok) {
          webhookBodyRejection = bounded.reason;
          return;
        }
        c.set('rawWebhookBody', bounded.rawBody);
      }
      await requestContext(c, next);
    });
    if (webhookBodyRejection === 'invalid-utf8') {
      return c.json({ error: 'Invalid webhook body encoding.' }, 400);
    }
    if (webhookBodyRejection === 'too-large') {
      return c.json({ error: 'Request body is too large.' }, 413);
    }
    if (webhookBodyRejection === 'read-error') {
      return c.json({ error: 'Unable to read webhook request body.' }, 400);
    }
    return limited;
  });

  app.use('/api/v1/auth/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  const publicCatalogCache = async (c: any, next: () => Promise<void>) => {
    await next();
    if (c.req.method === 'GET' && c.res.status >= 200 && c.res.status < 300) {
      const hasPosition = c.req.query('latitude') !== undefined || c.req.query('longitude') !== undefined;
      c.header('Cache-Control', hasPosition ? 'private, no-store' : 'public, max-age=60, stale-while-revalidate=300');
      c.header('Vary', 'Accept-Encoding');
    }
  };
  app.use('/api/v1/medicines*', publicCatalogCache);
  app.use('/api/v1/stores*', publicCatalogCache);
  app.use('/api/v1/stores/:id/route', async (c, next) => {
    await next();
    c.header('Cache-Control', 'private, no-store');
  });

  app.get('/', (c) => c.json({ message: 'NearPill backend is running' }));

  const health = async (c: any) => {
    try {
      await pool.query('SELECT 1');
      return c.json({ status: 'ok', database: databaseName });
    } catch (error: any) {
      console.error('health_check_failed', { code: error?.code });
      return c.json({ status: 'error', error: 'Database connection failed.' }, 503);
    }
  };

  app.get('/api/v1/live', (c) => c.json({ status: 'ok' }));
  app.get('/api/v1/ready', health);
  app.get('/api/v1/health', health);

  app.get('/reset-password', async (c) => {
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    return c.html(await readFile(publicAsset('reset-password.html'), 'utf8'));
  });
  app.get('/recovery/reset-password.css', async (c) => {
    c.header('Content-Type', 'text/css; charset=utf-8');
    return c.body(await readFile(publicAsset('reset-password.css'), 'utf8'));
  });
  app.get('/recovery/reset-password.js', async (c) => {
    c.header('Content-Type', 'text/javascript; charset=utf-8');
    c.header('Cache-Control', 'no-store');
    return c.body(await readFile(publicAsset('reset-password.js'), 'utf8'));
  });

  const apiManifest = registerApiRoutes(app, services);

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http', scheme: 'bearer', bearerFormat: 'opaque',
  });
  app.openAPIRegistry.registerComponent('securitySchemes', 'cookieAuth', {
    type: 'apiKey', in: 'cookie', name: services.auth.cookieName,
  });
  app.doc('/api/v1/openapi.json', {
    openapi: '3.0.3',
    info: {
      title: 'NearPill API',
      version: '1.0.0',
      description: 'Authoritative NearPill HTTP contract. First-party clients use /api/v1 exclusively.',
    },
    servers: [{ url: '/' }],
  });

  app.notFound((c) => c.json({ error: 'Endpoint not found.', path: c.req.path }, 404));
  app.onError((error, c) => {
    console.error('unhandled_server_error', { code: (error as any)?.code });
    return c.json({ error: 'Internal server error.' }, 500);
  });

  return Object.freeze({ app, apiManifest });
}

export { HealthSchema, ErrorSchema };
