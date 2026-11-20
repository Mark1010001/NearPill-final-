import assert from 'node:assert/strict';
import test from 'node:test';
import { createMembershipService } from '../src/application/membership-service.js';
import { assertSecurityRepository } from '../src/ports/security-repository.js';
import { PartnerAccountSchema } from '../src/http/contracts.ts';

function repo(overrides = {}) {
  const calls = [];
  const noop = async () => null;
  const names = ['privacyHash','issueCredentialSet','findActiveSession','rotateRefreshToken','revokeToken','revokeUserSessions','upsertEmailVerification','verifyEmailCode','consumeVerifiedEmail','createPasswordResetChallenge','resetPasswordWithChallenge','recordIpLoginAttempt','beginAccountLoginAttempt','failAccountLoginAttempt','succeedAccountLoginAttempt','releaseAccountLoginAttempt','resetAccountLoginSecurity','listActiveMemberships','findActiveMembership','listDrugstoreMemberships','upsertMembership','deactivateMembership'];
  const base = Object.fromEntries(names.map((name) => [name, noop]));
  base.createPartnerAccount = async (input) => { calls.push(input); return { status: 'ok', userId: 77 }; };
  return { repository: assertSecurityRepository({ ...base, ...overrides }), calls };
}

test('creating a partner account hashes the password and never returns it', async () => {
  const { repository, calls } = repo();
  const service = createMembershipService({ repository, hashPassword: async (password) => `hashed:${password.length}` });
  const result = await service.createPartnerAccount(1, 4, { email: ' Owner@Pharmacy.PH ', password: 'Sunrise2026ok' });
  assert.equal(result.status, 201);
  assert.deepEqual(result.body, { userId: 77, drugstoreId: 4, email: 'owner@pharmacy.ph', membershipRole: 'owner', role: 'partner' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].passwordHash, 'hashed:13');
  assert.equal(JSON.stringify(calls[0]).includes('Sunrise2026ok'), false);
  assert.equal(JSON.stringify(result).includes('Sunrise2026ok'), false);
});

test('partner account creation rejects weak passwords, bad emails, duplicates and unknown pharmacies', async () => {
  const { repository } = repo();
  const service = createMembershipService({ repository, hashPassword: async () => 'h' });
  assert.equal((await service.createPartnerAccount(1, 4, { email: 'a@b.ph', password: 'short1' })).status, 400);
  assert.equal((await service.createPartnerAccount(1, 4, { email: 'a@b.ph', password: 'onlyletterspassword' })).status, 400);
  assert.equal((await service.createPartnerAccount(1, 4, { email: 'not-an-email', password: 'Sunrise2026ok' })).status, 400);
  assert.equal((await service.createPartnerAccount(1, 'x', { email: 'a@b.ph', password: 'Sunrise2026ok' })).status, 400);
  assert.equal((await service.createPartnerAccount(1, 4, { email: 'longname@b.ph', password: 'longname@b.ph' })).status, 400);
  const taken = createMembershipService({ repository: repo({ createPartnerAccount: async () => ({ status: 'email_taken' }) }).repository, hashPassword: async () => 'h' });
  assert.equal((await taken.createPartnerAccount(1, 4, { email: 'a@b.ph', password: 'Sunrise2026ok' })).status, 409);
  const missing = createMembershipService({ repository: repo({ createPartnerAccount: async () => ({ status: 'store_missing' }) }).repository, hashPassword: async () => 'h' });
  assert.equal((await missing.createPartnerAccount(1, 4, { email: 'a@b.ph', password: 'Sunrise2026ok' })).status, 404);
});

test('the request body accepts only email and password', () => {
  assert.equal(PartnerAccountSchema.safeParse({ email: 'a@b.ph', password: 'Sunrise2026ok' }).success, true);
  assert.equal(PartnerAccountSchema.safeParse({ email: 'a@b.ph', password: 'Sunrise2026ok', role: 'admin' }).success, false);
});

