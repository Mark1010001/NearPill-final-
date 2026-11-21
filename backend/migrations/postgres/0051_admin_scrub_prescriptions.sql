-- Lets an administrator delete a customer account (like the customer's own deletion in 0037): the same narrow
-- "account_delete" capability may remove the sample prescription photo and name from that customer's prescription reviews.
-- It can only turn a review into the expired, photo-less, name-less state, and only when the signed-in actor is an administrator.
DROP POLICY IF EXISTS prescription_admin_scrub ON nearpill.prescription_reviews;
CREATE POLICY prescription_admin_scrub ON nearpill.prescription_reviews FOR UPDATE TO nearpill_app
USING (nearpill.current_capability() = 'account_delete' AND nearpill.current_actor_role() = 'admin')
WITH CHECK (nearpill.current_capability() = 'account_delete' AND nearpill.current_actor_role() = 'admin'
  AND status = 'expired' AND photo IS NULL AND mime_type IS NULL AND customer_name IS NULL);
