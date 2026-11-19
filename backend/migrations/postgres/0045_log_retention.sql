-- Automatic deletion of old logs (3 months). Data-free and idempotent.
-- The backend's scheduled cleanup runs as the 'system' actor. These policies
-- let that actor delete only rows older than 3 months, so a bug or a stolen
-- session cannot use the grant to wipe recent records.
-- Order records are NOT touched: customers keep their order history while the
-- account exists, and account deletion already anonymizes it.

GRANT DELETE ON audit_logs, payment_events, payment_reconciliation TO nearpill_app;

DROP POLICY IF EXISTS audit_logs_retention_delete ON audit_logs;
CREATE POLICY audit_logs_retention_delete ON audit_logs FOR DELETE TO nearpill_app
USING (
  nearpill.current_actor_role() = 'system'
  AND created_at < CURRENT_TIMESTAMP - INTERVAL '3 months'
);

DROP POLICY IF EXISTS payment_events_retention_delete ON payment_events;
CREATE POLICY payment_events_retention_delete ON payment_events FOR DELETE TO nearpill_app
USING (
  nearpill.current_actor_role() = 'system'
  AND created_at < CURRENT_TIMESTAMP - INTERVAL '3 months'
);

DROP POLICY IF EXISTS payment_reconciliation_retention_delete ON payment_reconciliation;
CREATE POLICY payment_reconciliation_retention_delete ON payment_reconciliation FOR DELETE TO nearpill_app
USING (
  nearpill.current_actor_role() = 'system'
  AND status <> 'open'
  AND created_at < CURRENT_TIMESTAMP - INTERVAL '3 months'
);
