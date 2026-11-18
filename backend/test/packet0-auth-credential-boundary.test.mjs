import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuthService } from '../src/application/auth-service.js';
import { hashCredential } from '../src/domain/identity/tokens.js';

// Packet 0 characterization: exercise the actual auth service against a
// recording repository. This does not test PostgreSQL expiry, RLS or grants.
const repositoryMethods = [
  'privacyHash', 'issueCredentialSet', 'findActiveSession', 'rotateRefreshToken',
  'revokeToken', 'revokeUserSessions', 'upsertEmailVerification', 'verifyEmailCode',
  'consumeVerifiedEmail', 'createPasswordResetChallenge',
  'resetPasswordWithChallenge', 'recordIpLoginAttempt', 'beginAccountLoginAttempt',
  'failAccountLoginAttempt', 'succeedAccountLoginAttempt',
  'releaseAccountLoginAttempt', 'resetAccountLoginSecurity',
  'listActiveMemberships', 'findActiveMembership', 'listDrugstoreMemberships',
  'upsertMembership', 'createPartnerAccount', 'deactivateMembership',
];

function recordingSecurityRepository() {
  const sessions = new Map();
  const calls = [];
  const repository = Object.fromEntries(repositoryMethods.map((name) => [name, async () => {
    throw new Error(`Unexpected repository method: ${name}`);
  }]));
  repository.issueCredentialSet = async ({ userId, accessHash, refreshHash, webHash, csrfHash }) => {
    for (const [hash, kind] of [[accessHash, 'access'], [refreshHash, 'refresh'], [webHash, 'web']]) {
      if (hash) sessions.set(hash, { userId, kind, csrfHash, revoked: false });
    }
  };
  repository.findActiveSession = async (hash, allowedKinds) => {
    calls.push({ hash, allowedKinds });
    const record = sessions.get(hash);
    return record && !record.revoked && allowedKinds.includes(record.kind)
      ? { userId: record.userId, csrfHash: record.csrfHash } : null;
  };
  repository.revokeToken = async (hash) => {
    const record = sessions.get(hash);
    if (!record) return false;
    record.revoked = true;
    return true;
  };
  repository.revokeUserSessions = async (userId) => {
    for (const record of sessions.values()) if (record.userId === userId) record.revoked = true;
  };
  return { repository, sessions, calls };
}

function request({ authorization, cookie, method = 'GET', csrf } = {}) {
  return { method, headers: {
    ...(authorization ? { authorization } : {}),
    ...(cookie ? { cookie } : {}),
    ...(csrf ? { 'x-csrf-token': csrf } : {}),
  } };
}

test('mobile bearer, web cookie, and refresh credentials never cross authentication kinds', async () => {
  const { repository, sessions, calls } = recordingSecurityRepository();
  const auth = createAuthService({ repository, production: false });
  const credentials = await auth.issueCredentials(17, { includeWeb: true });
  assert.equal(await auth.authenticate(request({ authorization: `Bearer ${credentials.refreshToken}` })), null);
  assert.equal(await auth.authenticate(request({ authorization: `Bearer ${credentials.webSessionToken}` })), null);
  assert.equal(await auth.authenticate(request({ cookie: `nearpill_session=${credentials.accessToken}` })), null);
  assert.equal(await auth.authenticate(request({ cookie: `nearpill_session=${credentials.refreshToken}` })), null);
  assert.equal((await auth.authenticate(request({ authorization: `Bearer ${credentials.accessToken}` }))).via, 'bearer');
  assert.equal((await auth.authenticate(request({ cookie: `nearpill_session=${credentials.webSessionToken}` }))).via, 'cookie');
  assert.equal(sessions.has(credentials.accessToken), false, 'raw credentials must not be recorded');
  assert.equal(sessions.has(hashCredential(credentials.accessToken)), true);
  assert.deepEqual(calls.slice(0, 2).map(({ allowedKinds }) => allowedKinds), [['access'], ['access']]);
});

test('CSRF credentials are bound to the exact web session for mutations', async () => {
  const { repository } = recordingSecurityRepository();
  const auth = createAuthService({ repository, production: false });
  const first = await auth.issueCredentials(17, { includeWeb: true });
  const second = await auth.issueCredentials(18, { includeWeb: true });
  const web = await auth.authenticate(request({ cookie: `nearpill_session=${first.webSessionToken}` }));
  const bearer = await auth.authenticate(request({ authorization: `Bearer ${first.accessToken}` }));
  assert.equal(auth.csrfAccepted(request({ method: 'POST', csrf: first.csrfToken }), web), true);
  assert.equal(auth.csrfAccepted(request({ method: 'DELETE', csrf: second.csrfToken }), web), false);
  assert.equal(auth.csrfAccepted(request({ method: 'PATCH' }), web), false);
  assert.equal(auth.csrfAccepted(request({ method: 'GET' }), web), true);
  assert.equal(auth.csrfAccepted(request({ method: 'POST' }), bearer), true,
    'bearer requests use Authorization and do not rely on the cookie CSRF token');
});

test('production cookie identity and revocation remain server-owned', async () => {
  const { repository } = recordingSecurityRepository();
  const auth = createAuthService({ repository, production: true });
  const user17 = await auth.issueCredentials(17, { includeWeb: true });
  const user18 = await auth.issueCredentials(18, { includeWeb: true });
  const [sessionCookie, csrfCookie] = auth.webSessionCookieHeaders(user17.webSessionToken, user17.csrfToken);
  assert.match(sessionCookie, /^__Host-nearpill_session=.*; HttpOnly; Path=\/; SameSite=Strict;.*; Secure$/);
  assert.match(csrfCookie, /^nearpill_csrf=.*; Path=\/; SameSite=Strict;.*; Secure$/);
  const token17 = request({ cookie: `__Host-nearpill_session=${user17.webSessionToken}` });
  const token18 = request({ cookie: `__Host-nearpill_session=${user18.webSessionToken}` });
  assert.equal((await auth.authenticate(token17)).userId, 17);
  await auth.revokeUserSessions(17, 'logout_all');
  assert.equal(await auth.authenticate(token17), null);
  assert.equal(await auth.authenticate(request({ authorization: `Bearer ${user17.accessToken}` })), null);
  assert.equal((await auth.authenticate(token18)).userId, 18, 'revoking one user must not revoke another');
});
