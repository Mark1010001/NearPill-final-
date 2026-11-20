-- Stock that passes the template check is applied at once, so there is no admin approval step any more.
-- The service records each upload as 'approved' (reviewed_by stays empty) while running as the system actor.
DROP POLICY IF EXISTS stock_submissions_auto_insert ON stock_submissions;
CREATE POLICY stock_submissions_auto_insert ON stock_submissions FOR INSERT TO nearpill_app
WITH CHECK (
  nearpill.current_actor_role() = 'system'
  AND nearpill.current_capability() = 'inventory_mutation'
  AND status = 'approved' AND reviewed_by IS NULL AND reviewed_at IS NOT NULL
  AND submitted_by = nearpill.current_actor_id()
  AND EXISTS (
    SELECT 1 FROM pharmacy_memberships pm JOIN drugstores d ON d.id = pm.drugstore_id
    WHERE pm.drugstore_id = stock_submissions.drugstore_id
      AND pm.user_id = nearpill.current_actor_id() AND pm.is_active = 1
      AND d.is_active = 1 AND d.verification_status = 'verified'
  )
);
