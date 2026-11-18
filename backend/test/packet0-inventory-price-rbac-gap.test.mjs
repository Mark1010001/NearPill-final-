/**
 * Packet 0 CURRENT-SOURCE characterization of a suspected DB-authority gap.
 * Passing these tests means the risky source shape was observed, NOT that the
 * database is secure. Remediation belongs to reviewed RLS/privilege work after
 * authorization, followed by real app-role negative tests on NearPill staging.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');
const [routes, coreRls, catalogRls, paymentRls, inventoryMigration] = await Promise.all([
  read('../src/http/routes/v1/register.ts'),
  read('../migrations/postgres/0002_rls.sql'),
  read('../migrations/postgres/0005_catalog_discovery.sql'),
  read('../migrations/postgres/0007_payment_reconciliation.sql'),
  read('../migrations/postgres/0006_order_inventory.sql'),
]);

const inventoryWrite = coreRls.match(/CREATE POLICY inventory_write ON inventory FOR ALL TO nearpill_app\s+USING\s*\(([\s\S]*?)\);\s*\n\s*ALTER TABLE orders ENABLE ROW LEVEL SECURITY;/)?.[0];

test('NP-036: admin price overrides keep their admin-only endpoint', () => {
  assert.match(routes, /id: 'adminUpdateInventoryPrice'[^\n]*path: '\/admin\/inventory\/:id\/price'[^\n]*auth: 'admin'/);
  assert.match(routes, /id: 'updateInventory'[^\n]*path: '\/inventory\/update'[^\n]*auth: 'user'/);
});

test('NP-036: partner price updates require the inventory backend context and pharmacy row policy', async () => {
  const [priceGuard, authority] = await Promise.all([
    read('../migrations/postgres/0022_partner_inventory_price.sql'),
    read('../migrations/postgres/0016_backend_mutation_authority.sql'),
  ]);
  assert.match(priceGuard, /NEW\.price_centavos IS DISTINCT FROM OLD\.price_centavos\s+AND NOT \(nearpill\.current_actor_role\(\) = 'partner'\s+AND nearpill\.current_capability\(\) IS NOT DISTINCT FROM 'inventory_mutation'\) THEN/);
  assert.match(authority, /CREATE POLICY inventory_update[\s\S]*?pm\.drugstore_id = inventory\.drugstore_id[\s\S]*?pm\.is_active = 1[\s\S]*?WITH CHECK[\s\S]*?pm\.drugstore_id = inventory\.drugstore_id[\s\S]*?pm\.is_active = 1/);
  assert.match(priceGuard, /NEW\.reserved_quantity IS DISTINCT FROM OLD\.reserved_quantity/);
});

test('NP-036 CURRENT BASELINE: database column privilege is broader than HTTP price authority', () => {
  assert.match(coreRls, /GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nearpill_app;/);
  assert.ok(inventoryWrite, 'inventory_write must be found in the reviewed 0002 migration');
  assert.match(inventoryWrite, /FOR ALL TO nearpill_app/);
  assert.match(inventoryWrite, /EXISTS\s*\(\s*SELECT 1 FROM pharmacy_memberships pm/g);
  assert.match(inventoryWrite, /pm\.is_active = 1/g);
  assert.doesNotMatch([coreRls, catalogRls, paymentRls].join('\n'), /REVOKE\s+UPDATE\s*\(\s*price_centavos\s*\)\s+ON\s+inventory\s+FROM\s+nearpill_app\b/i);
  // RLS is row-oriented. These broad row grants plus table-level UPDATE
  // privilege cannot independently enforce an admin-only price column.
});

test('NP-036 CURRENT SCHEMA: migration 0006 eliminates legacy inventory.price', () => {
  assert.match(inventoryMigration, /ALTER TABLE inventory DROP COLUMN IF EXISTS price\s*;/i);
  assert.match(inventoryMigration, /ADD COLUMN IF NOT EXISTS price_centavos BIGINT/i);
  assert.match(inventoryMigration, /ALTER COLUMN price_centavos SET NOT NULL/i);
  assert.match(inventoryMigration, /CHECK \(price_centavos >= 0\)/i);
});
