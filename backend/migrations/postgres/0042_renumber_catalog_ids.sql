-- Renumber catalog IDs (medicines.id) so they follow the partner pharmacies: pharmacy Account No. 1 first, then
-- medicine name A-Z; medicines first stocked by the next Account No. follow, and unstocked medicines come last.
-- Every table that points at a medicine is updated together inside this one transaction. The old to new mapping
-- is kept in medicine_id_renumbering so any record can be traced back.
DO $$
DECLARE
  fk record;
  before_inventory bigint; before_items bigint; before_medicines bigint;
  max_id integer;
BEGIN
  IF EXISTS (SELECT 1 FROM stock_submissions WHERE status = 'pending') THEN
    RAISE EXCEPTION 'Approve or reject all pending stock submissions before renumbering catalog IDs.';
  END IF;
  SELECT count(*) INTO before_medicines FROM medicines;
  SELECT count(*) INTO before_inventory FROM inventory;
  SELECT count(*) INTO before_items FROM order_items;

  CREATE TABLE medicine_id_renumbering AS
  SELECT m.id AS old_id,
         (row_number() OVER (
           ORDER BY COALESCE((SELECT min(d.account_no) FROM inventory i JOIN drugstores d ON d.id = i.drugstore_id WHERE i.medicine_id = m.id), 2147483647),
                    lower(m.brand_name), m.id))::integer AS new_id
  FROM medicines m;
  ALTER TABLE medicine_id_renumbering ADD PRIMARY KEY (old_id);
  CREATE UNIQUE INDEX medicine_id_renumbering_new_idx ON medicine_id_renumbering (new_id);
  ALTER TABLE medicine_id_renumbering ENABLE ROW LEVEL SECURITY;
  ALTER TABLE medicine_id_renumbering FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS migrator_all ON medicine_id_renumbering;
  CREATE POLICY migrator_all ON medicine_id_renumbering FOR ALL TO nearpill_migrator USING (true) WITH CHECK (true);

  CREATE TEMP TABLE medicine_fk_defs ON COMMIT DROP AS
  SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint WHERE contype = 'f' AND confrelid = 'medicines'::regclass;

  -- Let the new IDs flow into every referencing table, then put the original constraints back.
  FOR fk IN SELECT * FROM medicine_fk_defs LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.tbl, fk.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s ON UPDATE CASCADE', fk.tbl, fk.conname, fk.def);
  END LOOP;

  -- Two steps (through negative numbers) so no ID ever collides with an old one.
  UPDATE medicines m SET id = -r.new_id FROM medicine_id_renumbering r WHERE m.id = r.old_id;
  UPDATE medicines SET id = -id WHERE id < 0;

  FOR fk IN SELECT * FROM medicine_fk_defs LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.tbl, fk.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', fk.tbl, fk.conname, fk.def);
  END LOOP;

  SELECT COALESCE(max(id), 0) INTO max_id FROM medicines;
  EXECUTE format('ALTER TABLE medicines ALTER COLUMN id RESTART WITH %s', max_id + 1);

  IF (SELECT count(*) FROM medicines) <> before_medicines
     OR (SELECT count(*) FROM inventory) <> before_inventory
     OR (SELECT count(*) FROM order_items) <> before_items
     OR max_id <> before_medicines
     OR EXISTS (SELECT 1 FROM inventory i WHERE NOT EXISTS (SELECT 1 FROM medicines m WHERE m.id = i.medicine_id))
     OR EXISTS (SELECT 1 FROM order_items i WHERE NOT EXISTS (SELECT 1 FROM medicines m WHERE m.id = i.medicine_id)) THEN
    RAISE EXCEPTION 'Catalog renumbering check failed; nothing was changed.';
  END IF;
END $$;
