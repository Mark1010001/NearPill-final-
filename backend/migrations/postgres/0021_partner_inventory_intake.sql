-- Partners may open a listing for an eligible master product through intake.
CREATE POLICY inventory_partner_intake ON inventory FOR INSERT TO nearpill_app
WITH CHECK (
  nearpill.current_capability() = 'inventory_intake'
  AND nearpill.current_actor_role() = 'partner'
  AND stock_on_hand > 0 AND reserved_quantity = 0
  AND price_centavos > 0 AND availability = 1
  AND EXISTS (
    SELECT 1 FROM pharmacy_memberships pm
    JOIN drugstores d ON d.id = pm.drugstore_id
    WHERE pm.drugstore_id = inventory.drugstore_id
      AND pm.user_id = nearpill.current_actor_id() AND pm.is_active = 1
      AND d.is_active = 1 AND d.verification_status = 'verified'
      AND d.public_profile_published_at IS NOT NULL
  )
  AND EXISTS (
    SELECT 1 FROM medicines m WHERE m.id = inventory.medicine_id
      AND m.publication_status = 'published' AND m.otc_eligible
  )
);

CREATE POLICY stock_movements_partner_intake ON stock_movements FOR INSERT TO nearpill_app
WITH CHECK (
  nearpill.current_capability() = 'inventory_intake'
  AND nearpill.current_actor_role() = 'partner'
  AND actor_id = nearpill.current_actor_id()
  AND movement_type = 'adjustment' AND stock_on_hand_delta > 0 AND reserved_delta = 0
  AND EXISTS (
    SELECT 1 FROM inventory i JOIN pharmacy_memberships pm ON pm.drugstore_id = i.drugstore_id
    WHERE i.id = stock_movements.inventory_id
      AND pm.user_id = nearpill.current_actor_id() AND pm.is_active = 1
  )
);

CREATE POLICY audit_logs_partner_intake_receipt ON audit_logs FOR SELECT TO nearpill_app
USING (
  nearpill.current_capability() = 'inventory_intake'
  AND nearpill.current_actor_role() = 'partner'
  AND user_id = nearpill.current_actor_id()
  AND action = 'ADD_APPROVED_INVENTORY'
);
