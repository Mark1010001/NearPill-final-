-- Scoped identity access; apply only through the local/staging migration guard.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON users FOR ALL TO nearpill_migrator USING (true) WITH CHECK (true);
REVOKE ALL ON users FROM nearpill_app;
GRANT SELECT ON users TO nearpill_app;
GRANT INSERT (name, email, password, role) ON users TO nearpill_app;
GRANT UPDATE (name, phone, birthdate, password) ON users TO nearpill_app;
CREATE POLICY users_select ON users FOR SELECT TO nearpill_app USING (
  id = nearpill.current_actor_id()
  OR nearpill.current_actor_role() = 'admin'
  OR (nearpill.current_actor_role() = 'system' AND nearpill.current_capability() = 'identity_security')
  OR (nearpill.current_actor_role() = 'anonymous' AND nearpill.current_capability() IN (
    'identity_lookup:' || lower(email), 'identity_register:' || lower(email), 'identity_password:' || id::text
  ))
);
CREATE POLICY users_insert ON users FOR INSERT TO nearpill_app WITH CHECK (
  nearpill.current_actor_role() = 'anonymous'
  AND nearpill.current_capability() = 'identity_register:' || lower(email)
  AND role = 'customer'
);
CREATE POLICY users_update ON users FOR UPDATE TO nearpill_app USING (
  id = nearpill.current_actor_id()
  OR nearpill.current_actor_role() = 'admin'
  OR (nearpill.current_actor_role() = 'system' AND nearpill.current_capability() = 'identity_security')
  OR (nearpill.current_actor_role() = 'anonymous' AND nearpill.current_capability() = 'identity_password:' || id::text)
) WITH CHECK (
  id = nearpill.current_actor_id()
  OR nearpill.current_actor_role() = 'admin'
  OR (nearpill.current_actor_role() = 'system' AND nearpill.current_capability() = 'identity_security')
  OR (nearpill.current_actor_role() = 'anonymous' AND nearpill.current_capability() = 'identity_password:' || id::text)
);
ALTER TABLE nearpill_schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE nearpill_schema_migrations FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON nearpill_schema_migrations FOR ALL TO nearpill_migrator USING (true) WITH CHECK (true);
-- Hono owns authentication; Data API roles receive no application-data access.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA nearpill FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
DO $$
DECLARE client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', client_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', client_role);
      EXECUTE format('REVOKE ALL ON SCHEMA nearpill FROM %I', client_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', client_role);
    END IF;
  END LOOP;
END $$;
