# PostgreSQL persistence migration

The active NearPill backend now composes the existing Hono/application/domain layers with PostgreSQL repositories. This is an in-place persistence replacement, not a second backend or duplicate business implementation.

## Active persistence path

```text
Hono route adapter
  -> existing application use case/domain policy
  -> existing repository port
  -> PostgreSQL repository adapter
  -> Supabase-managed PostgreSQL (verify project engine; pgvector only when AI is approved)
```

The production bootstrap `backend/src/bootstrap/server.ts` does not import `mysql2` or MySQL repository adapters. The legacy MySQL adapter and schema files remain only as rollback/data-import evidence; Compose does not start MySQL and runtime dependencies do not include `mysql2`.

## Schema and migration authority

- `backend/src/infrastructure/postgres/schema.ts` is the Drizzle schema model.
- `backend/scripts/lib/reviewed-migration-sources.mjs` is the shared **read-only SQL source inventory** used by the existing migration runner and live-verification preflight. It enforces sequential `0001_...sql` naming, rejects symlink/nonregular and empty sources, and reads the complete set before the migration runner creates a connection. This is not a second migration journal, approval authority, or database adapter; new migrations still require code review, checksum validation, and real PostgreSQL tests.
- `backend/migrations/postgres/*.sql` is the reviewed operational migration history.
- `backend/scripts/migrate-postgres.mjs` applies migrations in filename order and records a SHA-256 for each applied file. It fails if an already-applied migration changes. **Packet 0 safety guard:** it now refuses implicit/default migration targets and application/owner roles *before creating a connection*. An explicit local development or owner-approved staging direct-TLS target is required; this is an operator safeguard, not proof of Supabase ownership or a substitute for backup/RLS tests. The same canonical runner now uses `backend/scripts/lib/execute-reviewed-migration.mjs`: it takes a fixed **transaction-level advisory lock before journal creation/checks**, then either applies the reviewed SQL and journal entry atomically or commits a checksum-matched skip. Competing canonical migrators targeting the same database serialize on this key; the lock is released automatically on transaction commit/rollback. The executor sets `SET LOCAL lock_timeout = '30s'` inside the transaction **before acquiring that lock**; a stalled migrator or DDL lock cannot cause unlimited server-side lock waiting, and a timeout rolls back without journal insertion. The timeout does not impose a total migration duration limit. These properties have local recording-transport tests, **not yet real PostgreSQL contention/timeout evidence**.
- **Packet 0 SQL-to-checksum binding:** before opening `BEGIN`, the same canonical executor independently recomputes the SHA-256 digest of the exact SQL string it will execute and requires it to equal the caller's digest and the reviewed manifest entry. It refuses a valid-looking but fabricated checksum, including when the journal would otherwise cause a skip. This is a local code-integrity safeguard; it does **not** replace independent source review, signed artifacts, or actual PostgreSQL migration/restore checks.
- `backend/postgres/bootstrap/001-roles.sh` creates `nearpill_app` and `nearpill_migrator` without superuser or `BYPASSRLS`, and enables pgvector using the bootstrap owner.

The application role is not the owner of application tables. RLS is enabled and forced on pharmacy/catalog private-write, membership, inventory, order, payment, subscription, and audit tables. Request identity is passed as transaction-local PostgreSQL settings after the server-owned Hono authentication middleware verifies the actor.

**Packet 0 / NP-031 acceptance gate (20 October 2026):** The reviewed migration history does *not* enable or force RLS on `public.users`, which contains account and credential data. `backend/scripts/lib/verify-live-fixture-connection.mjs` now **refuses** fixture-writing verification if the live `users` table lacks `relrowsecurity=true` and `relforcerowsecurity=true`, regardless of safe `anon`/`authenticated`/`PUBLIC` grants. The migration journal remains a separate migrator-only grant boundary; it is not required to have user RLS. This preflight makes a release blocker executable, **not fixed**: the current SQL will fail that new live gate until a separately reviewed, authentication-compatible RLS migration/policy and real app-role negative tests are accepted. Do not bypass the gate or apply ad hoc production SQL.


### Explicit migration target configuration

The existing migration script remains the only migration executor. For intentional local development migrations, set `NODE_ENV=development`, `NEARPILL_MIGRATION_TARGET=local`, `NEARPILL_MIGRATION_CONFIRMATION=I_APPROVE_REVIEWED_SQL_MIGRATIONS`, `DB_HOST=127.0.0.1`, `DB_PORT=5432`, `DB_NAME=nearpill`, `DB_USER=nearpill_migrator`, `MIGRATOR_DB_USER=nearpill_migrator`, and a private `DB_PASSWORD`. Set `NEARPILL_MIGRATION_EXPECTED_HOST` and `NEARPILL_MIGRATION_EXPECTED_DATABASE` to the **same independently confirmed** target. The migrator session itself is also inspected read-only for actual login/effective role, privilege escalation paths, connected database, and staging TLS **before transactional DDL**. This local action does not authorize customer-data migrations.

