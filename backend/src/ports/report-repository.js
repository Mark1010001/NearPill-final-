const requiredMethods = [
  'getMetrics',
  'getSalesReport',
  'getSalesReportForDrugstore',
  'getMedicineReport',
  'getDrugstoreReport',
  'listAuditLogs',
];

export function assertReportRepository(repository) {
  if (!repository || typeof repository !== 'object') {
    throw new TypeError('Report repository is required.');
  }
  for (const method of requiredMethods) {
    if (typeof repository[method] !== 'function') {
      throw new TypeError(`Report repository must implement ${method}().`);
    }
  }
  return repository;
}
