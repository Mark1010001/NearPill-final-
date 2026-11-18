import { timingSafeEqual } from 'node:crypto';
import { assertSecurityRepository } from '../ports/security-repository.js';
import {
  ACCESS_TTL_MS,
  REFRESH_TTL_MS,
  WEB_SESSION_TTL_MS,
  hashCredential,
  randomCredential,
  randomFamilyId,
} from '../domain/identity/tokens.js';

function cookieMap(header = '') {
  const values = new Map();
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    try {
      values.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()));
    } catch {
      continue;
    }
  }
  return values;
}

function bearerToken(req) {
  const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function safeHashEqual(raw, expectedHash) {
  if (!raw || !expectedHash) return false;
  const actual = Buffer.from(hashCredential(raw), 'hex');
  const expected = Buffer.from(String(expectedHash), 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createAuthService({ repository, now = Date.now, production = process.env.NODE_ENV === 'production' }) {
  assertSecurityRepository(repository);

  const cookieName = production ? '__Host-nearpill_session' : 'nearpill_session';

  async function issueCredentials(userId, { includeWeb = false, verifiedPasswordHash } = {}) {
    const issuedAt = now();
    const accessToken = randomCredential();
    const refreshToken = randomCredential();
    const webSessionToken = includeWeb ? randomCredential() : null;
    const csrfToken = includeWeb ? randomCredential() : null;
    const familyId = randomFamilyId();
    const issued = await repository.issueCredentialSet({
      userId,
      verifiedPasswordHash,
      familyId,
      accessHash: hashCredential(accessToken),
      refreshHash: hashCredential(refreshToken),
      webHash: webSessionToken ? hashCredential(webSessionToken) : null,
      csrfHash: csrfToken ? hashCredential(csrfToken) : null,
      accessExpiresAt: issuedAt + ACCESS_TTL_MS,
      refreshExpiresAt: issuedAt + REFRESH_TTL_MS,
      webExpiresAt: issuedAt + WEB_SESSION_TTL_MS,
    });
    if (issued === false) return null;
    return { accessToken, refreshToken, webSessionToken, csrfToken };
  }

  function webSessionCookieHeaders(rawToken, csrfToken) {
    const pieces = [
      `${cookieName}=${encodeURIComponent(rawToken)}`,
      'HttpOnly',
      'Path=/',
      'SameSite=Strict',
      `Max-Age=${Math.floor(WEB_SESSION_TTL_MS / 1000)}`,
    ];
    if (production) pieces.push('Secure');
    const csrfPieces = [
      `nearpill_csrf=${encodeURIComponent(csrfToken)}`,
      'Path=/',
      'SameSite=Strict',
      `Max-Age=${Math.floor(WEB_SESSION_TTL_MS / 1000)}`,
    ];
    if (production) csrfPieces.push('Secure');
    return [pieces.join('; '), csrfPieces.join('; ')];
  }

  function clearWebSessionCookieHeaders() {
    const pieces = [`${cookieName}=`, 'HttpOnly', 'Path=/', 'SameSite=Strict', 'Max-Age=0'];
    if (production) pieces.push('Secure');
    const csrfPieces = ['nearpill_csrf=', 'Path=/', 'SameSite=Strict', 'Max-Age=0'];
    if (production) csrfPieces.push('Secure');
    return [pieces.join('; '), csrfPieces.join('; ')];
  }

  async function authenticate(req) {
    const bearer = bearerToken(req);
    if (bearer) {
      const session = await repository.findActiveSession(hashCredential(bearer), ['access']);
      return session ? { ...session, rawToken: bearer, via: 'bearer' } : null;
    }
    const rawCookie = cookieMap(req.headers.cookie).get(cookieName);
    if (!rawCookie) return null;
    const session = await repository.findActiveSession(hashCredential(rawCookie), ['web']);
    return session ? { ...session, rawToken: rawCookie, via: 'cookie' } : null;
  }

  function csrfAccepted(req, session) {
    if (session.via !== 'cookie' || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
    return safeHashEqual(req.headers['x-csrf-token'], session.csrfHash);
  }

  return Object.freeze({
    cookieName,
    issueCredentials,
    webSessionCookieHeaders,
    clearWebSessionCookieHeaders,
    authenticate,
    csrfAccepted,
    bearerToken,
    webCookieToken(req) { return cookieMap(req.headers.cookie).get(cookieName) || null; },
    async rotateRefresh(refreshToken) {
      const raw = String(refreshToken || '').trim();
      if (!raw) return { status: 'invalid' };
      const issuedAt = now();
      const accessToken = randomCredential();
      const nextRefreshToken = randomCredential();
      const result = await repository.rotateRefreshToken({
        tokenHash: hashCredential(raw),
        newAccessHash: hashCredential(accessToken),
        newRefreshHash: hashCredential(nextRefreshToken),
        accessExpiresAt: issuedAt + ACCESS_TTL_MS,
        refreshExpiresAt: issuedAt + REFRESH_TTL_MS,
      });
      return result.status === 'rotated'
        ? { ...result, accessToken, refreshToken: nextRefreshToken }
        : result;
    },
    async revokeRawToken(rawToken, reason = 'logout') {
      const raw = String(rawToken || '').trim();
      if (!raw) return false;
      return repository.revokeToken(hashCredential(raw), reason);
    },
    revokeUserSessions: (userId, reason) => repository.revokeUserSessions(Number(userId), reason),
  });
}
