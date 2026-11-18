# NearPill — production-isolated staging rehearsal & migration release plan

**Approved environment designation (2026-11-04):** Supabase ref `aobxzstawwdbchplxaha` is **PRODUCTION ONLY**. Treat it as a denylisted target for all staging commands. **This document does not authorize changes to production, create a staging project, run migrations, change grants, or deploy an API.**

**Packet scope:** Packet 0, dependency-ready but acceptance BLOCKED. One canonical NearPill repository; existing Hono backend/auth, Drizzle/PostgreSQL adapters, React/Vite portal, Flutter app and domain logic are retained. A second *database environment* for staging is required; a second NearPill application implementation is prohibited.

**Execution update (2026-11-05):** The user selected a separate staging project in NearPill's existing organization. Supabase quoted $0/month, and `NearPill Staging` (`afqqozfjpiodanpogvfb`) was created in Singapore (`ap-southeast-1`). It is ACTIVE_HEALTHY on PostgreSQL 17.11, matching the observed production major/minor version. Production was not changed.

After explicit staging approval, separate non-owner, non-BYPASSRLS `nearpill_app` and `nearpill_migrator` logins were created, required extensions installed, and migrations `0001`–`0018` applied with the canonical transactional SHA-256 journal. TLS is verified against the Supabase Root 2021 CA; certificate verification was never disabled. Credentials remain outside distributable source.

Real app-role user/tenant isolation, auth/session flows, protected inventory/order fields, OTC publication denial and a 100-way stock test pass. Exactly three of 100 stock reservations succeeded for three units. Read-only integrity reconciliation passes. The Android emulator runs the rebuilt Flutter app against the local Hono API; Flutter analysis, 16 mobile tests, web build and type checks pass. See [local startup and remaining release requirements](local-staging-run.md).

The baseline below records the earlier 2026-11-04 state, not the current execution result. Local staging is operational. Production release acceptance remains blocked on the remaining release requirements, including owner credential rotation, clean Linux CI/source packaging and a provider backup/restore rehearsal.

## A. Historical baseline (2026-11-04): observed versus pending

| Boundary | Evidence | Status / effect |
|---|---|---|
| Production project | `NearPill` / `aobxzstawwdbchplxaha`, Singapore, ACTIVE_HEALTHY | **Designated production by owner. Never run rehearsal DDL here.** |
| Production PostgreSQL | 17.11; app public tables 0, Supabase migration inventory empty | No application schema; approval to change not implied |
| Production login roles | `nearpill_app`, `nearpill_migrator` absent | No app-role TLS or RLS negative acceptance can yet run |
| Production privilege notice | `public.rls_auto_enable()` is a `SECURITY DEFINER` event-trigger function with EXECUTE granted to PUBLIC, anon and authenticated | Advisor warning; review definition, trigger and grants before any separate approved remediation; no live change |
| Staging database | Neither a separate project nor an existing branch is accessible | **Not provisioned**; requires project choice, cost acknowledgement and owner approval |
| Source migrations | Seven canonical files `0001_core.sql`–`0007_payment_reconciliation.sql` | Reviewed source fingerprints below; **not applied** |
| Runtime | Node 24/npm 11 required, local host Node 22/npm 10; authentic lockfiles and Flutter SDK absent | Supported builds and installed-Hono tests blocked |
| Policy acceptance | NP-031 `public.users` credential-table RLS and R04 persisted OTC eligibility unresolved | No staging migration authorization until remedial design reviewed |

Production reference and project name are **identity facts**, not staging credentials. Never populate a staging environment variable with `aobxzstawwdbchplxaha`, its host, an owner's Postgres password or a Supabase service-role key. Do not use a production dump or user/order/payment data in staging.

## B. Environment topology and isolation

```text
Existing NearPill source / reviewed commit (single repository)
  ├─ local disposable DB: developer smoke tests only
  ├─ separately authorized Supabase STAGING project (new ref)
  │    ├─ dedicated non-BYPASSRLS app role, dedicated non-owner migrator
  │    ├─ reviewed migration journal / synthetic fixtures only
  │    ├─ Node 24 Hono API + React/Vite web + Flutter test client
  │    └─ sandbox payments / no customer-facing hostname
  └─ PRODUCTION Supabase aobxzstawwdbchplxaha
       └─ read-only metadata checks until separate production release approval
```

**Selected staging:** an independent Supabase project in NearPill's organization, using the production region and PostgreSQL version for parity, with isolated secrets and synthetic fixtures. Supabase quoted $0/month before creation. A provider backup/restore drill remains a release requirement.

