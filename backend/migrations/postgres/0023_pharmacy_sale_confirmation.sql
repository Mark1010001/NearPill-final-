ALTER TABLE inventory ADD COLUMN pharmacy_sale_confirmation jsonb;

CREATE POLICY medicines_partner_sale_confirmation ON medicines FOR SELECT TO nearpill_app
USING (nearpill.current_actor_role() = 'partner' AND nearpill.current_capability() = 'inventory_mutation');

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
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.drugstore_id IS DISTINCT FROM OLD.drugstore_id
       OR NEW.medicine_id IS DISTINCT FROM OLD.medicine_id THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'permission denied for table inventory';
    END IF;
  END IF;
  IF current_user = 'nearpill_app'
     AND NEW.pharmacy_sale_confirmation IS DISTINCT FROM OLD.pharmacy_sale_confirmation
     AND NOT (nearpill.current_actor_role() = 'partner'
       AND nearpill.current_capability() IS NOT DISTINCT FROM 'inventory_mutation'
       AND EXISTS (SELECT 1 FROM pharmacy_memberships pm
         WHERE pm.drugstore_id = OLD.drugstore_id AND pm.user_id = nearpill.current_actor_id() AND pm.is_active = 1)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'permission denied for pharmacy sale confirmation';
  END IF;
  RETURN NEW;
END $$;
