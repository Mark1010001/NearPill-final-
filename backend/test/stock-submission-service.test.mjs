import assert from 'node:assert/strict';
import test from 'node:test';
import { createStockSubmissionService } from '../src/application/stock-submission-service.js';
import { STOCK_HEADERS } from '../src/domain/inventory/stock-template.js';

const H = STOCK_HEADERS.join(',');
const partner = { role: 'partner', memberships: [{ drugstoreId: 7, membershipRole: 'owner', isActive: true }] };
const line = (over = {}) => {
  const cells = { pharmacy: 'ALV Pharmacy', catalog_id: '', brand: 'Biogesic', generic_name: 'Paracetamol', strength: '500 mg', form: 'Tablet', category: 'Non-prescription', selling_unit: 'Tablet', price: '3.50', stock_quantity: '10', ...over };
  return STOCK_HEADERS.map((name) => cells[name]).join(',');
};

function fake({ catalog = [], inventory = new Map() } = {}) {
  const state = { recorded: [], created: [], movements: [], audits: [], updated: [], inserted: [], rolledBack: false, options: null };
  const repository = new Proxy({}, { get: (_, name) => {
    switch (name) {
      case 'findDrugstoreName': return async (id) => (id === 7 ? 'ALV Pharmacy' : null);
      case 'findCatalogMatches': return async () => catalog;
      case 'withTransaction': return async (work, options) => {
        state.options = options ?? null;
        const tx = {
          createPharmacyProduct: async (input) => { state.created.push(input); return 900 + state.created.length; },
          findInventoryForUpdate: async (_d, medicineId) => inventory.get(medicineId) ?? null,
          updateInventoryStock: async (...a) => state.updated.push(['stock', ...a]),
          updateInventoryPrice: async (...a) => state.updated.push(['price', ...a]),
          updateInventoryUnits: async (...a) => state.updated.push(['unit', ...a]),
          insertReviewedListing: async (...a) => { state.inserted.push(a); return 500 + state.inserted.length; },
          appendStockMovement: async (m) => state.movements.push(m),
          appendAudit: async (...a) => state.audits.push(a),
          recordApprovedSubmission: async (input) => { state.recorded.push(input); return 41; },
        };
        const result = await work(tx);
        if (result?.rollback === true) state.rolledBack = true;
        return result?.value;
      };
      default: return async () => null;
    }
  } });
  return { service: createStockSubmissionService({ repository }), state };
}

test('a file that follows the template goes on sale at once, with no admin approval', async () => {
  const { service, state } = fake();
  const result = await service.submit(9, partner, { drugstoreId: 7, fileName: 'stock.csv', csv: `${H}\n${line()}` });
  assert.equal(result.status, 201);
  assert.deepEqual(result.body, { id: 41, status: 'approved', rowCount: 1, newMedicines: 1 });
  assert.deepEqual(state.options, { asSystem: true });
  assert.equal(state.created.length, 1);
  assert.equal(state.inserted.length, 1);
  assert.equal(state.recorded[0].source, 'csv');
  assert.equal(state.recorded[0].rows[0].name, 'Biogesic 500 mg');
  assert.equal(state.audits[0][1], 'AUTO_APPROVE_STOCK_SUBMISSION');
});

test('files that break the template, the pharmacy or the catalog are rejected without saving', async () => {
  const { service, state } = fake({ catalog: [{ id: 3, brandName: 'Neozep', dosageForm: 'Tablet' }, { id: 4, brandName: 'Biogesic 500 mg', dosageForm: 'Tablet' }] });
  assert.equal((await service.submit(9, partner, { drugstoreId: 7, csv: `${H.replace('brand', 'name')}\n${line()}` })).body.rowErrors[0].line, 1);
  assert.equal((await service.submit(9, partner, { drugstoreId: 7, csv: `${H}\n${line({ pharmacy: 'Other' })}` })).status, 400);
  const wrongBrand = await service.submit(9, partner, { drugstoreId: 7, csv: `${H}\n${line({ catalog_id: '3' })}` });
  assert.match(wrongBrand.body.rowErrors[0].message, /catalog_id 3 is Neozep/);
  const duplicate = await service.submit(9, partner, { drugstoreId: 7, csv: `${H}\n${line()}` });
  assert.match(duplicate.body.rowErrors[0].message, /already in the catalog as catalog_id 4/);
  assert.equal(state.recorded.length, 0);
  assert.equal(state.inserted.length, 0);
});

test('only a member of the pharmacy can submit, and exactly one of csv or row', async () => {
  const { service } = fake();
  assert.equal((await service.submit(9, { role: 'customer', memberships: [] }, { drugstoreId: 7, csv: H })).status, 403);
  assert.equal((await service.submit(9, partner, { drugstoreId: 8, csv: H })).status, 403);
  assert.equal((await service.submit(9, partner, { drugstoreId: 7 })).status, 400);
  assert.equal((await service.submit(9, partner, { drugstoreId: 7, csv: H, row: {} })).status, 400);
});

