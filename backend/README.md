# NearPill Backend

## HTTP transport

The production adapter is Hono on Node at `src/bootstrap/server.ts`; canonical API routes are under `/api/v1` and the generated OpenAPI document is `/api/v1/openapi.json`. Temporary `/api/*` aliases call the same application use cases and exist only for client migration.

## Setup

This backend is intended to run as a local or deployed API server for the NearPill Flutter app.

## PostgreSQL runtime and database roles

The active backend runtime uses PostgreSQL 18 with pgvector. The API connects as `nearpill_app`, which is deliberately created without superuser or `BYPASSRLS` privileges. Schema migrations use a separate `nearpill_migrator` role.

For local Compose setup, copy the root `.env.example` and provide separate owner, migrator, and application passwords. The PostgreSQL bootstrap creates the roles and pgvector extension; `db-migrate` then applies reviewed SQL migrations before the API starts.

For staging and production, set `DB_HOST`, `DB_USER`, and `DB_NAME` explicitly from the owner-approved NearPill Supabase connection and application role, alongside `DB_PASSWORD` and `DB_SSL=true`. Missing connection identity values fail closed rather than falling back to local development defaults. This configuration guard does **not** verify project ownership, actual role privileges, RLS or TLS connectivity; those require authenticated staging tests. The runtime also rejects known PostgreSQL/Supabase administrative, owner, migrator, and Data API role usernames for staging/production `DB_USER` (including shared session-pooler suffixes). This source-level guard is defense in depth only: arbitrary roles may still have elevated inherited grants, and the real application role must be checked as non-owner/non-`BYPASSRLS` on the authorized staging database. For staging/production `DB_HOST`, use the hostname supplied by the approved Supabase project connection dialog (direct or session-mode). Localhost, IPv4/IPv6 literals, and noncanonical numeric IPv4 spellings (such as `127.1`, octal, hexadecimal, or single-integer forms) are rejected in these environments to prevent accidental local/private target selection; loopback remains valid for disposable development/test PostgreSQL. This does **not** authenticate the hostname, establish project ownership, or replace live TLS/RLS checks. The persistent Hono/Drizzle runtime uses the Supabase direct or shared session-mode endpoint on port `5432`; the known Supabase transaction-pooler port `6543` is rejected in staging and production even when the hostname is a custom DNS alias, until there is reviewed compatibility evidence for prepared statements and transaction-local tenant context. This port check does not authenticate the endpoint or replace real app-role RLS tests. Keep migration credentials separate from the runtime application role. Local development/test may still use the documented defaults.

For direct backend startup, copy `backend/.env.example`:

```text
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=nearpill_app
DB_PASSWORD=replace-with-a-local-password
DB_NAME=nearpill
DB_SSL=false
PORT=3001
```

Database engineering commands:

```bash
npm run db:migrate  # requires explicit NEARPILL_MIGRATION_* target approval and migrator DB_USER
npm run db:reconcile
npm run db:verify-security
```

The migration runner will not silently connect to the default development database or to an unapproved Supabase project. Configure the explicit local/staging `NEARPILL_MIGRATION_*` gate and the `nearpill_migrator` role as described in `docs/postgres-migration.md` before running `db:migrate`. Staging uses the dashboard-provided **direct TLS** PostgreSQL endpoint, never a pooler; production migration remains gated by a separate release procedure.

The Drizzle schema is `src/infrastructure/postgres/schema.ts`. Reviewed PostgreSQL migrations live under `migrations/postgres/`; application repositories live under `src/infrastructure/postgres/`. The old MySQL files are rollback/import evidence only and are not composed by the Hono bootstrap (`src/bootstrap/server.ts`).

### Email verification

Sign-up sends a six-digit code through Brevo and verifies it before account
creation. Codes expire after 10 minutes. Without the Brevo settings below,
the backend returns the OTP to the app for local development. To test Brevo
delivery, set `BREVO_API_KEY` and a verified `MAIL_FROM` sender in local
`backend/.env`. Optionally set `DEV_OTP_INBOX` to route non-production signup
codes to a test inbox; this tests the signup flow but does not verify ownership
of the entered address. Remove `DEV_OTP_INBOX` when testing real email
ownership; production ignores it. Verification state is persisted in PostgreSQL as a hashed, expiring challenge and is consumed once when registration succeeds.

### Run the backend

Use the repository-pinned Node.js 24.22.0 runtime (the backend minimum remains Node 24.7.0 because password hashing uses the built-in Argon2id API). Install from the regenerated backend lockfile. The current source artifact must not be treated as install-reproducible until that lockfile matches `package.json`.

```bash
cd backend
npm ci
npm run dev
```

### Authentication input validation

Login, registration, send-code, verify-code and password-recovery requests are validated by
`src/http/contracts.ts` and the Hono route definitions before application services run. Auth JSON bodies
are limited to 4 KiB. Invalid bodies return a generic JSON error with HTTP 400
(413 for oversized bodies). Validation logs contain only the action and reason.

- Email: trimmed, lowercased ASCII dot-atom address, maximum 254 characters,
  local part up to 64 and domain labels up to 63. Quoted and internationalized
  mailbox addresses are currently unsupported; format checks do not prove ownership.
- Full name at signup: 1–100 characters after trimming; Unicode letters, marks,
  numbers, spaces, apostrophes, periods, commas, parentheses, hyphens and underscores.
  At least one letter is required. Markup and embedded control characters are rejected.
