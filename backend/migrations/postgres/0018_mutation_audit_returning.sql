-- INSERT RETURNING also needs SELECT RLS; limit mutation receipts to the current actor.
DROP POLICY audit_logs_select ON audit_logs;
CREATE POLICY audit_logs_select ON audit_logs FOR SELECT TO nearpill_app USING (
  nearpill.current_actor_role() IN ('admin','system')
  OR (user_id = nearpill.current_actor_id()
    AND nearpill.current_capability() IN ('order_mutation','inventory_mutation','payment_mutation'))
);
