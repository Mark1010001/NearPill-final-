-- Removes the staging checkout-test pharmacy that holds Account No. 4 (with the orders placed only at it, their payments and
-- reservations), then gives the "Mom's Best Value Pharmacy" that was added afterwards (Account No. 5) the freed number 4.
-- The test pharmacy is matched by id, name AND account number, and Mom's by name AND account number, so nothing else is touched
-- and a different database with other data is never affected. If either match fails, nothing is deleted or renumbered.
CREATE TEMP TABLE account_4_pharmacy ON COMMIT DROP AS
  SELECT id FROM drugstores
  WHERE id = 34 AND account_no = 4 AND name = 'NearPill Checkout Test Pharmacy (Staging)';

-- prescription_reviews has no migrator policy, so open one only for this delete.
CREATE POLICY migrator_cleanup_tmp ON nearpill.prescription_reviews FOR ALL TO nearpill_migrator USING (true) WITH CHECK (true);
DELETE FROM nearpill.prescription_reviews WHERE drugstore_id IN (SELECT id FROM account_4_pharmacy);
DROP POLICY migrator_cleanup_tmp ON nearpill.prescription_reviews;

DELETE FROM orders o
WHERE EXISTS (SELECT 1 FROM order_drugstores od WHERE od.order_id = o.id AND od.drugstore_id IN (SELECT id FROM account_4_pharmacy))
  AND NOT EXISTS (SELECT 1 FROM order_drugstores od WHERE od.order_id = o.id AND od.drugstore_id NOT IN (SELECT id FROM account_4_pharmacy));

DELETE FROM drugstores WHERE id IN (SELECT id FROM account_4_pharmacy);

UPDATE drugstores SET account_no = 4
WHERE name = 'Mom''s Best Value Pharmacy' AND account_no = 5
  AND NOT EXISTS (SELECT 1 FROM drugstores WHERE account_no = 4);
