import assert from 'node:assert/strict';
import test from 'node:test';

import { createIdentityService } from '../src/application/identity-service.js';
import { RegisterSchema, SendOtpSchema, VerifyOtpSchema } from '../src/http/contracts.ts';
import {
  passwordMatchesIdentity, validSignupEmail, validSignupPassword,
} from '../src/domain/identity/input-policy.js';

test('sign-up emails need a real-looking domain and may not be throwaway mailboxes', () => {
  for (const good of ['ana@example.com', 'Ana.Cruz+shop@mail.example.ph']) assert.equal(validSignupEmail(good), true, good);
  for (const bad of ['ana@example', 'ana@@example.com', 'ana@example..com', 'ana@-example.com', 'ana@example.c',
    'ana@example.123', 'ana @example.com', '@example.com', 'ana@mailinator.com', 'ana@Yopmail.com',
    `ana@${'a'.repeat(64)}.com`]) assert.equal(validSignupEmail(bad), false, bad);
});

test('new passwords need 10+ characters with a letter and a number, and are not common or the identity', () => {
  for (const good of ['Strong1!pass', 'correct horse 9 battery']) assert.equal(validSignupPassword(good), true, good);
  for (const bad of ['short1', 'allletterspassword', '1234567890123', 'Password123', 'x'.repeat(129)]) assert.equal(validSignupPassword(bad), false, bad);
  assert.equal(passwordMatchesIdentity('ana.cruz@example.com', { email: 'ana.cruz@example.com', name: 'Ana' }), true);
  assert.equal(passwordMatchesIdentity('ana.cruz', { email: 'ana.cruz@example.com', name: 'Ana' }), true);
  assert.equal(passwordMatchesIdentity('Ana Maria Cruz', { email: 'a@example.com', name: 'ana maria cruz' }), true);
  assert.equal(passwordMatchesIdentity('Strong1!pass', { email: 'ana@example.com', name: 'Ana' }), false);
});

test('the sign-up request needs accepted terms and refuses a password that is the email or name', () => {
  const base = { fullName: 'Ana Cruz', email: ' Ana@Example.com ', password: 'Strong1!pass', acceptedTerms: true };
  const ok = RegisterSchema.safeParse(base);
  assert.equal(ok.success, true);
  assert.equal(ok.data.email, 'ana@example.com');
  assert.equal(RegisterSchema.safeParse({ ...base, acceptedTerms: false }).success, false);
  const { acceptedTerms, ...withoutTerms } = base;
  void acceptedTerms;
  assert.equal(RegisterSchema.safeParse(withoutTerms).success, false);
  assert.equal(RegisterSchema.safeParse({ ...base, password: 'Ana Cruz 12' }).success, true);
  assert.equal(RegisterSchema.safeParse({ ...base, fullName: 'ana.example123', email: 'ana.example123@example.com', password: 'ana.example123@example.com' }).success, false);
  assert.equal(SendOtpSchema.safeParse({ email: 'x@mailinator.com' }).success, false);
  assert.equal(SendOtpSchema.safeParse({ email: 'x@example.com' }).success, true);
  assert.equal(VerifyOtpSchema.safeParse({ email: 'x@example.com', code: '12345' }).success, false);
});

function harness({ existing = false, limits = null, devMode = false } = {}) {
  const log = [];
  const challenge = { code: null, verified: false, attempts: 0 };
  const repository = {
    async findIdByEmail() { return existing ? 5 : null; },
    async createCustomer(input) { log.push(['create', input]); return 9; },
    async findAuthUserByEmail() {}, async replacePasswordIfCurrent() {}, async replacePassword() {}, async findRecoveryAccountByEmail() {},
    async findProfileById() {}, async findAuthorizationUserById() {}, async updateProfile() {},
  };
  const securityRepository = new Proxy({
    async upsertEmailVerification(email, hash) { challenge.code = hash; challenge.verified = false; challenge.attempts = 0; },
    async verifyEmailCode(email, hash) {
      if (!challenge.code) return { status: 'missing' };
      if (hash !== challenge.code) {
        challenge.attempts += 1;
        return challenge.attempts >= 5 ? { status: 'locked' } : { status: 'invalid', attemptsLeft: 5 - challenge.attempts };
      }
      challenge.verified = true; return { status: 'verified' };
    },
    async consumeVerifiedEmail() { const ok = challenge.verified; challenge.verified = false; return ok; },
  }, { get: (target, name) => target[name] ?? (async () => null) });
  let sentCode;
  const service = createIdentityService({
    repository, securityRepository,
    auth: { async issueCredentials() { return { accessToken: 'a', refreshToken: 'r' }; } },
    hashPassword: async (value) => `hash:${value}`,
    createCode: () => '123456',
    sendVerificationEmail: async (email, code) => { sentCode = code; log.push(['send', email]); return devMode ? { devMode: true, devCode: code } : { sent: true }; },
    sendExistingAccountNotice: async (email) => { log.push(['notice', email]); },
    signupLimits: limits,
  });
  return { service, log, sentCode: () => sentCode };
}

