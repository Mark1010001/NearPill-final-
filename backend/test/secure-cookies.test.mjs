import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthService, useSecureCookies } from '../src/application/auth-service.js';

test('session cookies are Secure on production and on any https deployment, such as Render staging', () => {
  assert.equal(useSecureCookies('production', undefined), true);
  assert.equal(useSecureCookies('staging', 'https://nearpill.xyz'), true);
  assert.equal(useSecureCookies('staging', ' HTTPS://nearpill.xyz '), true);
  assert.equal(useSecureCookies('staging', 'http://localhost:3001'), false);
  assert.equal(useSecureCookies('development', 'http://127.0.0.1:5173'), false);
  assert.equal(useSecureCookies('staging', undefined), false);
});

test('a staging deployment reached over https issues __Host- Secure HttpOnly cookies', async () => {
  const names = ['privacyHash','issueCredentialSet','findActiveSession','rotateRefreshToken','revokeToken','revokeUserSessions','upsertEmailVerification','verifyEmailCode','consumeVerifiedEmail','createPasswordResetChallenge','resetPasswordWithChallenge','recordIpLoginAttempt','beginAccountLoginAttempt','failAccountLoginAttempt','succeedAccountLoginAttempt','releaseAccountLoginAttempt','resetAccountLoginSecurity','listActiveMemberships','findActiveMembership','listDrugstoreMemberships','upsertMembership','createPartnerAccount','deactivateMembership'];
  const repository = Object.fromEntries(names.map((name) => [name, async () => true]));
  const auth = createAuthService({ repository, production: useSecureCookies('staging', 'https://nearpill.xyz') });
  const issued = await auth.issueCredentials(1, { includeWeb: true });
  const [session, csrf] = auth.webSessionCookieHeaders(issued.webSessionToken, issued.csrfToken);
  assert.match(session, /^__Host-nearpill_session=/);
  assert.match(session, /; Secure/);
  assert.match(session, /HttpOnly/);
  assert.match(csrf, /; Secure/);
});
