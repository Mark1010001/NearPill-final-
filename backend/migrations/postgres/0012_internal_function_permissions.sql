REVOKE ALL ON ALL FUNCTIONS IN SCHEMA nearpill FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA nearpill TO nearpill_app, nearpill_migrator;
ALTER DEFAULT PRIVILEGES IN SCHEMA nearpill REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DO $$
DECLARE client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA nearpill FROM %I', client_role);
    END IF;
  END LOOP;
END $$;
