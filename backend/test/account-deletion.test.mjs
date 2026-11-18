import assert from 'node:assert/strict';
import test from 'node:test';

import { createIdentityService } from '../src/application/identity-service.js';
import { hashPassword } from '../passwords.js';

async function harness({ openOrders = 0, role = 'customer', failAnonymize = false } = {}) {
  const calls = [];
  const password = await hashPassword('Right-pass1');
  const repository = {
    async findIdByEmail() {}, async createCustomer() {}, async replacePasswordIfCurrent() {}, async replacePassword() {},
    async findRecoveryAccountByEmail() {}, async findProfileById() {}, async findAuthorizationUserById() {}, async updateProfile() {},
    async findAuthUserByEmail() { return { id: 7, email: 'sam@example.com', role, password }; },
    async countOpenOrders() { return openOrders; },
    async scrubPrescriptionPhotos(id) { calls.push(['scrub', id]); },
    async anonymizeCustomer(id, details) {
      if (failAnonymize) throw Object.assign(new Error('permission denied'), { code: '42501' });
      calls.push(['anonymize', id, details]); return 1;
    },
  };
  const service = createIdentityService({
    repository, securityRepository: new Proxy({}, { get: () => async () => null }),
    auth: { issueCredentials() {}, revokeUserSessions: async (id, reason) => { calls.push(['revoke', id, reason]); } },
    hashPassword: async (value) => `hash:${value}`, sendVerificationEmail: async () => ({}), randomSecret: () => 'unusable',
  });
  return { service, calls, actor: { id: 7, email: 'sam@example.com', role } };
}

test('deleting an account needs the right password and no active orders', async () => {
  const wrong = await harness();
  assert.equal((await wrong.service.deleteAccount(7, wrong.actor, { password: 'nope' })).status, 400);
  assert.equal((await wrong.service.deleteAccount(7, wrong.actor, {})).status, 400);
  assert.deepEqual(wrong.calls, []);

  const busy = await harness({ openOrders: 2 });
  assert.equal((await busy.service.deleteAccount(7, busy.actor, { password: 'Right-pass1' })).status, 409);
  assert.deepEqual(busy.calls, []);

  const ok = await harness();
  const done = await ok.service.deleteAccount(7, ok.actor, { password: 'Right-pass1' });
  assert.equal(done.status, 200);
  assert.deepEqual(ok.calls.map((call) => call[0]), ['scrub', 'anonymize', 'revoke']);
  const [, , details] = ok.calls[1];
  assert.equal(details.name, 'Deleted account');
  assert.match(details.email, /^deleted-7@deleted\.invalid$/);
  assert.equal(details.passwordHash, 'hash:unusable');
});

test('only customer accounts can be deleted here', async () => {
  const partner = await harness({ role: 'partner' });
  assert.equal((await partner.service.deleteAccount(7, partner.actor, { password: 'Right-pass1' })).status, 403);
  assert.deepEqual(partner.calls, []);
});

test('a failed anonymisation reports unavailable and keeps the sessions', async () => {
  const failing = await harness({ failAnonymize: true });
  const outcome = await failing.service.deleteAccount(7, failing.actor, { password: 'Right-pass1' });
  assert.equal(outcome.status, 503);
  assert.equal(failing.calls.some((call) => call[0] === 'revoke'), false);
});
