import { assertSecurityRepository } from '../ports/security-repository.js';

export const loginError = 'Unable to sign in. Check your details or try again later.';

export function createDurableLoginSecurity({ repository, namespace = 'login' }) {
  assertSecurityRepository(repository);

  return Object.freeze({
    async allowIp(ip = 'unknown') {
      try {
        return await repository.recordIpLoginAttempt(repository.privacyHash(`${namespace}:${ip || 'unknown'}`));
      } catch (error) {
        console.error('login_rate_limit_failed', { code: error.code });
        throw error;
      }
    },
    async begin(email) {
      const emailHash = repository.privacyHash(email);
      return (await repository.beginAccountLoginAttempt(emailHash)) ? { emailHash } : null;
    },
    async fail(_email, state) {
      return repository.failAccountLoginAttempt(state.emailHash);
    },
    async succeed(_email, state) {
      await repository.succeedAccountLoginAttempt(state.emailHash);
      return true;
    },
    async release(_email, state) {
      if (state?.emailHash) await repository.releaseAccountLoginAttempt(state.emailHash);
    },
    reset(email) {
      return repository.resetAccountLoginSecurity(email);
    },
    close() {},
  });
}
