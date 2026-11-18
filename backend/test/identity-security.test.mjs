import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createAuthService } from '../src/application/auth-service.js';
import { createIdentityService } from '../src/application/identity-service.js';
import { actorHasPermission } from '../src/domain/identity/permissions.js';
import { hashCredential } from '../src/domain/identity/tokens.js';
import { createMembershipService } from '../src/application/membership-service.js';

function fakeSecurityRepository() {
  const sessions = new Map();
  const families = new Map();
  const emailChallenges = new Map();
  const memberships = new Map();
  return {
    privacyHash(value) { return hashCredential(value); },
    async issueCredentialSet(input) {
      families.set(input.familyId, { userId: input.userId, revoked: false });
      sessions.set(input.accessHash, { userId: input.userId, familyId: input.familyId, tokenKind: 'access', revoked: false, consumed: false });
      sessions.set(input.refreshHash, { userId: input.userId, familyId: input.familyId, tokenKind: 'refresh', revoked: false, consumed: false });
      if (input.webHash) sessions.set(input.webHash, { userId: input.userId, tokenKind: 'web', csrfHash: input.csrfHash, revoked: false, consumed: false });
    },
    async findActiveSession(tokenHash, kinds) {
      const item = sessions.get(tokenHash);
      if (!item || item.revoked || item.consumed || !kinds.includes(item.tokenKind)) return null;
      const family = item.familyId ? families.get(item.familyId) : null;
      if (family?.revoked) return null;
      const userMemberships = memberships.get(item.userId) || [];
      return {
        id: 1,
        userId: item.userId,
        familyId: item.familyId || null,
        tokenKind: item.tokenKind,
        csrfHash: item.csrfHash || null,
        user: { id: item.userId, name: 'User', email: 'user@example.com', role: item.userId === 9 ? 'partner' : 'customer' },
        memberships: userMemberships,
      };
    },
    async rotateRefreshToken({ tokenHash, newAccessHash, newRefreshHash }) {
      const current = sessions.get(tokenHash);
      if (!current || current.tokenKind !== 'refresh') return { status: 'invalid' };
      const family = families.get(current.familyId);
      if (current.consumed || current.revoked || family?.revoked) {
        if (family) family.revoked = true;
        for (const row of sessions.values()) if (row.familyId === current.familyId) row.revoked = true;
        return { status: 'replay' };
      }
      current.consumed = true;
      sessions.set(newAccessHash, { userId: current.userId, familyId: current.familyId, tokenKind: 'access', revoked: false, consumed: false });
      sessions.set(newRefreshHash, { userId: current.userId, familyId: current.familyId, tokenKind: 'refresh', revoked: false, consumed: false });
      return { status: 'rotated', userId: current.userId, familyId: current.familyId };
    },
    async revokeToken(tokenHash) {
      const item = sessions.get(tokenHash);
      if (!item) return false;
      item.revoked = true;
      if (item.tokenKind === 'refresh' && item.familyId) {
        families.get(item.familyId).revoked = true;
        for (const row of sessions.values()) if (row.familyId === item.familyId) row.revoked = true;
      }
      return true;
    },
    async revokeUserSessions(userId) {
      for (const row of sessions.values()) if (row.userId === userId) row.revoked = true;
    },
    async upsertEmailVerification(email, codeHash, expiresAt) { emailChallenges.set(email, { codeHash, expiresAt, verified: false }); },
    async verifyEmailCode(email, codeHash) {
      const row = emailChallenges.get(email);
      if (!row) return { status: 'missing' };
      if (row.expiresAt <= Date.now()) return { status: 'expired' };
      if (row.codeHash !== codeHash) return { status: 'invalid' };
      row.verified = true;
      return { status: 'verified' };
    },
    async consumeVerifiedEmail(email) {
      const row = emailChallenges.get(email);
      if (!row?.verified || row.expiresAt <= Date.now()) return false;
      emailChallenges.delete(email);
      return true;
    },
    async createPasswordResetChallenge() {},
    async resetPasswordWithChallenge() { return { status: 'invalid' }; },
    async recordIpLoginAttempt() { return true; },
    async beginAccountLoginAttempt() { return true; },
    async failAccountLoginAttempt() { return { failures: 1, notifyLockout: false }; },
    async succeedAccountLoginAttempt() {},
    async releaseAccountLoginAttempt() {},
    async resetAccountLoginSecurity() {},
    async listActiveMemberships(userId) { return memberships.get(userId) || []; },
    async findActiveMembership(userId, drugstoreId) { return (memberships.get(userId) || []).find(m => m.drugstoreId === drugstoreId) || null; },
    async listDrugstoreMemberships(drugstoreId) { return [...memberships.entries()].flatMap(([userId, list]) => list.filter(m => m.drugstoreId === drugstoreId).map(m => ({ userId, ...m }))); },
    async createPartnerAccount() { return { status: 'ok', userId: 1 }; },
    async upsertMembership({ userId, drugstoreId, membershipRole }) { memberships.set(userId, [{ drugstoreId, membershipRole, isActive: true }]); return { status: 'ok' }; },
    async deactivateMembership({ userId, drugstoreId }) { memberships.set(userId, (memberships.get(userId) || []).filter(m => m.drugstoreId !== drugstoreId)); return true; },
    _sessions: sessions,
    _families: families,
    _memberships: memberships,
  };
}

