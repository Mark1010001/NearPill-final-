const requiredMethods = [
  'withTransaction',
  'findInventoryForUpdate',
  'updateInventoryStock',
  'findInventoryByIdForUpdate',
  'updateInventoryPrice',
  'appendAudit',
  'listAdminInventory',
];

export function assertInventoryRepository(repository) {
  if (!repository || typeof repository !== 'object') {
    throw new TypeError('Inventory repository is required.');
  }
  for (const method of requiredMethods) {
    if (typeof repository[method] !== 'function') {
      throw new TypeError(`Inventory repository must implement ${method}().`);
    }
  }
  return repository;
}
