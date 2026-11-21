// Packet 0 characterization: older roadmap Phase 0 decisions must not be
// mistaken for approved production business rules. No external service calls.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createPaymentPolicy } from '../src/domain/payments/policy.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Phase 0: unconfigured payment policy cannot collect either full or deposit payments', () => {
  const policy = createPaymentPolicy();
  assert.equal(policy.mode, 'disabled');
  for (const plan of ['full', 'deposit']) {
    const quoted = policy.quote(10001, plan);
    assert.equal(quoted.ok, false);
    assert.equal(quoted.unavailable, true);
  }
});

test('Phase 0: deposit amount must be an explicitly selected versioned policy (not implied approval)', () => {
  const fullOnly = createPaymentPolicy({ mode: 'full', version: 'fixture-only' });
  assert.equal(fullOnly.quote(10001, 'deposit').ok, false);
  const explicitlyConfigured = createPaymentPolicy({
    mode: 'deposit_or_full', version: 'fixture-only', depositBasisPoints: 5000,
  });
  assert.deepEqual(explicitlyConfigured.quote(10001, 'deposit'), {
    ok: true, paymentPlan: 'deposit', amountCentavos: 5001,
    currency: 'PHP', policyVersion: 'fixture-only',
  });
});

test('Phase 0: current one-pharmacy enforcement and three-day default are characterized, not approved policy changes', async () => {
  const source = await read('../src/application/order-service.js');
  assert.match(source, /if \(drugstoreIds\.length !== 1\)/);
  assert.match(source, /An order can contain medicines from only one pharmacy/);
  assert.match(source, /reservationTtlMs\s*=\s*3\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
});

test('Phase 0: all six owner decisions remain explicitly open in the handoff register', async () => {
  const document = await read('../../docs/real-world-phase0-decision-gates-2026-10-30.md');
  const rows = document.split('\n').filter((line) => /^\| D[1-6] \|/.test(line));
  assert.equal(rows.length, 6);
  for (let i = 1; i <= 6; i++) {
    const row = rows.find((line) => line.startsWith(`| D${i} |`));
    assert.ok(row, `missing D${i}`);
    assert.match(row, /\bOPEN\b/);
  }
  assert.match(document, /Supabase-managed PostgreSQL/);
  assert.match(document, /Do not expose real patient data or accept real payments/);
});

test('Phase 0 R04: retired legacy medicine requires a persisted OTC review before republication', async () => {
  const { createCatalogService } = await import('../src/application/catalog-service.js');
  const migration = await read('../migrations/postgres/0005_catalog_discovery.sql');
  assert.match(migration, /CASE WHEN rx_required = 1 THEN 'retired' ELSE 'draft' END/);
  assert.match(migration, /ALTER TABLE medicines DROP COLUMN IF EXISTS rx_required/);

  let publication = 'retired';
  let approvedEvidence = 0;
  let publicationWrites = 0;
  // This isolated repository contract fixture does not substitute for an actual
  // database-role test or validate whether any medicine is OTC-eligible.
  const repository = new Proxy(Object.create(null), {
    get(_target, method) {
      if (method === 'findMasterMedicineById') {
        return async () => ({ id: 41, brand_name: 'Synthetic legacy restricted item', publication_status: publication });
      }
      if (method === 'countApprovedMedicineEvidence') return async () => approvedEvidence;
      if (method === 'updateMedicinePublication') {
        return async (_id, newStatus) => { publicationWrites++; publication = newStatus; return 1; };
      }
      return async () => null;
    },
  });
  const service = createCatalogService({ repository });
  assert.equal((await service.setMedicinePublication(1, 41, { status: 'published' })).status, 409);
  assert.equal(publicationWrites, 0);
  approvedEvidence = 1;
  const actual = await service.setMedicinePublication(1, 41, { status: 'published' });
  assert.equal(actual.status, 409, 'Evidence alone must not establish OTC eligibility');
  assert.equal(publication, 'retired');
  assert.equal(publicationWrites, 0);
});

test('Phase 0 R04: public discovery and store inventory use the shared published-or-pharmacy-listed eligibility predicate', async () => {
  const { createPostgresCatalogRepository } = await import('../src/infrastructure/postgres/catalog-repository.js');
  const recorded = [];
  const client = {
    async query(sql, params = []) {
      recorded.push({ sql: String(sql), params });
      // Source-level recording fixture only: PostgreSQL has NOT executed or
      // evaluated these predicates, and no pharmacy is asserted to be real.
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const pool = { async connect() { return client; }, async query(...args) { return client.query(...args); } };
  const repository = createPostgresCatalogRepository(pool);
  assert.deepEqual(await repository.searchAvailableMedicines({ limit: 4 }), []);
  assert.deepEqual(await repository.listStoreInventory(7), []);

  const queries = recorded.filter(({ sql }) => /FROM stock i\s+JOIN medicines m/.test(sql));
  assert.equal(queries.length, 2, 'one public catalog query and one public pharmacy inventory query');
  for (const { sql } of queries) {
    assert.match(sql, /m\.publication_status = 'published' AND m\.otc_eligible/);
    assert.match(sql, /ds\.verification_status = 'verified'/);
    // Prescription and unclassified categories stay out of standard checkout.
    assert.match(sql, /NOT IN \('prescription \(source list\)'/);
  }
  // medicine_evidence was removed by migration 0053, so discovery no longer calculates an evidence count.
  assert.ok(queries.every(({ sql }) => !/evidenceCount|medicine_evidence/.test(sql)));

  const checkout = await read('../src/infrastructure/postgres/order-repository.js');
  const stockLookup = /async findInventoryForUpdate\([\s\S]+?LIMIT 1 FOR UPDATE/.exec(checkout)?.[0];
  assert.ok(stockLookup, 'checkout inventory lookup exists');
  assert.match(stockLookup, /\$\{listingEligibleForCheckout\}/);
});
