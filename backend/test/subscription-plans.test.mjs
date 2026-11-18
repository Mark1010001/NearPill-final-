import assert from 'node:assert/strict';
import test from 'node:test';

import { subscriptionPlans, tierEntitlements, validTiers } from '../src/domain/subscriptions/plans.js';
import { createReportService } from '../src/application/report-service.js';

test('plans are Basic, Plus and Pro and each lists what it includes', () => {
  assert.deepEqual(validTiers, ['Basic', 'Plus', 'Pro']);
  for (const plan of subscriptionPlans) {
    assert.ok(plan.summary.length > 5);
    assert.ok(plan.features.length >= 2, `${plan.tier} must list its features`);
  }
  assert.deepEqual(tierEntitlements.Basic, []);
  assert.deepEqual(tierEntitlements.Plus, ['reports:view:premium']);
  assert.deepEqual(tierEntitlements.Pro, ['reports:view:premium', 'reports:history:full']);
});

function reports(seen) {
  return createReportService({ repository: {
    async getMetrics() { return {}; }, async getSalesReport() { return []; },
    async getSalesReportForDrugstore(_id, input) { seen.push(input); return []; },
    async getMedicineReport() { return []; }, async getDrugstoreReport() { return []; }, async listAuditLogs() { return []; },
  } });
}

test('without full history the partner sales report starts no earlier than 90 days ago', async () => {
  const seen = [];
  const service = reports(seen);
  const now = () => new Date('2026-11-15T10:00:00Z');
  await service.partnerSales(5, {}, { fullHistory: false, now });
  await service.partnerSales(5, { startDate: '2025-01-01' }, { fullHistory: false, now });
  await service.partnerSales(5, { startDate: '2026-11-01' }, { fullHistory: false, now });
  await service.partnerSales(5, { startDate: '2025-01-01' }, { fullHistory: true, now });
  assert.deepEqual(seen.map((input) => input.startDate), ['2026-08-17', '2026-08-17', '2026-11-01', '2025-01-01']);
});
