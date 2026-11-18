-- Pharmacies are added by an admin, so they are verified when created (going live is a separate, checklist-gated step).
-- The licence-review screen is gone; make sure no active pharmacy is left waiting for it.
UPDATE drugstores
SET verification_status = 'verified', verified_at = COALESCE(verified_at, CURRENT_TIMESTAMP)
WHERE verification_status = 'pending' AND is_active = 1;