- Signup password: the current client minimum of 6 characters, maximum 128.
  Login allows 1–255 characters to preserve access for legacy accounts. Lengths
  use JavaScript/Flutter UTF-16 units. Passwords are never trimmed or rewritten.
- Verification code: exactly six ASCII digits, sent as a string.
- Missing, incorrectly typed and unexpected fields are rejected. NearPill has
  no username field; signup sends `fullName`, `email` and `password`.

Run `node --test test/auth-validation.test.mjs` from `backend` to test the preserved authentication input policy and transport contracts without database or email calls. Verified-email enforcement,
password-policy strength and further session hardening remain launch requirements
in [the readiness audit](../docs/readiness-audit.md).

### Login limits, durable sessions and password recovery

Authentication state is PostgreSQL-backed. Access, refresh and browser credentials are distinct random values and only their SHA-256 digests are persisted. Access credentials expire after 15 minutes; refresh credentials expire after 30 days and rotate once; browser sessions expire after 8 hours. Replay of a consumed/expired/revoked refresh credential revokes its complete token family. Password reset and logout-all revoke all account sessions.

The web portal uses an opaque server session cookie. In production the cookie is named `__Host-nearpill_session` and is `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`. Mutating cookie-authenticated requests also require the per-session `X-CSRF-Token`. Browser role and pharmacy membership are display state only; the backend and PostgreSQL RLS remain authorization authority.

Login throttling is durable: IP budgets and account cooldown/lockout records are stored in PostgreSQL. Same-key decisions take transaction-scoped advisory locks. The existing progressive account delay and 15-minute fifth-failure lockout semantics are retained.

Recovery routes remain:

| Route | JSON body / result |
| --- | --- |
| `POST /api/v1/auth/forgot-password` | `{ "email": "..." }`; same neutral confirmation for known and unknown accounts |
| `POST /api/v1/auth/reset-password` | `{ "token": "64 hexadecimal characters", "password": "..." }`; validates a one-time hashed challenge, updates the password, and revokes account sessions |
| `GET /reset-password#token=...` | browser form served by the backend; token stays out of server URLs and referrers |

Legacy `/api/auth/*` aliases remain temporarily for existing clients and call the same application services.

Reset challenges expire after 15 minutes and are stored only as hashes. The reset write, challenge consumption and session revocation occur in one database transaction.

For OTP email verification, staging and production never echo a development verification code or route delivery through `DEV_OTP_INBOX`. If `BREVO_API_KEY` or `MAIL_FROM` is unavailable in these environments, OTP delivery fails closed (HTTP 503); development/test can still use local OTP preview and a development inbox.

Configure mail and the public recovery origin through `BREVO_API_KEY`, `MAIL_FROM`, and `PUBLIC_APP_URL`. `MAIL_FROM` must be a sender verified in Brevo. Staging and production `PUBLIC_APP_URL` must be an exact HTTPS origin (no path, query, fragment or embedded credentials); HTTP localhost origins remain supported for development and tests.

Run the targeted identity/security contracts from the repository root with `npm run test:identity-security`; when PostgreSQL 18 is available, use `npm run db:verify-identity` for the live RLS/refresh-replay gate. See `../docs/identity-security.md` for the complete boundary.

### Password storage and migration

Signup and password reset use Argon2id with a random 16-byte salt, 19 MiB memory,
two passes, one lane and a 32-byte key. The encoded hash records the parameters.
This meets the [OWASP minimum](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
without adding a dependency. Verification uses `timingSafeEqual`, preserving the
password exactly, including spaces and special characters.

The transport-independent login service (`src/application/login-service.js`) upgrades plaintext, the previous
`scrypt$16384$8$5$...` format, and explicitly tagged `md5$<hex>` / `sha1$<hex>`
records after successful verification. Wrong passwords never trigger a migration.
A conditional update prevents overwriting a concurrent password reset. Verification
runs both KDFs during the transition so unknown accounts and legacy records also
incur the hashing cost. Remove the old KDF work once legacy records are retired.

Bare 32/40/64-character hexadecimal values cannot safely be distinguished from
literal passwords. Those accounts, corrupted hashes and unsupported formats require
password recovery; do not guess a format or accept a stored digest as a password.
No MD5/SHA-1 password writer was found. The existing `VARCHAR(255)` column fits the
new hashes; no schema change or offline rehash script is needed. Dormant legacy
records still need sign-in migration or reset before live use.

Run the read-only inventory from the repository root:

```bash
node backend/audit-passwords.js
```

It loads `backend/.env`, scans in batches and prints only format counts, never
passwords, hashes or account identifiers. The local audit on 13 October 2026 found
five plaintext records and no other formats; it did not modify accounts. Re-run it
after sign-in/reset migration. Backend errors log event names and error codes;
mobile HTTP logs omit request/response contents, URLs and exception messages;
web console logs omit raw errors and event payloads.

From the repository root, run:

```bash
node --test backend/test/auth-validation.test.mjs backend/test/login-security.test.mjs backend/test/email.test.mjs backend/test/password-migration.test.mjs test/web_service_information.test.cjs
flutter test --no-pub
```

The targeted backend tests use deterministic fakes/static contracts where possible. They do not modify the active PostgreSQL database or send real email unless a live verification script is explicitly invoked.

### Medicine API smoke check

```bash
Invoke-RestMethod -Uri http://localhost:3001/api/v1/medicines -UseBasicParsing
```
