import { runWithDatabaseActor, setCurrentDatabaseActor } from '../infrastructure/postgres/context.js';
import { actorHasPermission } from '../domain/identity/permissions.js';
import { isIP } from 'node:net';

export function requestEnvelope(c: any) {
  return {
    method: c.req.method,
    headers: {
      authorization: c.req.header('authorization') || '',
      cookie: c.req.header('cookie') || '',
      'x-csrf-token': c.req.header('x-csrf-token') || '',
    },
  };
}

// Normalization is deliberately narrow. Do not accept hostnames, IP ranges,
// non-canonical IPv4 spellings or an arbitrary header-provided client key.
function validSocketIp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const ip = value.trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
  if (mapped && isIP(mapped) === 4) return mapped;
  return isIP(ip) ? ip : null;
}

export function clientIp(c: any) {
  const remote = validSocketIp(c.env?.incoming?.socket?.remoteAddress);
  // A forwarded address is an untrusted assertion unless the *socket peer*
  // is an explicitly configured trusted proxy, never an entire private subnet.
  const trustedProxyIps = c.get?.('trustedProxyIps');
  if (remote && trustedProxyIps instanceof Set && trustedProxyIps.has(remote)) {
    const raw = c.req.header('x-forwarded-for');
    // Our reviewed NGINX overwrites XFF with exactly one address. A comma
    // chain, malformed address or missing header must fail closed to the peer.
    if (typeof raw === 'string' && !raw.includes(',')) {
      const forwarded = validSocketIp(raw);
      if (forwarded) return forwarded;
    }
  }
  return remote || 'unknown';
}

export async function requestContext(_c: any, next: () => Promise<void>) {
  return runWithDatabaseActor({ role: 'anonymous' }, next);
}

export async function authenticateContext(c: any, auth: any) {
  const session = await auth.authenticate(requestEnvelope(c));
  if (!session) return { ok: false, status: 401, body: { error: 'Unauthorized.' } };
  if (!auth.csrfAccepted(requestEnvelope(c), session)) {
    return { ok: false, status: 403, body: { error: 'Invalid CSRF token.' } };
  }

  const userId = Number(session.userId);
  c.set('authUserId', userId);
  c.set('authUser', session.user);
  c.set('authMemberships', session.memberships || []);
  c.set('authSession', session);
  setCurrentDatabaseActor({ userId, role: session.user.role });
  return { ok: true, session };
}

export function adminAccepted(c: any) {
  const actor = { ...c.get('authUser'), memberships: c.get('authMemberships') || [] };
  return actorHasPermission(actor, 'admin:access');
}

export async function parseBody(c: any, schema: any, byteLimit = 64 * 1024) {
  let text: string;
  try {
    text = await c.req.text();
  } catch {
    // Interrupted or corrupt request streams are invalid client input, not
    // unhandled application exceptions. Never disclose stream error details.
    return { ok: false, status: 400, body: { error: 'Invalid JSON request body.' } };
  }
  if (Buffer.byteLength(text, 'utf8') > byteLimit) {
    return { ok: false, status: 413, body: { error: 'Request body is too large.' } };
  }
  let value: unknown;
  try {
    value = text ? JSON.parse(text) : {};
  } catch {
    return { ok: false, status: 400, body: { error: 'Invalid JSON request body.' } };
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) return { ok: false, status: 400, body: { error: 'Invalid request. Please check your details and try again.' } };
  return { ok: true, data: parsed.data };
}

export function parseValue(schema: any, value: unknown) {
  if (!schema) return { ok: true, data: value };
  const parsed = schema.safeParse(value);
  if (!parsed.success) return { ok: false, status: 400, body: { error: 'Invalid request. Please check your details and try again.' } };
  return { ok: true, data: parsed.data };
}

export function sendOutcome(c: any, outcome: any) {
  const wrapped = outcome?.result ? outcome : { result: outcome, setCookies: [] };
  const response = c.json(wrapped.result.body, wrapped.result.status);
  for (const cookie of wrapped.setCookies || []) response.headers.append('Set-Cookie', cookie);
  return response;
}
