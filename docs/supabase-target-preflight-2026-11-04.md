# NearPill — connected Supabase project setup preflight (2026-11-04)

> **2026-11-04 production designation correction:** Owner confirmed that Supabase `aobxzstawwdbchplxaha` is **PRODUCTION**, not staging. The staging environment examples below were drafted before that decision; **DO NOT EXECUTE THEM or set migration approval flags with this project's reference or host**. The current, authoritative production-isolated rehearsal plan is [`packet0-production-isolated-staging-rehearsal-2026-11-04.md`](packet0-production-isolated-staging-rehearsal-2026-11-04.md). This preflight remains historical read-only evidence.

**Status: LIVE MANAGEMENT CONNECTION VERIFIED / SCHEMA SETUP BLOCKED.** This is the reviewed operator configuration and read-only evidence for the **existing** NearPill Hono + Drizzle backend. It does not create another database, change the backend's authentication model, or authorize deployment.

## Verified connected Supabase target (read-only, 2026-11-04)

| Field | Observed | Acceptance implication |
|---|---|---|
| Project | `NearPill`, ref `aobxzstawwdbchplxaha` | Project name and connection verified; staging vs. production **not designated** |
| Region / state | `ap-southeast-1` (Singapore), `ACTIVE_HEALTHY` | Provider is reachable, not proof of deployed app |
| Database engine | PostgreSQL `17.11`, database `postgres` | Target plan prefers PG18; review/test PG17 compatibility before any migration |
| Direct host | `db.aobxzstawwdbchplxaha.supabase.co` | Must be independently verified from dashboard **Connect** before use |
| Application schema | 0 tables in `public`; no recorded NearPill migrations | Existing seven reviewed migrations have **not** been installed |
| NearPill roles | `nearpill_app` and `nearpill_migrator` absent | Require least-privilege bootstrap with independently secured passwords |
| Vector extension | `vector` available, not installed | Optional until AI scope approved; existing bootstrap currently attempts to install it |
| Security advisor | `public.rls_auto_enable()` `SECURITY DEFINER` is executable by `PUBLIC`, `anon`, and `authenticated` | Review function/trigger ownership and revoke unintended EXECUTE through an approved change; **not changed** |
| Operating actor | Read-only SQL through connected `postgres` role (`BYPASSRLS`) | **Cannot** prove ordinary app-role RLS isolation |

Read-only live checks performed: project inventory, migration inventory, tables, installed/available extensions, security advisor and SQL metadata/privilege inspections. **No DDL, DML, roles, passwords, default grants, policies, migrations, deployment, or live data were changed.**

## Setup in the canonical repository

Use the existing files; do not add Supabase Auth, a client-side database API, or a second application:

- Config parser: `backend/src/config/env.ts` (the runtime uses distinct `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL`, **not** a mandatory Supabase JavaScript client).
- Drizzle/PostgreSQL repositories: `backend/src/infrastructure/postgres/`.
- Protected bootstrap: `backend/postgres/bootstrap/001-roles.sh` (creates `nearpill_app`, `nearpill_migrator`; examine compatibility and grants first).
- Reviewed SQL history: `backend/migrations/postgres/0001_core.sql` through `0007_payment_reconciliation.sql`.
- **Only** canonical migrator: `backend/scripts/migrate-postgres.mjs`; see `backend/scripts/lib/verify-migration-target.mjs` for preconnection restrictions.
- Existing real-database gates: `backend/scripts/verify-postgres-security.mjs`, `backend/scripts/reconcile-postgres.mjs`, `backend/scripts/verify-order-inventory.mjs`, `backend/scripts/backup-postgres.sh`, `backend/scripts/restore-postgres.sh`.

### Backend-only staging configuration (example, **not activated**)

Configure the protected backend runtime **after confirming this project is a non-production staging target and obtaining its app-role credentials from an approved secret store**:

```dotenv
NODE_ENV=staging
DB_HOST=db.aobxzstawwdbchplxaha.supabase.co
DB_PORT=5432
DB_NAME=postgres
DB_USER=nearpill_app
DB_PASSWORD=<inject-secret-at-runtime>
DB_SSL=true
# CORS_ORIGINS=<approved-https-portal-origin>
# PUBLIC_APP_URL=<approved-https-api-origin>
PAYMENT_POLICY_MODE=disabled
PAYMENT_POLICY_VERSION=unconfigured
PAYMENT_REFUNDS_ENABLED=false
# TRUSTED_PROXY_IPS stays UNSET until the proxy peer is verified on the real host
```

