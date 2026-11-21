-- Simpler, consistent database names. The data, security rules and links all carry over because tables and columns are renamed in place.
--   drugstores -> pharmacies, inventory -> stock, order_drugstores -> order_pharmacies,
--   subscription_entitlements -> plan_features, payment_reconciliation -> payment_issues,
--   email_verification_challenges -> email_codes, password_reset_challenges -> reset_links.
--   Every column named *drugstore* becomes *pharmacy* (drugstore_id -> pharmacy_id) and *inventory* becomes *stock* (inventory_id -> stock_id).
--   stock_movements: stock_on_hand_delta -> stock_change, reserved_delta -> held_change.
-- Also removed: drugstores.account_no (the pharmacy id is the only number now), the medicine_evidence, medicine_id_renumbering and billing_events tables, and the unused columns payment_reconciliation.resolved_by/resolved_at and subscription_entitlements.granted_at.
ALTER TABLE drugstores RENAME TO pharmacies;
ALTER TABLE inventory RENAME TO stock;
ALTER TABLE order_drugstores RENAME TO order_pharmacies;
ALTER TABLE subscription_entitlements RENAME TO plan_features;
ALTER TABLE payment_reconciliation RENAME TO payment_issues;
ALTER TABLE email_verification_challenges RENAME TO email_codes;
ALTER TABLE password_reset_challenges RENAME TO reset_links;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT table_schema, table_name, column_name FROM information_schema.columns
    WHERE table_schema IN ('public', 'nearpill') AND (column_name LIKE '%drugstore%' OR column_name LIKE '%inventory%')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I RENAME COLUMN %I TO %I', r.table_schema, r.table_name, r.column_name,
      replace(replace(r.column_name, 'drugstore', 'pharmacy'), 'inventory', 'stock'));
  END LOOP;
END $$;

ALTER TABLE stock_movements RENAME COLUMN stock_on_hand_delta TO stock_change;
ALTER TABLE stock_movements RENAME COLUMN reserved_delta TO held_change;

-- Pharmacies are identified by id only.
ALTER TABLE pharmacies DROP COLUMN account_no;
-- Medicines no longer need an evidence record before they can be published.
DROP TABLE medicine_evidence;
-- Unused leftovers: the one-time catalog renumbering map, the plan change history (audit_logs already records
-- every subscription change) and columns nothing ever reads.
DROP TABLE medicine_id_renumbering;
DROP TABLE billing_events;
ALTER TABLE payment_issues DROP COLUMN resolved_by;
ALTER TABLE payment_issues DROP COLUMN resolved_at;
ALTER TABLE plan_features DROP COLUMN granted_at;

-- The trigger function reads column names inside its body, so it is rewritten with the new names.
CREATE OR REPLACE FUNCTION nearpill.guard_inventory_authority() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, nearpill AS $$
BEGIN
  IF current_user = 'nearpill_app' AND nearpill.current_actor_role() NOT IN ('admin','system') THEN
    IF NEW.price_centavos IS DISTINCT FROM OLD.price_centavos
       AND NOT (nearpill.current_actor_role() = 'partner'
         AND nearpill.current_capability() IS NOT DISTINCT FROM 'inventory_mutation') THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'permission denied for column price_centavos';
    END IF;
    IF NEW.reserved_quantity IS DISTINCT FROM OLD.reserved_quantity
       AND nearpill.current_capability() <> 'order_mutation'
       AND NOT (nearpill.current_capability() = 'payment_mutation' AND nearpill.current_actor_id() IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'permission denied for column reserved_quantity';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.pharmacy_id IS DISTINCT FROM OLD.pharmacy_id
       OR NEW.medicine_id IS DISTINCT FROM OLD.medicine_id THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'permission denied for table stock';
    END IF;
  END IF;
  IF current_user = 'nearpill_app'
     AND NEW.pharmacy_sale_confirmation IS DISTINCT FROM OLD.pharmacy_sale_confirmation
     AND NOT (nearpill.current_actor_role() = 'partner'
       AND nearpill.current_capability() IS NOT DISTINCT FROM 'inventory_mutation'
       AND EXISTS (SELECT 1 FROM pharmacy_memberships pm
         WHERE pm.pharmacy_id = OLD.pharmacy_id AND pm.user_id = nearpill.current_actor_id() AND pm.is_active = 1)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'permission denied for pharmacy sale confirmation';
  END IF;
  RETURN NEW;
END $$;
