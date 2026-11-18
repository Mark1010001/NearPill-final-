// Customer-facing wording shared with the Android app (lib/config/service_notices.dart and the screens).
// Keep these strings identical to the app's.
export const paymentNotice = 'GCash is the only payment method. It is currently unavailable. You can review your cart while payment setup is pending.';
export const cancellationNotice = 'Cancellation and refund status are authoritative only after NearPill records provider or approved reconciliation evidence.';
export const policiesLabel = 'Privacy, cancellations and terms';

// Same rules as the server's sign-up email check (letters-only ending, labels up to 63 characters).
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i;
export const emailErrorText = 'Enter a valid email address.';
export function validateEmailAddress(value: string): string | null {
  const email = value.trim();
  const [local = ''] = email.split('@');
  const ok = email.length <= 254 && local.length <= 64 && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..') && EMAIL.test(email);
  return ok ? null : emailErrorText;
}

/** New passwords: same rules as the server (10-128 characters, a letter, a number, not common, not your name or email). */
export const passwordRuleText = 'Use at least 10 characters with a letter and a number.';
const COMMON_PASSWORDS = new Set(['password', 'password1', 'password12', 'password123', 'password1234', 'password12345', 'passw0rd123',
  'qwerty123', 'qwertyuiop', 'qwerty12345', '1234567890', '12345678910', '123456789a', 'abc1234567', 'abcd123456', 'iloveyou123',
  'welcome123', 'welcome1234', 'admin12345', 'letmein1234', 'monkey12345', 'dragon12345', 'football123', 'baseball123', 'superman123',
  'princess123', 'sunshine123', 'nearpill123', 'nearpill1234', 'philippines1', 'cebu123456', 'changeme123', 'default1234',
  'test123456', 'testing1234']);
export function validateNewPassword(password: string, email: string, name: string): string | null {
  if (password.length > 128) return 'Use at most 128 characters.';
  if (password.length < 10 || !/\p{L}/u.test(password) || !/\p{N}/u.test(password)) return passwordRuleText;
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return 'Choose a less common password.';
  const lower = password.trim().toLowerCase();
  const address = email.trim().toLowerCase();
  const local = address.split('@')[0];
  const person = name.trim().toLowerCase();
  if (lower === address || (local.length >= 6 && lower === local) || (person.length >= 6 && lower === person)) {
    return 'Do not use your name or email as your password.';
  }
  return null;
}

/** Mirrors AuthRepository._mapError in the Android app. */
export function authErrorMessage(error: unknown, preferServer = false): string {
  const status = typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status: unknown }).status) : NaN;
  const message = error instanceof Error ? error.message : '';
  if (preferServer && status > 0 && message) return message;
  if (status === 0) return 'Unable to reach the server. Please check your connection and try again.';
  if (status === 401) return 'Unable to sign in. Check your details or try again later.';
  if (status === 400 || status === 413) return 'Please check your details and try again.';
  return 'Something went wrong. Please try again.';
}

/** Same rules as lib/utils/formatters.dart: validateBirthdate. */
export function validateBirthdate(value: string): string | null {
  const date = value.trim();
  if (!date) return 'Enter your birthdate';
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date)) return 'Use MM/DD/YYYY';
  const [month, day, year] = date.split('/').map(Number);
  if (year < 1955) return 'Year must be 1955 or later';
  const birth = new Date(year, month - 1, day);
  if (birth.getMonth() !== month - 1 || birth.getDate() !== day) return 'Invalid birthdate';
  const now = new Date();
  if (birth > new Date(now.getFullYear() - 18, now.getMonth(), now.getDate())) return 'You must be at least 18 years old';
  return null;
}

/** Same as DateTextFormatter: keeps digits, auto-inserts "/" and clamps month/day while typing. */
export function formatBirthdateInput(next: string, previous: string): string {
  if (!/^[0-9/]*$/.test(next)) return previous;
  let text = next.replaceAll('/', '');
  if (text.length > 8) return previous;
  if (next.length < previous.length) return next;
  if (text.length >= 1 && Number(text[0]) > 1) text = `0${text[0]}${text.slice(1)}`;
  if (text.length >= 2) {
    const month = Number(text.slice(0, 2));
    if (month > 12) text = text[0];
    else if (month === 0) text = '01';
  }
  if (text.length >= 3 && Number(text[2]) > 3) text = `${text.slice(0, 2)}0${text.slice(2)}`;
  if (text.length >= 4) {
    const day = Number(text.slice(2, 4));
    if (day > 31) text = text.slice(0, 3);
    else if (day === 0) text = `${text.slice(0, 2)}01${text.slice(4)}`;
  }
  let out = '';
  for (let i = 0; i < text.length; i += 1) { if (i === 2 || i === 4) out += '/'; out += text[i]; }
  return out;
}

export const validatePhone = (value: string) => /^09\d{9}$/.test(value) ? null : 'Enter an 11-digit mobile number starting with 09.';