test('access, refresh, and web credentials are separated and only hashes are stored', async () => {
  const repository = fakeSecurityRepository();
  const auth = createAuthService({ repository, now: () => 1_000, production: false });
  const issued = await auth.issueCredentials(7, { includeWeb: true });
  assert.notEqual(issued.accessToken, issued.refreshToken);
  assert.notEqual(issued.webSessionToken, issued.accessToken);
  assert.ok(repository._sessions.has(hashCredential(issued.accessToken)));
  assert.ok(repository._sessions.has(hashCredential(issued.refreshToken)));
  assert.equal(repository._sessions.has(issued.accessToken), false);

  const access = await auth.authenticate({ headers: { authorization: `Bearer ${issued.accessToken}` } });
  const refreshAsBearer = await auth.authenticate({ headers: { authorization: `Bearer ${issued.refreshToken}` } });
  assert.equal(access.userId, 7);
  assert.equal(refreshAsBearer, null);
});

test('refresh tokens rotate once and replay revokes the token family', async () => {
  const repository = fakeSecurityRepository();
  const auth = createAuthService({ repository, now: () => 2_000 });
  const issued = await auth.issueCredentials(7);
  const first = await auth.rotateRefresh(issued.refreshToken);
  assert.equal(first.status, 'rotated');
  const replay = await auth.rotateRefresh(issued.refreshToken);
  assert.equal(replay.status, 'replay');
  const newAccess = await auth.authenticate({ headers: { authorization: `Bearer ${first.accessToken}` } });
  assert.equal(newAccess, null, 'replay revokes every credential in the affected family');
});

test('cookie sessions require the per-session CSRF verifier for mutations', async () => {
  const repository = fakeSecurityRepository();
  const auth = createAuthService({ repository, production: false });
  const issued = await auth.issueCredentials(9, { includeWeb: true });
  const session = await auth.authenticate({ headers: { cookie: `nearpill_session=${issued.webSessionToken}` } });
  assert.equal(session.via, 'cookie');
  assert.equal(auth.csrfAccepted({ method: 'GET', headers: {} }, session), true);
  assert.equal(auth.csrfAccepted({ method: 'POST', headers: {} }, session), false);
  assert.equal(auth.csrfAccepted({ method: 'POST', headers: { 'x-csrf-token': issued.csrfToken } }, session), true);
});

test('an unrelated malformed cookie does not break session authentication', async () => {
  const auth = createAuthService({ repository: fakeSecurityRepository(), production: false });
  const issued = await auth.issueCredentials(9, { includeWeb: true });
  const session = await auth.authenticate({ headers: {
    cookie: `unrelated=%ZZ; nearpill_session=${issued.webSessionToken}`,
  } });
  assert.equal(session.userId, 9);
});