**Alternative:** paid, isolated persistent Supabase branch only after separate cost approval and confirmation of cloning/deployment semantics. Branches may deploy to production on merge: disable/guard all automatic merges, check existing pipeline permissions, and use no production data. Current production branch inventory reported `[]`. Because the production schema is empty, a branch cannot be assumed to contain the seven NearPill migrations.

**Hard isolation:** `STAGING_PROJECT_REF != aobxzstawwdbchplxaha`, separately managed credentials (no credentials in repo or chat), only synthetic test records; no production payment provider keys, webhooks, notification recipients or access tokens. Backend-only DB access over verified TLS. Frontend and Flutter call the staged Hono API only; no privileged Supabase keys shipped to public clients. Backend remains the authentication authority; **do not introduce Supabase Auth as a parallel login system**.

## C. Approval holds — must be cleared in order

| Gate | Required evidence | Stop condition |
|---|---|---|
| G1: staging ownership/cost | Authorized independent staging project ref, org/project owner, approved quote/billing, isolated secrets, project region and environment designation | No staging target or no cost approval |
| G2: engine + restore | PostgreSQL 17.11/18 compatibility decision against actual provider; extensions/ownership compatibility; staging snapshot and restore-to-disposable rehearsal | Engine drift not reviewed, restore not demonstrated |
| G3: SQL security design | NP-031 forced RLS on `users`, credentials/password-recovery read/update workflow, tenant and account bootstrap policy, migrator/app RLS tests; R04 stored OTC eligibility before publication; exposed-schema grants and `rls_auto_enable()` risk reviewed | Any credential table has unreviewed RLS, default grant, or OTC publication gap |
| G4: role bootstrap | Review `backend/postgres/bootstrap/001-roles.sh` for managed Supabase; non-owner LOGIN app and migrator; NOBYPASSRLS; no elevated membership; direct migrator TLS; app via direct or session mode; vault secrets | Using postgres/service_role for runtime or migrator; ambiguous permissions |
| G5: migration rehearsal | Approved source fingerprints, resolved extension availability (`pg_trgm`, `cube`, `earthdistance`, optional `vector`), migration journal/locking and exact project-ref/host verification; complete reviewed chain and replay | Any SQL error, checksum drift, privileged role, target mismatch or partial journal |
| G6: real acceptance | Negative RLS under real `nearpill_app`, two-tenant isolation, actor-context pool reset, 100 parallel stock reservations (3 success of 100, 0 sellable remainder for the stock-3 fixture), financial reconciliation, installed-Hono/web/Flutter flows | Missing or skipped gate; any unsafe auth/payment behavior |
| G7: preproduction decision | Owners sign off security findings and synthetic E2E; demonstrated backup/restore; CI artifact provenance; payments disabled, release/rollback runbook; separate production change authorization | Any incomplete acceptance or proposed automatic branch merge |

**Do not set the migration owner-approved environment flag as a substitute for G1–G4 approval.** No agent or maintainer may infer permission to modify production from a staging rehearsal request. Postgres 17 versus plan target 18 requires an explicit architecture decision: test on the version actually used for production (17.11) and separately approve any major upgrade; do not silently upgrade production.

## D. Canonical migration sequence, source hashes and invariants

The **only** approved migration authority is `backend/scripts/migrate-postgres.mjs` (command: `npm run db:migrate`). It uses `backend/scripts/lib/verify-migration-target.mjs` for explicit local/staging target checks; `backend/scripts/lib/execute-reviewed-migration.mjs` for transactional advisory-lock and SHA-256 journal integrity. **Do not paste migrations into the Supabase SQL editor or run `supabase db push` as a replacement** for this existing journal. Do not rewrite an applied migration: add a reviewed new versioned migration only after NP-031/R04 design and parity acceptance. The current source must first pass compatibility review on the selected staging major version.

| Order | File | Migration scope | SHA-256 |
|---|---|---|---|
| 1 | `0001_core.sql` | core users/pharmacies/catalog/orders/payments plus migration journal; users RLS gap | `0462b1cc1d5b5bf01fcecd3b00a7354e40d371c569ff2b2b1312a5be90397260` |
| 2 | `0002_rls.sql` | forced RLS, actor settings and policies for tenanted tables | `0f6d8cc35094245e07f6df5625046270735ab1869fe5ab5cf0fcc222fc3c2c17` |
| 3 | `0003_indexes.sql` | indexes | `cf98329c5a1ad8cc652bcad6df1e09a11b73787842a93a310006bae2b32a7597` |
| 4 | `0004_identity_security.sql` | identity session, recovery and rate-limiter durability | `a8e83cdf2304ba2a0a563e400425dcd3f065a31a0c7e8551b00cdaf3898ac729` |
| 5 | `0005_catalog_discovery.sql` | discovery, trigram/earthdistance, publication metadata | `48eae5dda5672f94d9c56ec58dd6656ddb940f6aed409b477d58d2714013ecb1` |
| 6 | `0006_order_inventory.sql` | inventory reservations and movements | `a3fe4e1de81db0d006fafd963aa070dbc08861ec5b72fe937e3b387300f53422` |
| 7 | `0007_payment_reconciliation.sql` | provider events, refunds, subscriptions and reconciliation | `69fa8015117023cddd50e2b5e1281e0f4ed9ae4cae0a0af0952f39f712cf9cfd` |