Staging requires `NODE_ENV=staging`, `NEARPILL_MIGRATION_TARGET=staging`, `NEARPILL_MIGRATION_OWNER_APPROVED=true`, `NEARPILL_MIGRATION_PROJECT_REF` matching the exact Supabase direct host `db.<project-ref>.supabase.co`, `DB_SSL=true`, port 5432, plus the same explicit confirmation and expected host/database checks. **Session/transaction poolers are not migration endpoints**. Never use `nearpill_app`, a table owner or a service-role/superuser credential for ordinary migrations. The guard intentionally refuses production migrations; production requires a separately reviewed release and backup procedure. Do not store credentials in this documentation or commit populated `.env` files. A matching operator-supplied project reference is **not independent evidence of ownership**.

## Legacy data import

`backend/scripts/import-mysql-to-postgres.mjs` is an **isolated synthetic-test conversion utility**, not an approved live import/cutover path. The previous version used implicit MySQL root and localhost/Postgres defaults and could begin writing without validating a target. Packet 0 now refuses to open either pool unless **all** of the following are explicitly configured:

- `NODE_ENV=test`, `NEARPILL_LEGACY_IMPORT_TARGET=local-test`, `NEARPILL_LEGACY_IMPORT_SYNTHETIC_SOURCE=true`, and `NEARPILL_LEGACY_IMPORT_CONFIRMATION=I_APPROVE_SYNTHETIC_LEGACY_IMPORT`.
- Loopback-only `LEGACY_DB_HOST` and `DB_HOST`, explicit valid `LEGACY_DB_PORT` and `DB_PORT`, and separate database names containing `test`.
- Independently confirmed `NEARPILL_LEGACY_IMPORT_EXPECTED_SOURCE_HOST`, `NEARPILL_LEGACY_IMPORT_EXPECTED_SOURCE_DATABASE`, `NEARPILL_LEGACY_IMPORT_EXPECTED_TARGET_HOST`, and `NEARPILL_LEGACY_IMPORT_EXPECTED_TARGET_DATABASE` matching the corresponding connections exactly.
- Explicit non-root MySQL `LEGACY_DB_USER`/`LEGACY_DB_PASSWORD`, non-owner PostgreSQL `DB_USER`/`DB_PASSWORD`, matching `MIGRATOR_DB_USER`, and `DB_SSL=false` for the loopback target. The actual connected PostgreSQL migrator login/role/database is checked read-only before `BEGIN`.

The flags are **operator assertions, not proof that fixtures are synthetic or that a particular Supabase project is NearPill-owned**. The utility rejects staging/production even with matching credentials. Any real source-data import requires a separate, reviewed Packet 3 data migration/restore procedure and security/data approvals.

Within this restricted test setting, it:

1. requires a fresh/empty PostgreSQL target;
2. reads legacy tables in dependency order;
3. drops the duplicate legacy `orders.userId` column during transfer;
4. inserts explicit IDs to preserve API references;
5. resets PostgreSQL identity sequences after import;
6. executes the import in one PostgreSQL transaction.

It does not dual-write and is not called by the application runtime.

## Integrity and security gates

`npm run db:reconcile` checks nonnegative stock/money, availability values, referential integrity, duplicate inventory keys, forced RLS, and application-role privileges. It reports pgvector presence, but only requires pgvector when the separately approved AI capability is enabled or an explicit extension gate is set.

`npm run db:verify-security` is the live acceptance test. It creates isolated fixtures, proves customer A cannot see customer B's order under the actual `nearpill_app` role, and runs 100 concurrent reservation attempts against stock of 3. Acceptance requires exactly three successful reservations and final stock of zero.

These live database gates require PostgreSQL/pgvector and cannot be replaced by static source inspection. If the execution environment cannot run PostgreSQL, the ledger must retain that fact explicitly even when an owner authorizes dependency advancement.

## Backup/restore

- `backend/scripts/backup-postgres.sh` creates a custom-format `pg_dump` without ownership/ACL data.
- `backend/scripts/restore-postgres.sh` performs a clean `pg_restore` into the selected database.

A real restore drill remains required before production readiness.

## Known deferred policy changes

This persistence migration intentionally preserves current application behavior. Durable sessions, full pharmacy-membership authorization, one-pharmacy checkout, integer-centavo application contracts, provider-confirmed payment/refund truth, and OTC-only cleanup are owned by later implementation packets. PostgreSQL constraints/RLS improve the persistence boundary without silently changing those business policies here.
