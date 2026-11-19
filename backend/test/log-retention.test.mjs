import assert from 'node:assert/strict';
import test from 'node:test';
import { createRetentionService, retentionCutoff } from '../src/application/retention-service.js';
import { createPostgresRetentionRepository } from '../src/infrastructure/postgres/retention-repository.js';
import { runWithDatabaseActor } from '../src/infrastructure/postgres/context.js';

function recordingPool(rowCount = 2) {
  const statements = [];
  const pool = {
    async query() { throw new Error('Repository bypassed its transaction client'); },
    async connect() {
      return {
        async query(sql, params = []) {
          const text = String(sql);
          if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text) || text.includes('set_config')) return { rows: [], rowCount: 0 };
          statements.push({ sql: text, params });
          return { rows: [], rowCount };
        },
        release() {},
      };
    },
  };
  return { pool, statements };
}

test('retention cutoff is exactly 3 months back and handles short months', () => {
  assert.equal(retentionCutoff('2026-11-20T04:00:00.000Z').toISOString(), '2026-08-20T04:00:00.000Z');
  assert.equal(retentionCutoff('2026-05-31T00:00:00.000Z').toISOString(), '2026-02-28T00:00:00.000Z');
  assert.equal(retentionCutoff('2026-01-15T00:00:00.000Z').toISOString(), '2025-10-15T00:00:00.000Z');
  assert.throws(() => retentionCutoff('not a date'), TypeError);
});

test('retention service passes the 3-month cutoff to the repository', async () => {
  const seen = [];
  const service = createRetentionService({
    repository: { async purgeBefore(cutoff) { seen.push(cutoff); return { auditLogs: 4 }; } },
    clock: () => new Date('2026-11-20T04:00:00.000Z'),
  });
  const result = await service.run();
  assert.deepEqual(seen, ['2026-08-20T04:00:00.000Z']);
  assert.equal(result.counts.auditLogs, 4);
  assert.throws(() => createRetentionService({ repository: {} }), TypeError);
});

test('log cleanup deletes only logs and never touches orders, payments, refunds or users', async () => {
  const observed = recordingPool(3);
  const repository = createPostgresRetentionRepository(observed.pool);
  const counts = await runWithDatabaseActor({ role: 'system' }, () => repository.purgeBefore('2026-08-20T04:00:00.000Z'));
  assert.equal(counts.auditLogs, 3);
  assert.equal(counts.paymentEvents, 3);
  assert.equal(Object.keys(counts).length, 8);
  assert.equal(observed.statements.length, 8);
  for (const { sql, params } of observed.statements) {
    assert.match(sql, /^\s*DELETE FROM (audit_logs|payment_events|payment_reconciliation|auth_sessions|auth_session_families|password_reset_challenges|email_verification_challenges|auth_account_security)\b/);
    assert.ok(params.includes('2026-08-20T04:00:00.000Z'), 'every delete is limited by the cutoff');
    assert.doesNotMatch(sql, /\b(orders|order_items|order_drugstores|payments|refunds|users)\b/);
  }
  const reconciliation = observed.statements.find(({ sql }) => sql.includes('payment_reconciliation'));
  assert.match(reconciliation.sql, /status <> 'open'/, 'unresolved reconciliation items are kept');
});

test('retention policies only let the system actor delete rows older than 3 months', async () => {
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile(new URL('../migrations/postgres/0045_log_retention.sql', import.meta.url), 'utf8');
  assert.match(sql, /GRANT DELETE ON audit_logs, payment_events, payment_reconciliation TO nearpill_app;/);
  assert.equal((sql.match(/FOR DELETE TO nearpill_app/g) ?? []).length, 3);
  assert.equal((sql.match(/current_actor_role\(\) = 'system'/g) ?? []).length, 3);
  assert.equal((sql.match(/INTERVAL '3 months'/g) ?? []).length, 3);
});