**This block is a non-secret template, not a populated `.env` file.** The backend role is not present yet. Do not send passwords through a chat, commit them, or place any DB or Supabase service-role credentials in Vite/Flutter. Direct connections require compatible network IPv6 or a provider IPv4 add-on; on an IPv4-only backend choose the *actual dashboard-provided* **session** pooler address and its qualified custom-role username, not an invented pooler hostname. Do not use transaction pooling with the present session-sensitive stack. Require TLS and verify server trust/certificate chain with the Node `pg` driver.

### Reviewed migrator setup (do **not** execute yet)

The guard for the same approved Supabase staging target requires:

```dotenv
NODE_ENV=staging
NEARPILL_MIGRATION_TARGET=staging
NEARPILL_MIGRATION_OWNER_APPROVED=true
NEARPILL_MIGRATION_CONFIRMATION=I_APPROVE_REVIEWED_SQL_MIGRATIONS
NEARPILL_MIGRATION_PROJECT_REF=aobxzstawwdbchplxaha
NEARPILL_MIGRATION_EXPECTED_HOST=db.aobxzstawwdbchplxaha.supabase.co
NEARPILL_MIGRATION_EXPECTED_DATABASE=postgres
DB_HOST=db.aobxzstawwdbchplxaha.supabase.co
DB_PORT=5432
DB_NAME=postgres
DB_USER=nearpill_migrator
MIGRATOR_DB_USER=nearpill_migrator
DB_PASSWORD=<inject-separate-migrator-secret-at-runtime>
DB_SSL=true
```

These are **required gate inputs, not a claim of owner approval**; the flag must not be set until owner approval is truly obtained. Migration credentials must be a non-owner, non-`BYPASSRLS` direct-login role, distinct from `nearpill_app`; the canonical migrator checks the connected session. The default `postgres`/`service_role` roles must never serve as the ordinary application or migrator identities. Keep migrations and role creation off the current target until the checklist below is satisfied.

## Mandatory setup sequence / blockers

1. **Designation:** owner explicitly confirms whether project `aobxzstawwdbchplxaha` is **staging** or **production**. If production, obtain an isolated, separately approved non-production test target before schema rehearsal; do not create a second production database.
2. **Engine/backups:** resolve PostgreSQL 17.11 versus plan target 18, capture project-specific schema/version/extension compatibility and backup + restore proof. No application data is currently present, but backups/restore and rollback remain required before cutover.
3. **Security design:** resolve NP-031 before applying schema: `0001_core.sql` creates a `public.users` credentials table without the required forced RLS; existing verifier intentionally blocks live fixture testing. Also verify R04 persisted OTC eligibility and review Supabase `public` table/function default grants. Inspect and remediate the `rls_auto_enable()` public-EXECUTE advisory through an approved security change.
4. **Roles:** after staging approval, securely provision separate `nearpill_app` and `nearpill_migrator` roles and audit actual login attributes, privilege membership, grants, schema ownership and TLS. The existing `001-roles.sh` was written for the local PostgreSQL bootstrap and must be reviewed for managed Supabase permissions and `vector` extension location.
5. **Migration:** use the one existing reviewed migration executor only, on the approved direct TLS target, with exact project/host/database and checksum verification. **Do not use the Supabase SQL editor or service-role credentials to bypass canonical migration journal or target gates.**
6. **Acceptance:** run real app-role negative tenant tests, transaction-local actor-context cleanup, 100-way inventory contention, financial and order reconciliation, migration replay/restore, and installed-Hono/API integration. Run Node 24/npm 11 and Flutter supported builds using genuine dependency lockfiles.
7. **Launch:** keep payment collection/refunds disabled, synthetic-only data, no public deployment until all release/security/clinical/payment gates are satisfied.

## Current test evidence classification

- **PASS:** Supabase project/database management connection and read-only metadata; existing source migration-file presence and earlier source/contract characterization.
- **NOT RUN / BLOCKED:** provisioning, migrations, actual `nearpill_app` TCP TLS connection, installed-Hono/React/Flutter end-to-end startup, RLS/stock/payment/restore acceptance, public live release.

## References

- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://supabase.com/docs/guides/api/securing-your-api
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable

**Rollback:** This preflight changed no live SQL. Remove this documentation and revert its ledger entry if superseded. Any future live DB change requires its own tested rollback/forward-fix procedure.
