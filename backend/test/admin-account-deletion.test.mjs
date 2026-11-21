import assert from 'node:assert/strict';
import test from 'node:test';

import { createIdentityService } from '../src/application/identity-service.js';
import { createMembershipService } from '../src/application/membership-service.js';
import { assertSecurityRepository } from '../src/ports/security-repository.js';

function identityHarness({ profile = { id: 9, role: 'customer' }, openOrders = 0, failAnonymize = false } = {}) {
  const calls = [];
  const repository = {
    async findIdByEmail() {}, async createCustomer() {}, async replacePasswordIfCurrent() {}, async replacePassword() {},
    async findRecoveryAccountByEmail() {}, async findAuthorizationUserById() {}, async updateProfile() {}, async findAuthUserByEmail() {},
    async findProfileById(id) { return Number(id) === 9 ? profile : null; },
    async countOpenOrders() { return openOrders; },
    async scrubPrescriptionPhotos(id) { calls.push(['scrub', id]); },
    async anonymizeCustomer(id, details) {
      if (failAnonymize) throw Object.assign(new Error('denied'), { code: '42501' });
      calls.push(['anonymize', id, details]); return 1;
    },
    async recordAudit(actor, action, text) { calls.push(['audit', actor, action, text]); },
    async listCustomers(input) { calls.push(['list', input]); return [{ id: 9, name: 'Sam', email: 'sam@example.com', created_at: '2026-11-01' }]; },
  };
  const service = createIdentityService({
    repository, securityRepository: new Proxy({}, { get: () => async () => null }),
    auth: { issueCredentials() {}, revokeUserSessions: async (id, reason) => { calls.push(['revoke', id, reason]); } },
    hashPassword: async (value) => `hash:${value}`, sendVerificationEmail: async () => ({}), randomSecret: () => 'unusable',
  });
  return { service, calls };
}

test('an administrator deletes a customer: details removed, orders kept, email freed, sessions ended, audit written', async () => {
  const { service, calls } = identityHarness();
  const result = await service.adminDeleteCustomer(1, 9);
  assert.equal(result.status, 200);
  assert.deepEqual(calls.map((call) => call[0]), ['scrub', 'anonymize', 'audit', 'revoke']);
  const [, id, details] = calls[1];
  assert.equal(id, 9);
  assert.equal(details.name, 'Deleted account');
  assert.equal(details.email, 'deleted-9@deleted.invalid');
  assert.equal(details.passwordHash, 'hash:unusable');
  assert.deepEqual(calls[2].slice(1, 3), [1, 'ADMIN_DELETE_CUSTOMER']);
  assert.deepEqual(calls[3], ['revoke', 9, 'account_deleted']);
});

test('administrator customer deletion refuses admins, partners, yourself, unknown ids and active orders', async () => {
  for (const [harnessOptions, adminId, customerId, status] of [
    [{ profile: { id: 9, role: 'admin' } }, 1, 9, 404],
    [{ profile: { id: 9, role: 'partner' } }, 1, 9, 404],
    [{}, 9, 9, 409],
    [{}, 1, 12, 404],
    [{}, 1, 'x', 400],
    [{ openOrders: 1 }, 1, 9, 409],
  ]) {
    const { service, calls } = identityHarness(harnessOptions);
    assert.equal((await service.adminDeleteCustomer(adminId, customerId)).status, status);
    assert.deepEqual(calls, []);
  }
});

test('a failed customer wipe reports unavailable and keeps the sessions', async () => {
  const { service, calls } = identityHarness({ failAnonymize: true });
  assert.equal((await service.adminDeleteCustomer(1, 9)).status, 503);
  assert.equal(calls.some((call) => call[0] === 'revoke'), false);
});

test('the admin customer list is searched, capped and never returns passwords', async () => {
  const { service, calls } = identityHarness();
  const result = await service.adminListCustomers({ q: '  Sam ', limit: 5000 });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, [{ id: 9, name: 'Sam', email: 'sam@example.com', createdAt: '2026-11-01' }]);
  assert.deepEqual(calls[0], ['list', { search: 'Sam', limit: 100 }]);
});

function membershipHarness(outcome) {
  const calls = [];
  const noop = async () => null;
  const names = ['privacyHash','issueCredentialSet','findActiveSession','rotateRefreshToken','revokeToken','revokeUserSessions','upsertEmailVerification','verifyEmailCode','consumeVerifiedEmail','createPasswordResetChallenge','resetPasswordWithChallenge','recordIpLoginAttempt','beginAccountLoginAttempt','failAccountLoginAttempt','succeedAccountLoginAttempt','releaseAccountLoginAttempt','resetAccountLoginSecurity','listActiveMemberships','findActiveMembership','listDrugstoreMemberships','upsertMembership','deactivateMembership'];
  const base = Object.fromEntries(names.map((name) => [name, noop]));
  const repository = assertSecurityRepository({ ...base, createPartnerAccount: noop, deletePharmacyAccount: async (input) => { calls.push(['delete', input.drugstoreId, await input.anonymise(31)]); return outcome; } });
  const revoked = [];
  const service = createMembershipService({ repository, hashPassword: async (value) => `hash:${value.length}`, revokeSessions: async (id) => { revoked.push(id); } });
  return { service, calls, revoked };
}

test('deleting a pharmacy removes its partner logins and ends their sessions', async () => {
  const { service, calls, revoked } = membershipHarness({ status: 'ok', userIds: [31, 32] });
  const result = await service.deletePharmacyAccount(1, 12);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { drugstoreId: 12, deleted: true, partnerAccountsRemoved: 2 });
  assert.deepEqual(revoked, [31, 32]);
  assert.equal(calls[0][2].name, 'Deleted partner');
  assert.equal(calls[0][2].email, 'deleted-partner-31@deleted.invalid');
  assert.match(calls[0][2].passwordHash, /^hash:/);
});

test('deleting a pharmacy is refused for unknown, already deleted or busy pharmacies and bad ids', async () => {
  for (const [outcome, id, status] of [
    [{ status: 'store_missing' }, 12, 404],
    [{ status: 'already_deleted' }, 12, 409],
    [{ status: 'open_orders' }, 12, 409],
    [{ status: 'ok', userIds: [] }, 'x', 400],
  ]) {
    const { service, revoked } = membershipHarness(outcome);
    assert.equal((await service.deletePharmacyAccount(1, id)).status, status);
    assert.deepEqual(revoked, []);
  }
});