**Preflight on a *separate staging instance*** (operator action after approval, not executed here):

1. Install the exact reviewed toolchains (Node 24/npm 11; supported Flutter/Dart). Recover/generate **authentic** root/backend/web npm and Flutter lockfiles from verified registries, review dependency integrity, and commit approved lockfiles. `npm ci` is not a substitute for a nonexistent lockfile; refuse to invent hashes.
2. Inspect actual `pg_roles` membership, `pg_database` owner, `pg_namespace` grants, extension installation/ownership, `public` EXECUTE defaults and `pg_event_trigger`. Review the Supabase-provided `rls_auto_enable()` advisory; define separately reviewed grant changes, not ad-hoc privileged workarounds.
3. Review `001-roles.sh` without running its local bootstrap against managed Supabase: it issues `CREATE EXTENSION vector`, and role/schema grants may require adjustments under managed Postgres. Prepare versioned, idempotent staging-only bootstrap with explicit approvals and passwords from a secret manager; verify it on a disposable clone first.
4. Design and review the **new** NP-031 authentication-compatible `users` RLS policy, with actual pre-auth login/recovery contract tests, and R04 persisted OTC eligibility policy. Do not mark them fixed until real non-`BYPASSRLS` tests pass. If a failure occurs partway through the historical chain, never conceal it by recording migration checksums manually.
5. Only after G1–G4, connect using **separate** staging direct-TLS migrator credential, set exact staging host/ref and reviewed migration flags, run the canonical migrator once; verify its journal and all source hashes, then rerun to assert checksum-matched skips. Capture output without secrets.
6. Run post-migration grants and RLS inspection as the staging **application role** (not the privileged management role), plus source-level regression and real fixture tests. Confirm no table in the exposed public schema that stores sensitive data has unintended grants or missing forced RLS. Verify role inheritance, `current_user` and `session_user` in live sessions.

### Non-secret staging configuration examples — **not active**

```dotenv
# Staging project reference is intentionally unknown and MUST NOT equal production.
NODE_ENV=staging
DB_HOST=db.<APPROVED_STAGING_PROJECT_REF>.supabase.co
DB_PORT=5432
DB_NAME=postgres
DB_USER=nearpill_app
DB_PASSWORD=<INJECT_STAGING_APP_SECRET_FROM_SECRET_MANAGER>
DB_SSL=true
PAYMENT_POLICY_MODE=disabled
PAYMENT_POLICY_VERSION=unconfigured
PAYMENT_REFUNDS_ENABLED=false
# Approved HTTPS CORS origin / trusted proxy policy set only after endpoint validation.
```

```dotenv
# ONLY after staged migration approval, with separate direct-TLS migrator secret.
NODE_ENV=staging
NEARPILL_MIGRATION_TARGET=staging
NEARPILL_MIGRATION_PROJECT_REF=<APPROVED_STAGING_PROJECT_REF>
NEARPILL_MIGRATION_EXPECTED_HOST=db.<APPROVED_STAGING_PROJECT_REF>.supabase.co
NEARPILL_MIGRATION_EXPECTED_DATABASE=postgres
DB_HOST=db.<APPROVED_STAGING_PROJECT_REF>.supabase.co
DB_PORT=5432
DB_NAME=postgres
DB_USER=nearpill_migrator
MIGRATOR_DB_USER=nearpill_migrator
DB_PASSWORD=<INJECT_STAGING_MIGRATOR_SECRET_FROM_SECRET_MANAGER>
DB_SSL=true
# Set NEARPILL_MIGRATION_OWNER_APPROVED and confirmation only in the approved manual change window.
```

These examples are **not** ready-to-run credentials. In particular, an angle-bracket placeholder must never be expanded to the production reference. Verify production ref is absent from staging environment and secrets before every deploy. Staging persistent Node backend: direct IPv6/IPv4 add-on, or real session-pooler endpoint if IPv4-only; migration/backup uses direct connection. Avoid transaction poolers for transaction-local session assumptions unless proven compatible by tests. Validate server CA/TLS hostname, never set `rejectUnauthorized:false`.

