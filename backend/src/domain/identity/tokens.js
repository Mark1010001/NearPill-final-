import { createHash, randomBytes } from 'node:crypto';

export const ACCESS_TTL_MS = 15 * 60_000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;
export const WEB_SESSION_TTL_MS = 8 * 60 * 60_000;

export function randomCredential(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function hashCredential(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function randomFamilyId() {
  return randomBytes(24).toString('hex');
}
