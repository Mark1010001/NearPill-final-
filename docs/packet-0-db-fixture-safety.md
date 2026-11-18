# Packet 0 — Fixture-writing database verification safety preflight

**Purpose:** fail closed before `pg.Pool` construction in the three existing live **verification** scripts that create, update or delete isolated test fixtures:

- `backend/scripts/verify-postgres-security.mjs`
- `backend/scripts/verify-identity-security.mjs`
- `backend/scripts/verify-order-inventory.mjs`

The guard resides at `backend/scripts/lib/verify-fixture-target.mjs`. Each verification pool passes `DB_SSL=true` as `{ rejectUnauthorized: true }`, rather than merely checking the flag; server certificate trust and database connectivity still require real execution. It does **not** alter the production API, Drizzle schema/migration history, backend auth or PostgreSQL RLS. It does not authorize a database cutover, verify target ownership, inspect PostgreSQL grants, or make fixtures non-destructive. It is an operator preflight only. Do not use these scripts on production or live customer records.

## Required explicit configuration (no secrets committed)

| Environment variable | local disposable test database | owner-approved staging test database |
|---|---|---|
| `NODE_ENV` | `test` | `staging` |
| `NEARPILL_VERIFICATION_TARGET` | `local-test` | `staging` |
| `NEARPILL_VERIFICATION_CONFIRMATION` | `I_APPROVE_TEST_FIXTURE_WRITES` | same |
| `DB_HOST` / `DB_NAME` | explicit loopback address / database name containing a `test` segment | explicit approved endpoint / target DB name |
| `DB_PORT` | explicit PostgreSQL port (typically `5432`; approved disposable local alternate permitted) | **exactly `5432`** for direct or Supabase session mode; reject transaction pooling (`6543`) |
| `NEARPILL_VERIFICATION_EXPECTED_HOST` | **exact same host** as expected by operator | **exact same approved host** |
| `NEARPILL_VERIFICATION_EXPECTED_DATABASE` | **exact same DB** as expected by operator | **exact same approved DB** |
| `DB_USER` / `MIGRATOR_DB_USER` | explicit, distinct roles; ordinary app role must not be `postgres`/`service_role`/`supabase_admin` | app role **unqualified** on direct endpoint or exactly `<role>.<project-ref>` on session pooler (no additional dots); migrator role **unqualified** on direct endpoint |
| `MIGRATOR_DB_HOST` / `MIGRATOR_DB_PORT` | optional; defaults to local `DB_HOST` / `DB_PORT` | **required**, direct host `db.<project-ref>.supabase.co`, port `5432`, never a pooler |
| `NEARPILL_VERIFICATION_EXPECTED_MIGRATOR_HOST` | not needed | **required**, must equal the independently approved direct migrator host |
| `DB_SSL` | governed by local setup | **must be `true`** |
| `DB_PASSWORD` / `MIGRATOR_DB_PASSWORD` | supplied through secure environment as needed | both explicitly required |
| `NEARPILL_VERIFICATION_PROJECT_REF` | not applicable | explicitly supplied project reference |
| `NEARPILL_VERIFICATION_OWNER_APPROVED` | not applicable | `true` only after confirming NearPill staging ownership |

A correctly configured **local disposable** test database might use `DB_HOST=127.0.0.1`, `DB_NAME=nearpill_test`, `DB_USER=nearpill_app`, and `MIGRATOR_DB_USER=nearpill_migrator`. The expected-host/database values must be deliberately set as additional confirmation. Staging application traffic may use the dashboard-supplied Supabase direct TLS endpoint or an approved session-mode endpoint; **fixture migrator and reconciliation traffic must use the separately confirmed direct TLS endpoint** with its own non-privileged-for-application, non-`BYPASSRLS` reviewed migrator role. The operator preflight checks the declared hostname and role shape but cannot prove direct network routing or project ownership. No Supabase project reference, password, or URI is supplied or inferred by this plan.

**Caution:** Matching operator-supplied values, an approval flag, and source-level tests **do not prove** a project's identity or safety. Independently confirm project ownership in Supabase, schema, non-bypass app role, backup/restore, fixture isolation, and real database/RLS constraints before any staging execution. Migration/import scripts are separate, privileged operations; this preflight neither covers nor authorizes them. If you do not have that evidence, **do not run the live scripts**.

Run the guard-only tests with:

```bash
node --test backend/test/packet0-db-verification-preflight.test.mjs
```

These tests do not open a database connection or write fixtures.

## 2026-10-20 continuation — verified live connection preflight

The existing three fixture-writing commands now run `assertSafeLiveFixtureConnections` **after** the operator guard but **before** first fixture INSERT/UPDATE/DELETE. The new shared module `backend/scripts/lib/verify-live-fixture-connection.mjs` performs read-only PostgreSQL queries (`pg_roles`, `pg_stat_ssl`, and `pg_class`). Each verifier refuses to execute unless:

- The server reports the expected connected database name and effective application role. For an approved Supabase session-pooler login `role.project_ref`, the database-reported role must be `role`.
- The application and (when used) migrator connection report **neither** `rolsuper` **nor** `rolbypassrls`; privileges must be explicitly false, not missing/null.
- `orders`, `inventory`, and `pharmacy_memberships` exist in `public`, have enabled **and forced** RLS, and are **not** application-role owned.
- In staging, **each** checked PostgreSQL connection reports SSL in `pg_stat_ssl`; checking a connection-string flag by itself is insufficient.
- Application and migration connections use different confirmed database roles.

These checks do not grant permission to run fixtures, determine whether a project belongs to NearPill, certify all table privileges or RLS policy behavior, verify backups, or prove provider connectivity in an environment without PostgreSQL. Real app-role cross-tenant, inventory contention, migration, and restore gates remain **NOT RUN/BLOCKED** until an owner-approved disposable or NearPill-only staging database is provided. Production remains prohibited.

```bash
node --test backend/test/packet0-db-live-connection-preflight.test.mjs
```

The nine new tests use in-memory recording query stubs; they never connect to a database. A code/test pass is not proof that the live Supabase gate passed.

## 2026-10-20 continuation — isolated refresh-token fixture and project-reference binding

Two further Packet 0 verification-tooling corrections were made without changing application authentication, Drizzle, SQL migrations, PostgreSQL role policies, React, or Flutter:

1. `verify-identity-security.mjs` **no longer selects any preexisting user** (`SELECT id FROM users ORDER BY id LIMIT 1`) for refresh replay tests. It now creates a unique synthetic `users` fixture using the distinct migration role *only after* both live role/RLS/TLS checks complete. The existing auth service issues/rotates/rejects tokens for only that synthetic user. The isolated helper deletes exactly that user by its ID **and** generated fixture email in `finally`, including after an assertion failure. A failed deletion surfaces a verification error; its `ON DELETE CASCADE` related auth rows are also removed by existing database constraints. No user account is deliberately reused or revoked.
2. The staging operator preflight binds `NEARPILL_VERIFICATION_PROJECT_REF` to the literal Supabase direct database host `db.<project-ref>.supabase.co` or, for a session-pooler host, requires **both** `DB_USER` and `MIGRATOR_DB_USER` to use `<role>.<project-ref>`. A matching manually supplied expected hostname alone can no longer authorize a different project's endpoint. The session-pooler hostname must be a `*.pooler.supabase.com` domain.

The project-reference check is **not proof of legal/operational project ownership** and a user who supplies all environment variables could still deliberately approve an inappropriate target. Independent owner-approved NearPill staging identity, migration-hash comparison, least-privilege role/RLS negative tests, and backup/restore verification remain mandatory. The scripting tests use recording query stubs and never connect to Supabase. The live commands were **not** executed in this environment.

```bash
node --test backend/test/packet0-isolated-auth-fixture.test.mjs \
  backend/test/packet0-db-verification-preflight.test.mjs
```

## 2026-10-20 continuation — reject inherited elevated PostgreSQL roles

