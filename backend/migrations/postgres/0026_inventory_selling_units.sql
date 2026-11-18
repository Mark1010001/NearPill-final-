ALTER TABLE inventory
  ADD COLUMN selling_unit varchar(48) CHECK (selling_unit ~ '^[[:alnum:]][[:alnum:] ().,-]*$'),
  ADD COLUMN package_size varchar(80) CHECK (package_size ~ '^[[:alnum:]][[:alnum:] ().,/-]*$');

ALTER TABLE order_items ADD COLUMN selling_unit varchar(48);

CREATE FUNCTION nearpill.guard_inventory_selling_unit() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, nearpill AS $$
BEGIN
  IF (NEW.selling_unit, NEW.package_size) IS DISTINCT FROM (OLD.selling_unit, OLD.package_size) THEN
    IF OLD.reserved_quantity > 0 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Selling unit and package size are locked while stock is reserved';
    END IF;
    IF current_user = 'nearpill_app' AND nearpill.current_capability() IS DISTINCT FROM 'inventory_mutation' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'permission denied for inventory unit changes';
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION nearpill.guard_inventory_selling_unit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nearpill.guard_inventory_selling_unit() TO nearpill_app, nearpill_migrator;

CREATE TRIGGER inventory_selling_unit_authority BEFORE UPDATE OF selling_unit, package_size ON inventory
FOR EACH ROW EXECUTE FUNCTION nearpill.guard_inventory_selling_unit();
