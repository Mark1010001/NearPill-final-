import { blockedEmailDomains } from './blocked-email-domains.js';
import { commonPasswords } from './common-passwords.js';

export const invalidInputMessage = 'Invalid request. Please check your details and try again.';

export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export function validEmail(value) {
  if (typeof value !== 'string') return false;
  const email = value.trim();
  if (email.length > 254) return false;
  const [local] = email.split('@');
  if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return false;
  }
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(email);
}

export function validFullName(value) {
  if (typeof value !== 'string') return false;
  const name = value.trim();
  return name.length >= 1 && name.length <= 100 && /\p{L}/u.test(name) &&
    /^[\p{L}\p{M}\p{N}\p{Zs}'\u2019.,()_-]+$/u.test(name);
}

export const signupPasswordMessage = 'Use at least 10 characters with a letter and a number.';

/** New passwords: 10-128 characters, at least one letter and one number, and not a common password. */
export function validSignupPassword(value) {
  return typeof value === 'string' && value.length >= 10 && value.length <= 128 &&
    /\p{L}/u.test(value) && /\p{N}/u.test(value) && !commonPasswords.has(value.toLowerCase());
}

/** The password may not be the email address (or its name part) or the person's name. */
export function passwordMatchesIdentity(password, { email, name } = {}) {
  const lower = String(password ?? '').trim().toLowerCase();
  if (!lower) return false;
  const address = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const local = address.split('@')[0];
  const person = typeof name === 'string' ? name.trim().toLowerCase() : '';
  return lower === address || (local.length >= 6 && lower === local) || (person.length >= 6 && lower === person);
}

/** Sign-up only: a well-formed address with a real-looking domain that is not a throwaway mailbox. */
export function validSignupEmail(value) {
  if (!validEmail(value)) return false;
  const domain = value.trim().toLowerCase().split('@')[1] ?? '';
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some((label) => label.length === 0 || label.length > 63)) return false;
  if (!/^[a-z]{2,24}$/.test(labels.at(-1))) return false;
  return !blockedEmailDomains.has(domain);
}

export function validLoginPassword(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 255;
}