**Packet 0 audit finding:** The original read-only fixture preflight examined only `rolsuper` and `rolbypassrls` on `current_user`. PostgreSQL role membership can give an otherwise ordinary application or migration login a path to an elevated group role, potentially via `SET ROLE` or inherited object privileges. Testing the current role's attributes alone is therefore insufficient. The official PostgreSQL `pg_has_role(..., 'MEMBER')` predicate checks direct **and indirect** membership irrespective of `SET`/`INHERIT` options; this preflight intentionally rejects such membership conservatively when the other role has elevated attributes or is a named privileged Supabase role.

**Implementation:** In the existing shared, read-only `assertSafeLiveFixtureConnections` role probe, check `rolcreaterole`, `rolcreatedb`, `rolreplication`, and transitive `pg_has_role` membership in any role with `SUPERUSER`, `BYPASSRLS`, role/database-creation or replication privileges, or the special `postgres`, `supabase_admin`, or `service_role` identities. Both the application and migrator connections must report **false** for every flag; `NULL`/missing results fail closed. The SQL uses only `SELECT` on PostgreSQL system catalog views and `pg_has_role`. The three existing fixture-writing scripts already call this check before fixture writes.

**Test scope:** The two new tests in `backend/test/packet0-db-live-connection-preflight.test.mjs` verify refusals for every elevated, true/null/missing flag on **both** roles, and assert that the probe actually contains a transitive membership check. Test stubs do not connect to PostgreSQL and do not prove that real roles, grants, RLS policies, table ownership or data are secure. No SQL migrations, application authentication, payment, or stock logic were changed.

**Owner gate:** Run with an explicitly identified, owner-approved NearPill-only test Supabase project and real non-bypass roles, independently review the role membership graph, table/function grants, RLS negative cases and restore plan. A role with a required elevated privilege cannot use these fixture-writing verifiers; review role separation rather than bypassing the guard. Live execution is **NOT RUN/BLOCKED** in this environment.

Official references:
- https://www.postgresql.org/docs/18/functions-info.html (role membership inquiry)
- https://www.postgresql.org/docs/18/role-membership.html (inheritance and SET ROLE)
- https://supabase.com/docs/guides/troubleshooting/custom-role-inherits-privileges-that-were-not-explicitly-granted-ddaa1c

## 2026-10-20 continuation — prevent unscoped order expiry in staging

**Confirmed verification-tooling risk:** `backend/scripts/verify-order-inventory.mjs` calls the existing `createOrderService().expireOldOrders()` during its synthetic reservation test. That production use case intentionally selects **all** eligible expired orders (see `backend/src/application/order-service.js` and `backend/src/infrastructure/postgres/order-repository.js`), not only the synthetic order IDs. Inserting dedicated fixture users/orders does not scope this expiry operation. Even an approved NearPill-owned staging target could contain unrelated orders, which the test could expire.

**Packet 0 fix (no application behavior change):** `assertIsolatedOrderVerifierTarget()` composes the existing fail-closed operator preflight and permits only `NEARPILL_VERIFICATION_TARGET=local-test` with `NODE_ENV=test`, loopback host, and an explicitly named test database. `verify-order-inventory.mjs` calls it **before creating any `pg.Pool`**. It rejects `staging` even with valid project approval and TLS settings. Run this particular integration check only against a truly dedicated, disposable local test database; a name containing `test` alone is **not evidence of actual exclusivity**. Do not point it at a shared developer database.

This restriction does **not** prohibit the separately scoped `verify-postgres-security.mjs` or isolated `verify-identity-security.mjs` from owner-approved staging verification under their existing operator and live-role/RLS/TLS guards. It does mean that the canonical expiry/release-path integration test must be **NOT RUN/BLOCKED** for Supabase staging until a reviewed, ID-scoped expiry test or genuinely exclusive disposable staging environment is available. Do not use an environment override as a bypass.

The following no-database tests prove the guard's permitted/denied cases and that the order verifier invokes it before constructing pools:

```bash
node --test backend/test/packet0-db-verification-preflight.test.mjs backend/test/packet0-db-live-connection-preflight.test.mjs
```

No actual PostgreSQL connection, customer/order modification or production expiry-code change was made in this continuation.

## 2026-10-20 continuation — full protected-table and owner-membership preflight

This Packet 0 verifier-only hardening supersedes the **three-table** scope described in the historical live-preflight section above. `assertSafeLiveFixtureConnections` now requires the full **25 protected PostgreSQL tables** listed by `backend/scripts/reconcile-postgres.mjs` to exist in `public` with **enabled and forced RLS**. It refuses any missing, unforced or unowned/unknown table, an application-owned table, and any application-role direct/indirect membership in the actual table owner. The membership probe uses `pg_has_role(c.relowner, 'MEMBER')`, which is conservative about roles that may be assumable. The tests compare the complete table list to the existing canonical reconciliation script to detect future drift.

This preflight runs with the actual application pool **before fixture writes**; it does not modify SQL migrations, role grants, production RLS, login, orders or payments. Passing its recording-transport tests does **not** prove real PostgreSQL policy behavior, table grants, app-role isolation, Supabase ownership, or backup integrity. Re-check the actual database schema and membership graph with separate least-privilege application and migrator credentials on a verified, owner-approved disposable/staging NearPill target before using any fixture-writing command. Packet 0 remains **NOT ACCEPTED** until the unsupported runtime/lockfile/Flutter/real DB gates are met.

Local executable test command:

```bash
node --test backend/test/packet0-db-live-connection-preflight.test.mjs
```


## 2026-10-20 continuation — Supabase Data API and PUBLIC grants (read-only gate)

The existing 25-table, actual-application-role preflight now additionally checks **effective table-level grants** to the Supabase Data API client roles `anon` and `authenticated`, and direct grants to PostgreSQL `PUBLIC`. Supabase documents grants and row-security policies as separate controls: enabled/forced RLS does not revoke an existing grant, and existing projects may grant client roles table privileges by default. NearPill uses backend-owned sessions, so these **backend-private tables** should not be directly accessible to Supabase client roles.

- `has_table_privilege(exposed.oid, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')` checks privileges available to each existing client role, including inherited grants.
- `aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner)))` checks explicit or default `PUBLIC` table grants, even if a standalone local PostgreSQL instance has no `anon` role.
- For every protected table, **both flags must explicitly be `false`**; `true`, missing, or unknown outcomes stop the fixture-writing verification *before* any test records are inserted.
- The checks are **read-only** and run through the existing application-role pool. They do not change Drizzle SQL, database grants, Supabase Auth, the API, or the frontend. No database was connected in this audit; executable tests use recording query responses.

This scope does **not** test sequences, functions, views, schema `USAGE`, or grants outside the 25 reviewed protected tables. It does **not** prove the absence of a bypass through privileged service keys or other roles, nor does it prove any live tenant policy behavior. Those remain explicit live-database release/Packet 0 acceptance gates. It intentionally does not demand that Supabase's internal `service_role` lose its platform-specific administrative access; ordinary NearPill business traffic must never use that role. Do not change grants in an unidentified Supabase project.

Local no-database test:

```bash
node --test backend/test/packet0-db-live-connection-preflight.test.mjs
```

References: https://supabase.com/docs/guides/database/postgres/row-level-security and https://www.postgresql.org/docs/18/functions-info.html


## 2026-10-20 continuation — cover all public-schema migration tables, including credentials

The previous guard inspected 25 RLS-protected tables but omitted two public-schema tables created by the current seven SQL migrations:

- `users` — contains account information including a password hash; the current migrations do **not** enable/force RLS on it, and the trusted backend needs authenticated identity lookups. **This remains a database authorization design exception and an unresolved release-security review, not a verified safe tenant policy.**
- `nearpill_schema_migrations` — a migration checksum journal intentionally managed only by the migrator. It is outside the 25 forced-RLS table inventory.

