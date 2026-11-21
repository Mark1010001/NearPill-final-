-- Keeps only ALV Pharmacy, Bing Pharmacy, Dobol B Pharmacy and Mom's Best Value Pharmacy and numbers them 1 to 4
-- (ALV = 1, Bing = 2, Dobol B = 3, Mom's = 4). Every other pharmacy is deleted completely: its stock, plans, memberships,
-- verification and prescription-review records, and the orders placed only at it (with their payments and reservations).
-- Partner login accounts that belong only to the deleted pharmacies are deleted too. Customers, administrators and the four
-- kept pharmacies' accounts are never touched. The next pharmacy created gets number 5.
-- Safety: if the four pharmacies are not found by exactly these names, or the renumbering check fails, the migration stops and
-- changes nothing.
DO $$
BEGIN
  IF (SELECT count(*) FROM pharmacies
      WHERE name IN ('ALV Pharmacy', 'Bing Pharmacy', 'Dobol B Pharmacy')
         OR replace(name, '''', '') = 'Moms Best Value Pharmacy') <> 4 THEN
    RAISE EXCEPTION 'Expected exactly ALV Pharmacy, Bing Pharmacy, Dobol B Pharmacy and Mom''s Best Value Pharmacy; nothing was changed.';
  END IF;
END $$;

CREATE TEMP TABLE pharmacies_to_remove ON COMMIT DROP AS
  SELECT id FROM pharmacies
  WHERE NOT (name IN ('ALV Pharmacy', 'Bing Pharmacy', 'Dobol B Pharmacy')
             OR replace(name, '''', '') = 'Moms Best Value Pharmacy');

-- Worked out before the pharmacies go, while their memberships still exist.
CREATE TEMP TABLE partner_logins_to_remove ON COMMIT DROP AS
  SELECT u.id FROM users u
  WHERE u.role = 'partner'
    AND NOT EXISTS (SELECT 1 FROM pharmacy_memberships pm
                    WHERE pm.user_id = u.id AND pm.pharmacy_id NOT IN (SELECT id FROM pharmacies_to_remove));

CREATE TEMP TABLE pharmacy_new_ids ON COMMIT DROP AS
  SELECT p.id AS old_id,
         (CASE WHEN p.name = 'ALV Pharmacy' THEN 1
               WHEN p.name = 'Bing Pharmacy' THEN 2
               WHEN p.name = 'Dobol B Pharmacy' THEN 3
               ELSE 4 END)::integer AS new_id
  FROM pharmacies p WHERE p.id NOT IN (SELECT id FROM pharmacies_to_remove);

-- prescription_reviews has no migrator policy, so open one only for this change.
CREATE POLICY migrator_cleanup_tmp ON nearpill.prescription_reviews FOR ALL TO nearpill_migrator USING (true) WITH CHECK (true);
DELETE FROM nearpill.prescription_reviews WHERE pharmacy_id IN (SELECT id FROM pharmacies_to_remove);

DELETE FROM orders o
WHERE EXISTS (SELECT 1 FROM order_pharmacies od WHERE od.order_id = o.id AND od.pharmacy_id IN (SELECT id FROM pharmacies_to_remove))
  AND NOT EXISTS (SELECT 1 FROM order_pharmacies od WHERE od.order_id = o.id AND od.pharmacy_id NOT IN (SELECT id FROM pharmacies_to_remove));

DELETE FROM pharmacies WHERE id IN (SELECT id FROM pharmacies_to_remove);
DELETE FROM users WHERE id IN (SELECT id FROM partner_logins_to_remove);

DO $$
DECLARE
  fk record;
  max_id integer;
  before_stock bigint; before_members bigint; before_plans bigint; before_children bigint;
BEGIN
  SELECT count(*) INTO before_stock FROM stock;
  SELECT count(*) INTO before_members FROM pharmacy_memberships;
  SELECT count(*) INTO before_plans FROM subscriptions;
  SELECT count(*) INTO before_children FROM order_pharmacies;

  CREATE TEMP TABLE pharmacy_fk_defs ON COMMIT DROP AS
  SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint WHERE contype = 'f' AND confrelid = 'pharmacies'::regclass;

  -- Let the new IDs flow into every referencing table, then put the original constraints back.
  FOR fk IN SELECT * FROM pharmacy_fk_defs LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.tbl, fk.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s ON UPDATE CASCADE', fk.tbl, fk.conname, fk.def);
  END LOOP;

  -- Two steps (through negative numbers) so no ID ever collides with an old one.
  UPDATE pharmacies p SET id = -r.new_id FROM pharmacy_new_ids r WHERE p.id = r.old_id;
  UPDATE pharmacies SET id = -id WHERE id < 0;

  FOR fk IN SELECT * FROM pharmacy_fk_defs LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.tbl, fk.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', fk.tbl, fk.conname, fk.def);
  END LOOP;

  SELECT COALESCE(max(id), 0) INTO max_id FROM pharmacies;
  EXECUTE format('ALTER TABLE pharmacies ALTER COLUMN id RESTART WITH %s', max_id + 1);

  IF (SELECT count(*) FROM pharmacies) <> 4
     OR (SELECT count(*) FROM pharmacies WHERE id BETWEEN 1 AND 4) <> 4
     OR (SELECT count(*) FROM stock) <> before_stock
     OR (SELECT count(*) FROM pharmacy_memberships) <> before_members
     OR (SELECT count(*) FROM subscriptions) <> before_plans
     OR (SELECT count(*) FROM order_pharmacies) <> before_children
     OR EXISTS (SELECT 1 FROM stock s WHERE NOT EXISTS (SELECT 1 FROM pharmacies p WHERE p.id = s.pharmacy_id))
     OR EXISTS (SELECT 1 FROM pharmacy_memberships m WHERE NOT EXISTS (SELECT 1 FROM pharmacies p WHERE p.id = m.pharmacy_id))
     OR EXISTS (SELECT 1 FROM subscriptions s WHERE NOT EXISTS (SELECT 1 FROM pharmacies p WHERE p.id = s.pharmacy_id))
     OR EXISTS (SELECT 1 FROM order_pharmacies o WHERE NOT EXISTS (SELECT 1 FROM pharmacies p WHERE p.id = o.pharmacy_id)) THEN
    RAISE EXCEPTION 'Pharmacy renumbering check failed; nothing was changed.';
  END IF;
END $$;

DROP POLICY migrator_cleanup_tmp ON nearpill.prescription_reviews;
