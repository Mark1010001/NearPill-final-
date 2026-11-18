import { createHash, randomInt } from 'node:crypto';

export const OTP_TTL_MS = 10 * 60 * 1000;

export function createOtpCode() {
  return String(randomInt(100000, 1000000));
}

export function hashOtp(email, code) {
  return createHash('sha256')
    .update(`${email}:${code}`)
    .digest('hex');
}

export function otpIsExpired(record, now = Date.now()) {
  return !record || now > record.expiresAt;
}
