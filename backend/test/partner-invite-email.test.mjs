import assert from 'node:assert/strict';
import test from 'node:test';
import { createPasswordRecoveryService } from '../src/application/password-recovery-service.js';

test('the partner invitation links to the portal and a single-use password link valid for 3 days, with no password in it', async () => {
  const challenges = [];
  const mails = [];
  const now = 1_700_000_000_000;
  const service = createPasswordRecoveryService({
    repository: {},
    securityRepository: { createPasswordResetChallenge: async (challenge) => { challenges.push(challenge); } },
    security: {},
    sendEmail: async (to, subject, text) => { mails.push({ to, subject, text }); },
    publicUrl: 'https://nearpill.xyz',
    now: () => now,
  });
  await service.invite({ id: 77, email: 'Owner@Pharmacy.PH' });
  assert.equal(challenges.length, 1);
  assert.equal(challenges[0].userId, 77);
  assert.equal(challenges[0].email, 'owner@pharmacy.ph');
  assert.equal(challenges[0].expiresAt, now + 3 * 24 * 60 * 60_000);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'Owner@Pharmacy.PH');
  assert.match(mails[0].text, /https:\/\/nearpill\.xyz\/portal/);
  assert.match(mails[0].text, /https:\/\/nearpill\.xyz\/reset-password#token=[0-9a-f]{64}/);
  assert.match(mails[0].text, /expires in 3 days/);
  assert.equal(/password:/i.test(mails[0].text), false);
  assert.notEqual(challenges[0].tokenHash, mails[0].text.match(/token=([0-9a-f]{64})/)[1], 'only the hash is stored');
});
