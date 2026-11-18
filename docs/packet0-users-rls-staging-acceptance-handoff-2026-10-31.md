# NearPill Packet 0 — NP-031 `users` RLS staging-acceptance handoff

**Date:** 2026-10-31 (Asia/Manila)  
**Status:** BLOCKED / DOCUMENTARY ONLY. This file neither deploys a policy nor certifies any Supabase project.

## Current source finding

The seven existing PostgreSQL migrations (`backend/migrations/postgres/0001_core.sql` through `0007_payment_reconciliation.sql`) do not enable and force RLS on the `public.users` table. The application-role grant and authentication bootstrap paths make an unreviewed blanket policy unsafe. `backend/test/packet0-users-auth-bootstrap-rls.test.mjs` characterizes login, registration, recovery, token lookups, profile changes, and admin identity access *with recording clients only*; those passing tests are not PostgreSQL allow/deny evidence. The existing `backend/scripts/lib/verify-live-fixture-connection.mjs` explicitly requires forced RLS on `users` and checks app-role, Data API roles, and schema/migration-policy inventory before fixture writes. Its live acceptance is NOT RUN.

## Preconditions before any live query or migration

- Obtain explicit owner identification and authorization for a **dedicated NearPill Supabase staging project**. Do not infer ownership from the presence of another project, and do not connect to `renforge`.
- Independently verify project reference, supported PostgreSQL major version, extensions, migration history/checksums, and a completed staging backup/restore route.
- Obtain **separate**, protected direct TLS migrator and least-privilege app-role connection details. The app role must not be owner, superuser, or `BYPASSRLS`; do not use Supabase service-role keys or client Data API credentials as NearPill backend identity.
- Use the existing database verification commands and approved fixture guard, not ad hoc writes or elevated test credentials. Treat any missing prerequisite as **BLOCKED**.

## Read-only inspection, only after approval

Run the following metadata-only statements with the **actual ordinary app role** in the approved staging project. Do not paste URLs, credentials, table contents, or identifying row data into evidence files.

```sql
SELECT current_database() AS database_name, current_user AS current_role,
       session_user AS login_role;
SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
  FROM pg_catalog.pg_roles WHERE rolname = current_user;
SELECT n.nspname AS schema_name, c.relname AS table_name,
       c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
       pg_catalog.pg_get_userbyid(c.relowner) AS owner_name
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname = 'users'
   AND c.relkind IN ('r', 'p');
SELECT policyname, cmd, roles, permissive, qual, with_check
  FROM pg_catalog.pg_policies
 WHERE schemaname = 'public' AND tablename = 'users';
SELECT grantee, privilege_type
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name = 'users';
```

These are **diagnostic**, not acceptance tests: catalog permissions may limit what the role can see, and absence of rows is not proof of safety. The source's existing read-only role/ACL/policy preflight performs broader checks. Reject tests run under a privileged role as evidence of isolation.

## Non-negotiable acceptance sequence

1. Review an **in-place new migration in the existing numbered Drizzle/PostgreSQL history**, not a second schema/auth implementation. The policy design must preserve password verification, registration uniqueness, legacy hash upgrade, reset-token/session-family revocation, authenticated profile operations, and narrowly authorized administration. Do not add a broad `USING (true)`/`WITH CHECK (true)` app-role escape hatch merely to unblock login.
2. On a disposable restore in approved staging, first verify the real non-owner app role, schema/table grants, required forced RLS, policies, and transaction-local verified identity (`set_config(..., true)`). Prove no state leakage after commit, rollback, and pool reuse.
3. Execute **positive and negative** real SQL tests: anonymous users cannot enumerate arbitrary users; unauthenticated recovery/registration does not reveal arbitrary records; customer A cannot read/update B; partner A cannot read B; approved admin and narrowly scoped authentication bootstrap paths continue functioning. Test `SELECT`, `INSERT`, `UPDATE`, `DELETE` and any applicable direct grants using the role actually configured for the backend.
4. Run full original repo characterization and authentication contracts under Node 24/npm 11 with source-authentic lockfiles; run PostgreSQL tenant tests, 100-way stock contention, migration replay, data reconciliation, and a real restore drill. Run Flutter/web checks with their pinned SDKs and locks.
5. Keep the packet **BLOCKED** if any of these gates are missing, fail, or rely only on mocked clients. No production SQL, app-role credential, Supabase cutover, or public payment acceptance is authorized by this handoff.

## Provider decisions retained

Persistent Hono/Drizzle should use a provider-supplied **direct TLS** Postgres connection (or session-mode pooler when IPv4 constraints require it); migration and backup tooling use direct connectivity. Transaction-pooler mode is not the default for prepared statements or session-sensitive context. Backend sessions and verified actor context remain the authority; Supabase Auth is not introduced.

References (checked 2026-10-31):
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://supabase.com/docs/guides/database/postgres/row-level-security

**Next safe packet:** Continue **Packet 0 acceptance** on the approved environment. Packet 1 remains blocked.
