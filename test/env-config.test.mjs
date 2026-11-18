import assert from 'node:assert/strict';
import test from 'node:test';

const nodeMajor = Number(process.versions.node.split('.')[0]);

if (nodeMajor < 24) {
  test('typed environment runtime tests require the declared Node 24 runtime', { skip: 'Node 24 required for native TypeScript loading' }, () => {});
} else {
  const { parseBackendEnvironment } = await import('../backend/src/config/env.ts');

  test('Xendit Test Mode accepts complete development credentials only on isolated staging', () => {
    const config = {
      NODE_ENV: 'test', DB_HOST: 'db.afqqozfjpiodanpogvfb.supabase.co', PAYMENT_POLICY_MODE: 'full',
      XENDIT_TEST_SECRET_KEY: 'xnd_development_fixture', XENDIT_TEST_WEBHOOK_TOKEN: 'fixture-token',
    };
    assert.ok(parseBackendEnvironment(config).payment.xenditTest);
    assert.throws(() => parseBackendEnvironment({ ...config, DB_HOST: 'localhost' }), /isolated NearPill staging/);
    assert.throws(() => parseBackendEnvironment({ ...config, XENDIT_TEST_WEBHOOK_TOKEN: '' }), /Set both/);
    assert.throws(() => parseBackendEnvironment({ ...config, PAYMENT_POLICY_MODE: 'disabled' }), /requires full payments/);
  });

  test('typed environment accepts explicit safe test configuration', () => {
    const env = parseBackendEnvironment({
      NODE_ENV: 'test',
      PORT: '3100',
      DB_PORT: '3307',
      DB_HOST: 'mysql',
      DB_USER: 'nearpill_app',
      DB_PASSWORD: 'test-only',
      DB_NAME: 'nearpill_test',
      CORS_ORIGINS: 'http://localhost:8080,https://portal.example.test',
      PUBLIC_APP_URL: 'http://localhost:8080',
    });

    assert.equal(env.nodeEnv, 'test');
    assert.equal(env.port, 3100);
    assert.equal(env.database.port, 3307);
    assert.deepEqual(env.corsOrigins, ['http://localhost:8080', 'https://portal.example.test']);
  });

  test('typed environment rejects wildcard CORS authority', () => {
    assert.throws(
      () => parseBackendEnvironment({ NODE_ENV: 'test', CORS_ORIGINS: '*' }),
      /must not use a wildcard origin/,
    );
  });

  test('local API can bind loopback and rejects invalid bind hosts', () => {
    assert.equal(parseBackendEnvironment({ NODE_ENV: 'test', HOST: '127.0.0.1' }).host, '127.0.0.1');
    assert.throws(() => parseBackendEnvironment({ HOST: 'https://example.test' }), /HOST must be/);
  });

  test('typed environment requires HTTPS public URL in production', () => {
    assert.throws(
      () =>
        parseBackendEnvironment({
          NODE_ENV: 'production',
          DB_PASSWORD: 'production-placeholder',
          CORS_ORIGINS: 'https://nearpill.example',
          PUBLIC_APP_URL: 'http://nearpill.example',
          ORDER_RESERVATION_TTL_MINUTES: '4320',
          PAYMENT_POLICY_MODE: 'disabled',
        }),
      /must use HTTPS in production/,
    );
  });

  test('typed environment requires production mail settings as a pair', () => {
    assert.throws(
      () =>
        parseBackendEnvironment({
          NODE_ENV: 'production',
          DB_PASSWORD: 'production-placeholder',
          PUBLIC_APP_URL: 'https://nearpill.example',
          CORS_ORIGINS: 'https://nearpill.example',
          BREVO_API_KEY: 'test-placeholder',
          ORDER_RESERVATION_TTL_MINUTES: '4320',
          PAYMENT_POLICY_MODE: 'disabled',
        }),
      /must be configured together in production/,
    );
  });

  test('typed environment requires explicit tenant-safe origins in production', () => {
    assert.throws(
      () =>
        parseBackendEnvironment({
          NODE_ENV: 'production',
          DB_PASSWORD: 'production-placeholder',
          PUBLIC_APP_URL: 'https://nearpill.example',
          ORDER_RESERVATION_TTL_MINUTES: '4320',
          PAYMENT_POLICY_MODE: 'disabled',
          DB_SSL: 'true',
          DB_HOST: 'db.exampleproject.supabase.co',
          DB_USER: 'nearpill_app',
          DB_NAME: 'postgres',
        }),
      /CORS_ORIGINS must be explicitly configured/,
    );
  });

  test('typed environment requires a database password in staging and production', () => {
    assert.throws(
      () =>
        parseBackendEnvironment({
          NODE_ENV: 'staging',
          CORS_ORIGINS: 'https://staging.nearpill.example',
          PUBLIC_APP_URL: 'https://staging.nearpill.example',
          ORDER_RESERVATION_TTL_MINUTES: '4320',
          PAYMENT_POLICY_MODE: 'disabled',
        }),
      /DB_PASSWORD must be configured/,
    );
  });
}