The existing **read-only** pre-fixture query now checks both additional tables for existence, valid non-application ownership, no application ownership-role membership, and no direct/inherited Supabase `anon` or `authenticated` or PostgreSQL `PUBLIC` table privileges. It also requires the application role to have **no table privileges** on `nearpill_schema_migrations`. The backend's existing access to `users` is left unchanged; this work does not create a new authentication flow or RLS migration. Missing/null security probe fields stop verification. A source-level test crosschecks the full **27-table** preflight inventory against `CREATE TABLE IF NOT EXISTS` declarations in the actual migration history, so an added table requires explicit classification.

**Important limitation:** Even if the preflight passes on an approved test connection, the lack of `users` RLS means direct app-role SQL is *not* constrained to a single actor at the database row level. Backend authentication and application authorization must remain the sole user lookup authority until a reviewed migration/secure schema decision is designed, characterized and applied in the appropriate dependency packet. Test that boundary with actual least-privilege PostgreSQL permissions and negatives; merely revoking Supabase Data API grants is not equivalent to RLS. Production deployment remains blocked. Schema grants, sequence/function privileges, views and exposed-schema configuration must also be independently reviewed.

Local no-database characterization: `node --test backend/test/packet0-db-live-connection-preflight.test.mjs`. No actual Supabase project was connected, and no database roles, tables, records, migrations, or production code were modified.


## 2026-10-20 continuation — detect public views, routines and sequence grants

**Observed gap:** The live fixture preflight already inspected all 27 migration-defined `public` tables, their row-security flags, ownership, and Supabase Data API table grants, but omitted a separate surface: an unreviewed public view may execute with its privileged owner's rights, a callable public routine may expose privileged operations, and `anon`/`authenticated` can hold sequence privileges independently of table privileges. The reviewed seven NearPill SQL migrations create **no views or callable routines in `public`** (the existing helper functions are in `nearpill`), so there is no reason for a fixture-writing test run to accept unreviewed public view/RPC objects.

**Verification-only improvement:** `assertSafeLiveFixtureConnections` now runs an additional **read-only SQL catalog query** before any fixtures are written. It fails closed if the connected database contains any `public` view or materialized view, any `public` function or procedure, or any `public` sequence with effective `USAGE`, `SELECT` or `UPDATE` access available to `anon`/`authenticated` or directly granted to PostgreSQL `PUBLIC`. This intentionally refuses **unreviewed** surfaces, not necessarily exploitable ones; an approved new view/RPC requires a separate design/security review and an updated explicit policy, not silently weakening the check. The SQL returns only object types, no secrets or object contents. Source tests verify read-only query shape, missing authorization flags and migration inventory; they do **not** execute real Postgres catalog reads or test policy behavior.

The previous **27-table** checks remain intact. The absence of user-table RLS (**NP-031**) remains unresolved and is not treated as a passing security gate. No backend authentication, Drizzle migrations, application RLS policy, production connection, React, Flutter, fixture data, or live Supabase project changed. Actual schemas/views/functions/extensions and grants must be inspected against the explicitly approved NearPill staging project, with data/tenant isolation, migrations, contention and restore proven separately. All such live checks are **NOT RUN / BLOCKED** in this environment.

Official references:
- https://supabase.com/docs/guides/database/views
- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://www.postgresql.org/docs/current/sql-createfunction.html

## 2026-10-20 continuation — read-only canonical migration journal checksum gate

**Observed gap:** The fixture-writing database preflight checked role privileges, table/RLS/grants and exposed `public` objects but did not verify whether the **live** migration journal recorded the seven exact reviewed SQL files. A stale, unreviewed or changed migration could pass the coarse table inventory check while fixture-writing tests modify a database whose schema lineage is not the canonical NearPill history.

**Implementation:** After verifying distinct least-privilege application and migrator connections and before any fixture INSERT/UPDATE/DELETE, `backend/scripts/lib/verify-live-fixture-connection.mjs` now requires the existing migrator connection and reads `public.nearpill_schema_migrations` using a read-only `SELECT filename, sha256`. It computes SHA-256 from the existing `backend/migrations/postgres/NNNN_*.sql` files and **rejects missing, extra, renamed or mismatched migration rows**. The application role remains denied access to the journal. This does **not** replay migrations, run DDL, repair drift or assert that on-disk migrations were applied correctly; only a real staging database can supply live evidence.

**Characterization:** Recording-transport tests verify the seven-file source history, reject missing/extra/changed/unavailable journal entries and reject a missing migrator connection. Tests use no PostgreSQL credentials or network connection. Run locally with `node --test backend/test/packet0-db-live-connection-preflight.test.mjs`. This local pass is **not** real database or Supabase acceptance.

**Release gate:** Before any Supabase cutover, independently establish project ownership, run the real journal checksum/RLS/tenant negative tests under verified roles, reconcile actual data, test restoration and obtain approved migration/rollback evidence. The existing `users` RLS exception (NP-031) remains unresolved; source-hash equality cannot certify authorization correctness.


## 2026-10-20 continuation — unexpected public-table catalog gate

The 27 known public tables are explicitly reviewed, but a database may also contain a table created outside the seven canonical migrations. Before any fixture-writing verification, the existing application-role live preflight now **queries `pg_class` and `pg_namespace` without mutating schema/data** and refuses additional public ordinary tables (`relkind = r`), partitioned tables (`p`), or foreign tables (`f`). This is intentionally stricter than checking only RLS settings or client grants on the known tables. Unexpected catalog results and unavailable/malformed query responses stop verification, rather than being silently treated as safe. The review list is the same existing 25 protected tables plus `users` and `nearpill_schema_migrations`; no extra database authority was introduced.

The local recording-transport tests cover refusal for each relation type and confirm SELECT-only SQL. They do **not** establish a live database inventory, RLS or grant behavior, Data API exposure, or production fitness. Actual Supabase checks remain BLOCKED pending explicit NearPill project verification, supported tooling and correct least-privilege credentials. The previously identified `users` RLS gap (NP-031) is unchanged.


## 2026-10-20 continuation — verify actual session login in addition to effective role

The original live-connection probe verified `current_user`, which PostgreSQL changes when a session executes `SET ROLE`. A connection originally authenticated as a privileged database account could temporarily report an ordinary application `current_user`. A fixture-writing verifier must not mistake that effective identity for evidence that the *session's login role* is least-privilege.

The existing read-only role probe now returns both `current_user AS role_name` and `session_user AS session_role_name`. Both the application connection and the separate migration connection must report the exact approved underlying login role (`<role>` for an approved Supabase session-pooler connection configured as `<role>.<project-ref>`). A missing/null/mismatched session identity fails closed **before any fixture writes**. The existing checks for superuser, `BYPASSRLS`, privilege-bearing role memberships, table grants/forced RLS, public objects, and migration checksums remain required.

The two new recording-transport tests reject hidden privileged session logins and null/missing/mismatched session identities for both connection types; they also inspect the actual probe SQL to ensure both identities are selected. The change does not modify PostgreSQL roles, application SQL, authentication, Supabase projects or Drizzle migrations. It is **not** proof that any real Supabase pooler or tenant policy passed verification. A pooler that reports a different privileged `session_user` must be investigated rather than bypassing the gate.

```bash
node --test backend/test/packet0-db-live-connection-preflight.test.mjs
```

References: PostgreSQL's official `SET ROLE` and system-information documentation (`session_user` versus `current_user`):
- https://www.postgresql.org/docs/18/sql-set-role.html
- https://www.postgresql.org/docs/18/functions-info.html

No live Supabase connection, migration or data write was performed in this continuation.

### Port and pooling safeguard (20 October 2026)

