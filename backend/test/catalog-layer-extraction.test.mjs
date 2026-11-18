import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createCatalogService } from '../src/application/catalog-service.js';
import { listingEligibleForCheckout } from '../src/infrastructure/postgres/catalog-orderability.js';
import { createPostgresCatalogRepository } from '../src/infrastructure/postgres/catalog-repository.js';
import { calculateOpenNow, pharmacySlug } from '../src/domain/catalog/open-now.js';

const bootstrapSource = await readFile(new URL('../src/bootstrap/server.ts', import.meta.url), 'utf8');
const routeSource = await readFile(new URL('../src/http/routes/v1/register.ts', import.meta.url), 'utf8');
const repositorySource = await readFile(new URL('../src/infrastructure/postgres/catalog-repository.js', import.meta.url), 'utf8');

const sqlShape = /\b(?:SELECT\s+[a-z0-9_*.,`]|INSERT\s+INTO\s+[a-z0-9_`]|UPDATE\s+(?:medicines|drugstores|inventory|audit_logs)|DELETE\s+FROM)\b/i;

function fakeCatalogRepository(overrides = {}) {
  return {
    async searchAvailableMedicines() { return []; },
    async findMedicineById() { return null; },
    async findMedicineInventoryById() { return []; },
    async listMedicineEvidence() { return []; },
    async listActiveStores() { return []; },
    async findPublicStoreById() { return null; },
    async findStoreById() { return null; },
    async listStoreInventory() { return []; },
    async findNearbyStores() { return []; },
    async searchPublicStores() { return []; },
    async listAdminPharmacies() { return []; },
    async listDrugstoreSales() { return []; },
    async createDrugstore() { return 1; },
    async updateDrugstore() { return 1; },
    async deactivateDrugstore() { return 1; },
    async setPharmacyVerification() { return true; },
    async getGoLiveFacts() { return null; },
    async setPublication() { return true; },
    async listMasterMedicines() { return []; },
    async createMedicine() { return 1; },
    async findMasterMedicineById() { return null; },
    async updateMedicine() { return 1; },
    async listAdminMedicineEvidence() { return []; },
    async addMedicineEvidence() { return 1; },
    async countApprovedMedicineEvidence() { return 0; },
    async updateMedicinePublication() { return 1; },
    async appendAudit() {},
    ...overrides,
  };
}

