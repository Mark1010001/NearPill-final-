-- Preserve administrator maintenance while separating visibility from DELETE authority.
GRANT DELETE ON reservations TO nearpill_app;
DROP POLICY reservations_app ON reservations;
CREATE POLICY reservations_select ON reservations FOR SELECT TO nearpill_app USING (
  nearpill.current_actor_role() IN ('admin','system')
  OR nearpill.current_capability() = 'order_mutation'
  OR EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.user_id = nearpill.current_actor_id())
  OR EXISTS (SELECT 1 FROM inventory i JOIN pharmacy_memberships pm ON pm.drugstore_id = i.drugstore_id
    WHERE i.id = inventory_id AND pm.user_id = nearpill.current_actor_id() AND pm.is_active = 1)
);
CREATE POLICY reservations_insert ON reservations FOR INSERT TO nearpill_app WITH CHECK (
  nearpill.current_actor_role() IN ('admin','system') OR nearpill.current_capability() = 'order_mutation'
);
CREATE POLICY reservations_update ON reservations FOR UPDATE TO nearpill_app USING (
  nearpill.current_actor_role() IN ('admin','system') OR nearpill.current_capability() = 'order_mutation'
) WITH CHECK (
  nearpill.current_actor_role() IN ('admin','system') OR nearpill.current_capability() = 'order_mutation'
);
CREATE POLICY reservations_delete ON reservations FOR DELETE TO nearpill_app USING (
  nearpill.current_actor_role() IN ('admin','system')
);
