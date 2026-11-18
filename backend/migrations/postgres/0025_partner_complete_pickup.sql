-- Allow completion of the same branch-scoped test pickups.
DROP POLICY orders_partner_pickup_update ON orders;
DROP POLICY order_drugstores_partner_pickup_update ON order_drugstores;
CREATE POLICY orders_partner_pickup_update ON orders FOR UPDATE TO nearpill_app USING (
  nearpill.current_actor_role() = 'partner' AND nearpill.current_capability() = 'order_mutation'
  AND reference LIKE 'NP-TEST-%' AND status IN ('confirmed','preparing','ready_for_pickup','completed')
  AND EXISTS (SELECT 1 FROM order_drugstores od JOIN pharmacy_memberships pm ON pm.drugstore_id = od.drugstore_id
    WHERE od.order_id = orders.id AND pm.user_id = nearpill.current_actor_id() AND pm.is_active = 1)
) WITH CHECK (
  nearpill.current_actor_role() = 'partner' AND nearpill.current_capability() = 'order_mutation'
  AND reference LIKE 'NP-TEST-%' AND status IN ('preparing','ready_for_pickup','completed')
  AND EXISTS (SELECT 1 FROM order_drugstores od JOIN pharmacy_memberships pm ON pm.drugstore_id = od.drugstore_id
    WHERE od.order_id = orders.id AND pm.user_id = nearpill.current_actor_id() AND pm.is_active = 1)
);
CREATE POLICY order_drugstores_partner_pickup_update ON order_drugstores FOR UPDATE TO nearpill_app USING (
  nearpill.current_actor_role() = 'partner' AND nearpill.current_capability() = 'order_mutation'
  AND status IN ('confirmed','preparing','ready_for_pickup','completed')
  AND EXISTS (SELECT 1 FROM pharmacy_memberships pm WHERE pm.drugstore_id = order_drugstores.drugstore_id
    AND pm.user_id = nearpill.current_actor_id() AND pm.is_active = 1)
) WITH CHECK (
  nearpill.current_actor_role() = 'partner' AND nearpill.current_capability() = 'order_mutation'
  AND status IN ('preparing','ready_for_pickup','completed')
  AND EXISTS (SELECT 1 FROM pharmacy_memberships pm WHERE pm.drugstore_id = order_drugstores.drugstore_id
    AND pm.user_id = nearpill.current_actor_id() AND pm.is_active = 1)
);