`DB_PORT` must be explicitly set and must be a valid TCP port. For approved Supabase staging verification, the guard accepts only **5432** (direct or session-mode pooler), refusing **6543** and other ports before opening a pool. Supabase transaction mode is inappropriate for this session-sensitive verification; driver defaults must not silently select an endpoint. This is an operator preflight only: it does **not** prove the host belongs to NearPill, that the session is truly direct/session pooled, that TLS certificate verification succeeded, or that live RLS/transaction behavior is safe. The existing read-only live role, grants, journal, and catalog preflight plus real negative tests are still required.

Official reference: https://supabase.com/docs/guides/database/connecting-to-postgres

## 2026-10-20 — Consistent read-only reconciliation snapshot

`backend/scripts/reconcile-postgres.mjs` runs its count/invariant, protected-table RLS, role and extension checks on one checked-out **migrator** client inside `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`. Its existing explicit-target and live-role/migration preflights run first. The snapshot uses one consistent view under concurrent writes; the database rejects writes in the read-only transaction. A failure triggers `ROLLBACK`, and the client is released in every case. No partial success is logged until `COMMIT` succeeds.

Local recording-client tests verify transaction ordering and failure cleanup; they **do not** demonstrate PostgreSQL grant/RLS enforcement, cross-tenant access, real transaction races, or correctness of a connected Supabase deployment. Run on a specifically verified NearPill-owned disposable/approved staging database with distinct app/migrator identities and reviewed migrations. Packet 0 remains blocked until those tests and supported-runtime/mobile builds run.

## 2026-10-20 continuation — reviewed `pg_trgm` extension routines in `public`

**Source-confirmed compatibility defect:** Migration `backend/migrations/postgres/0005_catalog_discovery.sql` installs `pg_trgm` **with schema `public`**. PostgreSQL's `pg_trgm` extension defines callable similarity functions. The previous pre-fixture catalog guard rejected *every* `public` routine, which would reject extension-owned functions on a canonical NearPill database even if no unreviewed RPC existed. The earlier claim that this migration history produces no public routines applied to *custom application routines*, not extension members.

The read-only `PUBLIC_SURFACE_PROBE_SQL` now excludes only `public` functions that **PostgreSQL's `pg_depend` catalog identifies as true `deptype='e'` members** of the reviewed `pg_extension.extname='pg_trgm'`, in the extension's declared schema, with `prosecdef=false`. It does not allow procedures, `SECURITY DEFINER` functions, same-named non-extension functions, or functions belonging to any other extension. Public views, materialized views and client-accessible sequences remain rejected. The migration files and production application are unchanged. This fix is a *source-level false-rejection correction*, not real Postgres validation or blanket approval for an exposed schema.

The recording-transport contract tests assert actual dependency-catalog SQL, source migration provenance, fail-closed public RPC behavior and malformed responses. No PostgreSQL connection is available here, so the SQL predicate and its actual effect against PostgreSQL catalogs remain **NOT RUN / BLOCKED** until testing on a NearPill-owned disposable/staging database. Database grants/RLS, `users` table policy (NP-031), and restore/concurrency gates remain independent blockers.

References: https://www.postgresql.org/docs/current/pgtrgm.html ; https://www.postgresql.org/docs/current/catalog-pg-depend.html ; https://supabase.com/docs/guides/database/postgres/row-level-security


## 2026-10-20 continuation — safe disposable-only PostgreSQL restore

**Packet 0 safety finding:** `backend/scripts/restore-postgres.sh` previously accepted a dump and used default database/role values before invoking `pg_restore --clean`. That command drops objects in its target. A mistakenly inherited production/Supabase environment could therefore cause destructive restoration. This is a verification/operational safety correction, **not** permission to run a restore on any NearPill live database.

The existing restore entry point is now **local disposable test DB only**, with a side-effect-free gate in `backend/scripts/lib/verify-restore-target.mjs`. It rejects missing consent, all staging/production targets, unconfirmed or non-loopback hosts, names not explicitly marked `test`, malformed PostgreSQL ports, URI-like database names, default admin roles, mismatched migrator identities, missing password, and absent archive files **before launching `pg_restore`**. No default host/database/role is inferred. The `pg_restore` subprocess receives an isolated environment containing only the executable search path and its password; inherited libpq environment settings cannot silently redirect it to a remote host. The actual restore uses `--single-transaction --exit-on-error` with the existing `--clean --if-exists --no-owner --no-acl`, so a command failure aborts rather than silently accepting a partial restore.

Operators must use a *separately provisioned, disposable local PostgreSQL database* and confirm the destination and dump. Example configuration values (use protected secrets, never commit them):

```text
NODE_ENV=test
NEARPILL_VERIFICATION_TARGET=local-test
NEARPILL_RESTORE_CONFIRMATION=I_APPROVE_DESTRUCTIVE_TEST_RESTORE
NEARPILL_RESTORE_EXPECTED_SHA256=<64 lowercase hexadecimal characters of independently approved archive>
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=nearpill_test_restore
NEARPILL_RESTORE_EXPECTED_HOST=127.0.0.1
NEARPILL_RESTORE_EXPECTED_DATABASE=nearpill_test_restore
DB_USER=nearpill_migrator
MIGRATOR_DB_USER=nearpill_migrator
DB_PASSWORD=<secret supplied securely>
```

Invoke `backend/scripts/restore-postgres.sh /approved/local/sanitized.dump` only on that disposable test database. Compute the SHA-256 of the intended local archive using `sha256sum /approved/local/sanitized.dump` before independently approving the corresponding `NEARPILL_RESTORE_EXPECTED_SHA256`. The script compares that value with the **private staged snapshot** before any `pg_restore` invocation, rejecting an absent, malformed or mismatched digest. This binds a destructive operation to a specific archive fingerprint; it cannot certify the source, safety, trust or recoverability of the archive. These text values are examples, **not** actual NearPill credentials or target approval. The script validates the local target configuration, but cannot independently prove that the database behind a loopback proxy is disposable or that an archive is sanitized; operators must verify these separately. Staging/production restore is deliberately blocked until a separate, reviewed provider-specific recovery runbook exists.

`node --test backend/test/packet0-disposable-restore-guard.test.mjs` uses a fake `pg_restore` binary to prove safe refusals and command construction. No PostgreSQL connection or real restore was performed; actual restore, data integrity, role/RLS preservation and backup/restore drill are **NOT RUN/BLOCKED**.

Reference: https://www.postgresql.org/docs/current/app-pgrestore.html (`--clean`, `--single-transaction`, `--exit-on-error`).


## 2026-10-24 — Inspect a restore archive before destructive local-test operation

The existing disposable-only restore guard checked operator consent, an exact
loopback database, and an existing file but went directly to `pg_restore --clean`.
That meant it did not independently reject a file whose PostgreSQL archive
catalog was unreadable **before** starting the destructive restore invocation.

The same existing `backend/scripts/restore-postgres.sh` now invokes
`pg_restore --list -- <archive>` with a sanitized environment and no database
arguments first. If archive catalog inspection fails (including a missing
`pg_restore` executable), it exits **2 / RESTORE BLOCKED** before any `--clean`
operation, without echoing archive metadata or credentials. A valid catalog
proceeds through the unchanged single-transaction, exit-on-error local restore.

The existing `backend/test/packet0-disposable-restore-guard.test.mjs` now
uses fake `pg_restore` calls to check that a failing `--list` cannot reach
`--clean` and that the successful path inspects the catalog first. Combined
backup/restore contract tests are **no-database** tests; a listable archive
can still have damaged data, and only a real restore/reconciliation on an
approved disposable database can prove recoverability. Supabase staging and
production restores remain prohibited by this script.

PostgreSQL reference: https://www.postgresql.org/docs/18/app-pgrestore.html

## 2026-10-20 — Secure disposable-local backup preflight

The original `backend/scripts/backup-postgres.sh` inferred a PostgreSQL host,
role and database from defaults and wrote a custom-format dump to the current
working directory. A dump can contain sensitive account, order and payment
records. The Packet 0 backup entrypoint now **only** supports an explicitly
approved disposable local PostgreSQL test database; staging/production backups
are separate Supabase operational procedures requiring verified project ownership,
retention, access-control and restore planning. This is not a live backup drill.

