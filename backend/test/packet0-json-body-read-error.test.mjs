import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

// Characterize the *existing* transport parser under a failing request stream.
// This parser is currently a dormant fallback, NOT the active Hono /api/v1
// validation path. The separate route-wiring guard below makes that explicit.
// The diagnostic Node 22 host cannot import TypeScript without an experimental
// loader; strip only the three annotations within this small actual function.
const source = readFileSync(new URL('../src/http/transport.ts', import.meta.url), 'utf8');
const start = source.indexOf('export async function parseBody(');
const end = source.indexOf('\nexport function parseValue(', start);
assert.ok(start >= 0 && end > start, 'parseBody must remain the canonical request parser');
const parseSource = source.slice(start, end)
  .replace('export async function parseBody(c: any, schema: any, byteLimit = 64 * 1024)',
    'async function parseBody(c, schema, byteLimit = 64 * 1024)')
  .replace('let text: string;', 'let text;')
  .replace('let value: unknown;', 'let value;');
assert.doesNotMatch(parseSource, /\b(?:any|unknown)\b\s*[;,)]/u, 'unexpected TypeScript additions must be reviewed');
const parseBody = runInNewContext(`${parseSource}\nparseBody;`, { Buffer }, { timeout: 1000 });

const schema = { safeParse: (value) => ({ success: true, data: value }) };

test('Packet 0: failed JSON request read is rejected without leaking stream details or running validation', async () => {
  let validated = false;
  const failing = {
    req: { text: async () => { throw new Error('private stream error'); } },
  };
  const parsed = await parseBody(failing, {
    safeParse() { validated = true; throw new Error('must not validate failed body'); },
  });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.status, 400);
  assert.equal(validated, false);
  assert.doesNotMatch(JSON.stringify(parsed), /private stream error|Internal server error/u);
});

test('Packet 0: successful JSON parsing keeps the existing validated DTO contract', async () => {
  const outcome = await parseBody({ req: { text: async () => '{"count":3}' } }, schema);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.data.count, 3);
});

test('Packet 0: oversized JSON and invalid JSON retain 413 and 400 contracts', async () => {
  const tooLarge = await parseBody({ req: { text: async () => 'x'.repeat(20) } }, schema, 4);
  assert.equal(tooLarge.ok, false);
  assert.equal(tooLarge.status, 413);
  const malformed = await parseBody({ req: { text: async () => '{invalid' } }, schema);
  assert.equal(malformed.ok, false);
  assert.equal(malformed.status, 400);
});

// Packet 0 provenance: in today's Hono cutover every route is registered with
// OpenAPI/Zod validation and prevalidated=true. Earlier error-path tests exercise
// parseBody directly, but cannot be cited as runtime ingress acceptance.
const routeSource = readFileSync(new URL('../src/http/routes/v1/register.ts', import.meta.url), 'utf8');
function assertActiveJsonValidationBoundary(source) {
  assert.match(source, /const v1Handler = makeHandler\(spec, services, true\);/u,
    'production routes must explicitly select the prevalidated handler');
  assert.match(source, /app\.openapi\(route, v1Handler as any\);/u,
    'route registration must retain OpenAPI/Zod validation');
  assert.match(source, /body = c\.req\.valid\('json'\) \?\? \{\};/u,
    'active JSON DTOs must come from Hono validated data');
  const registration = source.slice(source.indexOf('export function registerApiRoutes('));
  assert.ok(registration.startsWith('export function registerApiRoutes('),
    'canonical Hono route registration must be present');
  assert.doesNotMatch(registration, /makeHandler\(spec, services, false\)/u,
    'unvalidated transport parser must not become the production route');
}

test('Packet 0: active Hono routes use OpenAPI prevalidation, not the dormant parseBody fallback', () => {
  assertActiveJsonValidationBoundary(routeSource);
  // Negative mutations ensure this guard fails if the production handler is
  // switched to an unvalidated path or stops using Hono route validation.
  assert.throws(() => assertActiveJsonValidationBoundary(
    routeSource.replace('makeHandler(spec, services, true)', 'makeHandler(spec, services, false)'),
  ));
  assert.throws(() => assertActiveJsonValidationBoundary(
    routeSource.replace('app.openapi(route, v1Handler as any)', 'app.on(spec.method, route.path, v1Handler)'),
  ));
  assert.throws(() => assertActiveJsonValidationBoundary(
    routeSource.replace("body = c.req.valid('json') ?? {};", "body = c.req.json();"),
  ));
});
