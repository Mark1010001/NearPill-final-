const requiredMethods = [
  'searchAvailableMedicines',
  'findMedicineById',
  'findMedicineInventoryById',
  'listActiveStores',
  'findPublicStoreById',
  'findStoreById',
  'listStoreInventory',
  'findNearbyStores',
  'searchPublicStores',
  'listAdminPharmacies',
  'listDrugstoreSales',
  'createDrugstore',
  'updateDrugstore',
  'setPharmacyVerification',
  'getGoLiveFacts',
  'setPublication',
  'listMasterMedicines',
  'createMedicine',
  'findMasterMedicineById',
  'updateMedicine',
  'updateMedicinePublication',
  'appendAudit',
];

export function assertCatalogRepository(repository) {
  if (!repository || typeof repository !== 'object') {
    throw new TypeError('Catalog repository is required.');
  }

  for (const method of requiredMethods) {
    if (typeof repository[method] !== 'function') {
      throw new TypeError(`Catalog repository must implement ${method}().`);
    }
  }

  return repository;
}
