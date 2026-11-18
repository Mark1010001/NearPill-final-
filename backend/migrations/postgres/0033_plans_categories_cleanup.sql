-- 1) Subscription plans become Basic, Plus and Pro. The old "Premium" plan is the same product as Pro.
DO $$
DECLARE constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'subscriptions'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%tier%'
  LOOP
    EXECUTE format('ALTER TABLE subscriptions DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
END $$;

UPDATE subscriptions SET tier = 'Pro' WHERE tier = 'Premium';
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_tier_check CHECK (tier IN ('Basic', 'Plus', 'Pro'));

-- Pro also unlocks the full sales history. Plus keeps the 90-day sales report entitlement it already implies.
INSERT INTO subscription_entitlements (drugstore_id, subscription_id, entitlement_key)
SELECT s.drugstore_id, s.id, 'reports:history:full'
FROM subscriptions s
WHERE s.tier = 'Pro' AND s.status = 'active'
  AND (s.end_date IS NULL OR s.end_date >= CURRENT_DATE)
  AND NOT EXISTS (
    SELECT 1 FROM subscription_entitlements e
    WHERE e.drugstore_id = s.drugstore_id AND e.entitlement_key = 'reports:history:full' AND e.revoked_at IS NULL
  );

-- 2) Product categories are only Prescription, Non-prescription and Non-medicine.
CREATE OR REPLACE FUNCTION nearpill.canonical_category(value text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN value IS NULL THEN NULL
    WHEN lower(btrim(value)) IN ('prescription', 'prescriptions', 'prescription (source list)') THEN 'Prescription'
    WHEN lower(btrim(value)) IN ('non-prescription', 'non-prescriptions', 'non - prescriptions', 'non-prescription (source list)', 'general otc', 'otc') THEN 'Non-prescription'
    WHEN lower(btrim(value)) IN ('medical supplies', 'non-medicine', 'non-medicines', 'non medicine', 'non medicines') THEN 'Non-medicine'
    ELSE value
  END
$$;

CREATE OR REPLACE FUNCTION nearpill.normalize_medicine_category() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, nearpill AS $$
BEGIN
  NEW.category := nearpill.canonical_category(NEW.category);
  RETURN NEW;
END $$;

GRANT EXECUTE ON FUNCTION nearpill.canonical_category(text) TO nearpill_app;

-- A pharmacy sale confirmation stores a snapshot of the product's identity, which includes the category. Keep every
-- snapshot that currently matches in step with the renamed category, so those listings stay orderable.
UPDATE inventory i
SET pharmacy_sale_confirmation = jsonb_set(i.pharmacy_sale_confirmation, '{product}',
      jsonb_build_array(m.brand_name, m.generic_name, m.dosage_form, nearpill.canonical_category(m.category)))
FROM medicines m
WHERE m.id = i.medicine_id
  AND i.pharmacy_sale_confirmation IS NOT NULL
  AND (i.pharmacy_sale_confirmation -> 'product') = jsonb_build_array(m.brand_name, m.generic_name, m.dosage_form, m.category)
  AND m.category IS DISTINCT FROM nearpill.canonical_category(m.category);

UPDATE medicines SET category = nearpill.canonical_category(category)
WHERE category IS DISTINCT FROM nearpill.canonical_category(category);

DROP TRIGGER IF EXISTS medicines_normalize_category ON medicines;
CREATE TRIGGER medicines_normalize_category BEFORE INSERT OR UPDATE OF category ON medicines
FOR EACH ROW EXECUTE FUNCTION nearpill.normalize_medicine_category();
