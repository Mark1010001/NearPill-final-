-- Deletes two leftover synthetic test pharmacies and everything that belongs only to them (inventory, memberships,
-- subscriptions and verification records go with the pharmacy; orders placed only at these pharmacies, with their
-- payments and reservations, are deleted first). Nothing else is touched.
CREATE TEMP TABLE test_pharmacies_to_delete ON COMMIT DROP AS
  SELECT id FROM drugstores
  WHERE name = 'NearPill Demo Drugstore (Staging)' OR name LIKE 'Synthetic Catalog Check %';

-- prescription_reviews has no migrator policy, so open one only for this delete.
CREATE POLICY migrator_cleanup_tmp ON nearpill.prescription_reviews FOR ALL TO nearpill_migrator USING (true) WITH CHECK (true);
DELETE FROM nearpill.prescription_reviews WHERE drugstore_id IN (SELECT id FROM test_pharmacies_to_delete);
DROP POLICY migrator_cleanup_tmp ON nearpill.prescription_reviews;

DELETE FROM orders o
WHERE EXISTS (SELECT 1 FROM order_drugstores od WHERE od.order_id = o.id AND od.drugstore_id IN (SELECT id FROM test_pharmacies_to_delete))
  AND NOT EXISTS (SELECT 1 FROM order_drugstores od WHERE od.order_id = o.id AND od.drugstore_id NOT IN (SELECT id FROM test_pharmacies_to_delete));

DELETE FROM drugstores WHERE id IN (SELECT id FROM test_pharmacies_to_delete);
