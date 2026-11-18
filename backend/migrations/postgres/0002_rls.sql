CREATE OR REPLACE FUNCTION nearpill.current_actor_id()
RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::INTEGER
$$;

CREATE OR REPLACE FUNCTION nearpill.current_actor_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.role', true), ''), 'anonymous')
$$;

CREATE OR REPLACE FUNCTION nearpill.current_capability()
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.capability', true), ''), '')
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nearpill_app') THEN
    RAISE EXCEPTION 'Required database role nearpill_app does not exist. Run postgres/bootstrap/001-roles.sh first.';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public, nearpill TO nearpill_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nearpill_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nearpill_app;
REVOKE ALL ON nearpill_schema_migrations FROM nearpill_app;

DO $$
DECLARE
  protected_table TEXT;
BEGIN
  FOREACH protected_table IN ARRAY ARRAY[
    'drugstores','pharmacy_memberships','medicines','inventory','orders',
    'order_drugstores','order_items','payments','subscriptions','audit_logs'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS migrator_all ON %I', protected_table);
    EXECUTE format(
      'CREATE POLICY migrator_all ON %I FOR ALL TO nearpill_migrator USING (true) WITH CHECK (true)',
      protected_table
    );
  END LOOP;
END
$$;

ALTER TABLE drugstores ENABLE ROW LEVEL SECURITY;
ALTER TABLE drugstores FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS drugstores_select ON drugstores;
CREATE POLICY drugstores_select ON drugstores FOR SELECT TO nearpill_app
USING (
  is_active = 1
  OR nearpill.current_actor_role() IN ('admin','system')
  OR EXISTS (
    SELECT 1 FROM pharmacy_memberships pm
    WHERE pm.drugstore_id = id
      AND pm.user_id = nearpill.current_actor_id()
      AND pm.is_active = 1
  )
);
DROP POLICY IF EXISTS drugstores_write ON drugstores;
CREATE POLICY drugstores_write ON drugstores FOR ALL TO nearpill_app
USING (nearpill.current_actor_role() IN ('admin','system'))
WITH CHECK (nearpill.current_actor_role() IN ('admin','system'));

ALTER TABLE pharmacy_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmacy_memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memberships_select ON pharmacy_memberships;
CREATE POLICY memberships_select ON pharmacy_memberships FOR SELECT TO nearpill_app
USING (
  user_id = nearpill.current_actor_id()
  OR nearpill.current_actor_role() IN ('admin','system')
);
DROP POLICY IF EXISTS memberships_write ON pharmacy_memberships;
CREATE POLICY memberships_write ON pharmacy_memberships FOR ALL TO nearpill_app
USING (nearpill.current_actor_role() IN ('admin','system'))
WITH CHECK (nearpill.current_actor_role() IN ('admin','system'));

ALTER TABLE medicines ENABLE ROW LEVEL SECURITY;
ALTER TABLE medicines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS medicines_select ON medicines;
CREATE POLICY medicines_select ON medicines FOR SELECT TO nearpill_app USING (true);
DROP POLICY IF EXISTS medicines_write ON medicines;
CREATE POLICY medicines_write ON medicines FOR ALL TO nearpill_app
USING (nearpill.current_actor_role() IN ('admin','system'))
WITH CHECK (nearpill.current_actor_role() IN ('admin','system'));

ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_select ON inventory;
CREATE POLICY inventory_select ON inventory FOR SELECT TO nearpill_app
USING (
  nearpill.current_actor_role() IN ('admin','system')
  OR EXISTS (SELECT 1 FROM drugstores d WHERE d.id = drugstore_id AND d.is_active = 1)
  OR EXISTS (
    SELECT 1 FROM pharmacy_memberships pm
    WHERE pm.drugstore_id = inventory.drugstore_id
      AND pm.user_id = nearpill.current_actor_id()
      AND pm.is_active = 1
  )
);
DROP POLICY IF EXISTS inventory_write ON inventory;
CREATE POLICY inventory_write ON inventory FOR ALL TO nearpill_app
USING (
  nearpill.current_actor_role() IN ('admin','system')
  OR nearpill.current_capability() = 'order_mutation'
  OR EXISTS (
    SELECT 1 FROM pharmacy_memberships pm
    WHERE pm.drugstore_id = inventory.drugstore_id
      AND pm.user_id = nearpill.current_actor_id()
      AND pm.is_active = 1
  )
)
WITH CHECK (
  nearpill.current_actor_role() IN ('admin','system')
  OR nearpill.current_capability() = 'order_mutation'
  OR EXISTS (
    SELECT 1 FROM pharmacy_memberships pm
    WHERE pm.drugstore_id = inventory.drugstore_id
      AND pm.user_id = nearpill.current_actor_id()
      AND pm.is_active = 1
  )
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orders_select ON orders;
CREATE POLICY orders_select ON orders FOR SELECT TO nearpill_app
USING (
  user_id = nearpill.current_actor_id()
  OR nearpill.current_actor_role() IN ('admin','system')
);
DROP POLICY IF EXISTS orders_insert ON orders;
CREATE POLICY orders_insert ON orders FOR INSERT TO nearpill_app
WITH CHECK (
  user_id = nearpill.current_actor_id()
  OR nearpill.current_actor_role() IN ('admin','system')
);
DROP POLICY IF EXISTS orders_update ON orders;
CREATE POLICY orders_update ON orders FOR UPDATE TO nearpill_app
USING (
  user_id = nearpill.current_actor_id()
  OR nearpill.current_actor_role() IN ('admin','system')
)
WITH CHECK (
  user_id = nearpill.current_actor_id()
  OR nearpill.current_actor_role() IN ('admin','system')
);

ALTER TABLE order_drugstores ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_drugstores FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_drugstores_access ON order_drugstores;
CREATE POLICY order_drugstores_access ON order_drugstores FOR ALL TO nearpill_app
USING (
  nearpill.current_actor_role() IN ('admin','system')
  OR EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = order_id AND o.user_id = nearpill.current_actor_id()
  )
)
WITH CHECK (
  nearpill.current_actor_role() IN ('admin','system')
  OR EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = order_id AND o.user_id = nearpill.current_actor_id()
  )
);

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_items_access ON order_items;
CREATE POLICY order_items_access ON order_items FOR ALL TO nearpill_app
USING (
  nearpill.current_actor_role() IN ('admin','system')
  OR EXISTS (
    SELECT 1
    FROM order_drugstores od
    JOIN orders o ON o.id = od.order_id
    WHERE od.id = order_drugstore_id
      AND o.user_id = nearpill.current_actor_id()
  )
)
WITH CHECK (
  nearpill.current_actor_role() IN ('admin','system')
  OR EXISTS (
    SELECT 1
    FROM order_drugstores od
    JOIN orders o ON o.id = od.order_id
    WHERE od.id = order_drugstore_id
      AND o.user_id = nearpill.current_actor_id()
  )
);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payments_select ON payments;
CREATE POLICY payments_select ON payments FOR SELECT TO nearpill_app
USING (
  nearpill.current_actor_role() IN ('admin','system')
  OR EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = order_id AND o.user_id = nearpill.current_actor_id()
  )
);
DROP POLICY IF EXISTS payments_insert ON payments;
CREATE POLICY payments_insert ON payments FOR INSERT TO nearpill_app
WITH CHECK (
  nearpill.current_actor_role() IN ('admin','system')
  OR (
    nearpill.current_capability() = 'order_mutation'
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_id AND o.user_id = nearpill.current_actor_id()
    )
  )
);
DROP POLICY IF EXISTS payments_update ON payments;
CREATE POLICY payments_update ON payments FOR UPDATE TO nearpill_app
USING (
  nearpill.current_actor_role() IN ('admin','system')
  OR (
    nearpill.current_capability() = 'order_mutation'
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_id AND o.user_id = nearpill.current_actor_id()
    )
  )
)
WITH CHECK (
  nearpill.current_actor_role() IN ('admin','system')
  OR (
    nearpill.current_capability() = 'order_mutation'
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_id AND o.user_id = nearpill.current_actor_id()
    )
  )
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscriptions_select ON subscriptions;
CREATE POLICY subscriptions_select ON subscriptions FOR SELECT TO nearpill_app
USING (
  nearpill.current_actor_role() IN ('admin','system')
  OR EXISTS (
    SELECT 1 FROM pharmacy_memberships pm
    WHERE pm.drugstore_id = subscriptions.drugstore_id
      AND pm.user_id = nearpill.current_actor_id()
      AND pm.is_active = 1
  )
);
DROP POLICY IF EXISTS subscriptions_write ON subscriptions;
CREATE POLICY subscriptions_write ON subscriptions FOR ALL TO nearpill_app
USING (nearpill.current_actor_role() IN ('admin','system'))
WITH CHECK (nearpill.current_actor_role() IN ('admin','system'));

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_logs_select ON audit_logs;
CREATE POLICY audit_logs_select ON audit_logs FOR SELECT TO nearpill_app
USING (nearpill.current_actor_role() IN ('admin','system'));
DROP POLICY IF EXISTS audit_logs_insert ON audit_logs;
CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT TO nearpill_app
WITH CHECK (
  user_id = nearpill.current_actor_id()
  OR nearpill.current_actor_role() IN ('admin','system')
);
