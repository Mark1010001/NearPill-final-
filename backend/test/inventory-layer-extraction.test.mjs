import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createInventoryService } from '../src/application/inventory-service.js';
import { createPostgresInventoryRepository } from '../src/infrastructure/postgres/inventory-repository.js';
import { runWithDatabaseActor } from '../src/infrastructure/postgres/context.js';

const routeSource = await readFile(new URL('../src/http/routes/v1/register.ts', import.meta.url), 'utf8');
const repositorySource = await readFile(new URL('../src/infrastructure/postgres/inventory-repository.js', import.meta.url), 'utf8');

function repositoryFixture(reservedQuantity = 2) {
  let stockOnHand = 5;
  let priceCentavos = 950;
  let sellingUnit = null;
  let packageSize = null;
  const audits = [];
  const movements = [];
  return {
    audits, movements,
    async withTransaction(work) {
      const tx = {
        async findInventoryForUpdate(storeId, medicineId) { return storeId === 5 && medicineId === 9 ? { id: 1, stockOnHand, reservedQuantity, priceCentavos, availability: 1, sellingUnit, packageSize } : null; },
        async updateInventoryUnits(_id, unit, size) { sellingUnit = unit; packageSize = size; },
        async updateInventoryStock(_s, _m, nextStock) { stockOnHand = nextStock; },
        async findInventoryByIdForUpdate(id) { return id === 1 ? { id: 1, priceCentavos, stockOnHand, reservedQuantity } : null; },
        async updateInventoryPrice(_id, next) { priceCentavos = next; },
        async appendStockMovement(entry) { movements.push(entry); },
        async appendAudit(userId, action, description) { audits.push({ userId, action, description }); },
      };
      const result = await work(tx); return result?.value;
    },
    async findInventoryForUpdate() {}, async updateInventoryStock() {}, async findInventoryByIdForUpdate() {}, async updateInventoryPrice() {}, async appendAudit() {},
    async listAdminInventory(storeId) { return [{ drugstoreId: storeId ?? 5, stockOnHand, reservedQuantity, sellableQuantity: stockOnHand - reservedQuantity, priceCentavos, sellingUnit, packageSize }]; },
  };
}

test('changing selling units requires matching inventory and no active reservations', async () => {
  const partner = { role: 'partner', memberships: [{ drugstoreId: 5, membershipRole: 'staff' }] };
  const edit = { drugstoreId: 5, medicineId: 9, expectedStockOnHand: 5, stockOnHand: 30, expectedPriceCentavos: 950,
    price: '6.00', sellingUnit: 'Capsule', packageSize: 'Box of 10 capsules' };
  const reserved = createInventoryService({ repository: repositoryFixture() });
  assert.match((await reserved.updateStock(7, partner, edit)).body.error, /while stock is reserved/);
  const service = createInventoryService({ repository: repositoryFixture(0) });
  assert.equal((await service.updateStock(7, partner, edit)).status, 200);
  const [saved] = (await service.listPartnerInventory(partner)).body;
  assert.deepEqual([saved.sellingUnit, saved.packageSize, saved.stockOnHand, saved.priceCentavos], ['Capsule', 'Box of 10 capsules', 30, 600]);
  assert.equal((await service.updateStock(7, partner, { ...edit, expectedStockOnHand: 30, expectedPriceCentavos: 600 })).status, 409);
});

test('inventory route stays thin and Postgres repository owns row locks', () => {
  assert.doesNotMatch(routeSource, /\bSELECT\b|\bUPDATE\s+inventory\b|pool\.query/i);
  assert.match(repositorySource, /FOR UPDATE/);
  assert.match(repositorySource, /stock_on_hand/);
  assert.match(repositorySource, /reserved_quantity/);
});

test('partner adjustment cannot reduce stock below active reservations', async () => {
  const repository = repositoryFixture();
  const service = createInventoryService({ repository });
  const partner = { role: 'partner', memberships: [{ drugstoreId: 5, membershipRole: 'staff', isActive: true }] };
  assert.equal((await service.updateStock(7, partner, { pharmacyId: 6, medId: 9, countDelta: 1 })).status, 403);
  assert.equal((await service.updateStock(7, partner, { pharmacyId: 5, medId: 9, countDelta: -4 })).status, 409);
  assert.equal((await service.updateStock(7, partner, { pharmacyId: 5, medId: 9, countDelta: 2_147_483_647 })).status, 409);
  assert.equal((await service.updateStock(7, partner, { pharmacyId: 5, medId: 9, countDelta: 2_147_483_648 })).status, 400);
  assert.equal(repository.movements.length, 0);
  const adjusted = await service.updateStock(7, partner, { pharmacyId: 5, medId: 9, countDelta: -3 });
  assert.equal(adjusted.status, 200);
  assert.equal(adjusted.body.stockOnHand, 2);
  assert.equal(adjusted.body.reservedQuantity, 2);
  assert.equal(adjusted.body.sellableQuantity, 0);
  assert.equal(repository.movements[0].countDelta, -3);
});