Before running the existing script, create a **private directory** owned by the
running user (`mkdir -m 700 ...`), choose an absolute previously unused `.dump`
filename, and explicitly provide all of these values through a secure environment:

```text
NODE_ENV=test
NEARPILL_VERIFICATION_TARGET=local-test
NEARPILL_BACKUP_CONFIRMATION=I_APPROVE_LOCAL_TEST_BACKUP
NEARPILL_BACKUP_EXPECTED_HOST=127.0.0.1
NEARPILL_BACKUP_EXPECTED_DATABASE=nearpill_test_backup
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=nearpill_test_backup
DB_USER=nearpill_migrator
MIGRATOR_DB_USER=nearpill_migrator
DB_PASSWORD=<supplied securely, never committed>
BACKUP_FILE=<absolute path within the private directory>/nearpill-test-yyyymmdd.dump
```

`backend/scripts/backup-postgres.sh` invokes
`backend/scripts/lib/verify-backup-target.mjs` **before `pg_dump`**. It refuses
staging/production/non-test targets, unconfirmed host/database or non-admin
migrator, missing credentials, invalid ports, world-accessible output folders,
existing files and symlinks. Its `pg_dump` child receives a minimal environment
so inherited `PGHOSTADDR`/`PGSERVICE` cannot redirect it. It writes a private
`0600` temporary archive and publishes it only after a nonempty dump, a
successful `pg_restore --list` catalog inspection **and full offline payload
extraction** with `pg_restore --file=/dev/null --no-owner --no-acl` against the
same temporary archive. It never replaces an existing archive. If either
preflight fails or the dump is empty, the private temporary file is removed and
no finished backup is published. The generated SQL/COPY output and inspection
diagnostics are suppressed so sensitive data cannot be printed.
Generated `.dump` files are excluded by `.gitignore`; protect the storage and
separately verify retention/encryption and successful restores before acceptance.

Run local **no-database** characterization with:

```bash
node --test backend/test/packet0-private-backup-guard.test.mjs
```

These tests invoke fake `pg_dump` and `pg_restore` executables, **not PostgreSQL**.
The `--list` check inspects the catalog; `--file=/dev/null` additionally checks
whether a full SQL/COPY payload can be emitted without database access.
Neither check proves transactionally successful restoration, SQL trust or data reconciliation.
They provide no proof of actual backup consistency, restore accuracy, privileged data access or a
managed Supabase backup. A real owner-approved NearPill Supabase restore drill
and RLS/data-integrity checks remain `NOT RUN/BLOCKED`.

References: https://supabase.com/docs/guides/platform/backups and
https://supabase.com/docs/guides/database/connecting-to-postgres

## 2026-10-20 continuation — verify backup archive catalog before publication

The original backup success gate checked only that `pg_dump` exited successfully
and produced a nonempty file. A nonempty `.dump` is not necessarily a readable
custom-format archive. The same private temporary file is now inspected with
`pg_restore --list` in an empty environment **before** the hard-link publication
step. The command prints no table-of-contents data to the console; any inspection
failure, including unavailable `pg_restore`, fails closed and triggers existing
partial-file cleanup. Existing-file/symlink protections and local-test-only
restrictions are unchanged.

`node --test backend/test/packet0-private-backup-guard.test.mjs` now tests
archive inspection, failure cleanup and no-publication using **fake tools**.
This is **not** a real PostgreSQL backup or restore drill, and `--list` is not a
full integrity check of stored table rows. Independently approved Supabase
backup recovery, row reconciliation, RLS and grant tests remain blocked.

Reference: https://www.postgresql.org/docs/current/app-pgrestore.html


## 2026-10-20 continuation — verify `public` schema CREATE privileges

The existing live fixture preflight already checks 27 reviewed tables, forced RLS,
application-role ownership, Supabase client/table grants, the migration journal,
views, RPCs and sequences. **Schema `CREATE` privilege is independent of
these checks**: an untrusted role may be able to introduce new `public` objects
even when all existing tables have safe grants and RLS.

The same application-role, **read-only** preflight now inspects PostgreSQL's
`pg_namespace` and refuses fixture writes if the ordinary application role,
`anon`, `authenticated`, or PostgreSQL `PUBLIC` can create objects in `public`.
It also refuses membership in the `public` schema owner and missing or unknown
schema ownership or privilege flags. On owner-approved Supabase **staging**,
both actual `anon` and `authenticated` roles must exist so a negative grant
check cannot succeed vacuously. Disposable local PostgreSQL need not implement
Supabase's API roles; it must still pass the CREATE and ownership checks.
Only these catalog `SELECT`s run; no schema, role, session, grant, migration
or production application logic is changed.

Execute the isolated regression tests with:

```bash
node --test backend/test/packet0-db-live-connection-preflight.test.mjs
```

**Evidence limitation:** These tests use recording database responses and were
not executed against an approved NearPill Supabase project. Local pass is not
live privilege verification, and this does not resolve the unprotected `users`
RLS policy gap (NP-031) or substitute for negative tenant tests, data
reconciliation, concurrency or restore drills. Obtain actual least-privilege
roles, the right direct/session-mode connection and reviewed migrations before
running fixture writers on an independently verified project.

Sources: https://www.postgresql.org/docs/current/ddl-schemas.html and
https://supabase.com/docs/guides/database/postgres/row-level-security

## 2026-10-20 continuation — align migration journal coverage with the actual runner

The actual `backend/scripts/migrate-postgres.mjs` executes **every lowercase
`.sql` file** in `backend/migrations/postgres`. The fixture preflight previously
ignored executable `.sql` files whose names did not match its approved
`NNNN_slug.sql` convention. It now inventories the full executable `.sql` set,
**refuses unreviewed filenames instead of silently excluding them**, and checks
that the journal contains distinct filenames with exactly matching SHA-256
checksums. An unrelated non-SQL documentation file is not a migration.

Run the recording-transport tests with:

```bash
node --test backend/test/packet0-db-live-connection-preflight.test.mjs
```

This change does **not** execute or alter migrations. A local pass verifies only
source/control-flow behavior, not the actual Supabase migration journal, roles,
RLS, data integrity or backup/restore. The approved staging database and
supported toolchains are still required before Packet 0 can be accepted.

## 2026-10-20 continuation — reviewed RLS policy inventory gate

Forced RLS and revoked client grants do not establish that the *policies* on a
protected table remain the reviewed ones. The existing read-only live preflight
now queries `pg_catalog.pg_policies` for the 25 protected tables and checks each
policy's table/name, command type, permissive/restrictive mode, and exactly one
approved role (`nearpill_app` or `nearpill_migrator`) against policy definitions
from the seven canonical SQL migration files. It also characterizes the two
migrations that generate policies via `EXECUTE format(...)` and verifies their
source table arrays before constructing the expected inventory. The reviewed
source currently contains **78 active policy tuples**, including 25 narrowly
scoped `migrator_all` policies and six `identity_security_app` policies.

Any missing, additional, renamed, duplicate, broadened-role or changed-command
policy is rejected **before fixture writes**. The preflight also retrieves the
`pg_policies.qual` and `pg_policies.with_check` columns. App-role SELECT/DELETE
policies must have nontrivial `USING` predicates; INSERT policies must have a
nontrivial `WITH CHECK`; UPDATE and ALL policies require both. The check rejects
missing, null, empty, and obviously unconditionally true predicates. Migration-
only `nearpill_migrator` policies intentionally keep their reviewed unrestricted
predicates. The active reviewed medicine-read policy was narrowed in migration
0005, so there is no current app-role `USING (true)` exemption.