test('catalog Hono adapter remains SQL-free and composes the Postgres catalog boundary', () => {
  assert.doesNotMatch(routeSource, sqlShape);
  assert.doesNotMatch(routeSource, /pool\.query|getConnection\s*\(|\bmysql\b/i);
  assert.match(routeSource, /catalog\.listMedicines/);
  assert.match(routeSource, /catalog\.nearbyStores/);
  // Publishing goes only through the checklist-gated go-live route; the old licence-review route is gone.
  assert.match(routeSource, /catalog\.setGoLive/);
  assert.doesNotMatch(routeSource, /catalog\.verifyPharmacy/);
  assert.match(routeSource, /catalog\.setMedicinePublication/);
  assert.match(bootstrapSource, /createPostgresCatalogRepository\(pool\)/);
  assert.match(bootstrapSource, /createCatalogService\(/);
});

test('catalog domain preserves conservative open-hours and stable pharmacy slug behavior', () => {
  const noon = new Date(2026, 9, 17, 12, 0, 0);
  const late = new Date(2026, 9, 17, 23, 0, 0);
  assert.equal(calculateOpenNow('08:00-20:00', 1, noon), true);
  assert.equal(calculateOpenNow('08:00-20:00', 1, late), false);
  assert.equal(calculateOpenNow('8:00 PM - 2:00 AM', 1, late), true);
  assert.equal(calculateOpenNow('unparseable', 1, noon), false);
  assert.equal(pharmacySlug('  Cebu Care + Pharmacy  '), 'cebu-care-pharmacy');
});

test('public discovery is bounded and has a manual fallback when location is unavailable', async () => {
  const calls = [];
  const repo = fakeCatalogRepository({
    async findNearbyStores(input) {
      calls.push(['coordinates', input]);
      return [{ store_id: 5, store_name: 'Verified Cebu Pharmacy', address: 'Cebu', latitude: 10.31, longitude: 123.89, operating_hours: '08:00-20:00', verifiedAt: '2026-10-17', distanceKm: '1.25' }];
    },
    async searchPublicStores(input) {
      calls.push(['manual', input]);
      return [{ store_id: 6, store_name: 'Manual Match', address: 'Cebu', latitude: 10.32, longitude: 123.90, operating_hours: '08:00-20:00', verifiedAt: '2026-10-17', distanceKm: null }];
    },
  });
  const service = createCatalogService({ repository: repo, now: () => new Date(2026, 9, 17, 12) });

  const nearby = await service.nearbyStores({ latitude: 10.3157, longitude: 123.8854, radiusKm: 3 });
  assert.equal(nearby.status, 200);
  assert.equal(nearby.body.mode, 'coordinates');
  assert.equal(nearby.body.stores[0].verified, true);
  assert.equal(nearby.body.stores[0].distanceKm, 1.25);
  assert.equal(calls[0][1].radiusMeters, 3000);

  const manual = await service.nearbyStores({ q: 'Colon Street' });
  assert.equal(manual.body.mode, 'manual');
  assert.equal(manual.body.stores[0].distanceKm, null);
  assert.equal(manual.body.stores[0].store_name, 'Manual Match');
  assert.equal((await service.nearbyStores({})).status, 400);
  assert.equal((await service.nearbyStores({ latitude: 10.3 })).status, 400);
  assert.equal((await service.nearbyStores({ latitude: 10.3, longitude: 123.9, radiusKm: 26 })).status, 400);
});

test('pharmacy publication requires administrator-reviewed verification evidence', async () => {
  const audits = [];
  const repository = fakeCatalogRepository({
    async findStoreById(id) { return id === 5 ? { id: 5, name: 'Store' } : null; },
    async setPharmacyVerification(input) { this.review = input; return true; },
    async getGoLiveFacts() { return null; },
    async setPublication() { return true; },
    async appendAudit(userId, action, description) { audits.push({ userId, action, description }); },
  });
  const service = createCatalogService({ repository });
  assert.equal((await service.verifyPharmacy(1, 5, { status: 'verified', publish: true })).status, 400);
  const result = await service.verifyPharmacy(1, 5, {
    status: 'verified', licenseNumber: 'reviewed-reference', evidenceReference: 'evidence://review/5', publish: true,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.publicProfilePublished, true);
  assert.equal(repository.review.drugstoreId, 5);
  assert.ok(audits.some((entry) => entry.action === 'VERIFY_DRUGSTORE'));
});

test('medicine publication is draft-by-default and requires approved evidence', async () => {
  let approvedEvidence = 0;
  let otcEligible = false;
  let publication = 'draft';
  const repository = fakeCatalogRepository({
    async createMedicine() { return 9; },
    async findMasterMedicineById(id) { return id === 9 ? { id: 9, brand_name: 'Paracetamol', publication_status: publication, otc_eligible: otcEligible } : null; },
    async countApprovedMedicineEvidence() { return approvedEvidence; },
    async addMedicineEvidence() { approvedEvidence += 1; return 44; },
    async updateMedicinePublication(_id, status) { publication = status; return 1; },
  });
  const service = createCatalogService({ repository });
  const created = await service.createMedicine(1, { brandName: 'Paracetamol', dosageForm: 'Tablet', category: 'Pain Relief' });
  assert.equal(created.status, 201);
  assert.equal(created.body.publicationStatus, 'draft');
  assert.equal((await service.setMedicinePublication(1, 9, { status: 'published' })).status, 409);
  assert.equal((await service.addMedicineEvidence(1, 9, { sourceName: 'Reviewed source', sourceUrl: 'https://example.test/source', status: 'approved' })).status, 201);
  assert.equal((await service.setMedicinePublication(1, 9, { status: 'published' })).status, 409);
  otcEligible = true;
  assert.equal((await service.setMedicinePublication(1, 9, { status: 'published' })).status, 200);
  assert.equal(publication, 'published');
});

test('test-label description updates require staging permission and cannot alter clinical fields', async () => {
  let writes = 0;
  const record = { id: 9, brand_name: 'Synthetic', category: 'Prescription (source list)', publication_status: 'draft', otc_eligible: false };
  const repository = fakeCatalogRepository({
    async findMasterMedicineById() { return record; },
    async updateMedicine() { writes++; },
  });
  const body = { description: '[NEARPILL_STAGING_TEST_APPROVAL:afqqozfjpiodanpogvfb] STAGING TEST ONLY' };
  assert.equal((await createCatalogService({ repository }).updateMedicine(1, 9, body)).status, 403);
  const staging = createCatalogService({ repository, stagingTestLabels: true });
  assert.equal((await staging.updateMedicine(1, 9, { ...body, category: 'OTC' })).status, 403);
  for (const category of ['Prescription (source list)', 'Non-Prescription (source list)', 'Medical Supplies', 'Classification Needs Review']) {
    record.category = category;
    assert.equal((await staging.updateMedicine(1, 9, body)).status, 200);
  }
  record.category = 'Unrelated';
  assert.equal((await staging.updateMedicine(1, 9, body)).status, 403);
  record.category = 'Prescription (source list)'; record.publication_status = 'retired';
  assert.equal((await staging.updateMedicine(1, 9, body)).status, 403);
  record.publication_status = 'draft'; record.otc_eligible = true;
  assert.equal((await staging.updateMedicine(1, 9, body)).status, 403);
  assert.equal(writes, 4);
});

test('Postgres catalog adapter filters public truth and uses indexed text/geo search primitives', () => {
  assert.match(repositorySource, /m\.publication_status = 'published'/);
  assert.match(repositorySource, /ds\.verification_status = 'verified'/);
  assert.match(repositorySource, /ds\.public_profile_published_at IS NOT NULL/);
  assert.match(repositorySource, /websearch_to_tsquery\('simple'/);
  assert.match(repositorySource, /similarity\(/);
  assert.match(repositorySource, /nearpill_extensions\.earth_box/);
  assert.match(repositorySource, /nearpill_extensions\.earth_distance/);
  assert.match(repositorySource, /listMedicineEvidence/);
  assert.match(repositorySource, /status = 'approved'/);
});

test('catalog browsing validates a complete GPS pair and preserves the available default', async () => {
  const calls = [];
  const service = createCatalogService({ repository: fakeCatalogRepository({
    async searchAvailableMedicines(input) { calls.push(input); return []; },
  }) });
  assert.equal((await service.listMedicines({ latitude: 10.3 })).status, 400);
  assert.equal((await service.listMedicines({ latitude: 91, longitude: 123 })).status, 400);
  assert.equal((await service.listMedicines({ latitude: 10, longitude: Infinity })).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await service.listMedicines({ view: 'catalog', latitude: 10.3157, longitude: 123.8854, limit: 50, offset: 100 })).status, 200);
  assert.equal(calls[0].includeCatalog, true);
  assert.equal(calls[0].latitude, 10.3157);
  assert.equal(calls[0].longitude, 123.8854);
  assert.equal(calls[0].offset, 100);
  await service.listMedicines();
  assert.equal(calls[1].includeCatalog, false);
  assert.equal(calls[1].latitude, null);
});

test('road routing validates origins and resolves only public pharmacy destinations', async () => {
  let calls = 0;
  const service = createCatalogService({repository:fakeCatalogRepository({async findPublicStoreById(id) { return id === 5 ? {id:5,latitude:10.30,longitude:123.89} : null; }}),routePlanner:async (origin,destination,actorId) => {calls++; assert.deepEqual(origin,{latitude:10.31,longitude:123.88}); assert.deepEqual(destination,{latitude:10.30,longitude:123.89}); assert.equal(actorId,7); return {distanceMeters:1200,durationSeconds:240,coordinates:[[123.88,10.31],[123.89,10.30]]}; }});
  assert.equal((await service.getStoreRoute(7,5,{latitude:91,longitude:123})).status,400);
  assert.equal((await service.getStoreRoute(7,9,{latitude:10.31,longitude:123.88})).status,404);
  assert.equal(calls,0);
  assert.equal((await service.getStoreRoute(7,5,{latitude:10.31,longitude:123.88})).status,200);
  assert.equal(calls,1);
});

test('catalog SQL separates discoverability from ordering and binds GPS before pagination', async () => {
  const calls = [];
  const client = {
    async query(sql, params) { calls.push({ sql, params }); return { rows: [], rowCount: 0 }; },
    release() {},
  };
  const repository = createPostgresCatalogRepository({ query: client.query, async connect() { return client; } });
  await repository.searchAvailableMedicines({ includeCatalog: true, latitude: 10.3157, longitude: 123.8854, limit: 50, offset: 100 });
  const browse = calls.find(call => call.sql.includes('FROM inventory i'));
  assert.match(browse.sql, /publication_status IN \('draft', 'published'\)/);
  assert.match(browse.sql, /m\.publication_status = 'published' AND m\.otc_eligible/);
  assert.match(browse.sql, /AS canOrder/);
  assert.match(browse.sql, /ORDER BY distanceKm ASC/);
  assert.match(browse.sql, /i\.id ASC/);
  assert.deepEqual(browse.params, [10.3157, 123.8854, 50, 100]);
  assert.equal(calls.find(call => call.sql.includes("set_config('app.capability'")).params[2], 'catalog_browse');
  calls.length = 0;
  await repository.searchAvailableMedicines();
  const available = calls.find(call => call.sql.includes('FROM inventory i'));
  assert.doesNotMatch(available.sql, /publication_status IN \('draft', 'published'\)/);
  const saleableStockFilter = `AND ${listingEligibleForCheckout} AND i.availability = 1 AND i.stock_on_hand - i.reserved_quantity > 0`;
  assert.ok(available.sql.split('FROM inventory i')[1].includes(saleableStockFilter));
  assert.equal(calls.find(call => call.sql.includes("set_config('app.capability'")).params[2], 'catalog_browse');
  calls.length = 0;
  await repository.listStoreInventory(25, { includeCatalog: true });
  const storeBrowse = calls.find(call => call.sql.includes('FROM inventory i'));
  assert.match(storeBrowse.sql, /publication_status IN \('draft', 'published'\)/);
  assert.match(storeBrowse.sql, /AS canOrder/);
  assert.deepEqual(storeBrowse.params, [25]);
  calls.length = 0;
  await repository.listStoreInventory(25);
  const storeAvailable = calls.find(call => call.sql.includes('FROM inventory i'));
  assert.doesNotMatch(storeAvailable.sql, /publication_status IN \('draft', 'published'\)/);
  assert.ok(storeAvailable.sql.split('FROM inventory i')[1].includes(saleableStockFilter));
});
