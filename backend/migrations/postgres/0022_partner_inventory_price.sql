-- The existing inventory update policy restricts the partner to an active pharmacy membership.
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
  RETURN NEW;
END $$;