This is a **read-only structural predicate safety floor**, **not expression
parity**: PostgreSQL normalizes SQL, and a nontrivial string can still express
an unsafe predicate (for example, a deliberately broadened OR condition). The
live test must prove policy semantics with app-role positive and cross-tenant
negative tests. Actual
Supabase role, row isolation, capability, and negative read/write tests remain
**NOT RUN / BLOCKED** until a NearPill-owned staging PostgreSQL target is
verified. In particular, the unresolved `users`-table RLS issue (NP-031) remains
unaccepted. Neither the source policy list nor these mocked catalog tests
proves production safety, provider cutover, or functional parity.

Run the recording-only regression:

```bash
node --test backend/test/packet0-db-live-connection-preflight.test.mjs
```

No production Hono/Drizzle/auth flow or migration SQL was changed.


## 2026-10-20 continuation — explicit default-privilege catalog check

Existing table grants, forced RLS and policy inventory alone do not cover grants configured for **future** objects via `pg_default_acl`. Before any fixture-writing verification, the existing read-only app-role preflight now rejects explicit default grants to PostgreSQL `PUBLIC` or effective Supabase `anon`/`authenticated` identities (including inherited memberships), both globally and for the `public` schema. Checked privilege categories include relations, sequences, routines, schemas and types. Unavailable catalog results block execution. The new recording-transport tests inspect the SQL and verify failure before migrator-journal access.

**Scope limitation:** This check covers **explicit** default ACL entries, not implicit PostgreSQL defaults such as the default `PUBLIC EXECUTE` privilege on newly created functions; it is not a replacement for reviewing functions, default privileges, schema `CREATE`, RLS expressions or actual `anon`/`authenticated` access on the owner-approved Supabase staging project. No database was accessed or altered, and NP-031 remains open. The ordinary backend and migrator roles remain separate.

References: https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html and https://supabase.com/docs/guides/database/postgres/row-level-security

## 2026-10-20 continuation — Supabase client `SET ROLE` grant boundary

An effective privilege query (`has_table_privilege`, `has_schema_privilege`, or
`has_sequence_privilege`) detects direct or inherited access, but can miss
permissions available only by assuming a role with `SET ROLE`. The read-only
fixture preflight now rejects both kinds of client access on NearPill private
public-schema tables, schema creation, sequences, and explicit default ACLs.
It inspects grants in PostgreSQL catalogs and tests whether `anon` or
`authenticated` may `SET ROLE` to an ACL grantee. This is a non-destructive
pre-fixture guard, tested using recording SQL responses. It does **not**
prove which roles a live Supabase project grants, does not inspect RLS
expressions or fix NP-031, and does not replace live client-role negative tests.

References: https://www.postgresql.org/docs/18/role-membership.html and
https://www.postgresql.org/docs/18/functions-info.html


## 2026-10-20 continuation — complete public policy catalog scope

The `pg_catalog.pg_policies` inventory check now queries **all 27 known public
NearPill tables**, not only the 25 previously protected tables. This includes
`users` and `nearpill_schema_migrations`. The existing seven reviewed SQL
migrations define **no policies on either exceptional table**. An unexpected
policy on either table is therefore a source/deployment discrepancy, not an
implicitly authorized exception: the read-only preflight fails **before the
migrator migration-journal query or any synthetic fixture write**. Policies
introduced by a future approved migration must also be reflected in the
source-backed policy contract.

The recording-transport tests model the actual `WHERE tablename = ANY($1)`
filter and prove that ad hoc `users`/journal policies would previously have
been omitted from the result. This is a preflight *inventory* check, not
semantic proof of RLS predicates or authentication. The existing **NP-031**
`users` forced-RLS and login-compatibility migration remains unimplemented,
and all real app-role cross-tenant, source-to-deployment parity and Supabase
staging gates remain **NOT RUN/BLOCKED**. No SQL migrations or live credentials
were touched.

References: https://www.postgresql.org/docs/current/view-pg-policies.html
and https://www.postgresql.org/docs/current/ddl-rowsecurity.html.


## 2026-10-20 — Cross-customer order RLS negative-write characterization

`backend/scripts/verify-postgres-security.mjs` retains its approved-target guard and read-only actual-role/grant/RLS/migration preflight **before** synthetic fixture insertion. It now calls the existing test-only `backend/scripts/lib/verify-order-tenant-isolation.mjs` helper after creating two synthetic customers and their orders. Using the ordinary app-role pool, the verifier checks each customer's own-order read, absence of cross-customer reads, **zero affected rows** for cross-customer `UPDATE` and `DELETE`, and PostgreSQL SQLSTATE `42501` **with an explicit row-level-security violation message** for a cross-customer `INSERT` (a missing SQL `GRANT` also returns `42501` and is *not* accepted as proof of RLS). A denial caused by an unrelated constraint/network/SQL error is not accepted.

Each attempt starts a transaction, installs transaction-local customer and empty capability context, and rolls back regardless of whether the operation fails. The verifier reads the same connection **after rollback** to detect leaked `app.user_id`, `app.role` and `app.capability` before returning it to the pool. The new `packet0-order-rls-write-negatives.test.mjs` exercises this path with a recording transport only. These tests are not substitutes for live RLS isolation, actual database-role checks, identity-login parity, migration replay, or real stock contention. The `users` RLS blocker NP-031 remains unresolved in the seven reviewed migrations.


## 2026-10-20 continuation — wait for all concurrent fixture attempts before cleanup

The existing `verify-postgres-security.mjs` and `verify-order-inventory.mjs` both launch 100 concurrent verification requests. Previously they used fail-fast `Promise.all`. On any rejected attempt, an enclosing `finally` could begin removing synthetic orders, inventory or users while other attempts had not finished their transactions. This is unsafe even on a disposable test database and can obscure the initial failure with cleanup errors.

Both scripts now use the **same verification-only** `backend/scripts/lib/verify-concurrent-attempts.mjs` helper. It starts the requested bounded number of tasks, awaits `Promise.allSettled`, and only then returns results or throws an `AggregateError` containing all failures. The scripts retain their existing 100-attempt policies, PostgreSQL transaction handling, idempotency rules, result assertions and cleanup. They do not authorize shared database use, alter production order/inventory code, or replace true PostgreSQL concurrency checks.

`backend/test/packet0-concurrent-fixture-settlement.test.mjs` exercises the actual helper with an artificially delayed worker and an earlier failure, verifies that a failed attempt **cannot** trigger cleanup before the delayed worker finishes, and checks source-level use from both canonical scripts. The neighboring order/inventory contract now asserts the settled 100-attempt helper instead of the superseded `Promise.all` syntax. No live Supabase, PostgreSQL or actual inventory contention test was run.

## 2026-10-20 continuation — discard failed RLS-verification pool connections

The `withCustomer` transaction helper in
`backend/scripts/lib/verify-order-tenant-isolation.mjs` previously called
`client.release()` even when `BEGIN` failed, `ROLLBACK` failed, the
post-rollback actor/capability check failed, or that check could not be run.
In those cases the verifier could return an unsafe connection to the app-role
pool and allow subsequent synthetic tenant checks to reuse unverified state.

The verifier now returns a connection to the reusable pool **only after** a
successful `ROLLBACK` **and** successful verification that `app.user_id`,
`app.role` and `app.capability` were cleared. On any uncertainty it invokes
`client.release(true)` to destroy the connection, as supported by the
node-postgres pool contract. An expected denied INSERT, followed by a clean
rollback and context inspection, remains a normal reusable transaction.

`backend/test/packet0-rls-pool-cleanup.test.mjs` proves the initial defect
using a recording transport (four rejection cases returned a poisoned
connection), then verifies clean-path reuse and connection destruction for
failed BEGIN, failed ROLLBACK, leaked identity state and failed reset query.
These are **local verifier tests only**: no real Supabase connection, actual
PostgreSQL pool-reuse test or RLS guarantee is claimed. The owner-approved
Supabase staging, NP-031 `users` RLS remediation, tenant-negative tests,
concurrency, migration replay and real restore gates remain **NOT RUN/BLOCKED**.

