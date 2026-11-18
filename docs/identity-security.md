# Identity, sessions, authorization, and pharmacy memberships

NearPill keeps one identity implementation inside the existing backend. The active boundary is:

```text
Express auth/portal request
  -> durable authentication middleware
  -> identity / membership application services
  -> security repository port
  -> PostgreSQL security repository
  -> PostgreSQL 18 RLS-protected identity tables
```

The previous process-local token, verification, password-reset, and login-throttle stores are no longer used by the production runtime. Historical helpers required only by legacy unit fixtures live under `backend/test/support/` and are not imported by the production Hono bootstrap.

## Credentials and session families

The server issues distinct random credentials for three purposes:

- short-lived access credential: 15 minutes;
- single-use rotating refresh credential: 30 days;
- browser session credential: 8 hours.

Only SHA-256 credential digests are persisted. Access and refresh credentials share a server-side family. Successful refresh consumes the presented refresh credential and creates a new access/refresh pair in the same family. Reuse of an already consumed, expired, or revoked refresh credential revokes the complete family.

Password reset and logout-all revoke all active session families and browser sessions for the account. Ordinary logout revokes the submitted refresh credential/family and the active browser credential when present.

## Browser session and CSRF contract

The portal uses a server-owned opaque session cookie instead of browser role state. Production uses `__Host-nearpill_session` with `Secure`, `HttpOnly`, `Path=/`, and `SameSite=Strict`. Development uses the same semantics without the `__Host-`/`Secure` requirement so localhost HTTP remains usable.

State-changing cookie-authenticated requests must also provide the per-session CSRF value through `X-CSRF-Token`. Its digest is stored with the browser session. The readable `nearpill_csrf` cookie is a transport convenience for the existing vanilla portal until its later React migration; the backend still validates the value against server-owned session state. The portal uses same-origin requests with credentials and never derives authorization from `localStorage`.

## Durable challenges and throttling

Email verification and password-reset challenges are PostgreSQL-backed, expiring, one-time records. Verification codes and reset tokens are stored as hashes. Incorrect verification attempts are bounded. Password reset updates the credential and revokes account sessions atomically.

IP login budgets and per-account cooldown/lockout state are also PostgreSQL-backed. Same-key decisions take a transaction-scoped PostgreSQL advisory lock before evaluating counters so concurrent attempts cannot independently pass the same threshold decision.

## Pharmacy membership and permissions

`pharmacy_memberships` is now an authorization source rather than a structural placeholder. Active membership roles are `owner`, `manager`, and `staff`. Application permissions are resolved from the authenticated server session plus active memberships. A pharmacy ID supplied by a client is never authorization by itself.

Administrators manage memberships through authenticated admin routes. Membership changes are audited. Partner dashboard/subscription requests derive pharmacy context from active server-side memberships, and PostgreSQL RLS restricts partner order visibility to orders linked to pharmacies where that user has an active membership.

The existing static portal now bootstraps `/api/auth/me`; URL/branch values may select only among memberships already returned by the server. Client-side admin impersonation, demo credentials, editable browser role persistence, and browser filtering of admin-order responses have been removed.

## Verification commands

Packet-scoped static/unit contracts:

```bash
node --test \
  backend/test/identity-security.test.mjs \
  backend/test/backend-layer-extraction.test.mjs \
  backend/test/payment-subscription-layer-extraction.test.mjs \
  backend/test/postgres-migration-contract.test.mjs \
  backend/test/packet0-baseline-characterization.test.mjs
```

Live PostgreSQL security verification, when PostgreSQL 18 is available:

```bash
npm run db:verify-identity
```

That live gate proves partner-A cannot read partner-B orders through RLS and proves refresh replay revokes the newly issued credential family. Static/unit contracts do not substitute for that live database execution.

## Deliberately deferred

This identity boundary does not perform the later Hono `/api/v1` transport cutover, React portal migration, Flutter refresh-client repair, order/inventory policy redesign, payment-provider integration, or OTC/Rx cleanup. Those remain owned by their later implementation packets.
