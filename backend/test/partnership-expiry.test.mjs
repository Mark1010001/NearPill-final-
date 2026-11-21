import test from 'node:test';
import assert from 'node:assert/strict';
import { partnershipExpiry, partnershipMonths, subscriptionPlans } from '../src/domain/subscriptions/plans.js';

test('partnership lasts 3 months on Basic, 6 on Plus and 1 year on Pro', () => {
  assert.deepEqual({ ...partnershipMonths }, { Basic: 3, Plus: 6, Pro: 12 });
  assert.deepEqual(subscriptionPlans.map((plan) => plan.partnershipMonths), [3, 6, 12]);
});

test('expiry is the join date plus the plan length, in Philippine time', () => {
  assert.equal(partnershipExpiry('2026-05-10T04:00:00Z', 'Basic'), '2026-08-10');
  assert.equal(partnershipExpiry('2026-05-10T04:00:00Z', 'Plus'), '2026-11-10');
  assert.equal(partnershipExpiry('2026-05-10T04:00:00Z', 'Pro'), '2027-05-10');
  // 20:00 UTC on the 9th is already the 10th in Manila.
  assert.equal(partnershipExpiry('2026-05-09T20:00:00Z', 'Basic'), '2026-08-10');
});

test('month ends are clamped and missing data gives no expiry', () => {
  assert.equal(partnershipExpiry('2026-11-30T02:00:00Z', 'Basic'), '2027-02-28');
  assert.equal(partnershipExpiry('2026-08-31T02:00:00Z', 'Plus'), '2027-02-28');
  assert.equal(partnershipExpiry('2024-02-29T02:00:00Z', 'Pro'), '2025-02-28');
  assert.equal(partnershipExpiry(null, 'Basic'), null);
  assert.equal(partnershipExpiry('2026-05-10T04:00:00Z', null), null);
  assert.equal(partnershipExpiry('not a date', 'Basic'), null);
});

import { createCatalogService } from '../src/application/catalog-service.js';

test('admin pharmacy list carries the account number and partnership expiry', async () => {
  const noop = async () => [];
  const repository = new Proxy({
    async listAdminPharmacies() {
      return [
        { store_id: 1, name: 'Alv Pharmacy', address: 'A', is_active: 1, created_at: '2026-05-10T04:00:00Z', accountNo: 1, subscriptionTier: 'Pro' },
        { store_id: 2, name: 'Bay Pharmacy', address: 'B', is_active: 1, created_at: '2026-05-10T04:00:00Z', accountNo: 2, subscriptionTier: null },
      ];
    },
    async listDrugstoreSales() { return []; },
  }, { get: (target, key) => (key in target ? target[key] : noop), has: () => true });
  const result = await createCatalogService({ repository }).listAdminPharmacies();
  assert.equal(result.ok, true);
  const [first, second] = result.body;
  assert.equal(first.subscriptionTier, 'Pro');
  assert.equal(first.partnershipExpiresAt, '2027-05-10');
  assert.equal(second.partnershipExpiresAt, null);
});
