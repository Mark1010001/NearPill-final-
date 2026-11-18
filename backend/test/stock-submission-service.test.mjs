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
  const state = { saved: [], created: [], movements: [], audits: [], updated: [], inserted: [], decided: null, submission: null };
  const repository = new Proxy({}, { get: (_, name) => {
    switch (name) {
      case 'findDrugstoreName': return async (id) => (id === 7 ? 'ALV Pharmacy' : null);
      case 'findCatalogMatches': return async () => catalog;
      case 'createStockSubmission': return async (input) => { state.saved.push(input); return 41; };
      case 'withTransaction': return async (work) => {
        const tx = {
          lockStockSubmission: async () => state.submission,
          createPharmacyProduct: async (input) => { state.created.push(input); return 900 + state.created.length; },
          findInventoryForUpdate: async (_d, medicineId) => inventory.get(medicineId) ?? null,
          updateInventoryStock: async (...a) => state.updated.push(['stock', ...a]),
          updateInventoryPrice: async (...a) => state.updated.push(['price', ...a]),
          updateInventoryUnits: async (...a) => state.updated.push(['unit', ...a]),
          insertReviewedListing: async (...a) => { state.inserted.push(a); return 500 + state.inserted.length; },
          appendStockMovement: async (m) => state.movements.push(m),
          appendAudit: async (...a) => state.audits.push(a),
          decideStockSubmission: async (...a) => { state.decided = a; return true; },
        };
        const result = await work(tx);
        return result?.value;
      };
      default: return async () => null;
    }
  } });
  return { service: createStockSubmissionService({ repository }), state };
}

test('a file that follows the template is saved as a pending submission', async () => {
  const { service, state } = fake();
  const result = await service.submit(9, partner, { drugstoreId: 7, fileName: 'stock.csv', csv: `${H}\n${line()}` });
  assert.equal(result.status, 201);
  assert.deepEqual(result.body, { id: 41, status: 'pending', rowCount: 1, newMedicines: 1 });
  assert.equal(state.saved[0].source, 'csv');
  assert.equal(state.saved[0].rows[0].name, 'Biogesic 500 mg');
});

test('files that break the template, the pharmacy or the catalog are rejected without saving', async () => {
  const { service, state } = fake({ catalog: [{ id: 3, brandName: 'Neozep', dosageForm: 'Tablet' }, { id: 4, brandName: 'Biogesic 500 mg', dosageForm: 'Tablet' }] });
  assert.equal((await service.submit(9, partner, { drugstoreId: 7, csv: `${H.replace('brand', 'name')}\n${line()}` })).body.rowErrors[0].line, 1);
  assert.equal((await service.submit(9, partner, { drugstoreId: 7, csv: `${H}\n${line({ pharmacy: 'Other' })}` })).status, 400);
  const wrongBrand = await service.submit(9, partner, { drugstoreId: 7, csv: `${H}\n${line({ catalog_id: '3' })}` });
  assert.match(wrongBrand.body.rowErrors[0].message, /catalog_id 3 is Neozep/);
  const duplicate = await service.submit(9, partner, { drugstoreId: 7, csv: `${H}\n${line()}` });
  assert.match(duplicate.body.rowErrors[0].message, /already in the catalog as catalog_id 4/);
  assert.equal(state.saved.length, 0);
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
  assert.equal(state.saved[0].source, 'single');
});

test('approval creates new medicines, updates existing stock and records movements', async () => {
  const inventory = new Map([[3, { id: 60, stockOnHand: 5, reservedQuantity: 2, priceCentavos: 100, sellingUnit: 'Tablet', packageSize: null }]]);
  const { service, state } = fake({ inventory });
  state.submission = { id: 41, drugstoreId: 7, status: 'pending', rows: [
    { line: 3, medicineId: null, name: 'New Thing 10 mg', genericName: null, form: 'Syrup', category: 'Non-prescription', sellingUnit: 'Bottle', price: '20.00', stock: 4 },
    { line: 2, medicineId: 3, name: 'Neozep', form: 'Tablet', category: 'Non-prescription', sellingUnit: 'Tablet', price: '2.50', stock: 9 },
  ] };
  const result = await service.decide(1, 41, { decision: 'approve' });
  assert.equal(result.status, 200);
  assert.deepEqual(state.created, [{ brandName: 'New Thing 10 mg', genericName: null, dosageForm: 'Syrup', category: 'Non-prescription' }]);
  assert.deepEqual(state.updated.map((item) => item[0]), ['stock', 'price']);
  assert.deepEqual(state.inserted[0].slice(0, 5), [7, 901, 4, 2000, 'Bottle']);
  assert.deepEqual(state.movements.map((m) => m.countDelta), [4, 4]);
  assert.deepEqual(state.decided.slice(0, 3), [41, 'approved', null]);
});

test('approval refuses to drop stock below reserved units, repeat a decision, or reject without a reason', async () => {
  const inventory = new Map([[3, { id: 60, stockOnHand: 5, reservedQuantity: 4, priceCentavos: 100, sellingUnit: 'Tablet' }]]);
  const { service, state } = fake({ inventory });
  state.submission = { id: 41, drugstoreId: 7, status: 'pending', rows: [{ line: 2, medicineId: 3, name: 'Neozep', sellingUnit: 'Tablet', price: '1', stock: 1 }] };
  assert.equal((await service.decide(1, 41, { decision: 'approve' })).status, 409);
  assert.equal(state.decided, null);
  state.submission = { ...state.submission, status: 'approved' };
  assert.equal((await service.decide(1, 41, { decision: 'approve' })).status, 409);
  assert.equal((await service.decide(1, 41, { decision: 'reject', note: '' })).status, 400);
  state.submission = { ...state.submission, status: 'pending' };
  assert.equal((await service.decide(1, 41, { decision: 'reject', note: 'Wrong prices' })).status, 200);
  assert.deepEqual(state.decided.slice(0, 3), [41, 'rejected', 'Wrong prices']);
});