Reference: https://github.com/brianc/node-postgres/blob/master/docs/pages/apis/pool.mdx

## 2026-10-20 continuation — discard uncertain inventory-verification pool sessions

The live 100-attempt inventory verifier in `backend/scripts/verify-postgres-security.mjs`
previously released its application-role pooled connection unconditionally, even if
`ROLLBACK` failed after an attempt error. The test-only helper
`backend/scripts/lib/verify-inventory-pool-isolation.mjs` now performs the same
conditional reservation inside one transaction; it returns the connection to the
pool only after `COMMIT` **and** confirmation that transaction-local
`app.user_id`, `app.role` and `app.capability` are cleared on that physical
connection. Any `BEGIN`/query/`COMMIT`/rollback/reset failure destroys the
connection with `client.release(true)`. Malformed reservation results fail
before commit. The existing `settleFixtureAttempts(100, ...)` still waits for
all outstanding attempts before synthetic-fixture cleanup.

`backend/test/packet0-inventory-pool-isolation.test.mjs` checks the helper with
recording connections (successful reservation, no stock, failed BEGIN/SET/
UPDATE/COMMIT/ROLLBACK/reset inspection, leaked context, malformed result and
invalid fixture). These tests **do not prove** the behavior of a real PostgreSQL
connection or NearPill's Supabase deployment. Do not run fixture-writing tests
against unverified staging/production projects; Packet 0 remains **BLOCKED**
until the supported runtime, approved staging project, actual app-role RLS
negatives, live inventory contention, and data/restore gates pass. The known
NP-031 `users` forced-RLS design gap is unchanged.

## 2026-10-20 continuation — complete cleanup of synthetic order-verification fixtures

`backend/scripts/verify-order-inventory.mjs` previously stopped deleting fixtures
when the first `DELETE` failed. On a disposable test database, this could
leave otherwise removable synthetic inventory, medicine, store or user records
behind and obscure the failed verifier's outcome. The existing order/inventory
verification command now delegates cleanup to
`backend/scripts/lib/cleanup-order-fixtures.mjs`: it validates recorded
positive integer fixture IDs before any deletion, attempts the five deletions
in their original dependency order, collects all failures as an
`AggregateError`, and closes **both** pools using `Promise.allSettled` even
when deletion fails. If both the verification and cleanup fail, the reported
error retains both causes. `PASS` is printed **only after** verification,
cleanup and pool shutdown all succeed.

Run `node --test backend/test/packet0-order-fixture-cleanup.test.mjs` to
exercise this verification-only behavior without opening a database. These
recording-transport tests do not establish real PostgreSQL fixture cleanup,
referential cascade correctness or safe deployment. The global-expiry
verifier remains restricted to an explicitly approved disposable local test
database; staging/production execution is still prohibited.

## 2026-10-20 continuation — fail-closed RLS security-fixture cleanup

The synthetic cross-customer/100-way security verifier
`backend/scripts/verify-postgres-security.mjs` previously attempted its cleanup
from the same migration client and stopped on the first failing `DELETE`. If a
transaction was aborted or a synthetic child row could not be deleted, later
fixtures could remain. Furthermore, the original pass messages appeared before
teardown had been verified.

The verifier now finishes or rolls back the fixture setup transaction before
cleanup, destroys its migration client if rollback fails, and delegates each
recorded synthetic fixture deletion to
`backend/scripts/lib/cleanup-rls-fixtures.mjs` using the separate migrator pool.
The helper validates all recorded integer IDs *before* any DELETE, targets only
the two recorded orders, inventory row, medicine, store and two users, and
attempts every eligible deletion in dependency order. Failures are aggregated;
any original verification error is preserved alongside cleanup/connection-close
failures. Both pools are closed even if cleanup fails, and neither PASS message
is emitted until all steps succeed.

Run `node --test backend/test/packet0-rls-fixture-cleanup.test.mjs` for eight
recording-transport contract tests. These **do not** prove live PostgreSQL
teardown correctness; orphan/constraint behavior, real RLS, 100-way contention,
NP-031 (`users` forced RLS), reconciliation and real backup/restore remain
**NOT RUN / BLOCKED** until an authorized NearPill-owned staging or isolated
test database and the supported toolchains are available. Do not bypass the
existing operator-target and live-role/grant preflight.


## 2026-10-20 continuation — committed RLS-fixture deletion evidence

**Audit finding:** The RLS verification teardown previously treated any resolved
PostgreSQL `DELETE` as successful cleanup, even when it returned `rowCount=0`
after the synthetic fixture transaction had committed. This can hide residual
test data when the migration-role connection has unexpectedly filtered or
failed to affect the recorded rows.

`backend/scripts/lib/cleanup-rls-fixtures.mjs` now requires a boolean
`fixtureCommitted` argument. If the fixture's `COMMIT` succeeded, it requires
exactly the expected number of affected rows for each recorded DELETE:
recorded orders/users can contain two IDs; other recorded fixture objects
contain one ID. A result with missing, nonintegral, negative, excessive, or
insufficient `rowCount` is a **cleanup failure**, and every remaining cleanup
step is still attempted. If the fixture transaction did not commit, zero rows
is legitimate after its rollback; the affected-row result must nevertheless be
well formed and cannot exceed the number of recorded IDs.

`backend/scripts/verify-postgres-security.mjs` records the actual commit
outcome and passes it to the cleanup helper. This does not change the
production reservation, authentication, RLS policy, or migration code.
Recording-transport negative tests characterize the result-count contract,
missing outcome handling, and cleanup continuation, but **do not prove a
connected Supabase database's delete behavior or permissions**. Continue to
require the explicit approved fixture target, real non-bypass app-role RLS
negative tests, and data reconciliation before accepting Packet 0.

Relevant PostgreSQL semantics: `DELETE` command tags report the count of
rows deleted. See https://www.postgresql.org/docs/18/sql-delete.html .

## 2026-10-20 continuation — verified order/inventory fixture deletion counts

The canonical local-only order/inventory verification previously accepted a
resolved `DELETE` even if the migrator's result reported zero affected rows.
`backend/scripts/lib/cleanup-order-fixtures.mjs` now checks PostgreSQL
`rowCount` on every committed synthetic singleton deletion. After the 100
contention attempts have settled and exactly three successful orders have been
observed, `verify-order-inventory.mjs` records `fixture.expectedOrderCount=3`
and teardown requires exactly three deleted orders. For an interrupted test
where the total number of committed orders is not known, teardown accepts a
well-formed `0..100` order count but still rejects malformed or unexpectedly
broad deletion results. It always continues with the remaining fixture rows
and aggregates errors; a false success is not printed.

Run `node --test backend/test/packet0-order-fixture-cleanup.test.mjs` for the
recording-query contracts. This is not real PostgreSQL proof of teardown or
RLS: use only the explicitly approved disposable local test database for the
canonical verifier (which calls the global order-expiry job), retain separate
app and migration roles, and preserve all blocked real database gates. Never
interpret local checks as a Supabase cutover. PostgreSQL DELETE reports the
number of deleted rows in the command tag:
https://www.postgresql.org/docs/18/sql-delete.html .


## 2026-10-20 continuation — verify the global expiry target before mutation

`backend/scripts/verify-order-inventory.mjs` exercises the real application
`expireOldOrders()` use case. This use case intentionally expires **every**
qualifying order in the database, not just its current test fixture. The
previous operator gate already limited the verifier to a confirmed disposable
local test database, but it did not check whether that database actually held
other orders. An accidentally reused local test DB could have unrelated
expired orders modified during verification.

A new read-only helper, `backend/scripts/lib/verify-order-expiry-scope.mjs`,
rejects any pre-existing order before the verifier creates fixtures. Immediately
before invoking `expireOldOrders()`, it also requires the eligible expired-order
set to contain **exactly the recorded synthetic expiry-order ID**. Missing,
extra, malformed or unrelated results stop verification before the global
expiry call. The guard is exercised by `packet0-order-expiry-scope.test.mjs`.

