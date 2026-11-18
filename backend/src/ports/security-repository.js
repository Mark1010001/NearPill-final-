const requiredMethods = [
  'privacyHash',
  'issueCredentialSet',
  'findActiveSession',
  'rotateRefreshToken',
  'revokeToken',
  'revokeUserSessions',
  'upsertEmailVerification',
  'verifyEmailCode',
  'consumeVerifiedEmail',
  'createPasswordResetChallenge',
  'resetPasswordWithChallenge',
  'recordIpLoginAttempt',
  'beginAccountLoginAttempt',
  'failAccountLoginAttempt',
  'succeedAccountLoginAttempt',
  'releaseAccountLoginAttempt',
  'resetAccountLoginSecurity',
  'listActiveMemberships',
  'findActiveMembership',
  'listDrugstoreMemberships',
  'upsertMembership',
  'createPartnerAccount',
  'deactivateMembership',
];

export function assertSecurityRepository(repository) {
  if (!repository || typeof repository !== 'object') {
    throw new TypeError('Security repository is required.');
  }
  for (const method of requiredMethods) {
    if (typeof repository[method] !== 'function') {
      throw new TypeError(`Security repository must implement ${method}().`);
    }
  }
  return repository;
}