test('partner sets the counted total while protecting newer stock and reserved units', async () => {
  const repository = repositoryFixture();
  const service = createInventoryService({ repository });
  const partner = { role: 'partner', memberships: [{ drugstoreId: 5, membershipRole: 'staff' }] };
  const count = { drugstoreId: 5, medicineId: 9, expectedStockOnHand: 5, stockOnHand: 3 };
  assert.equal((await service.updateStock(7, partner, { ...count, drugstoreId: 6 })).status, 403);
  assert.equal((await service.updateStock(7, partner, { ...count, countDelta: -2 })).status, 400);
  assert.equal((await service.updateStock(7, partner, { ...count, stockOnHand: 0 })).status, 409);
  const saved = await service.updateStock(7, partner, count);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.stockOnHand, 3);
  assert.equal(saved.body.sellableQuantity, 1);
  assert.equal((await service.updateStock(7, partner, count)).status, 409);
  assert.equal((await service.updateStock(7, partner, { ...count, expectedStockOnHand: 3 })).status, 200);
  assert.deepEqual(repository.movements.map((entry) => entry.countDelta), [-2]);
  assert.equal(repository.audits.length, 1);
});

test('partner updates its stock and unit price together and rejects stale or unauthorized edits', async () => {
  const repository = repositoryFixture();
  const service = createInventoryService({ repository });
  const partner = { role: 'partner', memberships: [{ drugstoreId: 5, membershipRole: 'staff' }] };
  const edit = { drugstoreId: 5, medicineId: 9, expectedStockOnHand: 5, stockOnHand: 4, expectedPriceCentavos: 950, price: '12.75' };
  assert.equal((await service.updateStock(7, partner, { ...edit, drugstoreId: 6 })).status, 403);
  assert.equal((await service.updateStock(7, { role: 'customer' }, edit)).status, 403);
  assert.equal((await service.updateStock(7, partner, { ...edit, price: '12.751' })).status, 400);
  assert.equal((await service.updateStock(7, partner, { ...edit, expectedPriceCentavos: 949 })).status, 409);
  assert.equal((await service.updateStock(7, partner, { ...edit, stockOnHand: 1 })).status, 409);
  assert.equal(repository.audits.length, 0);
  assert.equal((await service.updateStock(7, partner, edit)).status, 200);
  const result = await service.listPartnerInventory(partner);
  assert.equal(result.body[0].stockOnHand, 4);
  assert.equal(result.body[0].priceCentavos, 1275);
  assert.deepEqual(repository.audits.map(({ action }) => action), ['UPDATE_INVENTORY', 'UPDATE_INVENTORY_PRICE']);
});

test('only a member can record a documented sale confirmation for their own listing', async () => {
  const repository = repositoryFixture();
  const transaction = repository.withTransaction;
  const confirmations = [];
  repository.withTransaction = (work) => transaction((tx) => work({
    ...tx, async confirmPharmacySale(...args) { confirmations.push(args); return true; },
  }));
  const service = createInventoryService({ repository });
  const staff = { role: 'partner', memberships: [{ drugstoreId: 5, membershipRole: 'staff' }] };
  const saleProduct = ['Product 9', null, 'Tablet', 'Non-Prescription'];
  const input = { drugstoreId: 5, medicineId: 9, stockOnHand: 5, expectedStockOnHand: 5, saleProduct };
  assert.equal((await service.updateStock(7, staff, { ...input, drugstoreId: 6 })).status, 403);
  assert.equal((await service.updateStock(1, { role: 'admin' }, input)).status, 403);
  assert.equal((await service.updateStock(7, staff, { ...input, saleProduct: [] })).status, 400);
  assert.deepEqual(confirmations, []);
  assert.equal((await service.updateStock(7, staff, input)).status, 200);
  assert.deepEqual(confirmations, [[1, 7, saleProduct]]);
  assert.equal(repository.audits[0].action, 'CONFIRM_PHARMACY_ONLINE_SALE');
});

test('partner inventory reads drafts through catalogue access and stays scoped to the member pharmacy', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: sql.includes('FROM stock i') ? [{ publicationstatus: 'draft' }] : [] };
    },
    release() {},
  };
  const repository = createPostgresInventoryRepository({ query() {}, async connect() { return client; } });
  const service = createInventoryService({ repository });
  const actor = { userId: 7, role: 'partner', memberships: [{ drugstoreId: 5, membershipRole: 'staff' }] };
  assert.equal((await service.listPartnerInventory(actor, { drugstoreId: 6 })).status, 403);
  assert.equal(calls.length, 0);
  const result = await runWithDatabaseActor(actor, () => service.listPartnerInventory(actor));
  assert.equal(result.body[0].publicationStatus, 'draft');
  assert.deepEqual(calls.find(({ sql }) => sql.includes("set_config('app.capability'")).params, ['7', 'partner', 'catalog_browse']);
  const inventoryQuery = calls.find(({ sql }) => sql.includes('FROM stock i'));
  assert.deepEqual(inventoryQuery.params, [5]);
  assert.match(inventoryQuery.sql, /i\.pharmacy_id = \$1 AND m\.publication_status IN \('draft', 'published'\)/);
});

