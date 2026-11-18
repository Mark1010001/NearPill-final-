import test from 'node:test';
import assert from 'node:assert/strict';
import * as email from '../email.js';
import { createIdentityService } from '../src/application/identity-service.js';

const userEmail = 'customer@example.invalid';
const devInbox = 'developer@example.invalid';
const code = '654321';

test('Packet 0 staging OTP: a development inbox override cannot intercept staging verification', () => {
  assert.equal(email.verificationRecipient(userEmail, {
    NODE_ENV: 'staging', DEV_OTP_INBOX: devInbox,
  }), userEmail);
});

test('Packet 0 staging OTP: existing development/test inbox override remains available locally', () => {
  for (const nodeEnv of [undefined, 'development', 'test']) {
    assert.equal(email.verificationRecipient(userEmail, {
      NODE_ENV: nodeEnv, DEV_OTP_INBOX: ` ${devInbox} `,
    }), devInbox);
  }
  assert.equal(email.verificationRecipient(userEmail, {
    NODE_ENV: 'production', DEV_OTP_INBOX: devInbox,
  }), userEmail);
});

test('Packet 0 staging OTP: unavailable delivery never returns a verification code in staging/production', () => {
  assert.equal(typeof email.verificationDeliveryUnavailable, 'function');
  for (const nodeEnv of ['staging', 'production']) {
    const result = email.verificationDeliveryUnavailable(nodeEnv, code);
    assert.deepEqual(result, { sent: false });
    assert.doesNotMatch(JSON.stringify(result), /654321|devCode/);
  }
});

test('Packet 0 staging OTP: local-only delivery fallback remains explicit', () => {
  assert.equal(typeof email.verificationDeliveryUnavailable, 'function');
  for (const nodeEnv of ['development', 'test']) {
    assert.deepEqual(email.verificationDeliveryUnavailable(nodeEnv, code), {
      devMode: true, devCode: code,
    });
  }
});

test('Packet 0 staging OTP: identity response fails closed when delivery cannot run', async () => {
  assert.equal(typeof email.verificationDeliveryUnavailable, 'function');
  const requiredMethods = new Proxy({}, {
    get: (_target, name) => typeof name === 'string' ? async () => null : undefined,
  });
  const identity = createIdentityService({
    repository: requiredMethods,
    securityRepository: requiredMethods,
    auth: { issueCredentials: async () => ({ accessToken: '', refreshToken: '' }) },
    hashPassword: async () => 'unused',
    sendVerificationEmail: async (_address, generatedCode) => email.verificationDeliveryUnavailable('staging', generatedCode),
    createCode: () => code,
  });
  const response = await identity.sendOtp({ email: userEmail });
  assert.equal(response.status, 503);
  assert.doesNotMatch(JSON.stringify(response), /654321|devCode/);
});
