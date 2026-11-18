import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Characterize the *real* typed backend environment parser on the available
// diagnostic Node 22 runtime without upgrading, installing dependencies, or
// relaxing the independently enforced supported-Node acceptance gate.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const parserUrl = pathToFileURL(resolve(root, 'backend/src/config/env.ts')).href;
const safeStaging = {
  NODE_ENV: 'staging',
  DB_HOST: 'db.example-project.supabase.co',
  DB_USER: 'nearpill_app',
  DB_NAME: 'postgres',
  DB_PASSWORD: 'synthetic-nonsecret-password',
  DB_SSL: 'true',
  CORS_ORIGINS: 'https://staging.example.invalid',
  PUBLIC_APP_URL: 'https://staging.example.invalid',
  PAYMENT_POLICY_MODE: 'disabled',
  ORDER_RESERVATION_TTL_MINUTES: '60',
};

function parseInIsolatedRuntime(raw) {
  const script = `
    const { parseBackendEnvironment } = await import(${JSON.stringify(parserUrl)});
    try {
      const parsed = parseBackendEnvironment(${JSON.stringify(raw)});
      console.log(JSON.stringify({ accepted: true, ssl: parsed.database.ssl }));
    } catch (error) {
      console.log(JSON.stringify({ accepted: false, error: String(error.message) }));
    }
  `;
  // Node 24 natively strips erasable TypeScript types; the explicit flag also
  // permits a diagnostic check under Node 22 without claiming Node 24 parity.
  const stdout = execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
    cwd: root,
    encoding: 'utf8',
    timeout: 12_000,
    env: { ...process.env, NODE_OPTIONS: '' },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(stdout.trim());
}

test('Packet 0 Supabase TLS: staging fails closed if DB_SSL is missing', () => {
  const { DB_SSL: _omitted, ...noSsl } = safeStaging;
  const outcome = parseInIsolatedRuntime(noSsl);
  assert.equal(outcome.accepted, false, 'staging must never silently allow an unencrypted PostgreSQL connection');
  assert.match(outcome.error, /DB_SSL.*true/i);
});

test('Packet 0 Supabase TLS: production fails closed if DB_SSL=false', () => {
  const outcome = parseInIsolatedRuntime({ ...safeStaging, NODE_ENV: 'production', DB_SSL: 'false' });
  assert.equal(outcome.accepted, false, 'production must never allow an unencrypted PostgreSQL connection');
  assert.match(outcome.error, /DB_SSL.*true/i);
});

test('Packet 0 Supabase TLS: staging accepts explicitly enabled TLS', () => {
  assert.deepEqual(parseInIsolatedRuntime(safeStaging), { accepted: true, ssl: true });
});

test('Packet 0 Supabase TLS: local test connections remain usable without TLS', () => {
  assert.deepEqual(parseInIsolatedRuntime({ NODE_ENV: 'test', DB_SSL: 'false' }), { accepted: true, ssl: false });
});
