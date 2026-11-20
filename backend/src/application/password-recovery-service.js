import { createHash, randomBytes } from 'node:crypto';
import { hashPassword } from '../../passwords.js';
import { failure, success } from './result.js';

const duration = 15 * 60_000;
const tokenHash = token => createHash('sha256').update(token).digest('hex');
const resetError = 'Unable to reset password. Request a new link or try again later.';

export function createPasswordRecoveryService({
  repository,
  securityRepository,
  security,
  sendEmail,
  publicUrl,
  now = Date.now,
}) {
  if (!repository) throw new TypeError('Identity repository is required.');
  const page = new URL('/reset-password', publicUrl);
  if (!['http:', 'https:'].includes(page.protocol) || page.username || page.password ||
      (process.env.NODE_ENV === 'production' && page.protocol !== 'https:')) {
    throw new Error('PUBLIC_APP_URL must be an HTTPS URL in production.');
  }

  async function notify(user, locked = false) {
    const token = randomBytes(32).toString('hex');
    await securityRepository.createPasswordResetChallenge({
      userId: Number(user.id),
      email: user.email.trim().toLowerCase(),
      tokenHash: tokenHash(token),
      expiresAt: now() + duration,
    });
    const link = new URL(page);
    link.hash = `token=${token}`;
    const intro = locked
      ? 'Repeated unsuccessful sign-in attempts temporarily blocked your NearPill account for 15 minutes.'
      : 'A password reset was requested for your NearPill account.';
    await sendEmail(user.email, 'NearPill account security',
      `${intro}\n\nReset your password using this single-use link, which expires in 15 minutes:\n${link.href}\n\nIf you did not request this, you can ignore this email. Contact nearpillemail.business@gmail.com if you need help.`);
  }

  // A new partner pharmacy login: tells the owner their account exists and lets them choose their own password.
  // The link is single-use like a reset link, but stays valid for 3 days because the owner may not read it at once.
  const inviteDuration = 3 * 24 * 60 * 60_000;
  const portal = new URL('/portal', publicUrl);
  async function invite(user) {
    const token = randomBytes(32).toString('hex');
    await securityRepository.createPasswordResetChallenge({
      userId: Number(user.id),
      email: user.email.trim().toLowerCase(),
      tokenHash: tokenHash(token),
      expiresAt: now() + inviteDuration,
    });
    const link = new URL(page);
    link.hash = `token=${token}`;
    await sendEmail(user.email, 'Your NearPill pharmacy account is ready',
      `A NearPill pharmacy partner account was created for this email address.\n\nSign in to the partner portal: ${portal.href}\n\nTo choose your own password, use this single-use link, which expires in 3 days:\n${link.href}\n\nIf you were not expecting this email, you can ignore it. Contact nearpillemail.business@gmail.com with any questions.`);
  }

  return Object.freeze({
    notify,
    invite,
    async requestReset({ email }) {
      try {
        const user = await repository.findRecoveryAccountByEmail(email);
        if (user) void notify(user).catch(() => console.error('password_recovery_notification_failed'));
      } catch (error) {
        console.error('password_recovery_request_failed', { code: error.code });
      }
      return success({ message: 'If this account can receive email, a reset link will be sent.' });
    },
    async resetPassword({ token, password }) {
      try {
        const encoded = await hashPassword(password);
        const result = await securityRepository.resetPasswordWithChallenge({
          tokenHash: tokenHash(token),
          passwordHash: encoded,
        });
        if (result.status !== 'reset') return failure(400, resetError);
        await security.reset(result.email);
        // Tell the owner their password changed; a failed email never undoes the reset.
        void Promise.resolve(sendEmail(result.email, 'Your NearPill password was changed',
          'The password for your NearPill account was just changed and you were signed out on every device. If this was not you, reset your password again and contact nearpillemail.business@gmail.com.'))
          .catch(() => console.error('password_changed_notification_failed'));
        return success({ message: 'Password updated. You can now sign in with your new password.' });
      } catch (error) {
        console.error('password_reset_failed', { code: error.code });
        return failure(500, resetError);
      }
    },
    close() {},
  });
}
