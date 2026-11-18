-- Browsing does not grant publication, stock mutation, or ordering authority.
CREATE POLICY medicines_catalog_browse ON medicines FOR SELECT TO nearpill_app
USING (
  nearpill.current_capability() = 'catalog_browse'
  AND publication_status IN ('draft', 'published')
);

CREATE POLICY inventory_catalog_browse ON inventory FOR SELECT TO nearpill_app
USING (
  nearpill.current_capability() = 'catalog_browse'
  AND EXISTS (
    SELECT 1 FROM drugstores d
    WHERE d.id = inventory.drugstore_id
      AND d.is_active = 1
      AND d.verification_status = 'verified'
      AND d.public_profile_published_at IS NOT NULL
  )
  AND EXISTS (
    SELECT 1 FROM medicines m
    WHERE m.id = inventory.medicine_id
      AND m.publication_status IN ('draft', 'published')
  )
);
