const requiredMethods = [
  'withTransaction',
  'listCustomerOrders',
  'listItemsForOrders',
  'findCustomerOrder',
  'listItemsForOrder',
  'listAdminOrders',
  'listAdminItemsForOrders',
  'findAdminOrder',
  'listAdminItemsForOrder',
  'listPartnerOrderItems',
];

export function assertOrderRepository(repository) {
  if (!repository || typeof repository !== 'object') {
    throw new TypeError('Order repository is required.');
  }
  for (const method of requiredMethods) {
    if (typeof repository[method] !== 'function') {
      throw new TypeError(`Order repository must implement ${method}().`);
    }
  }
  return repository;
}
