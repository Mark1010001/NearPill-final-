import { OTP_TTL_MS, createOtpCode, hashOtp } from '../domain/identity/otp.js';

// A second step for administrator sign-in: after the password is right, a 6-digit code is emailed and must be entered.
// It reuses the email-code storage that sign-up uses (5 wrong tries delete the code, 10 minute life, stored only as a
// hash). The storage key is "admin:<email>", which is not a valid email, so the public sign-up code endpoints can never
// read, verify or consume an administrator's code, and an administrator's code can never create an account.
const prefix = 'admin:';

export function createAdminSecondFactor({ securityRepository, sendCodeEmail, enabled = true, now = Date.now, createCode = createOtpCode }) {
  if (typeof securityRepository?.upsertEmailVerification !== 'function' || typeof securityRepository?.verifyEmailCode !== 'function' ||
      typeof securityRepository?.consumeVerifiedEmail !== 'function') {
    throw new TypeError('Security repository with email code storage is required.');
  }
  if (typeof sendCodeEmail !== 'function') throw new TypeError('sendCodeEmail is required.');
  const keyFor = (email) => {
    const key = `${prefix}${String(email).trim().toLowerCase()}`;
    if (key.length > 254) throw new Error('Email address is too long for a sign-in code.');
    return key;
  };
  return Object.freeze({
    required(user) { return enabled && user?.role === 'admin'; },
    async send(user) {
      const key = keyFor(user.email);
      const code = createCode();
      await securityRepository.upsertEmailVerification(key, hashOtp(key, code), now() + OTP_TTL_MS);
      await sendCodeEmail(user.email, code);
    },
    async verify(user, code) {
      const key = keyFor(user.email);
      const result = await securityRepository.verifyEmailCode(key, hashOtp(key, String(code ?? '')));
      if (result.status !== 'verified') return false;
      // One use only: remove the verified code so it cannot be replayed.
      return securityRepository.consumeVerifiedEmail(key);
    },
  });
}
