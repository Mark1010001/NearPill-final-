ALTER TABLE medicines ADD COLUMN otc_eligible boolean NOT NULL DEFAULT false;
ALTER TABLE medicines ADD COLUMN otc_review_reference text;
ALTER TABLE medicines ADD COLUMN otc_reviewed_at timestamptz;
ALTER TABLE medicines ADD CONSTRAINT medicines_otc_review_check CHECK (
  NOT otc_eligible OR (NULLIF(btrim(otc_review_reference), '') IS NOT NULL AND otc_reviewed_at IS NOT NULL)
);
-- Existing unreviewed published rows make this migration fail; no rows are retired or deleted.
ALTER TABLE medicines ADD CONSTRAINT medicines_published_otc_check CHECK (
  publication_status <> 'published' OR otc_eligible
);
-- shortcut: eligibility is migrator-managed, add an approved pharmacist review workflow before real sales.
REVOKE INSERT, UPDATE ON medicines FROM nearpill_app;
GRANT INSERT (brand_name, generic_name, dosage_form, category, description, publication_status) ON medicines TO nearpill_app;
GRANT UPDATE (brand_name, generic_name, dosage_form, category, description, publication_status, published_at) ON medicines TO nearpill_app;
