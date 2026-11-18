-- A verified, public pharmacy may list ANY catalog item (non-prescription, prescription or non-medicine) from the
-- "From the catalog" form. Rules are unchanged: prescription listings stay outside normal checkout, and a draft
-- non-prescription/non-medicine item only becomes orderable through the pharmacy sale confirmation that the intake
-- transaction records. Listings with no confirmation are visible to the pharmacy but never orderable.
CREATE POLICY inventory_partner_catalog_any ON inventory FOR INSERT TO nearpill_app
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
      AND (inventory.pharmacy_sale_confirmation IS NULL
        OR (m.publication_status = 'draft' AND NOT m.otc_eligible
          AND (inventory.pharmacy_sale_confirmation -> 'product') = jsonb_build_array(m.brand_name, m.generic_name, m.dosage_form, m.category)))
  )
);