test('a single add uses the same template rules', async () => {
  const { service, state } = fake();
  const bad = await service.submit(9, partner, { drugstoreId: 7, row: { brand: 'X', form: 'Tablet', category: 'Nope', selling_unit: 'Tablet', price: '1', stock_quantity: '1' } });
  assert.equal(bad.status, 400);
  const ok = await service.submit(9, partner, { drugstoreId: 7, row: { brand: 'Neozep', form: 'Tablet', category: 'Non-medicine', selling_unit: 'Tablet', price: '5', stock_quantity: '2' } });
  assert.equal(ok.status, 201);
  assert.equal(state.recorded[0].source, 'single');
});

test('an accepted file creates new medicines, updates existing stock and records movements', async () => {
  const inventory = new Map([[3, { id: 60, stockOnHand: 5, reservedQuantity: 2, priceCentavos: 100, sellingUnit: 'Tablet', packageSize: null }]]);
  const { service, state } = fake({ inventory, catalog: [{ id: 3, brandName: 'Neozep', dosageForm: 'Tablet' }] });
  const csv = `${H}\n${line({ brand: 'New Thing 10 mg', generic_name: '', form: 'Syrup', selling_unit: 'Bottle', price: '20.00', stock_quantity: '4' })}\n${line({ catalog_id: '3', brand: 'Neozep', price: '2.50', stock_quantity: '9' })}`;
  const result = await service.submit(9, partner, { drugstoreId: 7, csv });
  assert.equal(result.status, 201);
  assert.equal(state.created.length, 1);
  assert.equal(state.created[0].dosageForm, 'Syrup');
  assert.deepEqual(state.updated.map((item) => item[0]), ['stock', 'price']);
  assert.deepEqual(state.inserted[0].slice(0, 5), [7, 901, 4, 2000, 'Bottle']);
  assert.deepEqual(state.movements.map((m) => m.countDelta), [4, 4]);
  assert.equal(state.rolledBack, false);
});

test('one row that cannot be applied rejects the whole file and changes nothing', async () => {
  const inventory = new Map([[3, { id: 60, stockOnHand: 5, reservedQuantity: 4, priceCentavos: 100, sellingUnit: 'Tablet' }]]);
  const { service, state } = fake({ inventory, catalog: [{ id: 3, brandName: 'Neozep', dosageForm: 'Tablet' }] });
  const csv = `${H}\n${line({ brand: 'Fine One', price: '5', stock_quantity: '3' })}\n${line({ catalog_id: '3', brand: 'Neozep', stock_quantity: '1' })}`;
  const result = await service.submit(9, partner, { drugstoreId: 7, csv });
  assert.equal(result.status, 400);
  assert.match(result.body.rowErrors[0].message, /below the 4 units reserved/);
  assert.equal(result.body.rowErrors[0].line, 3);
  assert.equal(state.rolledBack, true);
  assert.equal(state.recorded.length, 0);
});

test('every missing or invalid value is reported before anything is saved', async () => {
  const { service, state } = fake();
  const csv = `${H}\n${line({ brand: '' })}\n${line({ price: 'abc' })}\n${line({ stock_quantity: '' })}`;
  const result = await service.submit(9, partner, { drugstoreId: 7, csv });
  assert.equal(result.status, 400);
  assert.deepEqual([...new Set(result.body.rowErrors.map((e) => e.line))], [2, 3, 4]);
  assert.equal(state.options, null);
  assert.equal(state.recorded.length, 0);
});

test('a single add of a medicine already in the catalog joins that entry without a catalog_id', async () => {
  const { service, state } = fake({ catalog: [{ id: 4, brandName: 'Biogesic 500 mg', dosageForm: 'Tablet' }] });
  const row = Object.fromEntries(STOCK_HEADERS.map((name) => [name, { pharmacy: 'ALV Pharmacy', catalog_id: '', brand: 'Biogesic', generic_name: 'Paracetamol', strength: '500 mg', form: 'Tablet', category: 'Non-prescription', selling_unit: 'Tablet', price: '3.50', stock_quantity: '10' }[name]]));
  const result = await service.submit(9, partner, { drugstoreId: 7, row });
  assert.equal(result.status, 201);
  assert.equal(state.created.length, 0);
  assert.equal(state.recorded[0].rows[0].medicineId, 4);
  const asFile = await service.submit(9, partner, { drugstoreId: 7, csv: `${H}\n${line()}` });
  assert.match(asFile.body.rowErrors[0].message, /already in the catalog as catalog_id 4/);
});
