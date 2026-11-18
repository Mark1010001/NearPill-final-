const requiredMethods = [
  'findIdByEmail',
  'findAuthUserByEmail',
  'createCustomer',
  'replacePasswordIfCurrent',
  'replacePassword',
  'findRecoveryAccountByEmail',
  'findProfileById',
  'findAuthorizationUserById',
  'updateProfile',
];

// Needed only by account deletion, so repositories used elsewhere need not implement them.
export const accountDeletionMethods = ['countOpenOrders', 'scrubPrescriptionPhotos', 'anonymizeCustomer'];

export function assertIdentityRepository(repository) {
  if (!repository || typeof repository !== 'object') {
    throw new TypeError('Identity repository is required.');
  }

  for (const method of requiredMethods) {
    if (typeof repository[method] !== 'function') {
      throw new TypeError(`Identity repository must implement ${method}().`);
    }
  }

  return repository;
}
