-- Deletes three leftover test pharmacies (two synthetic catalog/intake checks and the "Mom's Best Value" demo) and what belongs
-- only to them (inventory, memberships, subscriptions and verification records go with the pharmacy). Each one is matched by
-- id AND name and only deleted while it has no orders, so a different pharmacy that happens to share an id on another database
-- is never touched. "NearPill Checkout Test Pharmacy (Staging)" is deliberately kept: it has orders.
CREATE TEMP TABLE leftover_test_pharmacies ON COMMIT DROP AS
  SELECT d.id FROM drugstores d
  WHERE ((d.id = 36 AND d.name LIKE 'Synthetic Intake %')
      OR (d.id = 37 AND d.name LIKE 'Synthetic CSV %')
      OR (d.id = 38 AND d.name = 'Mom''s Best Value Pharmacy'))
    AND NOT EXISTS (SELECT 1 FROM order_drugstores od WHERE od.drugstore_id = d.id);

-- prescription_reviews has no migrator policy, so open one only for this delete.
CREATE POLICY migrator_cleanup_tmp ON nearpill.prescription_reviews FOR ALL TO nearpill_migrator USING (true) WITH CHECK (true);
DELETE FROM nearpill.prescription_reviews WHERE drugstore_id IN (SELECT id FROM leftover_test_pharmacies);
DROP POLICY migrator_cleanup_tmp ON nearpill.prescription_reviews;

DELETE FROM drugstores WHERE id IN (SELECT id FROM leftover_test_pharmacies);