These checks are additional safeguards, **not a serialization guarantee**:
concurrent external writers can change the set between inspection and expiry.
The operator must still use a fully isolated, quiescent, disposable local
PostgreSQL test database; neither staging nor production is permitted. No SQL
migration or production expiry behavior changed. Real database behavior remains
**NOT RUN/BLOCKED** without the authorized test environment.

## 2026-10-23 — Supabase direct migrator boundary (supersedes older shared-host staging examples)

**Confirmed Packet 0 verification defect:** All three fixture-writing verification commands and
`reconcile-postgres.mjs` previously constructed the migrator connection using `DB_HOST` / `DB_PORT`
even if the app used a Supabase session-mode pooler. This violates the approved separate *direct*
migration/backup connection boundary. The older 2026-10-20 pooler example that assigned
`MIGRATOR_DB_USER=<role>.<ref>` is historical and **must not be used** for staging verification.

For an independently approved NearPill-only Supabase staging project, configure (through
protected environment settings, never a committed credential file):

- Application `DB_HOST`, `DB_PORT=5432`, `DB_USER`: direct or session-mode endpoint and corresponding login.
- `MIGRATOR_DB_HOST=db.<approved-project-ref>.supabase.co`, `MIGRATOR_DB_PORT=5432`, and
  `NEARPILL_VERIFICATION_EXPECTED_MIGRATOR_HOST` set to the independently confirmed same direct host.
- `MIGRATOR_DB_USER`: **unqualified** PostgreSQL role (for example `nearpill_migrator`),
  distinct from the ordinary app role; its secret is supplied independently.
- `DB_SSL=true` is passed with `rejectUnauthorized: true` to **both** pools. Direct
  connectivity and trusted certificate validation still require actual execution.

For `local-test`, the existing explicitly approved loopback database and default migrator
connection behavior remain unchanged. All four scripts invoke the existing operator guard
before any pool is constructed, then check live roles, grants and migration checksums before
any fixture writes. The order-expiry verifier **remains local-test only**. This correction
changes verification connection configuration, not business logic or schema, and cannot
replace an actual Supabase staging connection, real RLS isolation/concurrency, migration
replay or a restore drill. If the host cannot reach the direct Supabase endpoint,
**mark the staging gate BLOCKED** rather than falling back to transaction/session pooling.

Official provider documentation: https://supabase.com/docs/guides/database/connecting-to-postgres

## 2026-10-23 — direct/session username-shape guard (Packet 0 continuation)

The staging operator preflight now enforces the **mode-specific app login**
format documented by Supabase: an unqualified PostgreSQL role on
`db.<project-ref>.supabase.co:5432`, or exactly `<role>.<project-ref>` on a
shared session-mode `*.pooler.supabase.com:5432` endpoint. Previously, the
preflight could accept a session-style username with a direct host and a
multiply qualified username with the pooler. These fail before construction
of any DB pool. The separately approved direct migrator requirement and
local disposable-test behavior are unchanged.

This is a configuration-format check, not an independent proof of project
ownership, DNS routing, connection TLS or actual PostgreSQL role identity.
The subsequent read-only live role check and staging security gates must still
run before any fixture writes. Verification: 
`node --test backend/test/packet0-db-verification-preflight.test.mjs` (offline).
Official provider reference: https://supabase.com/docs/guides/database/connecting-to-postgres

## 2026-10-24 — Validate backup data payload before publication (Packet 0)

The existing local disposable backup already inspected the custom-format TOC,
but a TOC-readable archive with a broken compressed data section could still
be published as a successful backup. The same original
`backend/scripts/backup-postgres.sh` now performs an **offline** full-payload
`pg_restore --file=/dev/null --no-owner --no-acl` extraction after the catalog
inspection and **before** the atomic publish step. Both preflights consume the
same private `.partial.*` archive under a minimal child environment and suppress
SQL, data and error output. A failed extraction removes the partial archive and
preserves any existing destination. No Supabase/live database is contacted by
these no-database contract tests.

The red-first fake-`pg_restore` test simulates a readable catalog and unreadable
payload, then verifies failure, cleanup and no published `.dump`; the success
test confirms both commands inspect the same temporary archive. This is a
readability screen, **not** an SQL security audit, point-in-time consistency
proof, real restore drill, or live Supabase acceptance. Those gates remain
blocked until the approved PostgreSQL staging environment is available.

Reference: https://www.postgresql.org/docs/18/app-pgrestore.html


## 2026-10-24 — Reject restore source symlink substitutions during private staging (Packet 0)

The existing disposable-only restore script rejected a symlink at the initial
`-f`/`-L` check, but a caller-controlled source pathname could be replaced with
a symlink just before `cp` opened it. Plain `cp` follows that late link and
previously allowed its target to be staged and fed to `pg_restore`, bypassing
the initial source restriction. This is a local file-substitution boundary,
**not** evidence of access to an approved Supabase environment.

The original `backend/scripts/restore-postgres.sh` now stages with GNU
`cp -P` (do not dereference a source symlink), refuses staged symlinks and
non-regular files **before `chmod`**, and retains the existing same-snapshot
catalog/payload/destructive-restore checks and temporary cleanup. This prevents
`chmod` from following a late source link and changing an unrelated target.
The deterministic red-first test replaces the source with a symlink from the
`cp` execution boundary: original script proceeded (FAIL), updated script
blocks before any `pg_restore` invocation (PASS). The linked target's mode
remains unchanged. A source controlled by a malicious local user can still
change its *regular-file contents* during staging; only a trusted approved
archive and a real restore/reconciliation drill establish acceptable operation.

Reference: https://www.gnu.org/s/coreutils/manual/html_node/cp-invocation.html


## 2026-10-24 — Exact-path backup publication under a late destination substitution (Packet 0)

The existing backup guard verifies that the requested `.dump` output pathname
is unused before running `pg_dump`. Between that check and publication, another
process can create a directory (or a symlink pointing at one) at the intended
output filename. GNU `ln` without `-T` treats that destination as a directory
and creates the hard link *inside it*, potentially exporting sensitive test
data to an unintended path while printing a misleading success message.

The canonical `backend/scripts/backup-postgres.sh` now publishes with GNU
`ln -T -- "$temporary" "$BACKUP_FILE"`, checks that exact operation and
returns a generic error with no archive contents on failure. The existing
0600 private temporary archive is deleted by the shell cleanup trap. The
change preserves exclusive no-overwrite publication for normal output names.

Red-first contract evidence demonstrates that the original script returned
status 0 when a fake `pg_dump` substituted a destination symlink to a directory.
After the fix, no archive appears inside that directory, both directory and
symlink replacements fail, and normal archive publication remains intact.
These are controlled local mock tests, not PostgreSQL recovery or Supabase
security acceptance. GNU Coreutils reference:
https://www.gnu.org/software/coreutils/manual/html_node/Target-directory.html


## 2026-10-24 Packet 0 — case-variant reserved role names during disposable restore

The disposable restore target guard previously compared the configured migrator
name to `postgres`, `supabase_admin`, and `service_role` case-sensitively.
In contrast, the backup guard already rejected case variants. The restore
guard now conservatively normalizes the configured name before this denylist
comparison and blocks the restore before invoking any PostgreSQL command.
Characterization exercises `POSTGRES`, `Supabase_Admin`, and `SERVICE_ROLE`,
including the shell entry point. Source-level name checks **do not prove** a
non-superuser or non-`BYPASSRLS` role: independent catalog/membership checks
against an owner-approved, disposable database remain mandatory. No live
connections, SQL, migrations, grants, or application authentication changed.

Local test: `node --test backend/test/packet0-disposable-restore-guard.test.mjs`
with fake PostgreSQL executables only.
