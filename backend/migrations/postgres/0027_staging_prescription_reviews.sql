CREATE TABLE nearpill.prescription_reviews (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  drugstore_id integer NOT NULL REFERENCES public.drugstores(id),
  medicine_id integer NOT NULL REFERENCES public.medicines(id),
  product jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  photo bytea CHECK (octet_length(photo) <= 1048576),
  mime_type text CHECK (mime_type IN ('image/jpeg','image/png')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  reviewed_by integer REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  UNIQUE (customer_id, drugstore_id, medicine_id),
  CHECK ((status = 'pending' AND photo IS NOT NULL AND mime_type IS NOT NULL)
      OR (status <> 'pending' AND photo IS NULL AND mime_type IS NULL))
);

ALTER TABLE nearpill.prescription_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE nearpill.prescription_reviews FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nearpill.prescription_reviews FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
  FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    EXECUTE format('REVOKE ALL ON nearpill.prescription_reviews FROM %I', role_name);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON nearpill.prescription_reviews TO nearpill_app;
GRANT USAGE ON SEQUENCE nearpill.prescription_reviews_id_seq TO nearpill_app;

CREATE POLICY prescription_customer_read ON nearpill.prescription_reviews FOR SELECT TO nearpill_app
USING (nearpill.current_capability() = 'catalog_browse' AND nearpill.current_actor_role() = 'customer' AND customer_id = nearpill.current_actor_id());
CREATE POLICY prescription_customer_submit ON nearpill.prescription_reviews FOR INSERT TO nearpill_app
WITH CHECK (nearpill.current_capability() = 'catalog_browse' AND nearpill.current_actor_role() = 'customer'
  AND customer_id = nearpill.current_actor_id() AND status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL);
CREATE POLICY prescription_customer_retry ON nearpill.prescription_reviews FOR UPDATE TO nearpill_app
USING (nearpill.current_capability() = 'catalog_browse' AND nearpill.current_actor_role() = 'customer'
  AND customer_id = nearpill.current_actor_id() AND (status IN ('rejected','expired') OR (status = 'pending' AND expires_at <= now())))
WITH CHECK (nearpill.current_capability() = 'catalog_browse' AND nearpill.current_actor_role() = 'customer'
  AND customer_id = nearpill.current_actor_id() AND status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL);

CREATE POLICY prescription_partner_read ON nearpill.prescription_reviews FOR SELECT TO nearpill_app
USING (nearpill.current_capability() = 'catalog_browse' AND nearpill.current_actor_role() = 'partner' AND EXISTS (
  SELECT 1 FROM public.pharmacy_memberships pm WHERE pm.drugstore_id = prescription_reviews.drugstore_id
    AND pm.user_id = nearpill.current_actor_id() AND pm.is_active = 1));
CREATE POLICY prescription_partner_decide ON nearpill.prescription_reviews FOR UPDATE TO nearpill_app
USING (nearpill.current_capability() = 'catalog_browse' AND nearpill.current_actor_role() = 'partner'
  AND status = 'pending' AND expires_at > now() AND EXISTS (
    SELECT 1 FROM public.pharmacy_memberships pm WHERE pm.drugstore_id = prescription_reviews.drugstore_id
      AND pm.user_id = nearpill.current_actor_id() AND pm.is_active = 1))
WITH CHECK (nearpill.current_capability() = 'catalog_browse' AND nearpill.current_actor_role() = 'partner'
  AND status IN ('approved','rejected') AND reviewed_by = nearpill.current_actor_id() AND EXISTS (
    SELECT 1 FROM public.pharmacy_memberships pm WHERE pm.drugstore_id = prescription_reviews.drugstore_id
      AND pm.user_id = nearpill.current_actor_id() AND pm.is_active = 1));

CREATE POLICY prescription_system_expiry_read ON nearpill.prescription_reviews FOR SELECT TO nearpill_app
USING (nearpill.current_capability() = 'catalog_browse' AND nearpill.current_actor_role() = 'system' AND expires_at <= now());
CREATE POLICY prescription_system_expiry ON nearpill.prescription_reviews FOR UPDATE TO nearpill_app
USING (nearpill.current_capability() = 'catalog_browse' AND nearpill.current_actor_role() = 'system' AND status = 'pending' AND expires_at <= now())
WITH CHECK (nearpill.current_capability() = 'catalog_browse' AND nearpill.current_actor_role() = 'system' AND status = 'expired');
