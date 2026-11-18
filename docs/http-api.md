# NearPill HTTP API transport

The production HTTP adapter is Hono on Node. Business behavior remains in the existing application services and repository ports; the transport layer does not own SQL, order rules, payment rules, inventory rules, or tenant authority.

## Canonical API

New integrations use `/api/v1/*`. The OpenAPI document is exposed at `/api/v1/openapi.json` and is generated from the same Zod schemas used by the Hono route definitions.

Health endpoints are:

- `/api/v1/live` — process liveness only;
- `/api/v1/ready` — PostgreSQL readiness;
- `/api/v1/health` — compatibility health representation for v1 consumers.

## Compatibility window

Existing `/api/*` application routes are temporary aliases over the same route manifest and the same application use cases. They carry deprecation/successor metadata and must be removed after both the portal and Flutter client have completed their `/api/v1` migrations. The aliases are not a second implementation.

The former `/api/health` compatibility endpoint was removed after first-party client and operational callers moved to `/api/v1/health`.

## Authentication boundary

Bearer/mobile credentials and server-owned web session cookies are resolved in transport middleware. Cookie-authenticated mutations continue to require the session-bound CSRF verifier. Role and pharmacy authorization remain server-owned and PostgreSQL actor context is set only after authentication.

## Request validation

The `/api/v1` contract uses Zod schemas declared in `backend/src/http/contracts.ts`. Authentication inputs are strict. Other legacy-compatible payloads validate the known fields while intentionally tolerating existing extra fields until their owning domain packet changes the contract.

The temporary `/api/*` aliases use those same schemas through a manual adapter so old clients do not bypass validation.

## Runtime prerequisites

The declared runtime is Node 24. Backend dependencies must be installed from a regenerated lockfile before executing the Hono server. A source checkout with a stale lockfile is not a release-ready install.

## Install reproducibility

The previous backend lockfile referenced the retired Express dependency graph and has been removed. Regenerate `backend/package-lock.json` with the pinned Node/npm toolchain and registry access, review it, then require `npm run check:backend-lockfile` followed by `npm ci --prefix backend`. Until then, Hono startup/build execution is an explicit environment acceptance gap rather than a claimed pass.

## Order creation integrity

`POST /api/v1/orders` requires an idempotency key and delegates authoritative pricing/reservation to the order application service. The server enforces one pharmacy per order, reloads current published price/availability, stores authoritative money in centavos, and treats client price/total fields as non-authoritative. Temporary `/api/orders` compatibility traffic uses the same use case; it does not own a second checkout implementation.


## Payment authority

Payment collection is a separate operation after order reservation. `POST /api/v1/orders/:id/payments` creates an intent only through a configured payment provider and versioned server policy. `POST /api/v1/payments/webhooks/:provider` preserves the raw request body for provider signature verification and deduplicates provider event IDs before side effects. Direct administrator mutation of amount/status/reference is removed. Refund requests use `/api/v1/admin/payments/:id/refunds`; confirmed refund state requires provider or approved reconciliation evidence.

Partner Premium report access is enforced by server-owned subscription entitlements through `/api/v1/partner/entitlements` and `/api/v1/partner/reports/sales`.
