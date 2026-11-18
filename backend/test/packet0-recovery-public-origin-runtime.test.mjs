import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Exercise the canonical typed parser with the diagnostic Node 22 type-stripper.
// This does not satisfy the separate pinned Node 24 acceptance gate.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const parserUrl = pathToFileURL(resolve(root, 'backend/src/config/env.ts')).href;
const safe = {
  NODE_ENV: 'production',
  DB_HOST: 'db.example-project.supabase.co',
  DB_USER: 'nearpill_app',
  DB_NAME: 'postgres',
  DB_PASSWORD: 'synthetic-placeholder',
  DB_SSL: 'true',
  CORS_ORIGINS: 'https://portal.example.invalid',
  PUBLIC_APP_URL: 'https://portal.example.invalid',
  ORDER_RESERVATION_TTL_MINUTES: '60',
  PAYMENT_POLICY_MODE: 'disabled',
};
function parse(raw) {
  const code = `
    const { parseBackendEnvironment } = await import(${JSON.stringify(parserUrl)});
    try {
      const env = parseBackendEnvironment(${JSON.stringify(raw)});
      console.log(JSON.stringify({ accepted: true, publicAppUrl: env.publicAppUrl }));
    } catch (error) {
      console.log(JSON.stringify({ accepted: false, reason: String(error.message) }));
    }
  `;
  const result = execFileSync(process.execPath, [
    '--experimental-strip-types', '--input-type=module', '-e', code,
  ], {
    cwd: root, encoding: 'utf8', timeout: 12_000,
    env: { ...process.env, NODE_OPTIONS: '' }, stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(result.trim());
}

test('Packet 0 recovery origin: staging rejects HTTP password reset origin', () => {
  const result = parse({ ...safe, NODE_ENV: 'staging', PUBLIC_APP_URL: 'http://staging.example.invalid' });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /PUBLIC_APP_URL.*HTTPS/);
});

test('Packet 0 recovery origin: production rejects embedded credentials without reflecting them', () => {
  const result = parse({ ...safe, PUBLIC_APP_URL: 'https://user:private-password@portal.example.invalid' });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /PUBLIC_APP_URL/);
  assert.ok(!result.reason.includes('private-password'));
});

test('Packet 0 recovery origin: paths, query and fragments cannot silently change recovery root', () => {
  for (const candidate of [
    'https://portal.example.invalid/path',
    'https://portal.example.invalid/?redirect=unsafe',
    'https://portal.example.invalid/#fragment',
  ]) {
    const result = parse({ ...safe, PUBLIC_APP_URL: candidate });
    assert.equal(result.accepted, false, candidate);
    assert.match(result.reason, /PUBLIC_APP_URL/);
  }
});

test('Packet 0 recovery origin: explicit production HTTPS and local HTTP remain allowed', () => {
  assert.deepEqual(parse(safe), { accepted: true, publicAppUrl: safe.PUBLIC_APP_URL });
  assert.deepEqual(parse({ NODE_ENV: 'development', PUBLIC_APP_URL: 'http://localhost:3001' }), {
    accepted: true, publicAppUrl: 'http://localhost:3001',
  });
});
