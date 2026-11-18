import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Characterize the existing typed environment parser without network access,
// package installs or a potentially unrelated Supabase connection. This is
// diagnostic Node 22 evidence, NOT supported Node 24 acceptance.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const parserUrl = pathToFileURL(resolve(root, 'backend/src/config/env.ts')).href;
const staging = {
  NODE_ENV: 'staging', DB_HOST: 'db.example-project.supabase.co',
  DB_USER: 'nearpill_app', DB_NAME: 'postgres',
  DB_PASSWORD: 'synthetic-not-a-real-secret', DB_SSL: 'true',
  CORS_ORIGINS: 'https://staging.example.invalid',
  PUBLIC_APP_URL: 'https://staging.example.invalid',
  PAYMENT_POLICY_MODE: 'disabled', ORDER_RESERVATION_TTL_MINUTES: '60',
};

function parseInIsolatedRuntime(raw) {
  const script = `
    const { parseBackendEnvironment } = await import(${JSON.stringify(parserUrl)});
    try {
      const parsed = parseBackendEnvironment(${JSON.stringify(raw)});
      console.log(JSON.stringify({ accepted: true, host: parsed.database.host, user: parsed.database.user, name: parsed.database.name }));
    } catch (error) {
      console.log(JSON.stringify({ accepted: false, error: String(error.message) }));
    }
  `;
  return JSON.parse(execFileSync(process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e', script], {
      cwd: root, encoding: 'utf8', timeout: 12_000,
      env: { ...process.env, NODE_OPTIONS: '' },
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim());
}

for (const field of ['DB_HOST', 'DB_USER', 'DB_NAME']) {
  test(`Packet 0 Supabase target: staging/production reject missing ${field}`, () => {
    for (const env of ['staging', 'production']) {
      const { [field]: _removed, ...withoutField } = { ...staging, NODE_ENV: env };
      const result = parseInIsolatedRuntime(withoutField);
      assert.equal(result.accepted, false, `${env} cannot silently select an implicit ${field}`);
      assert.match(result.error, new RegExp(`${field}.*explicit|${field}.*required|${field}.*configured`, 'i'));
    }
  });
}

test('Packet 0 Supabase target: explicit app-role connection remains valid', () => {
  for (const env of ['staging', 'production']) {
    const result = parseInIsolatedRuntime({ ...staging, NODE_ENV: env });
    assert.deepEqual(result, { accepted: true, host: staging.DB_HOST, user: staging.DB_USER, name: staging.DB_NAME });
  }
});

test('Packet 0 Supabase target: local disposable database defaults remain valid', () => {
  const result = parseInIsolatedRuntime({ NODE_ENV: 'test' });
  assert.deepEqual(result, { accepted: true, host: '127.0.0.1', user: 'nearpill_app', name: 'nearpill' });
});

test('Packet 0 runtime app connection rejects known elevated and migration roles in staging/production', () => {
  // A supplied DB_USER must not silently route ordinary Hono queries through
  // an owner, migration, Supabase administrative or client Data API role.
  for (const nodeEnv of ['staging', 'production']) {
    for (const user of [
      'postgres', 'postgres.example-project', 'supabase_admin', 'service_role',
      'nearpill_migrator', 'nearpill_migrator.example-project',
      'nearpill_owner', 'anon', 'authenticated', 'pg_read_all_data',
      'PoStGrEs.example-project',
    ]) {
      const result = parseInIsolatedRuntime({ ...staging, NODE_ENV: nodeEnv, DB_USER: user });
      assert.equal(result.accepted, false, `${nodeEnv} should reject privileged runtime role ${user}`);
      assert.match(result.error, /DB_USER.*(application|role|privilege)/i);
    }
  }
});

test('Packet 0 runtime app connection permits a distinct custom Supabase session-pooler login', () => {
  const user = 'nearpill_app.example-project';
  for (const nodeEnv of ['staging', 'production']) {
    const result = parseInIsolatedRuntime({ ...staging, NODE_ENV: nodeEnv, DB_USER: user });
    assert.deepEqual(result, { accepted: true, host: staging.DB_HOST, user, name: staging.DB_NAME });
  }
});

test('Packet 0 Supabase target: staging and production reject loopback or IP-literal database hosts', () => {
  // A managed Supabase backend must not accidentally target an arbitrary local
  // PostgreSQL service (or a literal IP) when a provider hostname was intended.
  // This is a configuration guard, not proof that a DNS name is NearPill-owned.
  for (const nodeEnv of ['staging', 'production']) {
    for (const host of ['localhost', 'LOCALHOST', 'localhost.localdomain', '127.0.0.1', '127.1.2.3', '::1', '0.0.0.0', '10.1.2.3']) {
      const result = parseInIsolatedRuntime({ ...staging, NODE_ENV: nodeEnv, DB_HOST: host });
      assert.equal(result.accepted, false, `${nodeEnv} must not use an unreviewed local or IP-literal host: ${host}`);
      assert.match(result.error, /DB_HOST.*(hostname|provider|local|literal)/i);
    }
  }
});

test('Packet 0 Supabase target: provider direct and session-pooler hostnames remain valid', () => {
  for (const nodeEnv of ['staging', 'production']) {
    for (const host of ['db.example-project.supabase.co', 'aws-0-ap-southeast-1.pooler.supabase.com']) {
      const result = parseInIsolatedRuntime({ ...staging, NODE_ENV: nodeEnv, DB_HOST: host });
      assert.equal(result.accepted, true, `${nodeEnv} must accept a supplied provider hostname`);
      assert.equal(result.host, host);
    }
  }
});

test('Packet 0 Supabase target: noncanonical numeric IPv4 forms cannot bypass the managed-host guard', () => {
  // Hostname parsers/resolvers can normalize these strings to 127.0.0.1 even
  // though net.isIP(rawHost) returns 0. Do not resolve DNS during this test.
  for (const nodeEnv of ['staging', 'production']) {
    for (const host of ['127.1', '0177.0.0.1', '2130706433', '0x7f000001']) {
      const result = parseInIsolatedRuntime({ ...staging, NODE_ENV: nodeEnv, DB_HOST: host });
      assert.equal(result.accepted, false, `${nodeEnv} must reject noncanonical IPv4 host: ${host}`);
      assert.match(result.error, /DB_HOST.*(hostname|provider|local|literal)/i);
    }
  }
});

test('Packet 0 Supabase target: transaction-pooler port is refused for Hono app connections', () => {
  // NearPill sets trusted actor context inside each transaction. Do not
  // silently switch its persistent adapter to Supabase transaction pooling
  // before an explicitly reviewed compatibility acceptance packet.
  for (const nodeEnv of ['staging', 'production']) {
    for (const host of ['db.example-project.supabase.co', 'aws-0-ap-southeast-1.pooler.supabase.com']) {
      const result = parseInIsolatedRuntime({ ...staging, NODE_ENV: nodeEnv, DB_HOST: host, DB_PORT: '6543' });
      assert.equal(result.accepted, false, `${nodeEnv}: ${host}:6543 must not be accepted as a direct/session connection`);
      assert.match(result.error, /DB_PORT.*(transaction|pool|session|direct)/i);
    }
  }
});

test('Packet 0 Supabase target: direct and session-mode port 5432 stays valid', () => {
  for (const nodeEnv of ['staging', 'production']) {
    for (const host of ['db.example-project.supabase.co', 'aws-0-ap-southeast-1.pooler.supabase.com']) {
      const result = parseInIsolatedRuntime({ ...staging, NODE_ENV: nodeEnv, DB_HOST: host, DB_PORT: '5432' });
      assert.equal(result.accepted, true, `${nodeEnv}: ${host}:5432 must remain valid`);
    }
  }
});

test('Packet 0 Supabase target: port 6543 is rejected even behind a staging DNS alias', () => {
  // A custom DNS name may point to a Supabase endpoint. The application must
  // not infer its pooling mode only from whether the hostname ends in a
  // literal provider suffix; the known transaction-pooling port is not approved.
  for (const nodeEnv of ['staging', 'production']) {
    const result = parseInIsolatedRuntime({
      ...staging,
      NODE_ENV: nodeEnv,
      DB_HOST: 'nearpill-db.example.invalid',
      DB_PORT: '6543',
    });
    assert.equal(result.accepted, false, `${nodeEnv} cannot accept unreviewed transaction-pooler port through an alias`);
    assert.match(result.error, /DB_PORT.*(transaction|pool|session|direct)/i);
  }
  const local = parseInIsolatedRuntime({ NODE_ENV: 'test', DB_PORT: '6543' });
  assert.equal(local.accepted, true, 'disposable local/test PostgreSQL retains its existing port configurability');
});