## E. Rehearsal commands and evidence (operator-controlled; do not run on production)

These commands describe the **existing scripts**. The execution update above and linked local run record identify what has now passed; the list below is not a claim that every release gate has executed:

```bash
# Source and runtime checks, in reviewed checkout; no DB mutation.
node --version && npm --version
npm run check:runtime
npm run check:lockfile
npm run check:backend-lockfile
npm run verify:packet0
npm run verify:mobile

# After staging target and role approvals, in restricted CI/manual window:
# npm run db:migrate                  # STAGING ONLY; guard must confirm connected role and target
# npm run db:verify-security         # REAL app-role tenant isolation, 100-way contention
# npm run db:verify-identity         # credential/session/recovery safety
# npm run db:verify-order-inventory  # inventory and order invariants
# npm run db:reconcile               # finance/stock/cross-table integrity
# npm --prefix backend start         # installed-Hono API, staging only
# npm run build:web                  # staged React portal, real API contract
# npm run test:web:e2e               # test staged UI
# flutter analyze && flutter test    # supported Flutter SDK and staging API configuration
```

*Documentation note:* `db:verify-security` writes synthetic fixtures; it is **not** a read-only operation. Do not invoke it on the production project, with a privileged connection, or before completing NP-031. `db:migrate` and restore scripts are write/destructive operations. `backend/scripts/backup-postgres.sh` and `restore-postgres.sh` are explicitly restricted to disposable local tests; for managed Supabase staging/production prepare a separately approved native provider backup/restore drill and avoid running local `pg_restore --clean` against cloud production.

### Mandatory evidence bundle from a future staging rehearsal

- Staging project ref (not production), billing approval, engine version, network/TLS and ownership attestations, migration actor role attributes and backup artifact location (without secrets).
- SHA-256 for all migration SQL sources, journal rows/checksums, migration stdout and idempotent replay result, verified rollback/restore and migration duration.
- App-role `rls_enabled` and `rls_forced` evidence, RLS negative tests for customer A/B, unprivileged login/recovery, no privilege inheritance, no leaked actor settings across pooled transactions.
- Stock race test with 100 concurrent requests for 3 available units; exactly three reservations with no oversell; order/payment/refund/reconciliation audits.
- Installed-Hono exact-version webhook, rate limit/trusted proxy, malformed body and signed bytes tests, React and Flutter smoke; no real notifications, payment capture, refunds or user records.
- Human-reviewed go/no-go sheet: engineering/security/database/business owners sign on **new** production change request only after every staging gate passes.

## F. Rollback, incident and production cutover boundary

**Current rollback boundary:** changes are limited to the separate staging project, local configuration and application source. Stop the local API to stop testing. No production rollback is needed because production was not changed. No provider backup/restore drill has been demonstrated; do not treat the local run as production release approval.

**Future staging failure:** pause pipeline and API; preserve sanitised test evidence; restore a **disposable staging target** from a previously proven snapshot or recreate staging with reviewed migration chain; audit journal and fixed SQL; run all gates again. Do not force a checksum match, disable RLS, attach `BYPASSRLS`, run ad-hoc `DROP`, or copy production data.

**Future production release (separate request):** create a change ticket approved by production owner, verify backup/PITR availability and restore, assess data-loss window and downtime, enforce production direct/migrator restrictions (canonical migrator currently **rejects** production), prepare forward-fix and rollback steps, deploy Hono/web/mobile safely, monitor health/orders/payments, and obtain explicit go-live sign-off. Do not alter existing migrator target guard in this Packet 0 plan.

## G. Provenance and source links

- Existing source files: `backend/migrations/postgres/0001_core.sql` … `0007_payment_reconciliation.sql`, `backend/scripts/migrate-postgres.mjs`, `backend/scripts/lib/verify-migration-target.mjs`, `backend/postgres/bootstrap/001-roles.sh`, `backend/scripts/verify-postgres-security.mjs`, `backend/scripts/reconcile-postgres.mjs`.
- Supabase environment management: https://supabase.com/docs/guides/deployment/managing-environments
- Supabase branching: https://supabase.com/docs/guides/deployment/branching
- Supabase database migration guidance: https://supabase.com/docs/guides/deployment/database-migrations
- Supabase connections: https://supabase.com/docs/guides/database/connecting-to-postgres
- Supabase security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase production checklist: https://supabase.com/docs/guides/deployment/going-into-prod

**Execution status:** LOCAL STAGING OPERATIONAL / PRODUCTION ACCEPTANCE BLOCKED. Staging provisioning and approved security remediation have executed. Remaining release requirements are recorded in `local-staging-run.md`; production requires its own change authorization.
