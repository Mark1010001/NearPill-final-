-- Ownership permits reads; authoritative order writes require the backend transaction capability.
DROP POLICY orders_insert ON orders;
CREATE POLICY orders_insert ON orders FOR INSERT TO nearpill_app WITH CHECK (
  nearpill.current_actor_role() IN ('admin','system')
  OR (nearpill.current_capability() = 'order_mutation' AND user_id = nearpill.current_actor_id())
);
DROP POLICY orders_update ON orders;
CREATE POLICY orders_update ON orders FOR UPDATE TO nearpill_app USING (
  nearpill.current_actor_role() IN ('admin','system')
  OR (nearpill.current_capability() = 'order_mutation' AND user_id = nearpill.current_actor_id())
) WITH CHECK (
  nearpill.current_actor_role() IN ('admin','system')
  OR (nearpill.current_capability() = 'order_mutation' AND user_id = nearpill.current_actor_id())
);
DROP POLICY order_drugstores_insert ON order_drugstores;
CREATE POLICY order_drugstores_insert ON order_drugstores FOR INSERT TO nearpill_app WITH CHECK (
  nearpill.current_actor_role() IN ('admin','system')
  OR (nearpill.current_capability() = 'order_mutation' AND user_id = nearpill.current_actor_id())
);
DROP POLICY order_drugstores_update ON order_drugstores;
CREATE POLICY order_drugstores_update ON order_drugstores FOR UPDATE TO nearpill_app USING (
  nearpill.current_actor_role() IN ('admin','system')
  OR (nearpill.current_capability() = 'order_mutation' AND user_id = nearpill.current_actor_id())
) WITH CHECK (
  nearpill.current_actor_role() IN ('admin','system')
  OR (nearpill.current_capability() = 'order_mutation' AND user_id = nearpill.current_actor_id())
);

DROP POLICY order_items_insert ON order_items;
CREATE POLICY order_items_insert ON order_items FOR INSERT TO nearpill_app WITH CHECK (
  nearpill.current_actor_role() IN ('admin','system')
  OR (nearpill.current_capability() = 'order_mutation' AND EXISTS (
    SELECT 1 FROM order_drugstores od
    WHERE od.id = order_drugstore_id AND od.user_id = nearpill.current_actor_id()
  ))
);
-- The application never deletes accounting/stock history or edits existing price snapshots.
REVOKE DELETE ON orders, order_drugstores, order_items, inventory, reservations, stock_movements FROM nearpill_app;
REVOKE UPDATE ON order_items FROM nearpill_app;

DROP POLICY inventory_write ON inventory;
CREATE POLICY inventory_insert ON inventory FOR INSERT TO nearpill_app WITH CHECK (
  nearpill.current_actor_role() IN ('admin','system')
);
CREATE POLICY inventory_update ON inventory FOR UPDATE TO nearpill_app USING (
  nearpill.current_actor_role() IN ('admin','system')
  OR nearpill.current_capability() = 'order_mutation'
  OR EXISTS (SELECT 1 FROM pharmacy_memberships pm
    WHERE pm.drugstore_id = inventory.drugstore_id
      AND pm.user_id = nearpill.current_actor_id() AND pm.is_active = 1)
) WITH CHECK (
  nearpill.current_actor_role() IN ('admin','system')
  OR nearpill.current_capability() = 'order_mutation'
  OR EXISTS (SELECT 1 FROM pharmacy_memberships pm
    WHERE pm.drugstore_id = inventory.drugstore_id
      AND pm.user_id = nearpill.current_actor_id() AND pm.is_active = 1)
);

-- RLS scopes rows; this invoker trigger protects columns within a member's own row.
CREATE FUNCTION nearpill.guard_inventory_authority() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, nearpill AS $$
BEGIN
  IF current_user = 'nearpill_app' AND nearpill.current_actor_role() NOT IN ('admin','system') THEN
    IF NEW.price_centavos IS DISTINCT FROM OLD.price_centavos THEN
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
CREATE TRIGGER inventory_authority BEFORE UPDATE ON inventory
FOR EACH ROW EXECUTE FUNCTION nearpill.guard_inventory_authority();
GRANT EXECUTE ON FUNCTION nearpill.guard_inventory_authority() TO nearpill_app, nearpill_migrator;
