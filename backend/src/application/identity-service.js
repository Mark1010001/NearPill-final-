import { createHash, randomBytes } from 'node:crypto';
import { accountDeletionMethods, assertIdentityRepository } from '../ports/identity-repository.js';
import { assertSecurityRepository } from '../ports/security-repository.js';
import { OTP_TTL_MS, createOtpCode, hashOtp } from '../domain/identity/otp.js';
import { failure, success } from './result.js';
import { verifyPassword } from '../../passwords.js';
import { TERMS_VERSION } from '../domain/identity/terms.js';

const sentMessage = 'If this email can receive a code, we sent one.';

/** Returns a 429 failure when any named limit is used up, otherwise null. */
async function throttled(limits, checks) {
  if (!limits) return null;
  for (const [scope, key, windowSeconds, max] of checks) {
    const outcome = await limits.recordThrottle(scope, key, windowSeconds, max);
    if (!outcome.allowed) {
      const minutes = Math.max(1, Math.ceil(outcome.retryAfterSeconds / 60));
      return failure(429, outcome.retryAfterSeconds <= 60
        ? 'Please wait a moment before trying again.'
        : `Too many requests. Try again in ${minutes} minutes.`);
    }
  }
  return null;
}

/** Structured sign-up audit line. The email is hashed and no code or password is ever included. */
function audit(event, email, extra = {}) {
  const emailHash = createHash('sha256').update(`audit:${String(email).toLowerCase()}`).digest('hex').slice(0, 16);
  console.info('signup_audit', { event, emailHash, ...extra });
}

function profilePayload(user, memberships = []) {
  return {
    id: String(user.id),
    fullName: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    memberships,
    createdAt: user.created_at,
  };
}

