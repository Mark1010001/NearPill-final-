-- Store the parent owner with a composite FK so child RLS never queries orders recursively.
ALTER TABLE orders ADD CONSTRAINT orders_id_user_unique UNIQUE (id, user_id);
ALTER TABLE order_drugstores ADD COLUMN user_id integer;
UPDATE order_drugstores od SET user_id = o.user_id FROM orders o WHERE o.id = od.order_id;
ALTER TABLE order_drugstores ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE order_drugstores ADD CONSTRAINT order_drugstores_owner_fk
  FOREIGN KEY (order_id, user_id) REFERENCES orders (id, user_id) ON DELETE CASCADE;

CREATE FUNCTION nearpill.set_order_group_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, nearpill AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    SELECT user_id INTO NEW.user_id FROM public.orders WHERE id = NEW.order_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_group_owner BEFORE INSERT ON order_drugstores
FOR EACH ROW EXECUTE FUNCTION nearpill.set_order_group_owner();

DROP POLICY order_drugstores_select ON order_drugstores;
CREATE POLICY order_drugstores_select ON order_drugstores FOR SELECT TO nearpill_app USING (
  user_id = nearpill.current_actor_id()
  OR nearpill.current_actor_role() IN ('admin','system')
  OR EXISTS (
    SELECT 1 FROM pharmacy_memberships pm
    WHERE pm.drugstore_id = order_drugstores.drugstore_id
      AND pm.user_id = nearpill.current_actor_id() AND pm.is_active = 1
  )
);
DROP POLICY order_drugstores_insert ON order_drugstores;
CREATE POLICY order_drugstores_insert ON order_drugstores FOR INSERT TO nearpill_app WITH CHECK (
  user_id = nearpill.current_actor_id() OR nearpill.current_actor_role() IN ('admin','system')
);
DROP POLICY order_drugstores_update ON order_drugstores;
CREATE POLICY order_drugstores_update ON order_drugstores FOR UPDATE TO nearpill_app USING (
  user_id = nearpill.current_actor_id() OR nearpill.current_actor_role() IN ('admin','system')
) WITH CHECK (
  user_id = nearpill.current_actor_id() OR nearpill.current_actor_role() IN ('admin','system')
);