test('partner intake carries catalog approval and records initial stock and price once', async () => {
  const repository = repositoryFixture();
  let inserted = false;
  repository.withTransaction = async (work, options) => {
    assert.deepEqual(options, { intake: true });
    return (await work({
      async addApprovedListing(branch, medicine, stock, price) {
        assert.deepEqual([branch, medicine, stock, price], [5, 9, 8, 750]);
        if (inserted) return null;
        inserted = true;
        return 1;
      },
      async appendStockMovement(entry) { repository.movements.push(entry); },
      async appendAudit(user, action) { repository.audits.push({ user, action }); },
    })).value;
  };
  const service = createInventoryService({ repository });
  const partner = { role: 'partner', memberships: [{ drugstoreId: 5, membershipRole: 'staff', isActive: true }] };
  const input = { drugstoreId: 5, medicineId: 9, stock: 8, price: '7.50' };
  assert.equal((await service.addApprovedListing(7, partner, { ...input, drugstoreId: 6 })).status, 403);
  assert.equal((await service.addApprovedListing(7, partner, { ...input, price: '0' })).status, 400);
  assert.equal((await service.addApprovedListing(7, partner, input)).status, 201);
  assert.equal((await service.addApprovedListing(7, partner, input)).status, 409);
  assert.equal(repository.movements.length, 1);
  assert.equal(repository.audits[0].action, 'ADD_APPROVED_INVENTORY');
});

test('partner stock upload rejects duplicate rows and rolls back when one product cannot be listed', async () => {
  const repository = repositoryFixture();
  let attempts = 0;
  repository.withTransaction = async (work) => {
    const result = await work({
      async addApprovedListing(_branch, medicine) {
        attempts++;
        return medicine === 9 ? 1 : null;
      },
      async appendStockMovement() {},
      async appendAudit() {},
    });
    assert.equal(result.rollback, true);
    return result.value;
  };
  const service = createInventoryService({ repository });
  const partner = { role: 'partner', memberships: [{ drugstoreId: 5, membershipRole: 'staff' }] };
  const row = { medicineId: 9, stock: 2, price: '7.50' };
  assert.equal((await service.addApprovedListing(7, partner, { drugstoreId: 5, items: [row, row] })).status, 400);
  assert.equal(attempts, 0);
  const rejected = await service.addApprovedListing(7, partner, { drugstoreId: 5, items: [row, { ...row, medicineId: 10 }] });
  assert.equal(rejected.status, 409);
  assert.match(rejected.body.error, /Catalog #10/);
  assert.equal(attempts, 2);
});

test('a pharmacy can create a brand-new product with its first stock, but only for its own branch', async () => {
  const repository = repositoryFixture();
  const created = [];
  repository.withTransaction = async (work, options) => {
    assert.deepEqual(options, { intake: true });
    return (await work({
      async createPharmacyProduct(product) { created.push(product); return 55; },
      async addNewProductListing(...args) { created.push(args); return 3; },
      async appendStockMovement(entry) { repository.movements.push(entry); },
      async appendAudit(user, action) { repository.audits.push({ user, action }); },
    })).value;
  };
  const service = createInventoryService({ repository });
  const partner = { role: 'partner', memberships: [{ drugstoreId: 5, membershipRole: 'staff', isActive: true }] };
  const input = { drugstoreId: 5, brandName: ' Biogesic 500 mg ', genericName: '', dosageForm: 'Tablet', category: 'Non-prescription', stock: 20, price: '6.50', sellingUnit: 'Tablet' };
  assert.equal((await service.createPharmacyProduct(7, partner, { ...input, drugstoreId: 6 })).status, 403);
  assert.equal((await service.createPharmacyProduct(7, { role: 'customer' }, input)).status, 403);
  assert.equal((await service.createPharmacyProduct(7, partner, { ...input, price: '0' })).status, 400);
  assert.equal((await service.createPharmacyProduct(7, partner, { ...input, category: 'Controlled' })).status, 400);
  assert.equal(created.length, 0);
  const result = await service.createPharmacyProduct(7, partner, input);
  assert.equal(result.status, 201);
  assert.deepEqual(created[0], { brandName: 'Biogesic 500 mg', genericName: null, dosageForm: 'Tablet', category: 'Non-prescription' });
  assert.deepEqual(created[1], [5, 55, 20, 650, 'Tablet', null, 7]);
  assert.equal(repository.audits[0].action, 'ADD_APPROVED_INVENTORY');
});
