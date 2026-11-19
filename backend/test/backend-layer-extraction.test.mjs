import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createIdentityService } from '../src/application/identity-service.js';
import { createMysqlIdentityRepository } from '../src/infrastructure/mysql/identity-repository.js';

const serverSource = await readFile(new URL('../src/bootstrap/server.ts', import.meta.url), 'utf8');
const authRouterSource = await readFile(new URL('../src/http/routes/v1/register.ts', import.meta.url), 'utf8');
const loginSource = await readFile(new URL('../src/application/login-service.js', import.meta.url), 'utf8');
const recoverySource = await readFile(new URL('../src/application/password-recovery-service.js', import.meta.url), 'utf8');
const repositorySource = await readFile(
  new URL('../src/infrastructure/mysql/identity-repository.js', import.meta.url),
  'utf8',
);

test('identity HTTP adapter is thin and contains no SQL or MySQL access', () => {
  assert.doesNotMatch(authRouterSource, /FROM\s+users|INSERT\s+INTO|UPDATE\s+users|DELETE\s+FROM|pool\.query|getConnection\s*\(/i);
  assert.doesNotMatch(authRouterSource, /\bmysql\b|pool\.query|getConnection\s*\(/i);
  assert.match(authRouterSource, /identity\.register/);
  assert.match(authRouterSource, /identity\.getProfile/);
  assert.match(authRouterSource, /identity\.updateProfile/);
});

test('server composes the extracted identity slice instead of implementing auth/profile routes inline', () => {
  assert.match(serverSource, /createPostgresIdentityRepository\(pool\)/);
  assert.match(serverSource, /createIdentityService\(/);
  assert.match(serverSource, /createHttpApp\(/);
  assert.doesNotMatch(serverSource, /app\.post\('\/api\/auth\/register'/);
  assert.doesNotMatch(serverSource, /app\.get\(\s*'\/api\/auth\/me'/s);
  assert.match(serverSource, /createPostgresSecurityRepository\(pool\)/);
  assert.match(serverSource, /createAuthService\(/);
});

test('login and recovery use the identity repository rather than issuing SQL directly', () => {
  assert.doesNotMatch(loginSource, /pool\.query/);
  assert.doesNotMatch(recoverySource, /pool\.query/);
  assert.match(loginSource, /findAuthUserByEmail/);
  assert.match(loginSource, /replacePasswordIfCurrent/);
  assert.match(recoverySource, /findRecoveryAccountByEmail/);
  assert.match(recoverySource, /resetPasswordWithChallenge/);
});

test('MySQL identity adapter implements named persistence operations and keeps SQL out of transport', async () => {
  const calls = [];
  const pool = {
    async query(sql, args) {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), args });
      if (/SELECT id FROM users WHERE email/.test(sql)) return [[{ id: 4 }]];
      if (/SELECT \* FROM users/.test(sql)) {
        return [[{ id: 4, name: 'A', email: args[0], password: 'legacy', role: 'customer' }]];
      }
      if (/INSERT INTO users/.test(sql)) return [{ insertId: 7 }];
      if (/CAST\(password AS BINARY\)/.test(sql)) return [{ affectedRows: 1 }];
      if (/UPDATE users SET password/.test(sql)) return [{ affectedRows: 1 }];
      if (/SELECT id, email FROM users/.test(sql)) return [[{ id: 4, email: args[0] }]];
      if (/SELECT id, name, email, role FROM users/.test(sql)) {
        return [[{ id: args[0], name: 'A', email: 'a@example.com', role: 'admin' }]];
      }
      if (/SELECT[\s\S]*created_at[\s\S]*FROM users/.test(sql)) {
        return [[{ id: args[0], name: 'A', email: 'a@example.com', phone: null, birthdate: null, role: 'customer', created_at: 'now' }]];
      }
      if (/UPDATE users SET phone/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const repository = createMysqlIdentityRepository(pool);
  assert.deepEqual(await repository.findIdByEmail('a@example.com'), { id: 4 });
  assert.equal((await repository.findAuthUserByEmail('a@example.com')).role, 'customer');
  assert.equal(await repository.createCustomer({ name: 'A', email: 'a@example.com', passwordHash: 'hash' }), 7);
  assert.equal(await repository.replacePasswordIfCurrent({ userId: 4, newPasswordHash: 'new', currentPasswordHash: 'old' }), 1);
  assert.equal(await repository.replacePassword(4, 'new'), 1);
  assert.deepEqual(await repository.findRecoveryAccountByEmail('a@example.com'), { id: 4, email: 'a@example.com' });
  assert.equal((await repository.findAuthorizationUserById(4)).role, 'admin');
  assert.equal((await repository.findProfileById(4)).id, 4);
  assert.equal((await repository.updateProfile(4, { phone: '123' })).id, 4);
  assert.ok(calls.length >= 9);
  assert.match(repositorySource, /INSERT INTO users/);
});

test('identity use cases preserve registration, durable verification, profile and refresh contracts with injected ports', async () => {
  const users = new Map();
  let nextId = 1;
  const repository = {
    async findIdByEmail(email) {
      const user = [...users.values()].find((candidate) => candidate.email === email);
      return user ? { id: user.id } : null;
    },
    async findAuthUserByEmail(email) { return [...users.values()].find((candidate) => candidate.email === email) ?? null; },
    async createCustomer({ name, email, passwordHash }) {
      const id = nextId++;
      users.set(id, { id, name, email, password: passwordHash, phone: null, birthdate: null, role: 'customer', created_at: 'now' });
      return id;
    },
    async replacePasswordIfCurrent() { return 1; },
    async replacePassword() { return 1; },
    async findRecoveryAccountByEmail(email) {
      const user = [...users.values()].find((candidate) => candidate.email === email);
      return user ? { id: user.id, email: user.email } : null;
    },
    async findProfileById(id) { return users.get(id) ?? null; },
    async findAuthorizationUserById(id) { return users.get(id) ?? null; },
    async updateProfile(id, update) {
      const user = users.get(id);
      if (!user) return null;
      Object.assign(user, { phone: update.phone });
      return user;
    },
  };
  const verified = new Map();
  const securityRepository = {
    privacyHash() { return 'x'.repeat(64); },
    async issueCredentialSet() {},
    async findActiveSession() { return null; },
    async rotateRefreshToken() { return { status: 'rotated', userId: 1, accessToken: 'unused' }; },
    async revokeToken() { return true; },
    async revokeUserSessions() {},
    async upsertEmailVerification(email, codeHash, expiresAt) { verified.set(email, { codeHash, expiresAt, ok: false }); },
    async verifyEmailCode(email, codeHash) { const row = verified.get(email); if (!row || row.codeHash !== codeHash) return { status: 'invalid' }; row.ok = true; return { status: 'verified' }; },
    async consumeVerifiedEmail(email) { const row = verified.get(email); if (!row?.ok) return false; verified.delete(email); return true; },
    async createPasswordResetChallenge() {},
    async resetPasswordWithChallenge() { return { status: 'invalid' }; },
    async recordIpLoginAttempt() { return true; },
    async beginAccountLoginAttempt() { return true; },
    async failAccountLoginAttempt() { return { failures: 1, notifyLockout: false }; },
    async succeedAccountLoginAttempt() {},
    async releaseAccountLoginAttempt() {},
    async resetAccountLoginSecurity() {},
    async listActiveMemberships() { return []; },
    async findActiveMembership() { return null; },
    async listDrugstoreMemberships() { return []; },
    async upsertMembership() { return { status: 'ok' }; },
    async createPartnerAccount() { return { status: 'ok', userId: 1 }; },
    async deactivateMembership() { return true; },
  };
  let token = 0;
  const auth = {
    async issueCredentials() { return { accessToken: `access-${++token}`, refreshToken: `refresh-${token}` }; },
    async rotateRefresh() { return { status: 'rotated', accessToken: `access-${++token}`, refreshToken: `refresh-${token}` }; },
    async revokeRawToken() { return true; },
    async revokeUserSessions() {},
  };
  const identity = createIdentityService({
    repository,
    securityRepository,
    auth,
    hashPassword: async (value) => `hash:${value}`,
    sendVerificationEmail: async (_email, code) => ({ devMode: true, devCode: code }),
    createCode: () => '123456',
  });

  const sent = await identity.sendOtp({ email: 'user@example.com' });
  assert.equal(sent.status, 200);
  assert.equal((await identity.verifyOtp({ email: 'user@example.com', code: '000000' })).status, 400);
  assert.equal((await identity.verifyOtp({ email: 'user@example.com', code: '123456' })).status, 200);
  const registered = await identity.register({ fullName: 'Test User', email: 'user@example.com', password: 'secret1' });
  assert.equal(registered.status, 201);
  assert.equal(users.get(1).password, 'hash:secret1');
  assert.equal((await identity.getProfile(1)).body.email, 'user@example.com');
  assert.equal((await identity.updateProfile(1, { phone: '0917' })).body.phone, '0917');
  const refreshed = await identity.refresh({ refreshToken: registered.body.refreshToken });
  assert.equal(refreshed.status, 200);
  assert.notEqual(refreshed.body.refreshToken, registered.body.refreshToken);
  assert.equal((await identity.logout({ refreshToken: refreshed.body.refreshToken })).status, 200);
});