test('production cookie contract uses Secure HttpOnly __Host session and separate CSRF cookie', async () => {
  const repository = fakeSecurityRepository();
  const auth = createAuthService({ repository, production: true });
  const issued = await auth.issueCredentials(1, { includeWeb: true });
  const values = auth.webSessionCookieHeaders(issued.webSessionToken, issued.csrfToken);
  assert.match(values[0], /^__Host-nearpill_session=/);
  assert.match(values[0], /HttpOnly/);
  assert.match(values[0], /Secure/);
  assert.match(values[0], /SameSite=Strict/);
  assert.match(values[1], /^nearpill_csrf=/);
  assert.doesNotMatch(values[1], /HttpOnly/);
});

test('email verification state is durable-repository owned and consumed once by registration', async () => {
  const securityRepository = fakeSecurityRepository();
  let userId = 40;
  const repository = {
    async findIdByEmail() { return null; },
    async findAuthUserByEmail() { return null; },
    async createCustomer() { return ++userId; },
    async replacePasswordIfCurrent() { return 1; },
    async replacePassword() { return 1; },
    async findRecoveryAccountByEmail() { return null; },
    async findProfileById() { return null; },
    async findAuthorizationUserById() { return null; },
    async updateProfile() { return null; },
  };
  const auth = createAuthService({ repository: securityRepository });
  const identity = createIdentityService({
    repository,
    securityRepository,
    auth,
    hashPassword: async () => 'hash',
    sendVerificationEmail: async () => ({ devMode: true, devCode: '123456' }),
    createCode: () => '123456',
  });
  await identity.sendOtp({ email: 'a@example.com' });
  assert.equal((await identity.verifyOtp({ email: 'a@example.com', code: '123456' })).ok, true);
  assert.equal((await identity.register({ fullName: 'A User', email: 'a@example.com', password: 'secret1' })).status, 201);
  assert.equal((await identity.register({ fullName: 'A User', email: 'a@example.com', password: 'secret1' })).status, 403);
});

test('partner password changes require the current password and target only the signed-in account', async () => {
  const securityRepository = fakeSecurityRepository();
  let writes = 0;
  securityRepository.changePartnerPassword = async (change) => {
    assert.deepEqual(change, { userId: 9, currentPasswordHash: 'initial-secret', passwordHash: 'new-hash' });
    return ++writes === 1;
  };
  const identity = createIdentityService({
    repository: {
      async findAuthUserByEmail() { return { id: 9, password: 'initial-secret' }; },
      findIdByEmail() {}, createCustomer() {}, replacePasswordIfCurrent() {},
      replacePassword() {}, findRecoveryAccountByEmail() {}, findProfileById() {},
      findAuthorizationUserById() {}, updateProfile() {},
    },
    securityRepository,
    auth: createAuthService({ repository: securityRepository }),
    hashPassword: async () => 'new-hash',
    sendVerificationEmail: async () => ({}),
  });
  const actor = { role: 'partner', email: 'partner@example.test' };
  const body = { currentPassword: 'initial-secret', password: 'replacement-secret' };
  assert.equal((await identity.changePartnerPassword(9, { ...actor, role: 'customer' }, body)).status, 403);
  assert.equal((await identity.changePartnerPassword(10, actor, body)).status, 400);
  assert.equal((await identity.changePartnerPassword(9, actor, { ...body, currentPassword: 'wrong' })).status, 400);
  assert.equal(writes, 0);
  assert.equal((await identity.changePartnerPassword(9, actor, body)).status, 200);
  assert.equal((await identity.changePartnerPassword(9, actor, body)).status, 409);
});

test('pharmacy permissions are membership-scoped and deny cross-tenant access', () => {
  const actor = { role: 'partner', memberships: [{ drugstoreId: 3, membershipRole: 'manager', isActive: true }] };
  assert.equal(actorHasPermission(actor, 'inventory:adjust', 3), true);
  assert.equal(actorHasPermission(actor, 'orders:read:pharmacy', 3), true);
  assert.equal(actorHasPermission(actor, 'inventory:adjust', 4), false);
  assert.equal(actorHasPermission({ role: 'customer', memberships: [] }, 'admin:access'), false);
});

