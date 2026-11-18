import { assertReportRepository } from '../ports/report-repository.js';
import { success } from './result.js';
import { SALES_HISTORY_DAYS_WITHOUT_FULL_HISTORY } from '../domain/subscriptions/plans.js';

function isoDay(date) { return date.toISOString().slice(0, 10); }

export function createReportService({ repository }) {
  assertReportRepository(repository);

  return Object.freeze({
    async metrics() {
      const { gmvRow, pharmacyRow, orderRow } = await repository.getMetrics();
      return success({
        totalGMV: Number(gmvRow?.totalGMV || 0),
        activePharmaciesCount: Number(pharmacyRow?.activePharmaciesCount || 0),
        totalOrdersCount: Number(orderRow?.totalOrdersCount || 0),
      });
    },

    async sales(query = {}) {
      const rows = await repository.getSalesReport({
        startDate: query.startDate,
        endDate: query.endDate,
      });
      return success(rows.map((row) => ({
        reportDate: row.reportDate,
        orderCount: Number(row.orderCount),
        revenue: Number(row.revenue),
      })));
    },

    async partnerSales(drugstoreIdValue, query = {}, { fullHistory = true, now = () => new Date() } = {}) {
      const drugstoreId = Number(drugstoreIdValue);
      let startDate = query.startDate;
      if (!fullHistory) {
        const earliest = isoDay(new Date(now().getTime() - SALES_HISTORY_DAYS_WITHOUT_FULL_HISTORY * 86_400_000));
        if (!startDate || String(startDate).slice(0, 10) < earliest) startDate = earliest;
      }
      const rows = await repository.getSalesReportForDrugstore(drugstoreId, {
        startDate,
        endDate: query.endDate,
      });
      return success(rows.map((row) => ({
        reportDate: row.reportDate,
        orderCount: Number(row.orderCount),
        revenueCentavos: Number(row.revenueCentavos || 0),
        revenue: Number(row.revenueCentavos || 0) / 100,
      })));
    },

    async medicines() {
      const rows = await repository.getMedicineReport();
      return success(rows.map((row) => ({
        medicineId: Number(row.medicineId),
        brandName: row.brandName,
        genericName: row.genericName,
        quantitySold: Number(row.quantitySold),
        orderCount: Number(row.orderCount),
      })));
    },

    async drugstores() {
      const rows = await repository.getDrugstoreReport();
      return success(rows.map((row) => ({
        drugstoreId: Number(row.drugstoreId),
        drugstoreName: row.drugstoreName,
        orderCount: Number(row.orderCount),
        revenue: Number(row.revenue),
        cancelledCount: Number(row.cancelledCount || 0),
        expiredCount: Number(row.expiredCount || 0),
      })));
    },

    async auditLogs() {
      return success(await repository.listAuditLogs());
    },
  });
}
