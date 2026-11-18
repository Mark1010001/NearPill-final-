-- Account deletion: a customer may anonymise their own users row (the email is
-- replaced with a non-routable placeholder) and remove their own pending sample
-- prescription photo. Orders, payments and audit rows stay, detached from any
-- personal details, because pharmacies and payment reconciliation need them.
GRANT UPDATE (email) ON users TO nearpill_app;

DROP POLICY IF EXISTS prescription_customer_scrub ON nearpill.prescription_reviews;
CREATE POLICY prescription_customer_scrub ON nearpill.prescription_reviews FOR UPDATE TO nearpill_app
USING (nearpill.current_capability() = 'account_delete' AND nearpill.current_actor_role() = 'customer'
  AND customer_id = nearpill.current_actor_id())
WITH CHECK (nearpill.current_capability() = 'account_delete' AND nearpill.current_actor_role() = 'customer'
  AND customer_id = nearpill.current_actor_id() AND status = 'expired' AND photo IS NULL AND mime_type IS NULL
  AND customer_name IS NULL);
