-- Removes every pharmacy except ALV Pharmacy, Bing Pharmacy and Dobol B Pharmacy (the leftover test pharmacies such as
-- "Mom's Best Value Pharmacy" and the staging checkout test pharmacy), plus the orders placed only at them with their payments
-- and reservations. Stock, memberships, subscriptions and verification records go with each pharmacy. The partner login
-- accounts that belong only to the removed pharmacies (including leftover partner accounts with no pharmacy) are deleted too,
-- so their email addresses can be used again. Accounts linked to ALV, Bing or Dobol B, customers and administrators are never touched.
-- Safety: if the three pharmacies to keep are not found by exactly these names, the migration stops and changes nothing.
DO $$
BEGIN
  IF (SELECT count(*) FROM drugstores WHERE name IN ('ALV Pharmacy', 'Bing Pharmacy', 'Dobol B Pharmacy')) <> 3 THEN
    RAISE EXCEPTION 'Expected exactly ALV Pharmacy, Bing Pharmacy and Dobol B Pharmacy; nothing was deleted.';
  END IF;
END $$;

CREATE TEMP TABLE pharmacies_to_remove ON COMMIT DROP AS
  SELECT id FROM drugstores WHERE name NOT IN ('ALV Pharmacy', 'Bing Pharmacy', 'Dobol B Pharmacy');

-- Worked out before the pharmacies go, while their memberships still exist.
CREATE TEMP TABLE partner_logins_to_remove ON COMMIT DROP AS
  SELECT u.id FROM users u
  WHERE u.role = 'partner'
    AND NOT EXISTS (SELECT 1 FROM pharmacy_memberships pm
                    WHERE pm.user_id = u.id AND pm.drugstore_id NOT IN (SELECT id FROM pharmacies_to_remove));

-- prescription_reviews has no migrator policy, so open one only for this delete.
CREATE POLICY migrator_cleanup_tmp ON nearpill.prescription_reviews FOR ALL TO nearpill_migrator USING (true) WITH CHECK (true);
DELETE FROM nearpill.prescription_reviews WHERE drugstore_id IN (SELECT id FROM pharmacies_to_remove);
DROP POLICY migrator_cleanup_tmp ON nearpill.prescription_reviews;

DELETE FROM orders o
WHERE EXISTS (SELECT 1 FROM order_drugstores od WHERE od.order_id = o.id AND od.drugstore_id IN (SELECT id FROM pharmacies_to_remove))
  AND NOT EXISTS (SELECT 1 FROM order_drugstores od WHERE od.order_id = o.id AND od.drugstore_id NOT IN (SELECT id FROM pharmacies_to_remove));

DELETE FROM drugstores WHERE id IN (SELECT id FROM pharmacies_to_remove);
DELETE FROM users WHERE id IN (SELECT id FROM partner_logins_to_remove);
