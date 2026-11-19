import { createPostgresCompatPool } from './compat-pool.js';

// Deletes old logs. Order, payment and refund records are never deleted here.
// The audit and payment tables are also protected by 0045_log_retention.sql,
// which only lets the system actor delete rows older than 3 months.
export function createPostgresRetentionRepository(postgresPool) {
  const pool = createPostgresCompatPool(postgresPool);
  const securityPool = createPostgresCompatPool(postgresPool, { capability: 'identity_security' });
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A PostgreSQL query-capable pool is required.');
  }

  const removed = async (target, sql, params) => {
    const [result] = await target.query(sql, params);
    return Number(result?.affectedRows ?? 0);
  };

  return {
    async purgeBefore(cutoff) {
      const counts = {};
      counts.auditLogs = await removed(pool, 'DELETE FROM audit_logs WHERE created_at < ?', [cutoff]);
      counts.paymentEvents = await removed(pool, 'DELETE FROM payment_events WHERE created_at < ?', [cutoff]);
      counts.paymentReconciliation = await removed(
        pool,
        `DELETE FROM payment_reconciliation WHERE status <> 'open' AND created_at < ?`,
        [cutoff],
      );
      counts.authSessions = await removed(
        securityPool,
        'DELETE FROM auth_sessions WHERE (expires_at < ? OR revoked_at < ?)',
        [cutoff, cutoff],
      );
      counts.authSessionFamilies = await removed(
        securityPool,
        `DELETE FROM auth_session_families
          WHERE created_at < ?
            AND NOT EXISTS (SELECT 1 FROM auth_sessions s WHERE s.family_id = auth_session_families.id)`,
        [cutoff],
      );
      counts.passwordResets = await removed(
        securityPool,
        'DELETE FROM password_reset_challenges WHERE created_at < ? AND (consumed_at IS NOT NULL OR expires_at < ?)',
        [cutoff, cutoff],
      );
      counts.emailChallenges = await removed(
        securityPool,
        'DELETE FROM email_verification_challenges WHERE expires_at < ?',
        [cutoff],
      );
      counts.loginThrottles = await removed(
        securityPool,
        'DELETE FROM auth_account_security WHERE expires_at < ?',
        [cutoff],
      );
      return counts;
    },
  };
}
