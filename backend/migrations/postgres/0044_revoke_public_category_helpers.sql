-- The category helpers added in 0033 were created without revoking the default
-- PUBLIC EXECUTE privilege. Every other nearpill.* helper is restricted to the
-- backend roles, so close the same gap here. Idempotent and data-free.
REVOKE ALL ON FUNCTION nearpill.canonical_category(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION nearpill.normalize_medicine_category() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nearpill.canonical_category(text) TO nearpill_app, nearpill_migrator;
GRANT EXECUTE ON FUNCTION nearpill.normalize_medicine_category() TO nearpill_app, nearpill_migrator;
