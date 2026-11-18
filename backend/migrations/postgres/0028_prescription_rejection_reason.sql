-- Pharmacy staff must say why a staging prescription review was rejected so the
-- customer knows what to fix. Short free text, set only on rejection.
ALTER TABLE nearpill.prescription_reviews
  ADD COLUMN rejection_reason text CHECK (rejection_reason IS NULL OR (char_length(rejection_reason) BETWEEN 3 AND 200));
ALTER TABLE nearpill.prescription_reviews
  ADD CONSTRAINT prescription_reason_only_when_rejected CHECK (rejection_reason IS NULL OR status = 'rejected');