export function createIdentityService({
  repository,
  securityRepository,
  auth,
  hashPassword,
  sendVerificationEmail,
  sendExistingAccountNotice = async () => {},
  signupLimits = null,
  now = Date.now,
  createCode = createOtpCode,
  randomSecret = () => randomBytes(32).toString('base64url'),
}) {
  assertIdentityRepository(repository);
  assertSecurityRepository(securityRepository);
  if (!auth || typeof auth.issueCredentials !== 'function') {
    throw new TypeError('Durable auth service is required.');
  }
  if (typeof hashPassword !== 'function' || typeof sendVerificationEmail !== 'function') {
    throw new TypeError('Identity cryptography and email dependencies are required.');
  }

  return Object.freeze({
    async changePartnerPassword(userId, actor, { currentPassword, password }) {
      if (actor?.role !== 'partner') return failure(403, 'Partner access is required.');
      if (currentPassword === password) return failure(400, 'Choose a different new password.');
      const user = await repository.findAuthUserByEmail(actor.email);
      if (!user || Number(user.id) !== Number(userId) || !(await verifyPassword(currentPassword, user.password))) {
        return failure(400, 'Current password is incorrect.');
      }
      const changed = await securityRepository.changePartnerPassword({
        userId, currentPasswordHash: user.password, passwordHash: await hashPassword(password),
      });
      if (!changed) return failure(409, 'Password changed in another request. Sign in again.');
      return success({ message: 'Password changed. Sign in with your new password.' });
    },
    async register({ fullName, email, password, company, formMs }, { ip = 'unknown' } = {}) {
      const limited = await throttled(signupLimits, [['register_ip', ip, 3600, 10]]);
      if (limited) return limited;
      // Bots fill the hidden field or submit instantly; answer like any other failure.
      if ((typeof company === 'string' && company.trim() !== '') || (typeof formMs === 'number' && formMs < 2000)) {
        audit('account_creation_refused', email, { reason: 'bot_check' });
        return failure(400, 'Could not create your account. Please try again.');
      }
      const existing = await repository.findIdByEmail(email);
      if (existing) {
        audit('account_creation_refused', email, { reason: 'exists' });
        return failure(409, 'An account with this email already exists.');
      }
      if (!(await securityRepository.consumeVerifiedEmail(email))) {
        audit('account_creation_refused', email, { reason: 'unverified' });
        return failure(403, 'Verify your email before creating an account.');
      }
      const passwordHash = await hashPassword(password);
      const userId = await repository.createCustomer({ name: fullName, email, passwordHash, termsVersion: TERMS_VERSION });
      const credentials = await auth.issueCredentials(userId);
      audit('account_created', email);
      return success({
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        user: { id: String(userId), fullName, email, role: 'customer' },
      }, 201);
    },

    async sendOtp({ email }, { ip = 'unknown' } = {}) {
      const limited = await throttled(signupLimits, [
        ['otp_send_ip', ip, 3600, 20],
        ['otp_send_email_burst', email, 30, 1],
        ['otp_send_email', email, 3600, 5],
      ]);
      if (limited) return limited;
      // The answer never reveals whether the email already has an account.
      const existing = await repository.findIdByEmail(email);
      let emailResult;
      if (existing) {
        try { await sendExistingAccountNotice(email); } catch { /* same reply either way */ }
        audit('code_not_sent_existing_account', email);
        emailResult = { devMode: false, sent: true, testInbox: false };
      } else {
        const code = createCode();
        await securityRepository.upsertEmailVerification(email, hashOtp(email, code), now() + OTP_TTL_MS);
        emailResult = await sendVerificationEmail(email, code);
        if (!emailResult.devMode && !emailResult.sent) {
          return failure(503, 'Verification email could not be sent. Please try again later.');
        }
        audit('code_sent', email);
        if (emailResult.devMode) {
          return success({ message: sentMessage, email, devMode: true, testInbox: emailResult.testInbox === true, devCode: emailResult.devCode });
        }
      }
      return success({ message: sentMessage, email, devMode: false, testInbox: emailResult.testInbox === true });
    },

    async verifyOtp({ email, code }, { ip = 'unknown' } = {}) {
      const limited = await throttled(signupLimits, [
        ['otp_verify_ip', ip, 900, 40],
        ['otp_verify_email', email, 900, 10],
      ]);
      if (limited) return limited;
      const result = await securityRepository.verifyEmailCode(email, hashOtp(email, code));
      if (result.status === 'missing') return failure(400, 'No verification code was requested.');
      if (result.status === 'expired') return failure(400, 'Code expired. Request a new code.');
      if (result.status === 'locked') {
        audit('code_locked', email);
        return failure(400, 'Too many wrong codes. Request a new code.');
      }
      if (result.status !== 'verified') {
        const left = Number(result.attemptsLeft);
        return failure(400, Number.isInteger(left) && left > 0
          ? `Wrong code, ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Invalid verification code.');
      }
      audit('code_verified', email);
      return success({ message: 'Email verified successfully.', verified: true });
    },

    async refresh({ refreshToken }) {
      const result = await auth.rotateRefresh(refreshToken);
      if (result.status !== 'rotated') {
        return failure(401, result.status === 'replay'
          ? 'Refresh token replay detected. Sign in again.'
          : 'Invalid or expired refresh token.');
      }
      return success({ accessToken: result.accessToken, refreshToken: result.refreshToken });
    },

    async logout({ refreshToken, bearerToken, cookieToken }) {
      const tokens = [refreshToken, bearerToken, cookieToken].filter(Boolean);
      for (const token of tokens) await auth.revokeRawToken(token, 'logout');
      return success({ message: 'Logged out successfully.' });
    },

    async logoutAll(userId) {
      const numericUserId = Number(userId);
      if (!Number.isInteger(numericUserId) || numericUserId <= 0) return failure(401, 'Unauthorized.');
      await auth.revokeUserSessions(numericUserId, 'logout_all');
      return success({ message: 'All sessions have been revoked.' });
    },

    async getProfile(userId) {
      const numericUserId = Number(userId);
      if (!Number.isFinite(numericUserId)) return failure(401, 'Unauthorized.');
      const user = await repository.findProfileById(numericUserId);
      if (!user) return failure(404, 'User account not found.');
      const memberships = await securityRepository.listActiveMemberships(numericUserId);
      return success(profilePayload(user, memberships));
    },

    /**
     * Deletes a customer's own account by anonymising it: personal details are
     * removed and the sign-in is made unusable, while order and payment records
     * stay (without a name or contact) for the pharmacies and reconciliation.
     */
    async deleteAccount(userId, actor, { password } = {}) {
      const numericUserId = Number(userId);
      if (!Number.isInteger(numericUserId) || numericUserId <= 0) return failure(401, 'Unauthorized.');
      if (actor?.role !== 'customer') return failure(403, 'Only customer accounts can be deleted here.');
      if (!accountDeletionMethods.every((method) => typeof repository[method] === 'function')) {
        return failure(503, 'Account deletion is not available right now. Try again later.');
      }
      const user = await repository.findAuthUserByEmail(actor.email);
      if (!user || Number(user.id) !== numericUserId || user.role !== 'customer') {
        return failure(404, 'User account not found.');
      }

      if (typeof password !== 'string' || password === '') {
        return failure(400, 'Enter your password to delete your account.');
      }
      if (!(await verifyPassword(password, user.password))) return failure(400, 'Password is incorrect.');

      if ((await repository.countOpenOrders(numericUserId)) > 0) {
        return failure(409, 'Finish or cancel your active orders before deleting your account.');
      }
      try {
        await repository.scrubPrescriptionPhotos(numericUserId);
        const changed = await repository.anonymizeCustomer(numericUserId, {
          name: 'Deleted account',
          email: `deleted-${numericUserId}@deleted.invalid`,
          passwordHash: await hashPassword(randomSecret()),
        });
        if (changed !== 1) return failure(404, 'User account not found.');
      } catch (error) {
        console.error('account_delete_failed', { code: error?.code });
        return failure(503, 'Account deletion is not available right now. Try again later.');
      }
      await auth.revokeUserSessions(numericUserId, 'account_deleted');
      return success({ message: 'Your account has been deleted.' });
    },

    async updateProfile(userId, { phone = null }) {
      const numericUserId = Number(userId);
      const user = await repository.updateProfile(numericUserId, { phone });
      if (!user) return failure(404, 'User account not found.');
      const memberships = await securityRepository.listActiveMemberships(numericUserId);
      return success(profilePayload(user, memberships));
    },
  });
}
