import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  assertVectorExtensionReadiness,
  vectorRequirementFromEnvironment,
} from '../scripts/lib/reconciliation-extension-readiness.mjs';

test('core PostgreSQL reconciliation records missing pgvector as deferred until AI is enabled', () => {
  assert.deepEqual(assertVectorExtensionReadiness({ rows: [] }), {
    installed: false, required: false, version: null,
  });
});

test('enabled AI or explicit extension gate fails closed when pgvector is missing', () => {
  for (const config of [{ aiEnabled: true }, { requireVector: true }]) {
    assert.throws(() => assertVectorExtensionReadiness({ rows: [] }, config), /required for enabled AI/);
  }
});

test('installed pgvector remains a verified prerequisite in both modes', () => {
  for (const config of [{}, { aiEnabled: true }]) {
    assert.deepEqual(assertVectorExtensionReadiness({ rows: [{ extversion: '0.8.6' }] }, config), {
      installed: true, required: config.aiEnabled === true, version: '0.8.6',
    });
  }
});

test('unknown PostgreSQL extension catalog results never become deferred or PASS', () => {
  for (const response of [undefined, {}, { rows: null }, { rows: [{}] },
    { rows: [{ extversion: null }] }, { rows: [{ extversion: 'unknown' }] },
    { rows: [{ extversion: '0.8.6' }, { extversion: '0.9.0' }] }]) {
    assert.throws(() => assertVectorExtensionReadiness(response), /inconclusive/);
  }
});

test('AI feature flags cannot silently disable a required extension with invalid values', () => {
  assert.deepEqual(vectorRequirementFromEnvironment({}), { aiEnabled: false, requireVector: false });
  assert.deepEqual(vectorRequirementFromEnvironment({ NEARPILL_AI_ENABLED: 'true' }), {
    aiEnabled: true, requireVector: false,
  });
  assert.deepEqual(vectorRequirementFromEnvironment({ NEARPILL_REQUIRE_PGVECTOR: 'true' }), {
    aiEnabled: false, requireVector: true,
  });
  for (const name of ['NEARPILL_AI_ENABLED', 'NEARPILL_REQUIRE_PGVECTOR']) {
    assert.throws(() => vectorRequirementFromEnvironment({ [name]: 'yes' }), /must be exactly true or false/);
  }
});

test('reconciliation retains existing mandatory security/data probes and reports deferred as deferred', async () => {
  const script = await readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8');
  assert.match(script, /assertSafeLiveFixtureConnections/);
  assert.match(script, /withReadOnlyReconciliationSnapshot/);
  assert.match(script, /assertZeroInvalidRows/);
  assert.match(script, /relforcerowsecurity/);
  assert.match(script, /rolbypassrls/);
  assert.match(script, /SELECT extversion FROM pg_extension/);
  assert.match(script, /vectorRequirementFromEnvironment\(process\.env\)/);
  assert.match(script, /DEFERRED pgvector/);
  assert.doesNotMatch(script, /CREATE EXTENSION|DROP EXTENSION/);
});
