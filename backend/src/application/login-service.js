import { loginError } from './durable-login-security.js';
import { failure, success } from './result.js';
import { hashPassword, passwordFormat, verifyPassword } from '../../passwords.js';
import { validSignupPassword } from '../domain/identity/input-policy.js';

export function createLoginService({
  repository, auth, security, recovery, secondFactor,
}) {
  if (!repository) throw new TypeError('Identity repository is required.');
  if (!auth || typeof auth.issueCredentials !== 'function') throw new TypeError('Auth service is required.');
  if (!security || typeof security.begin !== 'function') throw new TypeError('Login security is required.');

  return Object.freeze({
    async login({ email, password, code }) {
      const state = await security.begin(email);
      if (!state) return { result: failure(401, loginError), setCookies: [] };

      try {
        const user = await repository.findAuthUserByEmail(email);
        if (!await verifyPassword(password, user?.password)) {
          const failed = await security.fail(email, state);
          if (failed.notifyLockout && user) {
            void recovery.notify(user, true).catch(() => console.error('lockout_notification_failed'));
          }
          return { result: failure(401, loginError), setCookies: [] };
        }

        let verifiedPasswordHash = user.password;
        if (passwordFormat(user.password) !== 'argon2id') {
          const encoded = await hashPassword(password);
          const affectedRows = await repository.replacePasswordIfCurrent({
            userId: user.id,
            newPasswordHash: encoded,
            currentPasswordHash: user.password,
          });
          if (affectedRows !== 1) return { result: failure(401, loginError), setCookies: [] };
          verifiedPasswordHash = encoded;
        }

        // Administrators must also enter a code that was emailed to them. The first call (no code) sends it and signs
        // nobody in; the second call repeats the password with the code. Nothing here resets the lockout counters
        // until the whole sign-in succeeds, and a wrong code counts like a wrong password.
        if (secondFactor?.required(user)) {
          if (!code) {
            try { await secondFactor.send(user); } catch {
              console.error('admin_second_factor_send_failed');
              return { result: failure(503, 'The sign-in code could not be sent. Try again in a moment.'), setCookies: [] };
            }
            return {
              result: success({ verificationRequired: true, message: 'We emailed a 6-digit sign-in code to your address. Enter it to finish signing in.' }),
              setCookies: [],
            };
          }
          if (!await secondFactor.verify(user, code)) {
            const failed = await security.fail(email, state);
            if (failed.notifyLockout) void recovery.notify(user, true).catch(() => console.error('lockout_notification_failed'));
            return { result: failure(401, 'That code is wrong or has expired. Sign in again to get a new one.'), setCookies: [] };
          }
        }

        if (!await security.succeed(email, state)) {
          return { result: failure(401, loginError), setCookies: [] };
        }

        const credentials = await auth.issueCredentials(Number(user.id), { includeWeb: true, verifiedPasswordHash });
        if (!credentials) return { result: failure(401, loginError), setCookies: [] };
        return {
          result: success({
            accessToken: credentials.accessToken,
            refreshToken: credentials.refreshToken,
            csrfToken: credentials.csrfToken,
            user: { id: String(user.id), fullName: user.name, email: user.email, role: user.role },
            // Older accounts may predate the current password rules; clients can suggest a change.
            passwordNeedsUpdate: !validSignupPassword(password),
          }),
          setCookies: auth.webSessionCookieHeaders(credentials.webSessionToken, credentials.csrfToken),
        };
      } catch (error) {
        console.error('login_failed', { code: error.code });
        return { result: failure(500, loginError), setCookies: [] };
      } finally {
        await security.release(email, state).catch(() => {});
      }
    },
  });
}