test('emailing login details sends a set-password link to an active partner and never a password', async () => {
  const sent = [];
  const { repository } = repo({ listDrugstoreMemberships: async () => [
    { userId: 77, name: 'Owner', email: 'owner@pharmacy.ph', drugstoreId: 4, membershipRole: 'owner', isActive: true },
    { userId: 78, name: 'Gone', email: 'gone@pharmacy.ph', drugstoreId: 4, membershipRole: 'staff', isActive: false },
  ] });
  const service = createMembershipService({ repository, hashPassword: async () => 'h', sendSetupEmail: async (user) => { sent.push(user); } });
  const ok = await service.sendLoginEmail(1, 4, 77);
  assert.equal(ok.status, 200);
  assert.deepEqual(sent, [{ id: 77, email: 'owner@pharmacy.ph' }]);
  assert.equal(JSON.stringify(ok.body).includes('password'), false);
  assert.equal((await service.sendLoginEmail(1, 4, 78)).status, 404, 'a removed login gets no email');
  assert.equal((await service.sendLoginEmail(1, 4, 999)).status, 404);
  assert.equal((await service.sendLoginEmail(1, 'x', 77)).status, 400);
  const broken = createMembershipService({ repository, hashPassword: async () => 'h', sendSetupEmail: async () => { throw new Error('mail down'); } });
  assert.equal((await broken.sendLoginEmail(1, 4, 77)).status, 502);
  const unavailable = createMembershipService({ repository, hashPassword: async () => 'h' });
  assert.equal((await unavailable.sendLoginEmail(1, 4, 77)).status, 503);
});

test('without a password the server makes a random one that nobody sees, and the partner is told to use the emailed link', async () => {
  const { repository, calls } = repo();
  const hashed = [];
  const service = createMembershipService({ repository, hashPassword: async (password) => { hashed.push(password); return `hashed:${password.length}`; } });
  const first = await service.createPartnerAccount(1, 4, { email: 'owner@pharmacy.ph' });
  const second = await service.createPartnerAccount(1, 4, { email: 'other@pharmacy.ph' });
  assert.equal(first.status, 201);
  assert.equal(hashed.length, 2);
  assert.ok(hashed[0].length >= 30, 'a long random password');
  assert.notEqual(hashed[0], hashed[1], 'a different password every time');
  assert.equal(JSON.stringify(first.body).includes(hashed[0]), false, 'never returned');
  assert.equal(JSON.stringify(calls).includes(hashed[0]), false, 'only the hash reaches the repository');
  assert.deepEqual(first.body, { userId: 77, drugstoreId: 4, email: 'owner@pharmacy.ph', membershipRole: 'owner', role: 'partner' });
  assert.equal(second.status, 201);
  assert.equal(PartnerAccountSchema.safeParse({ email: 'owner@pharmacy.ph' }).success, true);
  assert.equal(PartnerAccountSchema.safeParse({ email: 'owner@pharmacy.ph', password: 'short' }).success, false, 'a supplied password is still checked');
});

test('the email check says whether an email is free before a pharmacy is created', async () => {
  const { repository } = repo();
  const seen = [];
  const service = createMembershipService({ repository, hashPassword: async () => 'h', emailInUse: async (email) => { seen.push(email); return email === 'used@pharmacy.ph'; } });
  assert.deepEqual((await service.partnerEmailAvailable({ email: ' Used@Pharmacy.PH ' })).body, { available: false });
  assert.deepEqual((await service.partnerEmailAvailable({ email: 'free@pharmacy.ph' })).body, { available: true });
  assert.deepEqual(seen, ['used@pharmacy.ph', 'free@pharmacy.ph']);
  assert.equal((await service.partnerEmailAvailable({ email: 'nope' })).status, 400);
  const unavailable = createMembershipService({ repository, hashPassword: async () => 'h' });
  assert.equal((await unavailable.partnerEmailAvailable({ email: 'free@pharmacy.ph' })).status, 503);
});