const signup = { fullName: 'Ana Cruz', email: 'ana@example.com', password: 'Strong1!pass' };

test('an account cannot be created without a verified code, and a verified email works only once', async () => {
  const { service, log } = harness();
  assert.equal((await service.register(signup)).status, 403);
  await service.sendOtp({ email: signup.email });
  assert.equal((await service.register(signup)).status, 403);
  assert.equal((await service.verifyOtp({ email: signup.email, code: '123456' })).status, 200);
  const created = await service.register(signup);
  assert.equal(created.status, 201);
  assert.equal(log.find((entry) => entry[0] === 'create')[1].termsVersion.length > 0, true);
  assert.equal((await service.register(signup)).status, 403);
});

test('wrong codes count down, lock after five and a new code must be requested', async () => {
  const { service } = harness();
  await service.sendOtp({ email: signup.email });
  const first = await service.verifyOtp({ email: signup.email, code: '000000' });
  assert.equal(first.status, 400);
  assert.match(first.body?.error ?? first.error, /Wrong code, 4 tries left\./);
  for (let i = 0; i < 3; i += 1) await service.verifyOtp({ email: signup.email, code: '000000' });
  const locked = await service.verifyOtp({ email: signup.email, code: '000000' });
  assert.match(locked.body?.error ?? locked.error, /Too many wrong codes/);
});

test('the send-code answer is the same whether or not the email already has an account', async () => {
  const fresh = harness();
  const taken = harness({ existing: true });
  const a = await fresh.service.sendOtp({ email: signup.email });
  const b = await taken.service.sendOtp({ email: signup.email });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.deepEqual(a.body ?? a.data, b.body ?? b.data);
  assert.deepEqual(fresh.log.map((e) => e[0]), ['send']);
  assert.deepEqual(taken.log.map((e) => e[0]), ['notice']);
  assert.equal(taken.sentCode(), undefined);
});

test('a code is never returned to the caller unless the local test mode is on', async () => {
  const production = await harness().service.sendOtp({ email: signup.email });
  assert.equal(JSON.stringify(production).includes('123456'), false);
  const local = await harness({ devMode: true }).service.sendOtp({ email: signup.email });
  assert.equal(JSON.stringify(local).includes('123456'), true);
});

test('code sending, checking and sign-up are rate limited with a plain wait message', async () => {
  const seen = [];
  const limits = { async recordThrottle(scope, key, windowSeconds, max) {
    seen.push(scope);
    return scope === 'otp_send_email_burst' ? { allowed: false, retryAfterSeconds: 20 }
      : scope === 'otp_verify_email' ? { allowed: false, retryAfterSeconds: 600 }
        : scope === 'register_ip' ? { allowed: false, retryAfterSeconds: 3000 } : { allowed: true, retryAfterSeconds: 0 };
  } };
  const { service, log } = harness({ limits });
  const send = await service.sendOtp({ email: signup.email }, { ip: '1.2.3.4' });
  assert.equal(send.status, 429);
  assert.deepEqual(log, []);
  const verify = await service.verifyOtp({ email: signup.email, code: '123456' }, { ip: '1.2.3.4' });
  assert.equal(verify.status, 429);
  assert.match(verify.body?.error ?? verify.error, /Try again in 10 minutes/);
  assert.equal((await service.register(signup, { ip: '1.2.3.4' })).status, 429);
  assert.deepEqual([...new Set(seen)].sort(), ['otp_send_email_burst', 'otp_send_ip', 'otp_verify_email', 'otp_verify_ip', 'register_ip']);
});

test('the hidden field or an instant submit fails like any other refused sign-up, even with a verified code', async () => {
  const { service, log } = harness();
  await service.sendOtp({ email: signup.email });
  await service.verifyOtp({ email: signup.email, code: '123456' });
  assert.equal((await service.register({ ...signup, company: 'Acme' })).status, 400);
  assert.equal((await service.register({ ...signup, formMs: 500 })).status, 400);
  assert.equal(log.some((entry) => entry[0] === 'create'), false);
  assert.equal((await service.register({ ...signup, company: '', formMs: 4000 })).status, 201);
});

test('sign-up audit lines hash the email and never include codes or passwords', async () => {
  const lines = [];
  const original = console.info;
  console.info = (...args) => lines.push(JSON.stringify(args));
  try {
    const { service } = harness();
    await service.sendOtp({ email: signup.email });
    await service.verifyOtp({ email: signup.email, code: '123456' });
    await service.register(signup);
  } finally { console.info = original; }
  const text = lines.join('\n');
  assert.match(text, /code_sent/);
  assert.match(text, /account_created/);
  for (const secret of ['ana@example.com', '123456', 'Strong1!pass']) assert.equal(text.includes(secret), false, secret);
});
