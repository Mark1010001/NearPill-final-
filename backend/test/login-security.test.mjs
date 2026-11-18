import assert from 'node:assert/strict';
import test from 'node:test';
import { createDurableLoginSecurity, loginError } from '../src/application/durable-login-security.js';

function repository() {
  const attempts = [];
  const accounts = new Map();
  const noop = async () => null;
  return {
    privacyHash(value) { return `hash:${value}`; },
    issueCredentialSet: noop, findActiveSession: noop, rotateRefreshToken: noop, revokeToken: noop,
    revokeUserSessions: noop, upsertEmailVerification: noop, verifyEmailCode: noop,
    consumeVerifiedEmail: noop, createPasswordResetChallenge: noop, resetPasswordWithChallenge: noop,
    async recordIpLoginAttempt(value) { attempts.push(value); return attempts.length <= 10; },
    async beginAccountLoginAttempt(emailHash) {
      if (accounts.get(emailHash)?.inFlight) return false;
      accounts.set(emailHash, { inFlight: true, failures: accounts.get(emailHash)?.failures || 0 });
      return true;
    },
    async failAccountLoginAttempt(emailHash) {
      const row = accounts.get(emailHash) || { failures: 0 };
      row.failures++;
      accounts.set(emailHash, row);
      return { failures: row.failures, notifyLockout: row.failures === 5 };
    },
    async succeedAccountLoginAttempt(emailHash) { accounts.delete(emailHash); },
    async releaseAccountLoginAttempt(emailHash) { if (accounts.has(emailHash)) accounts.get(emailHash).inFlight = false; },
    async resetAccountLoginSecurity(email) { accounts.delete(`hash:${email}`); },
    listActiveMemberships: async () => [], findActiveMembership: noop, listDrugstoreMemberships: async () => [],
    upsertMembership: noop, createPartnerAccount: noop, deactivateMembership: async () => false,
    _attempts: attempts, _accounts: accounts,
  };
}

test('durable IP limiter delegates every decision to the shared security repository', async () => {
  const repo = repository();
  const security = createDurableLoginSecurity({ repository: repo, namespace: 'login' });
  for (let i = 0; i < 10; i++) assert.equal(await security.allowIp('127.0.0.1'), true);
  assert.equal(await security.allowIp('127.0.0.1'), false);
  assert.equal(repo._attempts[0], 'hash:login:127.0.0.1');
});

test('account attempt lifecycle remains repository-owned and lockout notification occurs on the fifth failure', async () => {
  const repo = repository();
  const security = createDurableLoginSecurity({ repository: repo });
  for (let i = 1; i <= 5; i++) {
    const state = await security.begin('user@example.com');
    assert.ok(state);
    const failed = await security.fail('user@example.com', state);
    assert.equal(failed.failures, i);
    assert.equal(failed.notifyLockout, i === 5);
    await security.release('user@example.com', state);
  }
  await security.reset('user@example.com');
  assert.equal(repo._accounts.size, 0);
});

test('generic login error does not disclose whether account, password, or throttle caused denial', () => {
  assert.equal(loginError, 'Unable to sign in. Check your details or try again later.');
  assert.doesNotMatch(loginError, /account exists|password incorrect|rate limit/i);
});
