-- Payment access uses the FK-protected owner column too; no child SELECT policy may query orders.
DROP POLICY order_drugstores_payment_mutation_select ON order_drugstores;
CREATE POLICY order_drugstores_payment_mutation_select ON order_drugstores FOR SELECT TO nearpill_app USING (
  nearpill.current_capability() = 'payment_mutation'
  AND (nearpill.current_actor_id() IS NULL OR user_id = nearpill.current_actor_id())
);
DROP POLICY order_drugstores_payment_mutation_update ON order_drugstores;
CREATE POLICY order_drugstores_payment_mutation_update ON order_drugstores FOR UPDATE TO nearpill_app USING (
  nearpill.current_capability() = 'payment_mutation'
  AND (nearpill.current_actor_id() IS NULL OR user_id = nearpill.current_actor_id())
) WITH CHECK (
  nearpill.current_capability() = 'payment_mutation'
  AND (nearpill.current_actor_id() IS NULL OR user_id = nearpill.current_actor_id())
);
