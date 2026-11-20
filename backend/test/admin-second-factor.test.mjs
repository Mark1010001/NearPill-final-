import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminSecondFactor } from '../src/application/admin-second-factor.js';
import { createLoginService } from '../src/application/login-service.js';
import { hashOtp } from '../src/domain/identity/otp.js';
import { LoginSchema } from '../src/http/contracts.ts';
import { hashPassword } from '../passwords.js';

function memoryCodes() {
  const rows = new Map();
  return {
    rows,
    async upsertEmailVerification(key, codeHash, expiresAt) { rows.set(key, { codeHash, expiresAt, attempts: 0, verified: false }); },
    async verifyEmailCode(key, codeHash) {
      const row = rows.get(key);
      if (!row) return { status: 'missing' };
      if (row.codeHash !== codeHash) { row.attempts += 1; if (row.attempts >= 5) rows.delete(key); return { status: row.attempts >= 5 ? 'locked' : 'invalid' }; }
      row.verified = true; return { status: 'verified' };
    },
    async consumeVerifiedEmail(key) { const row = rows.get(key); if (row?.verified) { rows.delete(key); return true; } return false; },
  };
}

async function setup({ role = 'admin', enabled = true, sendFails = false } = {}) {
  const codes = memoryCodes();
  const sent = [];
  const password = 'Sunrise2026ok';
  const user = { id: 3, name: 'Boss', email: 'boss@nearpill.xyz', role, password: await hashPassword(password) };
  const secondFactor = createAdminSecondFactor({
    securityRepository: codes, enabled, createCode: () => '123456',
    sendCodeEmail: async (to, code) => { if (sendFails) throw new Error('mail down'); sent.push({ to, code }); },
  });
  const events = { failed: 0, succeeded: 0, released: 0 };
  const login = createLoginService({
    repository: { findAuthUserByEmail: async () => user, replacePasswordIfCurrent: async () => 1 },
    auth: { issueCredentials: async () => ({ accessToken: 'a', refreshToken: 'r', csrfToken: 'c', webSessionToken: 'w' }), webSessionCookieHeaders: () => ['cookie'] },
    security: {
      begin: async () => ({}), fail: async () => { events.failed += 1; return { notifyLockout: false }; },
      succeed: async () => { events.succeeded += 1; return true; }, release: async () => { events.released += 1; },
    },
    recovery: { notify: async () => {} },
    secondFactor,
  });
  return { login, codes, sent, events, password };
}

test('an administrator with the right password gets a code by email and no session yet', async () => {
  const { login, sent, events, password } = await setup();
  const first = await login.login({ email: 'boss@nearpill.xyz', password });
  assert.equal(first.result.status, 200);
  assert.equal(first.result.body.verificationRequired, true);
  assert.equal(first.result.body.accessToken, undefined);
  assert.deepEqual(first.setCookies, []);
  assert.deepEqual(sent, [{ to: 'boss@nearpill.xyz', code: '123456' }]);
  assert.equal(events.succeeded, 0, 'lockout counters are not reset until the whole sign-in succeeds');
});

test('the right code finishes the sign-in once; reusing it fails', async () => {
  const { login, password, events } = await setup();
  await login.login({ email: 'boss@nearpill.xyz', password });
  const done = await login.login({ email: 'boss@nearpill.xyz', password, code: '123456' });
  assert.equal(done.result.status, 200);
  assert.equal(done.result.body.accessToken, 'a');
  assert.equal(done.result.body.user.role, 'admin');
  assert.deepEqual(done.setCookies, ['cookie']);
  assert.equal(events.succeeded, 1);
  const replay = await login.login({ email: 'boss@nearpill.xyz', password, code: '123456' });
  assert.equal(replay.result.status, 401, 'the code works once');
});

test('a wrong code, a missing request, or a wrong password never signs an administrator in', async () => {
  const { login, password, events } = await setup();
  await login.login({ email: 'boss@nearpill.xyz', password });
  const wrong = await login.login({ email: 'boss@nearpill.xyz', password, code: '000000' });
  assert.equal(wrong.result.status, 401);
  assert.equal(events.failed, 1, 'a wrong code counts like a wrong password');
  const badPassword = await login.login({ email: 'boss@nearpill.xyz', password: 'Wrong2026pass', code: '123456' });
  assert.equal(badPassword.result.status, 401);
  const neverRequested = (await setup()).login;
  assert.equal((await neverRequested.login({ email: 'boss@nearpill.xyz', password, code: '123456' })).result.status, 401);
});

test('five wrong codes delete the code, so even the real code stops working', async () => {
  const { login, password } = await setup();
  await login.login({ email: 'boss@nearpill.xyz', password });
  for (let i = 0; i < 5; i += 1) await login.login({ email: 'boss@nearpill.xyz', password, code: '999999' });
  assert.equal((await login.login({ email: 'boss@nearpill.xyz', password, code: '123456' })).result.status, 401);
});

test('customers and partners sign in with just a password, and the switch can be turned off', async () => {
  for (const options of [{ role: 'customer' }, { role: 'partner' }, { role: 'admin', enabled: false }]) {
    const { login, password, sent } = await setup(options);
    const result = await login.login({ email: 'boss@nearpill.xyz', password });
    assert.equal(result.result.body.accessToken, 'a', JSON.stringify(options));
    assert.equal(sent.length, 0);
  }
});

test('if the code email cannot be sent the administrator is told, and nothing is signed in', async () => {
  const { login, password } = await setup({ sendFails: true });
  const originalError = console.error; console.error = () => {};
  try {
    const result = await login.login({ email: 'boss@nearpill.xyz', password });
    assert.equal(result.result.status, 503);
    assert.deepEqual(result.setCookies, []);
  } finally { console.error = originalError; }
});

test('codes live under an admin-only key that the public sign-up code endpoints cannot reach', async () => {
  const { login, codes, password } = await setup();
  await login.login({ email: 'boss@nearpill.xyz', password });
  assert.deepEqual([...codes.rows.keys()], ['admin:boss@nearpill.xyz']);
  assert.notEqual(codes.rows.get('admin:boss@nearpill.xyz').codeHash, hashOtp('boss@nearpill.xyz', '123456'));
});

test('the login request accepts an optional 6-digit code and nothing else extra', () => {
  assert.equal(LoginSchema.safeParse({ email: 'a@b.ph', password: 'Sunrise2026ok', code: '123456' }).success, true);
  assert.equal(LoginSchema.safeParse({ email: 'a@b.ph', password: 'Sunrise2026ok' }).success, true);
  assert.equal(LoginSchema.safeParse({ email: 'a@b.ph', password: 'Sunrise2026ok', code: '12345' }).success, false);
  assert.equal(LoginSchema.safeParse({ email: 'a@b.ph', password: 'Sunrise2026ok', code: 'abcdef' }).success, false);
  assert.equal(LoginSchema.safeParse({ email: 'a@b.ph', password: 'Sunrise2026ok', extra: 1 }).success, false);
});
