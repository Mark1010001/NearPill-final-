import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Execute the canonical typed parser with Node 22's diagnostic type-stripper.
// This does not waive the separate Node 24/npm 11 acceptance gate.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const parserUrl = pathToFileURL(resolve(root, 'backend/src/config/env.ts')).href;
const base = {
  NODE_ENV: 'production',
  DB_HOST: 'db.example-project.supabase.co',
  DB_USER: 'nearpill_app',
  DB_NAME: 'postgres',
  DB_PASSWORD: 'synthetic-test-only',
  DB_SSL: 'true',
  PUBLIC_APP_URL: 'https://nearpill.example.invalid',
  CORS_ORIGINS: 'https://portal.example.invalid',
  ORDER_RESERVATION_TTL_MINUTES: '60',
  PAYMENT_POLICY_MODE: 'disabled',
};

function parse(raw) {
  const script = `
    const { parseBackendEnvironment } = await import(${JSON.stringify(parserUrl)});
    try {
      const result = parseBackendEnvironment(${JSON.stringify(raw)});
      console.log(JSON.stringify({ accepted: true, origins: result.corsOrigins }));
    } catch (error) {
      console.log(JSON.stringify({ accepted: false, reason: String(error.message) }));
    }
  `;
  const output = execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
    cwd: root, encoding: 'utf8', timeout: 12_000,
    env: { ...process.env, NODE_OPTIONS: '' }, stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(output.trim());
}

test('Packet 0 CORS: production rejects insecure HTTP origins for credentialed requests', () => {
  const actual = parse({ ...base, CORS_ORIGINS: 'http://portal.example.invalid' });
  assert.equal(actual.accepted, false);
  assert.match(actual.reason, /CORS_ORIGINS.*HTTPS/i);
});

test('Packet 0 CORS: staging also rejects insecure HTTP origins', () => {
  const actual = parse({ ...base, NODE_ENV: 'staging', CORS_ORIGINS: 'http://portal.example.invalid' });
  assert.equal(actual.accepted, false);
  assert.match(actual.reason, /CORS_ORIGINS.*HTTPS/i);
});

test('Packet 0 CORS: disallows path, query, fragment and embedded credentials', () => {
  for (const origin of [
    'https://portal.example.invalid/path',
    'https://portal.example.invalid/',
    'https://portal.example.invalid?test=1',
    'https://portal.example.invalid#fragment',
    'https://user:password@portal.example.invalid',
  ]) {
    const actual = parse({ ...base, CORS_ORIGINS: origin });
    assert.equal(actual.accepted, false, `${origin} is not an exact web origin`);
    assert.match(actual.reason, /CORS_ORIGINS|Invalid CORS origin/);
    assert.ok(!actual.reason.includes('password'), 'configuration errors must not expose credentials');
  }
});

test('Packet 0 CORS: valid HTTPS production origins and local HTTP development remain accepted', () => {
  assert.deepEqual(parse(base), { accepted: true, origins: ['https://portal.example.invalid'] });
  const local = parse({ NODE_ENV: 'test', CORS_ORIGINS: 'http://localhost:8080' });
  assert.deepEqual(local, { accepted: true, origins: ['http://localhost:8080'] });
});
