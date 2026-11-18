-- A verified, public pharmacy may add a brand-new product to its own inventory in one intake transaction.
-- The product is stored as a draft master record (never otc_eligible, never published). Non-prescription and
-- non-medicine items become orderable through the existing pharmacy sale confirmation; prescription items are
-- listed but stay outside normal checkout, exactly like every other prescription listing.
CREATE POLICY medicines_partner_new_product_select ON medicines FOR SELECT TO nearpill_app
USING (nearpill.current_actor_role() = 'partner' AND nearpill.current_capability() = 'inventory_intake');

CREATE POLICY medicines_partner_new_product ON medicines FOR INSERT TO nearpill_app
WITH CHECK (
  nearpill.current_capability() = 'inventory_intake'
  AND nearpill.current_actor_role() = 'partner'
  AND publication_status = 'draft' AND NOT otc_eligible
  AND category IN ('Non-prescription', 'Prescription', 'Non-medicine')
  AND EXISTS (SELECT 1 FROM pharmacy_memberships pm
    WHERE pm.user_id = nearpill.current_actor_id() AND pm.is_active = 1)
);

CREATE POLICY inventory_partner_new_product ON inventory FOR INSERT TO nearpill_app
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
      AND m.publication_status = 'draft' AND NOT m.otc_eligible
      AND CASE WHEN m.category = 'Prescription' THEN inventory.pharmacy_sale_confirmation IS NULL
        ELSE (inventory.pharmacy_sale_confirmation -> 'product') = jsonb_build_array(m.brand_name, m.generic_name, m.dosage_form, m.category) END
  )
);
