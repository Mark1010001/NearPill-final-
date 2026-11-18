const requiredMethods = [
  'withTransaction',
  'listSubscriptions',
  'partnerDashboardForDrugstore',
  'activeSubscriptionForDrugstore',
  'findDrugstoreById',
  'expireActiveSubscriptions',
  'createSubscription',
  'findSubscriptionById',
  'updateSubscription',
  'replaceEntitlements',
  'listEntitlementsForDrugstore',
  'appendBillingEvent',
  'appendAudit',
  'findOrderPaymentForActor',
  'findPaymentForActor',
  'findPendingRefundForPayment',
  'findPaymentById',
];

export function assertPaymentSubscriptionRepository(repository) {
  if (!repository || typeof repository !== 'object') throw new TypeError('Payment/subscription repository is required.');
  for (const method of requiredMethods) {
    if (typeof repository[method] !== 'function') throw new TypeError(`Payment/subscription repository must implement ${method}().`);
  }
  return repository;
}
