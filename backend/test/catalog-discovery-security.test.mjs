import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';
import { createCatalogService } from '../src/application/catalog-service.js';

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');
const migration = await read('migrations/postgres/0005_catalog_discovery.sql');
const browsingMigration = await read('migrations/postgres/0019_catalog_browsing.sql');
const routes = await read('src/http/routes/v1/register.ts');
const contracts = await read('src/http/contracts.ts');
const app = await read('src/http/app.ts');
const portal = await read('../web/src/app/App.tsx');
const portalAdmin = await read('../web/src/features/admin/AdminPages.tsx');
const portalApi = await read('../web/src/api/client.ts');
const discoveryDoc = await read('../docs/catalog-discovery.md');
const importer = await read('scripts/import-mysql-to-postgres.mjs');

test('source-list labels cannot publish a medicine without OTC eligibility', async () => {
  const medicine = { category: 'Prescription (source list)', publication_status: 'draft', otc_eligible: false };
  const writes = [];
  const repository = new Proxy({
    findMasterMedicineById: async () => medicine,
    updateMedicinePublication: async (id, status) => { writes.push({ id, status }); },
    appendAudit: async () => {},
  }, { get: (target, key) => target[key] ?? (() => { throw new Error('Unexpected catalog operation'); }) });
  const catalog = createCatalogService({ repository });
  const publish = () => catalog.setMedicinePublication(1, 5, { status: 'published' });
  assert.equal((await publish()).status, 409);
  medicine.category = 'Non-Prescription (source list)';
  medicine.otc_eligible = true;
  assert.deepEqual(writes, []);
  assert.equal((await publish()).status, 200);
  assert.deepEqual(writes, [{ id: 5, status: 'published' }]);
});

test('a documented review can publish an eligible draft in one admin action', async () => {
  const medicine = { category: 'Prescription (source list)', publication_status: 'draft', otc_eligible: false };
  const writes = [];
  const catalog = createCatalogService({ repository: new Proxy({
    findMasterMedicineById: async () => medicine,
    updateMedicinePublication: async (...args) => { writes.push(args); return 1; },
    appendAudit: async () => {},
  }, { get: (target, key) => target[key] ?? (() => { throw new Error('Unexpected catalog operation'); }) }) });
  const publish = (reviewReference) => catalog.setMedicinePublication(1, 85, { status: 'published', reviewReference });
  assert.equal((await publish('Recorded review 85')).status, 409);
  medicine.category = 'Non-Prescription (source list)';
  assert.equal((await publish('   ')).status, 400);
  assert.deepEqual(writes, []);
  assert.equal((await publish(' Recorded review 85 ')).status, 200);
  assert.deepEqual(writes, [[85, 'published', 'Recorded review 85', medicine.category]]);
});

test('legacy data is not auto-trusted during the OTC publication migration', () => {
  assert.match(migration, /legacy\/demo pharmacy records must be explicitly reviewed/i);
  assert.match(migration, /CASE WHEN rx_required = 1 THEN 'retired' ELSE 'draft' END/);
  assert.match(migration, /DROP COLUMN IF EXISTS rx_required/);
  assert.match(importer, /legacyRestricted \? 'retired' : 'draft'/);
  assert.match(importer, /delete copy\.rx_required/);
});

test('catalog and pharmacy mutation authority remains server-owned', () => {
  // Pharmacies are verified automatically when an admin creates them; the old verify route must stay gone.
  assert.doesNotMatch(routes, /\/admin\/pharmacies\/:id\/verification/);
  assert.match(routes, /path: '\/admin\/pharmacies\/:id\/go-live'[\s\S]*auth: 'admin'/);
  assert.match(routes, /path: '\/admin\/medicines\/:id\/publication'[\s\S]*auth: 'admin'/);
  assert.doesNotMatch(routes, /\/admin\/inventory\/:id\/price/);
  assert.match(routes, /path: '\/inventory\/update'[\s\S]*auth: 'user'/);
  assert.match(contracts, /InventoryUpdateSchema[\s\S]*?\}\)\.strict\(\)/);
  assert.doesNotMatch(portalApi, /verifyPharmacy/);
  assert.match(portalApi, /setMedicinePublication/);
  assert.doesNotMatch(portal, /CoreDB\.PharmacyRegistry\.activate/);
  assert.doesNotMatch(portalAdmin, /CoreDB\.MasterCatalog\.addMedication/);
});

test('retired browser fixture scripts do not survive the React cutover', async () => {
  // The old fixture store was deleted; do not recreate it to satisfy historical tests.
  await assert.rejects(stat(new URL('../../web/js/data.js', import.meta.url)), { code: 'ENOENT' });
  await assert.rejects(stat(new URL('../../web/js/db.js', import.meta.url)), { code: 'ENOENT' });
  assert.doesNotMatch(portal, /Development Fixture A|CoreDB\./);
  assert.doesNotMatch(portalAdmin, /FDA-PH-|rating:\s*[0-9]|CoreDB\./);
});

test('public cache and map fallback contracts are explicit and bounded', () => {
  assert.match(app, /public, max-age=60, stale-while-revalidate=300/);
  assert.match(discoveryDoc, /Ask only after the user invokes nearby discovery/);
  assert.match(discoveryDoc, /manual `q` search path/);
  assert.match(discoveryDoc, /capped at 25 km/);
  assert.match(discoveryDoc, /does not guarantee medicine stock/);
});

test('catalog browsing adds only scoped reads and keeps private pharmacies and retired items excluded', () => {
  assert.equal((browsingMigration.match(/FOR SELECT TO nearpill_app/g) || []).length, 2);
  assert.equal((browsingMigration.match(/current_capability\(\) = 'catalog_browse'/g) || []).length, 2);
  assert.match(browsingMigration, /publication_status IN \('draft', 'published'\)/);
  assert.match(browsingMigration, /d\.is_active = 1/);
  assert.match(browsingMigration, /d\.verification_status = 'verified'/);
  assert.match(browsingMigration, /d\.public_profile_published_at IS NOT NULL/);
  assert.doesNotMatch(browsingMigration.replace(/^--.*$/gm, ''), /\b(?:INSERT|UPDATE|DELETE|GRANT|DISABLE|BYPASSRLS)\b/i);
  assert.match(app, /private, no-store/);
});