test('membership service never grants a client-selected membership without admin-side validation', async () => {
  const repository = fakeSecurityRepository();
  const service = createMembershipService({ repository, hashPassword: async () => 'hash' });
  const bad = await service.upsert(1, 3, { userId: 9, membershipRole: 'superadmin' });
  assert.equal(bad.status, 400);
  const ok = await service.upsert(1, 3, { userId: 9, membershipRole: 'staff' });
  assert.equal(ok.status, 201);
  assert.equal(actorHasPermission({ role: 'partner', memberships: await repository.listActiveMemberships(9) }, 'inventory:adjust', 3), true);
  assert.equal(actorHasPermission({ role: 'partner', memberships: await repository.listActiveMemberships(9) }, 'inventory:adjust', 2), false);
});

test('PostgreSQL identity migration stores hashed credentials, forces RLS, and supports pharmacy-scoped order reads', async () => {
  const migration = await readFile(new URL('../migrations/postgres/0004_identity_security.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS auth_sessions/);
  assert.match(migration, /token_hash CHAR\(64\) NOT NULL UNIQUE/);
  assert.doesNotMatch(migration, /raw_token|refresh_token\s+(TEXT|VARCHAR)|session_token\s+(TEXT|VARCHAR)/i);
  assert.match(migration, /auth_session_families/);
  assert.match(migration, /email_verification_challenges/);
  assert.match(migration, /password_reset_challenges/);
  assert.match(migration, /auth_rate_limit_events/);
  assert.match(migration, /'auth_sessions'/);
  assert.match(migration, /ALTER TABLE %I ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /ALTER TABLE %I FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /JOIN pharmacy_memberships pm ON pm\.drugstore_id = od\.drugstore_id/);
});


test('persistent auth throttling serializes same-key decisions inside PostgreSQL transactions', async () => {
  const source = await readFile(new URL('../src/infrastructure/postgres/security-repository.js', import.meta.url), 'utf8');
  assert.match(source, /pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)/);
  assert.match(source, /`ip:\$\{ipHash\}`/);
  assert.match(source, /`account:\$\{emailHash\}`/);
});

test('production CORS does not implicitly trust localhost origins', async () => {
  const source = await readFile(new URL('../src/config/env.ts', import.meta.url), 'utf8');
  assert.match(source, /staging' \|\| nodeEnv === 'production'/);
  assert.match(source, /CORS_ORIGINS must be explicitly configured/);
  assert.match(source, /CORS_ORIGINS must not use a wildcard origin/);
});

test('React portal uses server session bootstrap and has no browser role or tenant authority', async () => {
  const app = await readFile(new URL('../../web/src/app/App.tsx', import.meta.url), 'utf8');
  const api = await readFile(new URL('../../web/src/api/client.ts', import.meta.url), 'utf8');
  const session = await readFile(new URL('../../web/src/auth/session.tsx', import.meta.url), 'utf8');
  const partner = await readFile(new URL('../../web/src/features/partner/PartnerPages.tsx', import.meta.url), 'utf8');
  const combined = `${app}\n${api}\n${session}\n${partner}`;
  assert.doesNotMatch(combined, /localStorage|sessionStorage/);
  assert.doesNotMatch(combined, /email\.includes\(["']admin/);
  assert.doesNotMatch(combined, /admin123|pass123|password123/);
  assert.match(session, /queryKey:\s*\['session'\][\s\S]*?api\.me\(signal\)/);
  assert.match(api, /credentials:\s*'same-origin'/);
  assert.match(api, /X-CSRF-Token/);
  assert.match(api, /\/partner\/orders/);
  assert.match(api, /\/partner\/inventory/);
  assert.doesNotMatch(partner, /\/admin\/orders|\/admin\/inventory/);
});
