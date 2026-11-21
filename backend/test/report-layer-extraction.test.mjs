import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createReportService } from '../src/application/report-service.js';

const serverSource = await readFile(new URL('../src/bootstrap/server.ts', import.meta.url), 'utf8');
const routeSource = await readFile(new URL('../src/http/routes/v1/register.ts', import.meta.url), 'utf8');
const repositorySource = await readFile(new URL('../src/infrastructure/postgres/report-repository.js', import.meta.url), 'utf8');

const sqlShape = /\b(?:SELECT\s+[a-z0-9_*.,`]|INSERT\s+INTO\s+[a-z0-9_`]|UPDATE\s+[a-z0-9_`]+\s+SET|DELETE\s+FROM\s+[a-z0-9_`])/i;

test('report HTTP adapter is thin and contains no SQL/MySQL access', () => {
  assert.doesNotMatch(routeSource, sqlShape);
  assert.doesNotMatch(routeSource, /pool\.query|getConnection\s*\(|\bmysql\b/i);
  assert.match(routeSource, /reports\.metrics/);
  assert.match(routeSource, /reports\.sales/);
  assert.match(routeSource, /reports\.auditLogs/);
});

test('server composes report slice without inline metrics/report/audit routes', () => {
  assert.match(serverSource, /createPostgresReportRepository\(pool\)/);
  assert.match(serverSource, /createReportService\(/);
  assert.match(serverSource, /createHttpApp\(/);
  assert.doesNotMatch(serverSource, /app\.get\(\s*['"]\/api\/admin\/metrics['"]/s);
  assert.doesNotMatch(serverSource, /app\.get\(\s*['"]\/api\/admin\/reports\/sales['"]/s);
  assert.doesNotMatch(serverSource, /app\.get\(\s*['"]\/api\/admin\/audit-logs['"]/s);
});

test('report service preserves numeric response shaping', async () => {
  const repository = {
    async getMetrics() {
      return {
        gmvRow: { totalGMV: '100.50' },
        pharmacyRow: { activePharmaciesCount: '3' },
        orderRow: { totalOrdersCount: '7' },
      };
    },
    async getSalesReport(input) {
      assert.deepEqual(input, { startDate: '2026-10-01', endDate: '2026-10-17' });
      return [{ reportDate: '2026-10-17', orderCount: '4', revenue: '88.25' }];
    },
    async getSalesReportForDrugstore(drugstoreId, input) {
      assert.equal(drugstoreId, 5);
      return [{ reportDate: '2026-10-17', orderCount: '2', revenueCentavos: '5025' }];
    },
    async getMedicineReport() {
      return [{ medicineId: '9', brandName: 'Brand', genericName: 'Generic', quantitySold: '5', orderCount: '2' }];
    },
    async getDrugstoreReport() {
      return [{ drugstoreId: '5', drugstoreName: 'Store', orderCount: '3', revenue: '77.00', cancelledCount: '1', expiredCount: '2' }];
    },
    async listAuditLogs() { return [{ id: 1, action: 'TEST' }]; },
  };
  const reports = createReportService({ repository });
  assert.deepEqual((await reports.metrics()).body, {
    totalGMV: 100.5,
    activePharmaciesCount: 3,
    totalOrdersCount: 7,
  });
  assert.equal((await reports.sales({ startDate: '2026-10-01', endDate: '2026-10-17' })).body[0].revenue, 88.25);
  assert.equal((await reports.partnerSales(5, {})).body[0].revenueCentavos, 5025);
  assert.equal((await reports.medicines()).body[0].quantitySold, 5);
  assert.equal((await reports.drugstores()).body[0].expiredCount, 2);
  assert.equal((await reports.auditLogs()).body[0].action, 'TEST');
});

test('Postgres report repository owns metrics, report filters and audit SQL', () => {
  assert.match(repositorySource, /SUM\(total_centavos\).*totalGMV/s);
  assert.match(repositorySource, /o\.created_at >= \(\?::date\)::timestamp AT TIME ZONE '\$\{REPORT_TIME_ZONE\}'/);
  assert.match(repositorySource, /REPORT_TIME_ZONE = 'Asia\/Manila'/);
  assert.match(repositorySource, /PAID_ORDER_STATUSES = "\('confirmed', 'preparing', 'ready_for_pickup', 'completed'\)"/);
  assert.match(repositorySource, /o\.status IN \$\{PAID_ORDER_STATUSES\}/);
  assert.match(repositorySource, /LEFT JOIN order_pharmacies/);
  assert.match(repositorySource, /FROM audit_logs/);
  assert.match(repositorySource, /LIMIT 500/);
});

test('order value counts only paid orders and no longer hides test orders', () => {
  for (const section of [
    repositorySource.split('async getMetrics()')[1].split('async getSalesReport')[0],
    repositorySource.split('async getSalesReport(')[1].split('async getSalesReportForDrugstore')[0],
    repositorySource.split('async getMedicineReport(')[1].split('async getDrugstoreReport')[0],
    repositorySource.split('async getDrugstoreReport(')[1].split('async listAuditLogs')[0],
  ]) {
    assert.match(section, /PAID_ORDER_STATUSES/);
    assert.doesNotMatch(section, /NP-TEST/);
  }
  // The partner branch report keeps its completed-only rule but no longer hides test orders either.
  const branch = repositorySource.split('async getSalesReportForDrugstore(')[1].split('async getMedicineReport')[0];
  assert.doesNotMatch(branch, /NP-TEST/);
  assert.match(branch, /o\.status = 'completed'/);
});
