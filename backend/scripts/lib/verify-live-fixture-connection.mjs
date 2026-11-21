import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadReviewedMigrationSources, literalSqlStatements, reviewedDropTableTargets } from './reviewed-migration-sources.mjs';
export { assertReviewedMigrationFilenames } from './reviewed-migration-sources.mjs';

/**
 * Read-only live database preflight for fixture-writing verification commands.
 * This deliberately runs AFTER the no-connect operator guard, and BEFORE
 * INSERT/UPDATE/DELETE fixtures. It is not a replacement for RLS negative tests.
 * Do not use a privileged connection as proof of application-role isolation.
 */
const ROLE_PROBE_SQL = `
  SELECT current_user AS role_name,
         -- current_user can change via SET ROLE while session_user retains
         -- the original login authority. Require both to be the approved role.
         session_user AS session_role_name,
         current_database() AS database_name,
         r.rolsuper AS is_superuser,
         r.rolbypassrls AS bypass_rls,
         r.rolcreaterole AS can_create_roles,
         r.rolcreatedb AS can_create_databases,
         r.rolreplication AS can_replicate,
         -- A non-BYPASSRLS role can still inherit privileges or SET ROLE to
         -- an elevated role. MEMBER traverses direct/indirect role membership,
         -- including grants that are not inherited automatically.
         -- Subscription, reserved-connection and autovacuum-signal rights
         -- are operational privileges, not application query authority.
         EXISTS (
           SELECT 1 FROM pg_roles AS privileged
           -- Include the login itself: privileged PostgreSQL predefined
           -- roles must never be accepted if enabled for direct LOGIN.
           -- The reserved pg_ prefix also covers future predefined roles.
           WHERE (
               left(privileged.rolname, 3) = 'pg_' OR
               privileged.rolsuper OR privileged.rolbypassrls OR
               privileged.rolcreaterole OR privileged.rolcreatedb OR
               privileged.rolreplication OR
               privileged.rolname IN (
                 'postgres', 'supabase_admin', 'service_role', 'pg_maintain',
                 'pg_read_all_data', 'pg_write_all_data',
                 'pg_read_server_files', 'pg_write_server_files',
                 'pg_execute_server_program',
                 'pg_monitor', 'pg_read_all_settings', 'pg_read_all_stats',
                 'pg_stat_scan_tables', 'pg_signal_backend', 'pg_checkpoint',
                 'pg_create_subscription', 'pg_use_reserved_connections',
                 'pg_signal_autovacuum_worker'
               )
             )
             AND pg_has_role(r.oid, privileged.oid, 'MEMBER')
         ) AS elevated_role_membership,
         -- Supabase Data API roles must not gain monitoring, operational,
         -- global data authority or
         -- server-file/program privileges via inherited OR SET-able roles.
         -- Table ACL and RLS probes alone cannot detect these paths.
         EXISTS (
           SELECT 1 FROM pg_roles AS exposed
           JOIN pg_roles AS privileged ON (
             left(privileged.rolname, 3) = 'pg_' OR
             privileged.rolsuper OR privileged.rolbypassrls OR
             privileged.rolcreaterole OR privileged.rolcreatedb OR
             privileged.rolreplication OR
             privileged.rolname IN (
               'postgres', 'supabase_admin', 'service_role', 'pg_maintain',
               'pg_read_all_data', 'pg_write_all_data',
               'pg_read_server_files', 'pg_write_server_files',
               'pg_execute_server_program',
               'pg_monitor', 'pg_read_all_settings', 'pg_read_all_stats',
               'pg_stat_scan_tables', 'pg_signal_backend', 'pg_checkpoint',
                 'pg_create_subscription', 'pg_use_reserved_connections',
                 'pg_signal_autovacuum_worker'
             )
           )
           WHERE exposed.rolname IN ('anon', 'authenticated')
             AND pg_has_role(exposed.oid, privileged.oid, 'MEMBER')
         ) AS client_elevated_role_membership,
         (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS tls_active
  FROM pg_roles AS r WHERE r.rolname = current_user
`;

// Database-level CREATE is independent of CREATE on the three reviewed
// schemas. It permits creating *new* schemas (and trusted extensions), so an
// application or Data API role with this privilege could establish an
// unreviewed execution surface outside the schema-only inspection. Standard
// PostgreSQL CONNECT and TEMPORARY defaults are intentionally not restricted.
const DATABASE_CREATION_PRIVILEGE_PROBE_SQL = `
  SELECT pg_get_userbyid(d.datdba) AS database_owner,
         pg_has_role(d.datdba, 'MEMBER') AS app_can_assume_database_owner,
         has_database_privilege(current_user, d.oid, 'CREATE') OR EXISTS (
           SELECT 1 FROM aclexplode(
             COALESCE(d.datacl, acldefault('d', d.datdba))
           ) AS acl
           WHERE acl.grantee <> 0 AND acl.privilege_type = 'CREATE'
             AND pg_has_role(current_user, acl.grantee, 'SET')
         ) AS app_can_create_database_objects,
         EXISTS (
           SELECT 1 FROM pg_roles AS exposed
           WHERE exposed.rolname IN ('anon', 'authenticated')
             AND (has_database_privilege(exposed.oid, d.oid, 'CREATE') OR EXISTS (
               SELECT 1 FROM aclexplode(
                 COALESCE(d.datacl, acldefault('d', d.datdba))
               ) AS acl
               WHERE acl.grantee <> 0 AND acl.privilege_type = 'CREATE'
                 AND pg_has_role(exposed.oid, acl.grantee, 'SET')
             ))
         ) AS client_can_create_database_objects,
         EXISTS (
           SELECT 1 FROM aclexplode(
             COALESCE(d.datacl, acldefault('d', d.datdba))
           ) AS acl WHERE acl.grantee = 0 AND acl.privilege_type = 'CREATE'
         ) AS public_can_create_database_objects
  FROM pg_database AS d WHERE d.datname = current_database()
`;

const TABLE_PROBE_SQL = `
  SELECT c.relname AS table_name,
         c.relrowsecurity AS rls_enabled,
         c.relforcerowsecurity AS rls_forced,
         pg_get_userbyid(c.relowner) AS owner_name,
         -- App-role membership in a table owner permits potential RLS DDL
         -- escalation even if the login itself does not own the table.
         pg_has_role(c.relowner, 'MEMBER') AS app_can_assume_owner,
         -- Supabase's Data API client roles and PUBLIC must have no table
         -- grants to these backend-private tables, independent of RLS.
         -- has_table_privilege also evaluates inherited role privileges.
         EXISTS (
           SELECT 1 FROM pg_roles AS exposed
           WHERE exposed.rolname IN ('anon', 'authenticated')
             AND has_table_privilege(
               exposed.oid, c.oid,
               'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
             )
         ) OR EXISTS (
           -- has_table_privilege covers current/inherited rights, not grants
           -- reachable only after a Supabase API role executes SET ROLE.
           SELECT 1 FROM pg_roles AS exposed
           CROSS JOIN LATERAL aclexplode(
             COALESCE(c.relacl, acldefault('r', c.relowner))
           ) AS acl
           WHERE exposed.rolname IN ('anon', 'authenticated')
             AND acl.grantee <> 0
             AND acl.privilege_type IN (
               'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'
             )
             AND pg_has_role(exposed.oid, acl.grantee, 'SET')
         ) AS exposed_client_grant,
         -- Table ACLs do not include grants on individual columns.
         -- Supabase anon/authenticated must not obtain even partial private
         -- table access via a direct column grant or a SET ROLE-only grant.
         EXISTS (
           SELECT 1 FROM pg_roles AS exposed
           WHERE exposed.rolname IN ('anon', 'authenticated')
             AND has_any_column_privilege(
               exposed.oid, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'
             )
         ) OR EXISTS (
           SELECT 1 FROM pg_roles AS exposed
           JOIN pg_attribute AS a ON a.attrelid = c.oid
             AND a.attnum > 0 AND NOT a.attisdropped
           CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
           WHERE exposed.rolname IN ('anon', 'authenticated')
             AND acl.grantee <> 0
             AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
             AND pg_has_role(exposed.oid, acl.grantee, 'SET')
         ) AS exposed_client_column_grant,
         EXISTS (
           SELECT 1 FROM pg_attribute AS a
           CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
           WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
             AND acl.grantee = 0
             AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
         ) AS public_column_grant,
         EXISTS (
           SELECT 1
           FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
           WHERE acl.grantee = 0
             AND acl.privilege_type IN (
               'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'
             )
         ) AS public_grant,
         -- The migration journal must not be readable or writable by the
         -- ordinary application role, regardless of its RLS setting.
         has_table_privilege(
           current_user, c.oid,
           'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
         ) AS app_role_grant,
         has_any_column_privilege(
           current_user, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'
         ) AS app_role_column_grant,
         -- The ordinary app login must not access the migration journal even
         -- through a non-inherited membership whose privileges are available
         -- only after SET ROLE. Effective current-user checks miss that path.
         EXISTS (
           SELECT 1
           FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
           WHERE acl.grantee <> 0
             AND acl.privilege_type IN (
               'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'
             )
             AND pg_has_role(current_user, acl.grantee, 'SET')
         ) AS app_role_switch_table_grant,
         EXISTS (
           SELECT 1 FROM pg_attribute AS a
           CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
           WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
             AND acl.grantee <> 0
             AND acl.privilege_type IN ('SELECT','INSERT','UPDATE','REFERENCES')
             AND pg_has_role(current_user, acl.grantee, 'SET')
         ) AS app_role_switch_column_grant,
         -- FORCE RLS does NOT restrict TRUNCATE/REFERENCES, and TRIGGER
         -- permits unreviewed trigger creation. The ordinary app role must
         -- never acquire any of these privileges, even by SET ROLE.
         has_table_privilege(
           current_user, c.oid, 'TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
         ) AS app_non_rls_table_privilege,
         EXISTS (
           SELECT 1
           FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
           WHERE acl.grantee <> 0
             AND acl.privilege_type IN ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
             AND pg_has_role(current_user, acl.grantee, 'SET')
         ) AS app_role_switch_non_rls_table_privilege,
         -- REFERENCES can be granted on columns independently of tables.
         has_any_column_privilege(
           current_user, c.oid, 'REFERENCES'
         ) AS app_non_rls_column_privilege,
         EXISTS (
           SELECT 1 FROM pg_attribute AS a
           CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
           WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
             AND acl.grantee <> 0 AND acl.privilege_type = 'REFERENCES'
             AND pg_has_role(current_user, acl.grantee, 'SET')
         ) AS app_role_switch_non_rls_column_privilege
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    AND c.relname = ANY($1::text[])
`;

// Forced RLS and revoked Data API grants are not sufficient if a new policy
// allows unintended operations to the application role. Confirm the active
// PostgreSQL policy *inventory* against the reviewed canonical migrations.
// A structural predicate check additionally rejects absent or trivially TRUE
// app-role USING / WITH CHECK expressions. It is NOT expression-parity or
// tenant-isolation proof; live app-role negative tests remain mandatory.
export const POLICY_INVENTORY_PROBE_SQL = `
  SELECT CASE WHEN schemaname = 'public' THEN tablename::text ELSE schemaname || '.' || tablename END AS tablename,
         policyname, roles::text[] AS roles, cmd, permissive, qual, with_check
  FROM pg_catalog.pg_policies
  WHERE (schemaname = 'public' AND tablename = ANY($1::text[]))
     OR (schemaname = 'nearpill' AND (schemaname || '.' || tablename) = ANY($1::text[]))
`;

// Schema CREATE permissions are independent of table grants and RLS. A
// backend application role or Data API role able to create objects in public
// can introduce new functions, tables or search_path shadowing even when the
// currently reviewed 27 tables are locked down. Never use an owner's privileges
// as proof that the ordinary app role is constrained.
const PUBLIC_SCHEMA_PRIVILEGE_PROBE_SQL = `
  SELECT pg_get_userbyid(n.nspowner) AS schema_owner,
         pg_has_role(n.nspowner, 'MEMBER') AS app_can_assume_schema_owner,
         -- A least-privilege app login can gain schema CREATE through a
         -- non-inherited role membership with SET TRUE, even if its current
         -- role has no CREATE privilege. Refuse that indirect authority too.
         has_schema_privilege(current_user, n.oid, 'CREATE') OR EXISTS (
           SELECT 1 FROM aclexplode(
             COALESCE(n.nspacl, acldefault('n', n.nspowner))
           ) AS acl
           WHERE acl.grantee <> 0 AND acl.privilege_type = 'CREATE'
             AND pg_has_role(current_user, acl.grantee, 'SET')
         ) AS app_can_create,
         EXISTS (
           SELECT 1 FROM pg_roles AS exposed
           WHERE exposed.rolname IN ('anon', 'authenticated')
             AND has_schema_privilege(exposed.oid, n.oid, 'CREATE')
         ) OR EXISTS (
           SELECT 1 FROM pg_roles AS exposed
           CROSS JOIN LATERAL aclexplode(
             COALESCE(n.nspacl, acldefault('n', n.nspowner))
           ) AS acl
           WHERE exposed.rolname IN ('anon', 'authenticated')
             AND acl.grantee <> 0 AND acl.privilege_type = 'CREATE'
             AND pg_has_role(exposed.oid, acl.grantee, 'SET')
         ) AS client_can_create,
         EXISTS (
           SELECT 1 FROM aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) AS acl
           WHERE acl.grantee = 0 AND acl.privilege_type = 'CREATE'
         ) AS public_can_create,
         (SELECT COUNT(*) = 2 FROM pg_roles
          WHERE rolname IN ('anon', 'authenticated')) AS api_roles_present
  FROM pg_namespace AS n WHERE n.nspname = 'public'
`;

// These two reviewed schemas host authorization context helpers and vetted
// extensions. Supabase Data API roles have no reason to reach either schema,
// and the ordinary backend role must never be able to create shadow helpers.
// Review effective/inherited rights and privileges reachable via SET ROLE.
// This is read-only metadata, not proof that application transactions set a
// trustworthy actor/capability context (live negative RLS tests remain required).
const INTERNAL_SCHEMA_PRIVILEGE_PROBE_SQL = `
  SELECT n.nspname AS schema_name,
         pg_get_userbyid(n.nspowner) AS schema_owner,
         pg_has_role(n.nspowner, 'MEMBER') AS app_can_assume_schema_owner,
         has_schema_privilege(current_user, n.oid, 'CREATE') OR EXISTS (
           SELECT 1 FROM aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) AS acl
           WHERE acl.grantee <> 0 AND acl.privilege_type = 'CREATE'
             AND pg_has_role(current_user, acl.grantee, 'SET')
         ) AS app_can_create,
         EXISTS (
           SELECT 1 FROM pg_roles AS exposed
           WHERE exposed.rolname IN ('anon', 'authenticated')
             AND (has_schema_privilege(exposed.oid, n.oid, 'CREATE') OR EXISTS (
               SELECT 1 FROM aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) AS acl
               WHERE acl.grantee <> 0 AND acl.privilege_type = 'CREATE'
                 AND pg_has_role(exposed.oid, acl.grantee, 'SET')
             ))
         ) AS client_can_create,
         EXISTS (
           SELECT 1 FROM pg_roles AS exposed
           WHERE exposed.rolname IN ('anon', 'authenticated')
             AND (has_schema_privilege(exposed.oid, n.oid, 'USAGE') OR EXISTS (
               SELECT 1 FROM aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) AS acl
               WHERE acl.grantee <> 0 AND acl.privilege_type = 'USAGE'
                 AND pg_has_role(exposed.oid, acl.grantee, 'SET')
             ))
         ) AS client_can_use,
         EXISTS (
           SELECT 1 FROM aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) AS acl
           WHERE acl.grantee = 0 AND acl.privilege_type = 'CREATE'
         ) AS public_can_create,
         EXISTS (
           SELECT 1 FROM aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) AS acl
           WHERE acl.grantee = 0 AND acl.privilege_type = 'USAGE'
         ) AS public_can_use
  FROM pg_namespace AS n WHERE n.nspname = ANY($1::text[])
`;

// NearPill authentication-context helpers live outside public but are invoked
// by RLS policies. Their EXECUTE ACLs are independent of schema USAGE, and
// PostgreSQL grants EXECUTE to PUBLIC for new functions by default. Reject
// unexpected helpers, elevated SECURITY DEFINER routines, untrusted owners,
// and callable paths for Data API roles or PUBLIC before synthetic fixture
// writes. A reviewed future migration must revoke default PUBLIC EXECUTE and
// explicitly grant only the backend roles that need each helper.
const INTERNAL_ROUTINE_PROBE_SQL = `
  SELECT p.proname AS internal_function_name,
         pg_get_function_identity_arguments(p.oid) AS identity_arguments,
         p.prokind AS routine_kind,
         language.lanname AS routine_language,
         p.prorettype::regtype::text AS return_type,
         p.prosecdef AS security_definer,
         p.proconfig AS routine_settings,
         p.prosrc AS source_body,
         pg_get_userbyid(p.proowner) AS owner_name,
         pg_has_role(p.proowner, 'MEMBER') AS app_can_assume_owner,
         has_function_privilege(current_user, p.oid, 'EXECUTE') AS app_can_execute,
         EXISTS (
           SELECT 1 FROM pg_roles AS exposed
           WHERE exposed.rolname IN ('anon', 'authenticated')
             AND has_function_privilege(exposed.oid, p.oid, 'EXECUTE')
         ) OR EXISTS (
           SELECT 1 FROM pg_roles AS exposed
           CROSS JOIN LATERAL aclexplode(
             COALESCE(p.proacl, acldefault('f', p.proowner))
           ) AS acl
           WHERE exposed.rolname IN ('anon', 'authenticated')
             AND acl.grantee <> 0 AND acl.privilege_type = 'EXECUTE'
             AND pg_has_role(exposed.oid, acl.grantee, 'SET')
         ) AS client_can_execute,
         EXISTS (
           SELECT 1 FROM aclexplode(
             COALESCE(p.proacl, acldefault('f', p.proowner))
           ) AS acl
           WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
         ) AS public_can_execute
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  JOIN pg_language AS language ON language.oid = p.prolang
  WHERE n.nspname = 'nearpill'
`;

// One verification process reads the canonical migration directory once: the
// parsed sources are immutable inputs, and re-reading and re-parsing roughly
// forty files for every preflight call made the live-DB test suite take minutes.
let canonicalMigrationSources;
async function loadCanonicalMigrationSources() {
  canonicalMigrationSources ??= loadReviewedMigrationSources(MIGRATION_DIRECTORY);
  return canonicalMigrationSources;
}
const derivedInventories = new Map();
function memoizedInventory(key, derive) {
  if (!derivedInventories.has(key)) derivedInventories.set(key, derive());
  return derivedInventories.get(key).then((value) => structuredClone(value));
}

const REVIEWED_INTERNAL_ROUTINES = Object.freeze({
  current_actor_id: { result: 'integer', language: 'sql', searchPath: 'search_path=pg_catalog' },
  current_actor_role: { result: 'text', language: 'sql', searchPath: 'search_path=pg_catalog' },
  current_capability: { result: 'text', language: 'sql', searchPath: 'search_path=pg_catalog' },
  touch_updated_at: { result: 'trigger', language: 'plpgsql', searchPath: 'search_path=pg_catalog, public, nearpill' },
  set_order_group_owner: { result: 'trigger', language: 'plpgsql', searchPath: 'search_path=pg_catalog, public, nearpill' },
  guard_inventory_authority: { result: 'trigger', language: 'plpgsql', searchPath: 'search_path=pg_catalog, public, nearpill' },
  guard_inventory_selling_unit: { result: 'trigger', language: 'plpgsql', searchPath: 'search_path=pg_catalog, nearpill' },
  canonical_category: { args: 'value text', result: 'text', language: 'sql', searchPath: 'search_path=pg_catalog' },
  normalize_medicine_category: { result: 'trigger', language: 'plpgsql', searchPath: 'search_path=pg_catalog, nearpill' },
});

/**
 * Source-backed routine-body baseline, not a second implementation of the
 * helpers. pg_proc.prosrc is PostgreSQL's stored body for these SQL/PLpgSQL
 * string-literal functions. A metadata-only check misses a replaced body that
 * broadens tenant/actor decisions without changing a signature or grants.
 * The canonical migration history is the only expected-body authority.
 */
export function reviewedInternalRoutineBodiesFromSources(sources) {
  if (!Array.isArray(sources) || !sources.length) {
    throw new Error('Internal routine body inventory requires reviewed migrations.');
  }
  const expected = new Set(Object.keys(REVIEWED_INTERNAL_ROUTINES));
  const bodies = new Map();
  for (const { filename, sql } of sources) {
    for (const { statement, line } of literalSqlStatements(sql, filename)) {
      if (!/^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+nearpill\./i.test(statement)) continue;
      const signature = /^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+nearpill\.([a-z_][a-z0-9_]*)\s*\(([^)]*)\)/i.exec(statement);
      const name = signature?.[1]?.toLowerCase();
      if (!name || !expected.has(name) ||
          signature[2].replace(/\s+/g, ' ').trim().toLowerCase() !== (REVIEWED_INTERNAL_ROUTINES[name].args ?? '')) {
        throw new Error(`Unreviewed internal helper definition at ${filename}:${line}.`);
      }
      const match = /\bAS\s+(\$[a-z_0-9]*\$)([\s\S]*?)\1\s*$/i.exec(statement);
      if (!match || !match[2].trim()) {
        throw new Error(`Unverifiable internal helper body at ${filename}:${line}.`);
      }
      // Replacements within later reviewed migrations supersede earlier ones.
      bodies.set(name, match[2].replace(/\r\n/g, '\n').trim());
    }
  }
  if (bodies.size !== expected.size) {
    throw new Error('Missing reviewed internal helper body definitions.');
  }
  return Object.fromEntries(bodies);
}

async function reviewedInternalRoutineBodies() {
  return memoizedInventory('routines', async () => reviewedInternalRoutineBodiesFromSources(await loadCanonicalMigrationSources()));
}

function assertInternalRoutineBoundary(rows, appRole, expectedBodies) {
  const names = Object.keys(REVIEWED_INTERNAL_ROUTINES);
  if (!Array.isArray(rows) || rows.length !== names.length ||
      new Set(rows.map((row) => row?.internal_function_name)).size !== names.length) {
    throw new Error('Live DB verification refused: unreviewed or missing internal helper routine.');
  }
  for (const name of names) {
    const row = rows.find((entry) => entry?.internal_function_name === name);
    const expected = REVIEWED_INTERNAL_ROUTINES[name];
    const config = row?.routine_settings;
    if (!row || row.identity_arguments !== (expected.args ?? '') || row.routine_kind !== 'f' ||
        row.return_type !== expected.result || row.routine_language !== expected.language || row.security_definer !== false ||
        !row.owner_name || row.owner_name === appRole ||
        row.app_can_assume_owner !== false ||
        row.client_can_execute !== false || row.public_can_execute !== false ||
        typeof row.source_body !== 'string' ||
        row.source_body.replace(/\r\n/g, '\n').trim() !== expectedBodies?.[name] ||
        (name !== 'touch_updated_at' && row.app_can_execute !== true) ||
        !Array.isArray(config) || config.length !== 1 || typeof config[0] !== 'string' ||
        config[0].replace(/\s+/g, ' ').trim().toLowerCase() !== expected.searchPath) {
      throw new Error(`Live DB verification refused: unsafe internal helper routine ${name}.`);
    }
  }
}

// The reviewed `nearpill` schema contains ONLY authorization/trigger
// functions. Do not silently accept a new relation (including a view, foreign
// table, or sequence) under that private schema: it could introduce an
// unreviewed path for data or side effects outside the canonical repositories.
// The separately reviewed nearpill_extensions schema intentionally contains
// extension-owned objects and is NOT conflated with the authorization schema.
const INTERNAL_AUTH_RELATIONS_PROBE_SQL = `
  SELECT c.relname AS internal_relation_name, c.relkind AS internal_relation_kind,
         c.relrowsecurity, c.relforcerowsecurity,
         NOT pg_has_role(c.relowner, 'MEMBER') AND NOT EXISTS (
           SELECT 1 FROM aclexplode(c.relacl) acl
           WHERE acl.grantee <> c.relowner
             AND (acl.grantee <> 'nearpill_app'::regrole OR acl.is_grantable OR
               CASE WHEN c.relkind = 'S' THEN acl.privilege_type <> 'USAGE'
               ELSE acl.privilege_type NOT IN ('SELECT','INSERT','UPDATE') END)
         ) AS safe_acl
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'nearpill'
    AND c.relkind IN ('r', 'p', 'f', 'v', 'm', 'S')
`;

// The four reviewed helper bodies alone do not prove which trigger invokes
// them. An added, disabled or retargeted application trigger could mutate
// inventory/order records outside the canonical backend transaction path.
// Inventory user-defined public triggers through pg_trigger; PostgreSQL's
// internal FK/constraint triggers are managed by the engine and excluded.
const PUBLIC_APP_TRIGGER_PROBE_SQL = `
  SELECT c.relname AS trigger_table_name,
         t.tgname AS trigger_name,
         fnsp.nspname AS trigger_function_schema,
         fn.proname AS trigger_function_name,
         pg_get_function_identity_arguments(fn.oid) AS trigger_function_identity_arguments,
         t.tgtype::integer AS trigger_type,
         t.tgenabled::text AS trigger_enabled,
         t.tgisinternal AS trigger_internal,
         (t.tgparentid <> 0::oid) AS trigger_is_clone,
         (t.tgconstraint <> 0::oid) AS trigger_is_constraint,
         t.tgdeferrable AS trigger_deferrable,
         t.tginitdeferred AS trigger_initially_deferred,
         t.tgnargs::integer AS trigger_argument_count,
         COALESCE((SELECT string_agg(a.attname::text, ',' ORDER BY a.attname)
                   FROM unnest(t.tgattr::int2[]) AS k(attnum)
                   JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = k.attnum), '') AS trigger_update_columns,
         (t.tgqual IS NOT NULL) AS trigger_has_when,
         (t.tgoldtable IS NOT NULL) AS trigger_has_old_transition,
         (t.tgnewtable IS NOT NULL) AS trigger_has_new_transition
  FROM pg_trigger AS t
  JOIN pg_class AS c ON c.oid = t.tgrelid
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  JOIN pg_proc AS fn ON fn.oid = t.tgfoid
  JOIN pg_namespace AS fnsp ON fnsp.oid = fn.pronamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
`;

// A clean *enabled-trigger* result can be vacuous when an expected foreign
// key was dropped entirely. Derive the exact 41 single-column FK relationships
// from the seven reviewed CREATE TABLE statements and verify the deployed
// catalog's source/target columns, ON DELETE actions and validation state.
// PostgreSQL 18 added NOT ENFORCED foreign keys: convalidated=true alone is
// insufficient. Use a JSONB attribute lookup guarded by the server version,
// rather than referencing 18-only k.conenforced in SQL that must also parse on
// PostgreSQL 17. An absent/unreadable attribute on PG18 fails closed.
const FOREIGN_KEY_INVENTORY_PROBE_SQL = `
  SELECT src.relname AS fk_source_table,
         src_col.attname AS fk_source_column,
         dest_ns.nspname AS fk_target_schema,
         dest.relname AS fk_target_table,
         dest_col.attname AS fk_target_column,
         ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY AS col(attnum, pos)
               JOIN pg_attribute a ON a.attrelid = src.oid AND a.attnum = col.attnum ORDER BY col.pos) AS fk_source_columns,
         ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY AS col(attnum, pos)
               JOIN pg_attribute a ON a.attrelid = dest.oid AND a.attnum = col.attnum ORDER BY col.pos) AS fk_target_columns,
         cardinality(k.conkey)::integer AS fk_source_column_count,
         cardinality(k.confkey)::integer AS fk_target_column_count,
         k.convalidated AS fk_validated,
         CASE WHEN current_setting('server_version_num')::integer >= 180000
              THEN (to_jsonb(k)->>'conenforced')::boolean
              ELSE true
         END AS fk_enforced,
         k.confdeltype::text AS fk_delete_action,
         k.confupdtype::text AS fk_update_action,
         k.condeferrable AS fk_deferrable,
         k.condeferred AS fk_initially_deferred
  FROM pg_catalog.pg_constraint AS k
  JOIN pg_catalog.pg_class AS src ON src.oid = k.conrelid
  JOIN pg_catalog.pg_namespace AS src_ns ON src_ns.oid = src.relnamespace
  JOIN pg_catalog.pg_class AS dest ON dest.oid = k.confrelid
  JOIN pg_catalog.pg_namespace AS dest_ns ON dest_ns.oid = dest.relnamespace
  LEFT JOIN pg_catalog.pg_attribute AS src_col
    ON src_col.attrelid = src.oid AND src_col.attnum = k.conkey[1]
  LEFT JOIN pg_catalog.pg_attribute AS dest_col
    ON dest_col.attrelid = dest.oid AND dest_col.attnum = k.confkey[1]
  WHERE src_ns.nspname IN ('public', 'nearpill') AND k.contype = 'f'
`;

export function reviewedForeignKeyInventoryFromSources(sources) {
  if (!Array.isArray(sources) || !sources.length) {
    throw new Error('Live DB verification refused: reviewed foreign key sources unavailable.');
  }
  const expected = [];
  for (const { filename, sql } of sources) {
    for (const { statement, line } of literalSqlStatements(sql, filename)) {
      const create = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:public|nearpill)\.)?([a-z_][a-z0-9_]*)\s*\(/i.exec(statement);
      const references = [...statement.matchAll(/\bREFERENCES\b/gi)];
      if (!create) {
        const composite = /^ALTER TABLE order_drugstores ADD CONSTRAINT order_drugstores_owner_fk\s+FOREIGN KEY \(order_id, user_id\) REFERENCES orders \(id, user_id\) ON DELETE CASCADE$/i.test(statement.replace(/\s+/g, ' '));
        if (composite) {
          expected.push({ fk_source_table: 'order_drugstores', fk_source_column: 'order_id',
            fk_target_schema: 'public', fk_target_table: 'orders', fk_target_column: 'id',
            fk_source_columns: ['order_id', 'user_id'], fk_target_columns: ['id', 'user_id'],
            fk_source_column_count: 2, fk_target_column_count: 2,
            fk_validated: true, fk_enforced: true, fk_delete_action: 'c', fk_update_action: 'a',
            fk_deferrable: false, fk_initially_deferred: false });
          continue;
        }
        if (/^ALTER TABLE order_drugstores DROP CONSTRAINT order_drugstores_order_id_fkey$/i.test(statement.trim())) {
          const old = expected.findIndex((fk) => fk.fk_source_table === 'order_drugstores' && fk.fk_source_column === 'order_id' && fk.fk_source_column_count === 1);
          if (old < 0) throw new Error('Missing original order-group foreign key.');
          expected.splice(old, 1);
          continue;
        }
        if (references.length || /\bFOREIGN\s+KEY\b|\bDROP\s+CONSTRAINT\b[^;]*_fkey\b/i.test(statement)) {
          throw new Error(`Live DB verification refused: unreviewed foreign key DDL at ${filename}:${line}.`);
        }
        continue;
      }
      const rows = [...statement.matchAll(/(?:^|\n)\s*([a-z_][a-z0-9_]*)\s+[^,\n]*?\bREFERENCES\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(\s*([a-z_][a-z0-9_]*)\s*\)(?:\s+ON\s+DELETE\s+(CASCADE|SET\s+NULL)\b)?/gi)];
      if (rows.length !== references.length) {
        throw new Error(`Live DB verification refused: unsupported foreign key declaration at ${filename}:${line}.`);
      }
      for (const [, fk_source_column, fk_target_table, fk_target_column, action] of rows) {
        expected.push({
          fk_source_table: create[1], fk_source_column,
          fk_target_schema: 'public', fk_target_table, fk_target_column,
          fk_source_columns: [fk_source_column], fk_target_columns: [fk_target_column],
          fk_source_column_count: 1, fk_target_column_count: 1,
          fk_validated: true, fk_enforced: true,
          // No ON DELETE clause means PostgreSQL's NO ACTION default ('a').
          fk_delete_action: !action ? 'a' : /^CASCADE$/i.test(action) ? 'c' : 'n',
          fk_update_action: 'a', fk_deferrable: false, fk_initially_deferred: false,
        });
      }
    }
  }
  // Fixed baseline size prevents a silently omitted REFERENCES declaration
  // from shrinking both the expected and actual inventories to an empty pass.
  if (expected.length !== 41 ||
      new Set(expected.map((fk) => `${fk.fk_source_table}.${fk.fk_source_column}`)).size !== 41) {
    throw new Error('Live DB verification refused: reviewed foreign key inventory is incomplete.');
  }
  // Migration 0053 renames tables/columns and drops medicine_evidence (and its
  // foreign keys). Apply exactly that reviewed change to the replayed inventory.
  if (!sources.some((source) => source.filename === '0053_simpler_database_names.sql')) return expected;
  const column = (name) => name.replace('drugstore', 'pharmacy').replace('inventory', 'stock');
  const table = (name) => REVIEWED_TABLE_RENAMES.get(name) ?? name;
  return expected
    .filter((fk) => !REVIEWED_TABLE_REMOVALS.has(fk.fk_source_table) && !REVIEWED_TABLE_REMOVALS.has(fk.fk_target_table) &&
      !REVIEWED_REMOVED_FK_COLUMNS.has(`${fk.fk_source_table}.${fk.fk_source_column}`))
    .map((fk) => ({
      ...fk,
      fk_source_table: table(fk.fk_source_table), fk_target_table: table(fk.fk_target_table),
      fk_source_column: column(fk.fk_source_column), fk_target_column: column(fk.fk_target_column),
      fk_source_columns: fk.fk_source_columns.map(column), fk_target_columns: fk.fk_target_columns.map(column),
    }));
}

function assertReviewedForeignKeyInventory(rows, expected) {
  if (!Array.isArray(rows) || rows.length !== expected.length) {
    throw new Error('Live DB verification refused: missing or unexpected PostgreSQL foreign key.');
  }
  const key = (row) => `${row.fk_source_table}.${row.fk_source_column}`;
  const actual = new Map();
  for (const row of rows) {
    if (!row || actual.has(key(row))) {
      throw new Error('Live DB verification refused: duplicate or unreadable foreign key.');
    }
    actual.set(key(row), row);
  }
  for (const reviewed of expected) {
    const row = actual.get(key(reviewed));
    if (!row || Object.keys(reviewed).some((field) => Array.isArray(reviewed[field])
      ? JSON.stringify(row[field]) !== JSON.stringify(reviewed[field]) : row[field] !== reviewed[field])) {
      throw new Error(`Live DB verification refused: invalid, missing or changed foreign key ${key(reviewed)}.`);
    }
  }
}

// Packet 0: reviewed partial UNIQUE indexes (migrations 0004/0006/0007)
// guard reset challenge, checkout, payment replay and entitlement correctness.
// Source SQL alone cannot prove they are valid on live PostgreSQL. Inspect
// key order, predicate, operator class and readiness (PG17/PG18-compatible).
const REVIEWED_PARTIAL_UNIQUE_INDEX_PROBE_SQL = `
  SELECT idx.relname AS index_name,
         tbl.relname AS table_name,
         am.amname AS index_method,
         i.indisunique AS index_unique,
         i.indisvalid AS index_valid,
         i.indisready AS index_ready,
         i.indislive AS index_live,
         i.indimmediate AS index_immediate,
         i.indnkeyatts::integer AS index_key_count,
         i.indnatts::integer AS index_total_count,
         ARRAY(
           SELECT a.attname::text
           FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum, key_position)
           JOIN pg_catalog.pg_attribute AS a
             ON a.attrelid = tbl.oid AND a.attnum = key.attnum
           ORDER BY key.key_position
         ) AS index_columns,
         -- The reviewed migration uses the default B-tree equality semantics.
         -- An alternate operator class can change uniqueness behavior even
         -- when the index name, columns, predicate and readiness still match.
         (SELECT COUNT(*) = i.indnkeyatts
                 AND COALESCE(BOOL_AND(opc.opcdefault IS TRUE
                   AND opc.opcmethod = idx.relam), false)
          FROM unnest(i.indclass) AS indexed(opclass_oid)
          LEFT JOIN pg_catalog.pg_opclass AS opc ON opc.oid = indexed.opclass_oid
         ) AS index_default_operator_classes,
         -- No COLLATE clause appears in the reviewed CREATE INDEX. Require
         -- the live index to use the declared collation for each column,
         -- including the zero OID for non-collatable numeric identifiers.
         (SELECT COUNT(*) = i.indnkeyatts
                 AND COALESCE(BOOL_AND(a.attcollation = indexed.collation_oid), false)
          FROM unnest(i.indkey, i.indcollation) AS indexed(attnum, collation_oid)
          LEFT JOIN pg_catalog.pg_attribute AS a
            ON a.attrelid = tbl.oid AND a.attnum = indexed.attnum
         ) AS index_column_collations_match,
         pg_catalog.pg_get_expr(i.indpred, i.indrelid) AS index_predicate
  FROM pg_catalog.pg_index AS i
  JOIN pg_catalog.pg_class AS tbl ON tbl.oid = i.indrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = tbl.relnamespace
  JOIN pg_catalog.pg_class AS idx ON idx.oid = i.indexrelid
  JOIN pg_catalog.pg_am AS am ON am.oid = idx.relam
  WHERE n.nspname = 'public'
    AND (tbl.relname, idx.relname) IN (
      ('orders', 'orders_user_idempotency_unique'),
      ('reset_links', 'password_reset_active_user_idx'),
      ('payments', 'payments_provider_external_unique'),
      ('payments', 'payments_order_idempotency_unique'),
      ('plan_features', 'subscription_entitlements_active_unique')
    )
`;

// Keep the checkout, reset, payment and entitlement uniqueness invariants
// in one read-only app-role catalog probe. Reviewed SQL/Drizzle source parity
// does not attest a deployed index: each physical index must be valid, ready,
// immediate, default-equality B-tree, with the declared keys and predicate.
const REVIEWED_PARTIAL_UNIQUE_INDEXES = Object.freeze([
  { name: 'orders_user_idempotency_unique', table: 'orders',
    columns: ['user_id', 'idempotency_key'], predicate: 'idempotency_keyisnotnull',
    errorLabel: 'order idempotency' },
  { name: 'password_reset_active_user_idx', table: 'reset_links',
    columns: ['user_id'], predicate: 'consumed_atisnull', errorLabel: 'password-reset active challenge' },
  { name: 'payments_provider_external_unique', table: 'payments',
    columns: ['provider', 'provider_payment_id'],
    predicate: 'providerisnotnullandprovider_payment_idisnotnull', errorLabel: 'payment external ID' },
  { name: 'payments_order_idempotency_unique', table: 'payments',
    columns: ['order_id', 'idempotency_key'], predicate: 'idempotency_keyisnotnull',
    errorLabel: 'payment idempotency' },
  { name: 'subscription_entitlements_active_unique', table: 'plan_features',
    columns: ['pharmacy_id', 'entitlement_key'], predicate: 'revoked_atisnull',
    errorLabel: 'active entitlement' },
]);

function assertReviewedPartialUniqueIndexes(rows) {
  if (!Array.isArray(rows)) {
    throw new Error('Live DB verification refused: unreadable partial UNIQUE index inventory.');
  }
  for (const expected of REVIEWED_PARTIAL_UNIQUE_INDEXES) {
    const found = rows.filter((row) => row?.index_name === expected.name);
    const index = found[0];
    const predicate = String(index?.index_predicate ?? '').replace(/[()\s"]/g, '').toLowerCase();
    if (found.length !== 1 || index.table_name !== expected.table ||
        index.index_method !== 'btree' || index.index_unique !== true ||
        index.index_valid !== true || index.index_ready !== true ||
        index.index_live !== true || index.index_immediate !== true ||
        index.index_key_count !== expected.columns.length ||
        index.index_total_count !== expected.columns.length ||
        !Array.isArray(index.index_columns) ||
        index.index_columns.length !== expected.columns.length ||
        index.index_columns.some((column, i) => column !== expected.columns[i]) ||
        index.index_default_operator_classes !== true ||
        index.index_column_collations_match !== true ||
        predicate !== expected.predicate) {
      throw new Error(`Live DB verification refused: ${expected.errorLabel} UNIQUE index is missing, invalid or altered.`);
    }
  }
  // An unexpected additional row is a catalog ambiguity, never an OK result.
  if (rows.length !== REVIEWED_PARTIAL_UNIQUE_INDEXES.length) {
    throw new Error('Live DB verification refused: unexpected partial UNIQUE index catalog entries.');
  }
}

// Migrations 0001/0006/0007 define critical composite UNIQUE *constraints*:
// membership and inventory identity, reservation identity and payment event/
// refund deduplication. These are not partial indexes. Attest their backing
// indexes and NOT NULL keys under the ordinary application role before any
// migrator journal access or fixture-writing verification.
const REVIEWED_CRITICAL_UNIQUE_CONSTRAINT_PROBE_SQL = `
  SELECT con.conname AS critical_constraint_name,
         tbl.relname AS table_name,
         con.contype::text AS constraint_type,
         con.condeferrable AS constraint_deferrable,
         con.condeferred AS constraint_deferred,
         con.convalidated AS constraint_validated,
         idx.relname AS index_name,
         am.amname AS index_method,
         i.indisunique AS index_unique,
         i.indisvalid AS index_valid,
         i.indisready AS index_ready,
         i.indislive AS index_live,
         i.indimmediate AS index_immediate,
         i.indnullsnotdistinct AS index_nulls_not_distinct,
         i.indnkeyatts::integer AS index_key_count,
         i.indnatts::integer AS index_total_count,
         ARRAY(
           SELECT a.attname::text
           FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum, key_position)
           JOIN pg_catalog.pg_attribute AS a
             ON a.attrelid = tbl.oid AND a.attnum = key.attnum
           ORDER BY key.key_position
         ) AS index_columns,
         (SELECT COUNT(*) = i.indnkeyatts
                 AND COALESCE(BOOL_AND(opc.opcdefault IS TRUE
                   AND opc.opcmethod = idx.relam), false)
          FROM unnest(i.indclass) AS indexed(opclass_oid)
          LEFT JOIN pg_catalog.pg_opclass AS opc ON opc.oid = indexed.opclass_oid
         ) AS index_default_operator_classes,
         (SELECT COUNT(*) = i.indnkeyatts
                 AND COALESCE(BOOL_AND(a.attcollation = indexed.collation_oid), false)
          FROM unnest(i.indkey, i.indcollation) AS indexed(attnum, collation_oid)
          LEFT JOIN pg_catalog.pg_attribute AS a
            ON a.attrelid = tbl.oid AND a.attnum = indexed.attnum
         ) AS index_column_collations_match,
         (SELECT COUNT(*) = i.indnkeyatts
                 AND COALESCE(BOOL_AND(a.attnotnull IS TRUE), false)
          FROM unnest(i.indkey) AS indexed(attnum)
          LEFT JOIN pg_catalog.pg_attribute AS a
            ON a.attrelid = tbl.oid AND a.attnum = indexed.attnum
         ) AS index_columns_not_null,
         pg_catalog.pg_get_expr(i.indpred, i.indrelid) AS index_predicate
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_class AS tbl ON tbl.oid = con.conrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = tbl.relnamespace
  JOIN pg_catalog.pg_index AS i ON i.indexrelid = con.conindid
  JOIN pg_catalog.pg_class AS idx ON idx.oid = con.conindid
  JOIN pg_catalog.pg_am AS am ON am.oid = idx.relam
  WHERE n.nspname = 'public'
    AND con.conname IN (
      'payment_events_provider_event_unique',
      'refunds_provider_external_unique',
      'refunds_provider_idempotency_unique',
      'reservations_order_inventory_unique',
      'pharmacy_memberships_user_store_unique',
      'inventory_store_medicine_unique'
    )
`;

const REVIEWED_CRITICAL_UNIQUE_CONSTRAINTS = Object.freeze([
  { name: 'pharmacy_memberships_user_store_unique', table: 'pharmacy_memberships', columns: ['user_id', 'pharmacy_id'] },
  { name: 'inventory_store_medicine_unique', table: 'stock', columns: ['pharmacy_id', 'medicine_id'] },
  { name: 'reservations_order_inventory_unique', table: 'reservations', columns: ['order_id', 'stock_id'] },
  { name: 'payment_events_provider_event_unique', table: 'payment_events', columns: ['provider', 'event_id'] },
  { name: 'refunds_provider_external_unique', table: 'refunds', columns: ['provider', 'provider_refund_id'] },
  { name: 'refunds_provider_idempotency_unique', table: 'refunds', columns: ['provider', 'idempotency_key'] },
]);

function assertReviewedCriticalUniqueConstraints(rows) {
  if (!Array.isArray(rows) || rows.length !== REVIEWED_CRITICAL_UNIQUE_CONSTRAINTS.length) {
    throw new Error('Live DB verification refused: missing or unreviewed business UNIQUE constraint.');
  }
  for (const expected of REVIEWED_CRITICAL_UNIQUE_CONSTRAINTS) {
    const matching = rows.filter((row) => row?.critical_constraint_name === expected.name);
    const constraint = matching[0];
    if (matching.length !== 1 || constraint.table_name !== expected.table ||
        constraint.constraint_type !== 'u' ||
        constraint.constraint_deferrable !== false || constraint.constraint_deferred !== false ||
        constraint.constraint_validated !== true ||
        constraint.index_name !== expected.name || constraint.index_method !== 'btree' ||
        constraint.index_unique !== true || constraint.index_valid !== true ||
        constraint.index_ready !== true || constraint.index_live !== true ||
        constraint.index_immediate !== true || constraint.index_nulls_not_distinct !== false ||
        constraint.index_key_count !== expected.columns.length ||
        constraint.index_total_count !== expected.columns.length ||
        !Array.isArray(constraint.index_columns) ||
        constraint.index_columns.length !== expected.columns.length ||
        constraint.index_columns.some((column, i) => column !== expected.columns[i]) ||
        constraint.index_default_operator_classes !== true ||
        constraint.index_column_collations_match !== true ||
        constraint.index_columns_not_null !== true || constraint.index_predicate !== null) {
      throw new Error(`Live DB verification refused: business UNIQUE constraint ${expected.name} is missing or altered.`);
    }
  }
}

// Migration 0006's five named CHECKs and the three inline column CHECKs
// from migrations 0006/0007 enforce nonnegative monetary values and positive
// reservation/refund amounts as well as bounded inventory reservations.
// Stock/contention fixtures are not meaningful if live constraints have been
// silently removed, relaxed, left NOT VALID, or marked NOT ENFORCED (PG18).
// This catalog probe remains SELECT-only and uses the ordinary app role.
const REVIEWED_STOCK_AND_MONEY_CHECK_PROBE_SQL = `
  SELECT k.conname AS invariant_constraint_name,
         tbl.relname AS table_name,
         k.contype::text AS constraint_type,
         k.convalidated AS constraint_validated,
         CASE WHEN current_setting('server_version_num')::integer >= 180000
              THEN (to_jsonb(k)->>'conenforced')::boolean
              ELSE true
         END AS constraint_enforced,
         k.connoinherit AS constraint_no_inherit,
         k.conislocal AS constraint_is_local,
         k.coninhcount::integer AS constraint_inherit_count,
         k.conparentid = 0::oid AS constraint_no_parent,
         pg_catalog.pg_get_constraintdef(k.oid, true) AS constraint_definition
  FROM pg_catalog.pg_constraint AS k
  JOIN pg_catalog.pg_class AS tbl ON tbl.oid = k.conrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = tbl.relnamespace
  WHERE n.nspname = 'public' AND k.conname IN (
    'inventory_stock_invariant',
    'inventory_price_centavos_nonnegative',
    'orders_total_centavos_nonnegative',
    'order_items_unit_price_centavos_nonnegative',
    'payments_amount_centavos_nonnegative',
    'reservations_quantity_check',
    'refunds_amount_centavos_check',
    'payment_events_amount_centavos_check'
  )
`;

const REVIEWED_STOCK_AND_MONEY_CHECKS = Object.freeze([
  { name: 'inventory_stock_invariant', table: 'stock',
    definition: 'CHECK(stock_on_hand>=0ANDreserved_quantity>=0ANDreserved_quantity<=stock_on_hand)' },
  { name: 'inventory_price_centavos_nonnegative', table: 'stock',
    definition: 'CHECK(price_centavos>=0)' },
  { name: 'orders_total_centavos_nonnegative', table: 'orders',
    definition: 'CHECK(total_centavos>=0)' },
  { name: 'order_items_unit_price_centavos_nonnegative', table: 'order_items',
    definition: 'CHECK(unit_price_centavos>=0)' },
  { name: 'payments_amount_centavos_nonnegative', table: 'payments',
    definition: 'CHECK(amount_centavos>=0)' },
  // PostgreSQL assigns table_column_check names to these three reviewed
  // inline, unnamed CHECK clauses. The source migration texts are unchanged.
  { name: 'reservations_quantity_check', table: 'reservations',
    definition: 'CHECK(quantity>0)' },
  { name: 'refunds_amount_centavos_check', table: 'refunds',
    definition: 'CHECK(amount_centavos>0)' },
  { name: 'payment_events_amount_centavos_check', table: 'payment_events',
    definition: 'CHECK(amount_centavosISNULLORamount_centavos>=0)' },
]);

function assertReviewedStockAndMoneyChecks(rows) {
  if (!Array.isArray(rows) || rows.length !== REVIEWED_STOCK_AND_MONEY_CHECKS.length) {
    throw new Error('Live DB verification refused: missing or unreviewed stock/centavo CHECK constraint.');
  }
  for (const expected of REVIEWED_STOCK_AND_MONEY_CHECKS) {
    const matches = rows.filter((row) => row?.invariant_constraint_name === expected.name);
    const row = matches[0];
    // pg_get_constraintdef prints redundant parenthesis/spacing around simple
    // comparisons. Strip only those formatting tokens; preserve ALL operators,
    // operands, AND/OR and comparison order to prevent a relaxed predicate.
    const definition = typeof row?.constraint_definition === 'string'
      ? row.constraint_definition.replace(/[()\s"]/g, '').toUpperCase()
      : '';
    if (matches.length !== 1 || row.table_name !== expected.table ||
        row.constraint_type !== 'c' || row.constraint_validated !== true ||
        row.constraint_enforced !== true || row.constraint_no_inherit !== false ||
        row.constraint_is_local !== true || row.constraint_inherit_count !== 0 ||
        row.constraint_no_parent !== true ||
        definition !== expected.definition.toUpperCase().replace(/[()\s"]/g, '')) {
      throw new Error(`Live DB verification refused: stock/centavo CHECK constraint ${expected.name} is missing or altered.`);
    }
  }
}

// CHECK predicates accept UNKNOWN for NULL input. A live migration can retain
// reviewed CHECKs but weaken mandatory NOT NULL or narrow BIGINT to INTEGER,
// invalidating centavo/stock integrity. Conversely, payment_events.amount_centavos
// is intentionally nullable for provider events without amounts. Attest the
// reviewed type AND nullability under the app role before any migrator reads or
// fixture writes. pg_type.typname uses stable int4/int8 catalog identifiers.
const REVIEWED_STOCK_MONEY_COLUMN_PROBE_SQL = `
  SELECT tbl.relname AS table_name,
         a.attname AS critical_column_name,
         typ.typname AS type_name,
         a.attnotnull AS column_not_null,
         a.attgenerated::text AS column_generated,
         a.attidentity::text AS column_identity
  FROM pg_catalog.pg_attribute AS a
  JOIN pg_catalog.pg_class AS tbl ON tbl.oid = a.attrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = tbl.relnamespace
  JOIN pg_catalog.pg_type AS typ ON typ.oid = a.atttypid
  WHERE n.nspname = 'public' AND tbl.relkind IN ('r', 'p')
    AND a.attnum > 0 AND NOT a.attisdropped
    AND (tbl.relname, a.attname) IN (
      ('stock','price_centavos'),
      ('stock','stock_on_hand'),
      ('stock','reserved_quantity'),
      ('orders','total_centavos'),
      ('order_items','unit_price_centavos'),
      ('payments','amount_centavos'),
      ('reservations','quantity'),
      ('refunds','amount_centavos'),
      ('order_items','quantity'),
      ('stock_movements','stock_change'),
      ('stock_movements','held_change'),
      ('payment_events','amount_centavos')
    )
`;

const REVIEWED_STOCK_MONEY_COLUMNS = Object.freeze([
  ['stock', 'price_centavos', 'int8'],
  ['stock', 'stock_on_hand', 'int4'],
  ['stock', 'reserved_quantity', 'int4'],
  ['orders', 'total_centavos', 'int8'],
  ['order_items', 'unit_price_centavos', 'int8'],
  ['payments', 'amount_centavos', 'int8'],
  ['reservations', 'quantity', 'int4'],
  ['refunds', 'amount_centavos', 'int8', true],
  ['order_items', 'quantity', 'int4', true],
  ['stock_movements', 'stock_change', 'int4', true],
  ['stock_movements', 'held_change', 'int4', true],
  ['payment_events', 'amount_centavos', 'int8', false],
]);

function assertReviewedStockMoneyColumns(rows) {
  if (!Array.isArray(rows) || rows.length !== REVIEWED_STOCK_MONEY_COLUMNS.length) {
    throw new Error('Live DB verification refused: missing or unverifiable stock/centavo column.');
  }
  for (const [tableName, columnName, typeName, requiredNotNull = true] of REVIEWED_STOCK_MONEY_COLUMNS) {
    const matching = rows.filter((row) =>
      row?.table_name === tableName && row?.critical_column_name === columnName);
    const column = matching[0];
    if (matching.length !== 1 || column.type_name !== typeName ||
        column.column_not_null !== requiredNotNull || column.column_generated !== '' ||
        column.column_identity !== '') {
      throw new Error(`Live DB verification refused: stock/centavo column ${tableName}.${columnName} is missing or altered.`);
    }
  }
}

// Internal referential-integrity triggers are intentionally excluded from
// the application-trigger whitelist above: PostgreSQL generates their names.
// Their *enabled state* is still integrity-critical. A disabled (D) or
// replica-only (R) constraint trigger can bypass expected FK enforcement.
// This is a negative catalog check, not a claim that all expected foreign keys
// exist; migration replay and constraint reconciliation remain separate gates.
const DISABLED_INTERNAL_CONSTRAINT_TRIGGER_PROBE_SQL = `
  SELECT c.relname AS disabled_constraint_trigger_table,
         t.tgname AS disabled_constraint_trigger_name,
         t.tgenabled::text AS disabled_constraint_trigger_enabled
  FROM pg_trigger AS t
  JOIN pg_class AS c ON c.oid = t.tgrelid
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND t.tgisinternal
    AND t.tgconstraint <> 0::oid
    AND t.tgenabled NOT IN ('O', 'A')
`;

function assertReviewedPublicAppTrigger(rows) {
  // Attest each reviewed invoker trigger, including event flags and predicates.
  const definitions = [
    ['stock', 'inventory_touch_updated_at', 'touch_updated_at', 19, ''],
    ['order_pharmacies', 'order_group_owner', 'set_order_group_owner', 7, ''],
    ['stock', 'inventory_authority', 'guard_inventory_authority', 19, ''],
    ['stock', 'inventory_selling_unit_authority', 'guard_inventory_selling_unit', 19, 'package_size,selling_unit'],
    ['medicines', 'medicines_normalize_category', 'normalize_medicine_category', 23, 'category'],
  ];
  if (!Array.isArray(rows) || rows.length !== definitions.length) {
    throw new Error('Live DB verification refused: missing or unreviewed public application trigger.');
  }
  for (const [table, name, routine, type, updateColumns] of definitions) {
    const t = rows.find((row) => row.trigger_name === name);
    if (!t || t.trigger_table_name !== table ||
        t.trigger_name !== name ||
        t.trigger_function_schema !== 'nearpill' ||
        t.trigger_function_name !== routine ||
        t.trigger_function_identity_arguments !== '' ||
        t.trigger_type !== type || t.trigger_enabled !== 'O' ||
        t.trigger_internal !== false || t.trigger_is_clone !== false ||
        t.trigger_is_constraint !== false || t.trigger_deferrable !== false ||
        t.trigger_initially_deferred !== false || t.trigger_argument_count !== 0 ||
        t.trigger_update_columns !== updateColumns || t.trigger_has_when !== false ||
        t.trigger_has_old_transition !== false || t.trigger_has_new_transition !== false) {
      throw new Error('Live DB verification refused: changed public application trigger definition.');
    }
  }
}

// PostgreSQL default ACLs are independent of grants on *existing* objects.
// Check explicit global, public-schema, AND the two reviewed internal-schema
// defaults. A later auth helper created in `nearpill` could otherwise gain
// EXECUTE for Supabase client roles despite the current helpers being safe.
// This is not a check for implicit
// defaults (notably PUBLIC EXECUTE on functions): those require a separate
// deployment review and real negative tests, never an inferred PASS.
const UNSAFE_DEFAULT_GRANTS_SQL = `
  SELECT d.defaclobjtype AS object_type,
         pg_get_userbyid(d.defaclrole) AS creator_role,
         acl.privilege_type AS privilege_type
  FROM pg_default_acl AS d
  CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
  WHERE (d.defaclnamespace = 0 OR d.defaclnamespace IN (
      'public'::regnamespace,
      'nearpill'::regnamespace,
      'nearpill_extensions'::regnamespace
    ))
    -- Supabase controls its admin defaults; accept client grants only behind a closed schema boundary.
    AND NOT (
      pg_get_userbyid(d.defaclrole) = 'supabase_admin'
      AND d.defaclnamespace = 'public'::regnamespace
      AND pg_get_userbyid(acl.grantee) IN ('anon', 'authenticated', 'service_role')
      AND NOT EXISTS (
        SELECT 1 FROM pg_namespace n
        CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) permission
        WHERE n.nspname = 'public' AND permission.grantee = 0 AND permission.privilege_type = 'USAGE'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_roles exposed CROSS JOIN pg_namespace n
        WHERE exposed.rolname IN ('anon', 'authenticated', 'service_role') AND n.nspname = 'public'
          AND (has_schema_privilege(exposed.oid, n.oid, 'USAGE') OR EXISTS (
            SELECT 1 FROM aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) permission
            WHERE permission.grantee <> 0 AND permission.privilege_type = 'USAGE'
              AND pg_has_role(exposed.oid, permission.grantee, 'SET')
          ))
      )
    )
    AND (
      acl.grantee = 0
      OR EXISTS (
        SELECT 1 FROM pg_roles AS granted
        WHERE granted.oid = acl.grantee
          AND (
            -- A future object can silently inherit broad privileges even
            -- while all currently reviewed relations are locked down.
            -- Current/inherited and SET ROLE-only app grants both need
            -- explicit review; verified repository grants are object-specific.
            pg_has_role(current_user, granted.oid, 'USAGE')
            OR pg_has_role(current_user, granted.oid, 'SET')
            OR EXISTS (
              SELECT 1 FROM pg_roles AS exposed
              WHERE exposed.rolname IN ('anon', 'authenticated')
                AND (
                  pg_has_role(exposed.oid, granted.oid, 'USAGE')
                  OR pg_has_role(exposed.oid, granted.oid, 'SET')
                )
            )
          )
      )
    )
    AND (
      (d.defaclobjtype = 'r' AND acl.privilege_type IN
        ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'))
      OR (d.defaclobjtype = 'S' AND acl.privilege_type IN ('USAGE','SELECT','UPDATE'))
      OR (d.defaclobjtype = 'f' AND acl.privilege_type = 'EXECUTE')
      OR (d.defaclobjtype IN ('n','T') AND acl.privilege_type IN ('CREATE','USAGE'))
    )
`;

// The named-table probe cannot see new public tables created outside the
// seven reviewed migrations. Supabase may expose public-schema relations via
// the Data API, so refuse *any* additional base, partitioned or foreign table.
// A foreign table is a separate potential data boundary and must be reviewed
// before fixture-writing verification is allowed to proceed.
const UNREVIEWED_PUBLIC_RELATIONS_SQL = `
  SELECT c.relname AS relation_name, c.relkind AS relation_kind
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'f')
    AND NOT (c.relname = ANY($1::text[]))
`;

// A table-only audit cannot detect a SECURITY DEFINER view exposing private
// rows or an unreviewed public RPC routine bypassing Hono authorization.
// pg_proc includes ordinary functions, procedures, aggregates and window
// functions: all four kinds must be inventoried, not just f/p.
// Migration 0005 installs pg_trgm WITH SCHEMA public; the extension's own
// similarity functions are legitimate public-schema routines. Permit ONLY
// non-SECURITY-DEFINER functions that PostgreSQL catalogs as actual members
// of that specific reviewed extension. Function names alone are not trusted:
// unrelated routines (including impostors named similarity) must be refused.
// Continue to refuse public views and client-accessible sequences.
const PUBLIC_SURFACE_PROBE_SQL = `
  SELECT 'view' AS object_kind
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
  UNION ALL
  SELECT 'routine' AS object_kind
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p', 'a', 'w')
    AND NOT (
      p.prokind = 'f' AND p.prosecdef = false
      AND EXISTS (
        SELECT 1
        FROM pg_depend AS d
        JOIN pg_extension AS e ON e.oid = d.refobjid
        WHERE d.classid = 'pg_proc'::regclass
          AND d.objid = p.oid
          AND d.refclassid = 'pg_extension'::regclass
          AND d.deptype = 'e'
          AND e.extname = 'pg_trgm'
          AND e.extnamespace = p.pronamespace
      )
    )
  UNION ALL
  -- An ordinary application role must not own, or be a member of the
  -- owning role of, any public sequence. Ownership permits ALTER SEQUENCE
  -- (including RESTART / CYCLE changes) independently of the USAGE/SELECT
  -- grants needed by the normal repository. A non-inherited membership is
  -- conservatively refused, consistent with the table/schema owner guards.
  SELECT 'sequence-owner' AS object_kind
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'S'
    AND pg_has_role(c.relowner, 'MEMBER')
  UNION ALL
  -- Normal app inserts require sequence USAGE/SELECT, not UPDATE. UPDATE
  -- permits setval(), which can reset sequence identity allocation without
  -- using the reviewed migrator. Check effective grants and non-inherited
  -- UPDATE permissions reachable via SET ROLE, independently of ownership.
  SELECT 'sequence-app-update' AS object_kind
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'S'
    AND (
      has_sequence_privilege(current_user, c.oid, 'UPDATE')
      OR EXISTS (
        SELECT 1 FROM aclexplode(
          COALESCE(c.relacl, acldefault('S', c.relowner))
        ) AS acl
        WHERE acl.grantee <> 0 AND acl.privilege_type = 'UPDATE'
          AND pg_has_role(current_user, acl.grantee, 'SET')
      )
    )
  UNION ALL
  SELECT 'sequence-grant' AS object_kind
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'S' AND (
    EXISTS (
      SELECT 1 FROM pg_roles AS exposed
      WHERE exposed.rolname IN ('anon', 'authenticated')
        AND has_sequence_privilege(exposed.oid, c.oid, 'USAGE,SELECT,UPDATE')
    )
    OR EXISTS (
      SELECT 1 FROM pg_roles AS exposed
      CROSS JOIN LATERAL aclexplode(
        COALESCE(c.relacl, acldefault('S', c.relowner))
      ) AS acl
      WHERE exposed.rolname IN ('anon', 'authenticated')
        AND acl.grantee <> 0
        AND acl.privilege_type IN ('USAGE', 'SELECT', 'UPDATE')
        AND pg_has_role(exposed.oid, acl.grantee, 'SET')
    )
    OR EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(c.relacl, acldefault('S', c.relowner))) AS acl
      WHERE acl.grantee = 0 AND acl.privilege_type IN ('USAGE', 'SELECT', 'UPDATE')
    )
  )
`;

// The ordinary app role is intentionally forbidden from reading the migration
// journal. Check it through the already-verified, separate migrator connection.
// This is a read-only checksum/provenance gate, not schema or RLS parity proof.
const MIGRATION_JOURNAL_PROBE_SQL = `
  SELECT filename, sha256 FROM public.nearpill_schema_migrations ORDER BY filename
`;
const MIGRATION_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../../migrations/postgres',
);

// The canonical runner and live preflight use the same validated, no-symlink
// migration source loader rather than independently filtering directory files.
// Build the allowed policy tuple set from the exact seven reviewed migration
// sources, including the two guarded dynamic SQL policy loops. The source
// checksum journal is checked independently on the migrator connection.
// Inventory only executable, top-level policy DDL. A plain /CREATE POLICY/g
// over whole migration text also matches comments, quoted text and dynamic
// DO bodies, which can make the live preflight expect fictitious policies.
// The reviewed DO loops below are accounted for separately and fail closed
// on source drift; their runtime SQL is not treated as literal top-level DDL.
// A single replay primitive is used for both literal-only characterization
// and the full migration preflight. Dynamic DO-loop policies are inserted at
// their actual migration position, not appended after all later DROP commands.
function applyLiteralPolicyMutation(policies, statement, filename, line) {
  const droppedTables = reviewedDropTableTargets(statement, filename, line);
  if (droppedTables) {
    for (const key of policies.keys()) {
      if (droppedTables.includes(key.slice(0, key.lastIndexOf('.')))) policies.delete(key);
    }
    return;
  }
  if (!/^(?:CREATE|DROP|ALTER)\s+POLICY\b/i.test(statement)) return;
  const drop = /^DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s+ON\s+(?:public\.)?((?:nearpill\.)?[a-z_][a-z0-9_]*)$/i.exec(statement);
  if (drop) {
    policies.delete(`${drop[2]}.${drop[1]}`);
    return;
  }
  const create = /^CREATE\s+POLICY\s+([a-z_][a-z0-9_]*)\s+ON\s+(?:public\.)?((?:nearpill\.)?[a-z_][a-z0-9_]*)\s+FOR\s+(SELECT|INSERT|UPDATE|DELETE|ALL)\s+TO\s+(nearpill_app|nearpill_migrator)(?=\s|$)/i.exec(statement);
  if (!create || (statement.slice(create[0].length).trim() &&
      !/^(?:USING|WITH\s+CHECK)\b/i.test(statement.slice(create[0].length).trim()))) {
    throw new Error(`Live DB verification refused: unreviewed policy SQL at ${filename}:${line}.`);
  }
  const [, policyname, tablename, command, role] = create;
  const key = `${tablename}.${policyname}`;
  if (policies.has(key)) {
    throw new Error(`Live DB verification refused: duplicate active policy at ${filename}:${line}.`);
  }
  policies.set(key, {
    tablename, policyname, cmd: command.toUpperCase(),
    roles: [role], permissive: 'PERMISSIVE',
  });
}

export function literalReviewedPolicyInventory(sources) {
  const policies = new Map();
  for (const { filename, sql } of sources) {
    for (const { statement, line } of literalSqlStatements(sql, filename)) {
      applyLiteralPolicyMutation(policies, statement, filename, line);
    }
  }
  return [...policies.values()];
}

// Migrations 0002 and 0004 were written (and are replayed) with the table names
// that existed then; migration 0053 renames them. This list is frozen history.
const HISTORICAL_RLS_LOOP_TABLES = Object.freeze([
  'drugstores', 'pharmacy_memberships', 'medicines', 'inventory', 'orders',
  'order_drugstores', 'order_items', 'payments', 'subscriptions', 'audit_logs',
  'auth_session_families', 'auth_sessions', 'email_verification_challenges',
  'password_reset_challenges', 'auth_rate_limit_events', 'auth_account_security',
]);

// Only the two reviewed migration DO loops create dynamic policies. Validate
// each complete DO statement, its ordered table list, and each executable
// CREATE POLICY format invocation before adding expected rows at that point.
function applyReviewedDynamicPolicies(policies, filename, statement, line) {
  if (!['0002_rls.sql', '0004_identity_security.sql'].includes(filename) ||
      !/\bFOREACH\s+\w+\s+IN\s+ARRAY\s+ARRAY\s*\[/i.test(statement)) return false;
  const expectedTables = filename === '0002_rls.sql'
    ? HISTORICAL_RLS_LOOP_TABLES.slice(0, 10) : HISTORICAL_RLS_LOOP_TABLES.slice(10, 16);
  const array = /FOREACH\s+\w+\s+IN\s+ARRAY\s+ARRAY\s*\[([^\]]+)\]/i.exec(statement);
  // Validate every array element, not only strings matched by a global
  // regex. Otherwise an unrecognized entry (such as 'other_table_123', a
  // cast, or NULL) disappears from the inventory and may let added policy
  // targets evade the reviewed-source preflight.
  const actualTables = array ? array[1].split(',').map((entry) => {
    const token = /^'([a-z_][a-z0-9_]*)'$/.exec(entry.trim());
    return token?.[1] ?? null;
  }) : [];
  const actualDeclarations = [...statement.matchAll(/EXECUTE\s+format\s*\(\s*'CREATE\s+POLICY\s+([a-z_][a-z0-9_]*)\s+ON\s+%I\s+FOR\s+ALL\s+TO\s+(nearpill_app|nearpill_migrator)\b/gi)]
    .map((match) => `${match[1]}:${match[2]}`);
  // A partial CREATE POLICY regexp misses extra EXECUTE statements and changes
  // to predicates of otherwise familiar policy names. These two DO loops are
  // reviewed source, not arbitrary dynamic SQL: every executable format string
  // must match the canonical operation in its original order. Count ALL
  // EXECUTE tokens as well, so unsupported EXECUTE expressions fail closed.
  const reviewedOperations = filename === '0002_rls.sql'
    ? [
        'DROP POLICY IF EXISTS migrator_all ON %I',
        'CREATE POLICY migrator_all ON %I FOR ALL TO nearpill_migrator USING (true) WITH CHECK (true)',
      ]
    : [
        'ALTER TABLE %I ENABLE ROW LEVEL SECURITY',
        'ALTER TABLE %I FORCE ROW LEVEL SECURITY',
        'DROP POLICY IF EXISTS identity_security_app ON %I',
        "CREATE POLICY identity_security_app ON %I FOR ALL TO nearpill_app USING (nearpill.current_capability() = ''identity_security'') WITH CHECK (nearpill.current_capability() = ''identity_security'')",
        'DROP POLICY IF EXISTS migrator_all ON %I',
        'CREATE POLICY migrator_all ON %I FOR ALL TO nearpill_migrator USING (true) WITH CHECK (true)',
      ];
  const actualOperations = [...statement.matchAll(/\bEXECUTE\s+format\s*\(\s*'((?:[^']|'')*)'/gi)]
    .map((match) => match[1].replace(/\s+/g, ' ').trim());
  const executionCount = [...statement.matchAll(/\bEXECUTE\b/gi)].length;
  if (executionCount !== reviewedOperations.length ||
      actualOperations.length !== reviewedOperations.length ||
      actualOperations.some((operation, index) => operation !== reviewedOperations[index])) {
    throw new Error(`Live DB verification refused: dynamic RLS migration policy inventory drift at ${filename}:${line}.`);
  }
  // Match the *whole* reviewed PL/pgSQL loop, not just the quoted EXECUTE
  // templates. An added PERFORM, CALL or static DELETE would otherwise evade
  // the EXECUTE counter yet still run during migration. This deliberately
  // accepts only the two existing reviewed loop shapes; future changes need
  // explicit review rather than a permissive best-effort policy inventory.
  const loopVariable = filename === '0002_rls.sql' ? 'protected_table' : 'security_table';
  const quotedSql = String.raw`'(?:[^']|'')*'`;
  const reviewedExecute = String.raw`EXECUTE\s+format\s*\(\s*${quotedSql}\s*,\s*${loopVariable}\s*\)\s*;\s*`;
  const loopStructure = new RegExp(
    String.raw`^DO\s+\$\$\s*DECLARE\s+${loopVariable}\s+TEXT\s*;\s*BEGIN\s*` +
    String.raw`FOREACH\s+${loopVariable}\s+IN\s+ARRAY\s+ARRAY\s*\[[^\]]+\]\s*LOOP\s*` +
    `(?:${reviewedExecute}){${reviewedOperations.length}}` +
    String.raw`END\s+LOOP\s*;\s*END\s*\$\$$`,
    'i',
  );
  if (!loopStructure.test(statement)) {
    throw new Error(`Live DB verification refused: dynamic RLS migration policy inventory drift at ${filename}:${line}.`);
  }
  const expectedDeclarations = filename === '0002_rls.sql'
    ? ['migrator_all:nearpill_migrator']
    : ['identity_security_app:nearpill_app', 'migrator_all:nearpill_migrator'];
  if (actualTables.length !== expectedTables.length ||
      actualTables.some((table, index) => table !== expectedTables[index]) ||
      actualDeclarations.join(',') !== expectedDeclarations.join(',')) {
    throw new Error(`Live DB verification refused: dynamic RLS migration policy inventory drift at ${filename}:${line}.`);
  }
  for (const tablename of expectedTables) {
    for (const declaration of expectedDeclarations) {
      const [policyname, role] = declaration.split(':');
      const key = `${tablename}.${policyname}`;
      // The reviewed DO loops deliberately DROP before CREATE. Applying the
      // dynamic declaration must not keep a previous relation's stale entry.
      policies.set(key, {
        tablename, policyname, cmd: 'ALL', roles: [role], permissive: 'PERMISSIVE',
      });
    }
  }
  return true;
}

export function reviewedRlsPolicyInventoryFromSources(sources) {
  const policies = new Map();
  const dynamicLoopCounts = new Map();
  for (const { filename, sql } of sources) {
    for (const { statement, line } of literalSqlStatements(sql, filename)) {
      applyLiteralPolicyMutation(policies, statement, filename, line);
      // 0042 creates its renumbering audit table and policy inside one reviewed DO block, which the
      // literal statement parser cannot see. Accept exactly that policy and nothing else from it.
      if (filename === '0042_renumber_catalog_ids.sql' &&
          /CREATE POLICY migrator_all ON medicine_id_renumbering FOR ALL TO nearpill_migrator USING \(true\) WITH CHECK \(true\)/i.test(statement)) {
        policies.set('medicine_id_renumbering.migrator_all', {
          tablename: 'medicine_id_renumbering', policyname: 'migrator_all', cmd: 'ALL',
          roles: ['nearpill_migrator'], permissive: 'PERMISSIVE',
        });
      }
      if (applyReviewedDynamicPolicies(policies, filename, statement, line)) {
        const count = (dynamicLoopCounts.get(filename) ?? 0) + 1;
        if (count !== 1) throw new Error('Live DB verification refused: duplicate dynamic policy loop.');
        dynamicLoopCounts.set(filename, count);
      }
    }
    if (filename === '0053_simpler_database_names.sql') {
      // Apply exactly the reviewed renames/removal at the point migration 0053 runs, so
      // later literal DROP/CREATE POLICY statements see the new table names.
      for (const [key, policy] of [...policies]) {
        policies.delete(key);
        if (REVIEWED_TABLE_REMOVALS.has(policy.tablename)) continue;
        const renamed = REVIEWED_TABLE_RENAMES.get(policy.tablename);
        const next = renamed ? { ...policy, tablename: renamed } : policy;
        policies.set(`${next.tablename}.${next.policyname}`, next);
      }
    }
    if (['0002_rls.sql', '0004_identity_security.sql'].includes(filename) &&
        dynamicLoopCounts.get(filename) !== 1) {
      throw new Error('Live DB verification refused: missing reviewed dynamic RLS policy loop.');
    }
  }
  if (!PROTECTED_TABLES.every((table) =>
    [...policies.values()].some((policy) => policy.tablename === table &&
      policy.roles.length === 1 && policy.roles[0] === 'nearpill_app'))) {
    throw new Error('Live DB verification refused: source has an uncharacterized protected-table policy.');
  }
  return [...policies.values()];
}

export async function reviewedRlsPolicyInventory() {
  return memoizedInventory('policies', async () => reviewedRlsPolicyInventoryFromSources(await loadCanonicalMigrationSources()));
}

// PostgreSQL's pg_policies exposes the normalized active USING and WITH CHECK
// expression text. A missing predicate or unconditional TRUE can turn a
// restricted app policy into unrestricted access without changing its name,
// role or command. Reject obvious unsafe changes; the DB can normalize SQL
// and nontrivial predicates still need real tenant-negative tests.
function unwrapPolicyParentheses(predicate) {
  let expression = predicate.trim();
  // Peel only parentheses enclosing the complete expression. PostgreSQL's
  // pg_policies text may wrap a boolean expression several times.
  while (expression.startsWith('(') && expression.endsWith(')')) {
    let depth = 0;
    let wrapsWhole = true;
    let quote = null;
    for (let i = 0; i < expression.length; i += 1) {
      const char = expression[i];
      if (quote) {
        if (char === quote) {
          if (expression[i + 1] === quote) i += 1;
          else quote = null;
        }
        continue;
      }
      if (char === "'" || char === '"') { quote = char; continue; }
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      if (depth === 0 && i < expression.length - 1) { wrapsWhole = false; break; }
      if (depth < 0) { wrapsWhole = false; break; }
    }
    if (quote) wrapsWhole = false;
    if (!wrapsWhole || depth !== 0) break;
    expression = expression.slice(1, -1).trim();
  }
  return expression;
}

// Split only at top-level boolean operators, respecting nested parentheses
// and SQL-quoted text. This deliberately does not parse all SQL: it catches
// obvious unconditional OR branches without misreading an "OR true" string
// literal, an identifier, or `guard AND (false OR true)` as a broad grant.
function splitTopLevelPolicyBoolean(expression, operator) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let caseDepth = 0;
  let quote = null;
  for (let i = 0; i < expression.length; i += 1) {
    const char = expression[i];
    if (quote) {
      if (char === quote) {
        if (expression[i + 1] === quote) i += 1;
        else quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === '(') { depth += 1; continue; }
    if (char === ')') { depth -= 1; continue; }
    // OR/AND inside CASE WHEN conditions is not an outer RLS grant. Even
    // when the CASE is not wrapped in parentheses, keep its body intact.
    const word = /^(CASE|END)\b/i.exec(expression.slice(i));
    if (word && !/[\w$]/.test(expression[i - 1] ?? ' ') &&
        !/[\w$]/.test(expression[i + word[1].length] ?? ' ')) {
      if (word[1].toUpperCase() === 'CASE') caseDepth += 1;
      else if (caseDepth > 0) caseDepth -= 1;
      i += word[1].length - 1;
      continue;
    }
    if (depth !== 0 || caseDepth !== 0 ||
        expression.slice(i, i + operator.length).toUpperCase() !== operator) continue;
    const before = expression[i - 1] ?? ' ';
    const after = expression[i + operator.length] ?? ' ';
    // Commas delimit SQL function arguments, including `NULL,TRUE` without
    // whitespace. Boolean keywords still need word boundaries.
    if (operator !== ',' && (/[\w$]/.test(before) || /[\w$]/.test(after))) continue;
    parts.push(expression.slice(start, i).trim());
    start = i + operator.length;
    i += operator.length - 1;
  }
  if (parts.length === 0) return null;
  parts.push(expression.slice(start).trim());
  return parts;
}

// PostgreSQL need not spell TRUE to create a constant-true OR branch:
// `OR 1 < 2` / `OR 1 <> 2` can bypass the same actor/tenant predicate as
// `OR 1 = 1`. Safely evaluate ONLY two signed integer literals and a single
// comparison operator. Never evaluate SQL casts, identifiers, functions or
// quoted expressions. This remains a conservative safety floor, not a SQL
// theorem prover or a substitute for live RLS tenant-negative tests.
function literalIntegerComparisonValue(expression) {
  const match = /^([+-]?\d+)\s*(<=|>=|<>|!=|=|<|>)\s*([+-]?\d+)$/.exec(expression);
  if (!match) return undefined;
  const left = BigInt(match[1]);
  const right = BigInt(match[3]);
  switch (match[2]) {
    case '=': return left === right;
    case '<>':
    case '!=': return left !== right;
    case '<': return left < right;
    case '<=': return left <= right;
    case '>': return left > right;
    case '>=': return left >= right;
    default: return undefined;
  }
}

// PostgreSQL `IS NULL` is a total boolean test, including for a literal
// NULL. An unguarded OR branch such as `NULL IS NULL` or `1 IS NOT NULL`
// bypasses row/actor checks even though it uses neither TRUE nor an integer
// comparison. Only literal NULL, signed integers and boolean literals are
// evaluated; column references and all other SQL expressions remain opaque.
function literalNullCheckValue(expression) {
  const match = /^(NULL|TRUE|FALSE|[+-]?\d+)\s+IS\s+(NOT\s+)?NULL$/i.exec(expression);
  if (!match) return undefined;
  const isNullLiteral = match[1].toUpperCase() === 'NULL';
  return match[2] ? !isNullLiteral : isNullLiteral;
}

// Boolean negation and PostgreSQL's IS [NOT] TRUE/FALSE/UNKNOWN can
// express a constant TRUE without a literal TRUE branch. Evaluate only
// explicit boolean/NULL literals. A row-dependent predicate is opaque and
// still requires real app-role tenant-negative tests to establish safety.
function literalBooleanTestValue(expression) {
  const truthTest = /^(TRUE|FALSE|NULL)\s+IS\s+(NOT\s+)?(TRUE|FALSE|UNKNOWN)$/i.exec(expression);
  if (!truthTest) return undefined;
  const operand = truthTest[1].toUpperCase();
  const expected = truthTest[3].toUpperCase();
  const matches = expected === 'UNKNOWN' ? operand === 'NULL' : operand === expected;
  return truthTest[2] ? !matches : matches;
}

// Parse a searched CASE with one or more WHEN/THEN arms, optionally with an
// explicit ELSE. PostgreSQL supplies an implicit NULL when ELSE is missing.
// Top-level keywords are recognized only outside parentheses and SQL
// strings; nested/unexpected CASE syntax is left indeterminate. This is a
// deliberately narrow structural check, not general PostgreSQL SQL parsing.
function searchedPolicyCase(expression) {
  const keywords = [];
  let quote = null;
  let depth = 0;
  for (let i = 0; i < expression.length; i += 1) {
    const char = expression[i];
    if (quote) {
      if (char === quote) {
        if (expression[i + 1] === quote) i += 1;
        else quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === '(') { depth += 1; continue; }
    if (char === ')') { depth -= 1; if (depth < 0) return null; continue; }
    if (depth !== 0) continue;
    const match = /^(CASE|WHEN|THEN|ELSE|END)\b/i.exec(expression.slice(i));
    if (!match || /[\w$]/.test(expression[i - 1] ?? ' ')) continue;
    keywords.push({ keyword: match[1].toUpperCase(), start: i, end: i + match[1].length });
    i += match[1].length - 1;
  }
  if (quote || depth !== 0 || keywords.length < 4 ||
      keywords[0].keyword !== 'CASE' || keywords[0].start !== 0 ||
      keywords[keywords.length - 1].keyword !== 'END' ||
      expression.slice(keywords[keywords.length - 1].end).trim()) return null;

  const branches = [];
  let pos = 1;
  const endIndex = keywords.length - 1;
  while (pos + 1 < endIndex && keywords[pos].keyword === 'WHEN' &&
         keywords[pos + 1].keyword === 'THEN') {
    const condition = expression.slice(keywords[pos].end, keywords[pos + 1].start).trim();
    const nextIndex = pos + 2;
    if (nextIndex > endIndex || !['WHEN', 'ELSE', 'END'].includes(keywords[nextIndex].keyword)) return null;
    const outcome = expression.slice(keywords[pos + 1].end, keywords[nextIndex].start).trim();
    if (!condition || !outcome) return null;
    branches.push({ condition, outcome });
    pos = nextIndex;
  }
  if (!branches.length) return null;
  if (pos === endIndex) return { branches, fallback: null }; // implicit ELSE NULL
  if (pos !== endIndex - 1 || keywords[pos].keyword !== 'ELSE') return null;
  const fallback = expression.slice(keywords[pos].end, keywords[endIndex].start).trim();
  return fallback ? { branches, fallback } : null;
}

// Conservative three-state constant folding for the boolean shell of a
// PostgreSQL RLS predicate. `undefined` means row-dependent, SQL UNKNOWN, or
// otherwise unrecognized -- never assume it is FALSE. A literal FALSE arm
// makes an AND universally false even when its sibling reads row data, so
// negating that AND is an unrestricted TRUE. Similarly, a TRUE OR arm is
// unconditional. This is only a safety floor, not a SQL parser or proof of
// RLS policy equivalence; real application-role tenant negative tests remain
// mandatory. Preserve the SQL precedence OR < AND < NOT, and respect quoted
// strings and nested parentheses via the existing splitter.
function constantPolicyBooleanValue(predicate) {
  const expression = unwrapPolicyParentheses(predicate);
  if (isUnconditionalTruePredicate(expression)) return true;
  if (/^false(?:\s*::\s*(?:boolean|bool))?$/i.test(expression)) return false;

  for (const check of [literalIntegerComparisonValue, literalNullCheckValue, literalBooleanTestValue]) {
    const result = check(expression);
    if (result !== undefined) return result;
  }

  // A searched CASE chooses the first TRUE condition; FALSE/NULL skip to
  // the next arm. Treat row-dependent conditions as potentially true or
  // false. Only report a constant if EVERY reachable arm and fallback has
  // the same provable boolean result; do not guess row-specific outcomes.
  const searchedCase = searchedPolicyCase(expression);
  if (searchedCase) {
    const possible = [];
    let canReachFallback = true;
    for (const branch of searchedCase.branches) {
      const condition = constantPolicyBooleanValue(branch.condition);
      if (condition === false) continue;
      possible.push(constantPolicyBooleanValue(branch.outcome));
      if (condition === true) { canReachFallback = false; break; }
    }
    if (canReachFallback) possible.push(searchedCase.fallback === null
      ? undefined : constantPolicyBooleanValue(searchedCase.fallback));
    return possible.length && possible[0] !== undefined &&
      possible.every((value) => value === possible[0]) ? possible[0] : undefined;
  }

  // COALESCE is left-to-right: the first non-NULL input determines the
  // result. A constant TRUE fallback can make an application RLS policy
  // unconditional even without an explicit OR TRUE branch. Only evaluate
  // provable literal NULL inputs and the first non-null constant expression.
  // A row-dependent first input remains UNKNOWN (COALESCE(guard, TRUE) is
  // not universally TRUE). Reuse the quote/nesting-aware boolean splitter
  // for commas; this is not a general-purpose SQL expression interpreter.
  const coalesce = /^COALESCE\s*\(([\s\S]*)\)$/i.exec(expression);
  if (coalesce) {
    const argumentsList = splitTopLevelPolicyBoolean(coalesce[1], ',');
    if (!argumentsList || argumentsList.some((item) => !item)) return undefined;
    for (const argument of argumentsList) {
      if (/^NULL(?:\s*::\s*(?:boolean|bool))?$/i.test(unwrapPolicyParentheses(argument))) continue;
      return constantPolicyBooleanValue(argument);
    }
    return undefined;
  }

  const orParts = splitTopLevelPolicyBoolean(expression, 'OR');
  if (orParts) {
    const values = orParts.map(constantPolicyBooleanValue);
    if (values.some((value) => value === true)) return true;
    if (values.every((value) => value === false)) return false;
    return undefined;
  }
  const andParts = splitTopLevelPolicyBoolean(expression, 'AND');
  if (andParts) {
    const values = andParts.map(constantPolicyBooleanValue);
    if (values.some((value) => value === false)) return false;
    if (values.every((value) => value === true)) return true;
    return undefined;
  }
  const negated = /^NOT\s+(.+)$/i.exec(expression);
  if (negated) {
    const value = constantPolicyBooleanValue(negated[1]);
    return value === undefined ? undefined : !value;
  }
  return undefined;
}

function isObviouslyUnrestrictedPolicyPredicate(predicate) {
  return constantPolicyBooleanValue(predicate) === true;
}

function isRestrictingPredicate(predicate) {
  return typeof predicate === 'string' && Boolean(predicate.trim()) &&
    !isObviouslyUnrestrictedPolicyPredicate(predicate);
}

function assertAppPolicyPredicates(row) {
  if (row.roles[0] !== 'nearpill_app') return;
  const requiresUsing = ['ALL', 'SELECT', 'UPDATE', 'DELETE'].includes(row.cmd);
  const requiresCheck = ['ALL', 'INSERT', 'UPDATE'].includes(row.cmd);
  if ((requiresUsing && !isRestrictingPredicate(row.qual)) ||
      (requiresCheck && !isRestrictingPredicate(row.with_check))) {
    throw new Error('Live DB verification refused: app RLS policy has a missing or unrestricted USING/WITH CHECK predicate.');
  }
}

// The canonical `migrator_all` policies deliberately expose every protected
// row to the separately authorized, non-BYPASSRLS migrator. Reconciliation
// reads with that role: a narrowed USING predicate can silently hide invalid
// tenant rows and make COUNT(*) checks appear clean. Role/name/cmd parity
// alone is insufficient. Verify the normalized catalog's unconditional TRUE
// predicates for this *reviewed* policy only; it is not app-role authority.
function isUnconditionalTruePredicate(predicate) {
  if (typeof predicate !== 'string') return false;
  const expression = unwrapPolicyParentheses(predicate);
  return /^(?:true|true\s*::\s*(?:boolean|bool)|'t'\s*::\s*(?:boolean|bool))$/i.test(expression);
}

export function assertActualRlsPolicyInventory(rows, approved) {
  if (!Array.isArray(rows) || rows.length !== approved.length) {
    throw new Error('Live DB verification refused: PostgreSQL RLS policy inventory differs from reviewed migrations.');
  }
  const expected = new Map(approved.map((row) => [`${row.tablename}.${row.policyname}`, row]));
  const seen = new Set();
  for (const row of rows) {
    const key = `${row?.tablename}.${row?.policyname}`;
    const source = expected.get(key);
    if (!source || seen.has(key) || row.cmd !== source.cmd ||
        row.permissive !== source.permissive ||
        !Array.isArray(row.roles) || row.roles.length !== 1 ||
        row.roles[0] !== source.roles[0]) {
      throw new Error('Live DB verification refused: PostgreSQL RLS policy inventory differs from reviewed migrations.');
    }
    assertAppPolicyPredicates(row);
    if (source.policyname === 'migrator_all' && source.roles[0] === 'nearpill_migrator' &&
        (!isUnconditionalTruePredicate(row.qual) || !isUnconditionalTruePredicate(row.with_check))) {
      throw new Error('Live DB verification refused: migrator RLS policy must preserve full-row visibility for reconciliation.');
    }
    seen.add(key);
  }
}

async function assertReviewedMigrationHistory(migratorPool) {
  const sources = await loadCanonicalMigrationSources();
  const expected = new Map(sources.map(({ filename, sql }) => [
    filename, createHash('sha256').update(sql).digest('hex'),
  ]));
  const result = await migratorPool.query(MIGRATION_JOURNAL_PROBE_SQL);
  if (!result || !Array.isArray(result.rows) || result.rows.length !== expected.size ||
      new Set(result.rows.map((row) => row?.filename)).size !== expected.size ||
      result.rows.some((row) => !row || !expected.has(row.filename) ||
        row.sha256 !== expected.get(row.filename))) {
    throw new Error('Live DB verification refused: PostgreSQL migration journal does not match reviewed SQL checksums.');
  }
}

// Canonical protected-table set from the reviewed migration history and
// scripts/reconcile-postgres.mjs. Refuse missing or weakened tables BEFORE
// running any fixture-writing security/integrity verification.
// The reviewed SQL currently leaves both `users` and the migrator-only
// journal outside the 25-table policy inventory. The journal is restricted
// by grants, but `users` holds credentials and account data: NP-031 is a
// release-blocking RLS gap, not an approved exemption. Require enabled and
// forced users RLS *in addition to* safe grants before any fixture writes.
// This does not create a users policy or prove authentication compatibility;
// a reviewed source migration and real negative tests remain mandatory.
const PUBLIC_SCHEMA_EXCEPTIONS = Object.freeze(['users', 'nearpill_schema_migrations']);

const PROTECTED_TABLES = Object.freeze([
  'pharmacies', 'pharmacy_memberships', 'medicines', 'stock', 'orders',
  'order_pharmacies', 'order_items', 'payments', 'subscriptions', 'audit_logs',
  'auth_session_families', 'auth_sessions', 'email_codes',
  'reset_links', 'auth_rate_limit_events', 'auth_account_security',
  'pharmacy_verifications', 'reservations', 'stock_movements',
  'payment_events', 'refunds', 'payment_issues',
  'plan_features', 'stock_submissions', 'auth_throttle_events',
]);

// Reviewed table renames and the one reviewed removal made by migration
// 0053_simpler_database_names.sql. Older migrations still create the old names,
// so the replayed source inventory maps exactly these and nothing else.
const REVIEWED_TABLE_RENAMES = Object.freeze(new Map([
  ['drugstores', 'pharmacies'], ['inventory', 'stock'], ['order_drugstores', 'order_pharmacies'],
  ['subscription_entitlements', 'plan_features'], ['payment_reconciliation', 'payment_issues'],
  ['email_verification_challenges', 'email_codes'], ['password_reset_challenges', 'reset_links'],
]));
const REVIEWED_TABLE_REMOVALS = Object.freeze(new Set(['medicine_evidence', 'medicine_id_renumbering', 'billing_events']));
// Columns dropped by 0053 whose foreign keys disappear with them.
const REVIEWED_REMOVED_FK_COLUMNS = Object.freeze(new Set(['payment_reconciliation.resolved_by']));

function expectedLoginRole(value) {
  // Supabase's session pooler uses ROLE.PROJECT_REF as a connection username.
  // PostgreSQL current_user still represents the underlying ROLE.
  return String(value || '').trim().split('.')[0];
}

function assertRole(probe, role, database, target) {
  if (!probe || probe.role_name !== expectedLoginRole(role) || probe.database_name !== database) {
    throw new Error('Live DB verification refused: connected role/database differs from approved target.');
  }
  if (probe.session_role_name !== expectedLoginRole(role)) {
    throw new Error('Live DB verification refused: session identity differs from approved login; SET ROLE cannot prove least privilege.');
  }
  // Reject direct and inherited escalation paths, including SET ROLE into a
  // privileged role. Unknown/null probe results must never count as safe.
  if (probe.is_superuser !== false || probe.bypass_rls !== false ||
      probe.can_create_roles !== false || probe.can_create_databases !== false ||
      probe.can_replicate !== false || probe.elevated_role_membership !== false ||
      probe.client_elevated_role_membership !== false) {
    throw new Error('Live DB verification refused: role has elevated privileges, inherited membership, or unknown security flags.');
  }
  if (target === 'staging' && probe.tls_active !== true) {
    throw new Error('Live DB verification refused: PostgreSQL did not confirm TLS on this connection.');
  }
}

export async function assertSafeLiveFixtureConnections({ appPool, migratorPool, env }) {
  if (!appPool || typeof appPool.query !== 'function') {
    throw new Error('Live DB verification requires an application-role pool.');
  }
  if (!env || !['local-test', 'staging'].includes(env.NEARPILL_VERIFICATION_TARGET)) {
    throw new Error('Live DB verification requires the previously approved test target.');
  }

  const appProbe = (await appPool.query(ROLE_PROBE_SQL)).rows[0];
  assertRole(appProbe, env.DB_USER, env.DB_NAME, env.NEARPILL_VERIFICATION_TARGET);

  // Actual table ownership and RLS flags matter even if the role name looks safe.
  const tables = (await appPool.query(
    TABLE_PROBE_SQL, [[...PROTECTED_TABLES, ...PUBLIC_SCHEMA_EXCEPTIONS]],
  )).rows;
  for (const name of PROTECTED_TABLES) {
    const table = tables.find((row) => row.table_name === name);
    if (!table || table.rls_enabled !== true || table.rls_forced !== true ||
        !table.owner_name || table.owner_name === appProbe.role_name ||
        table.app_can_assume_owner !== false ||
        table.exposed_client_grant !== false || table.public_grant !== false ||
        table.exposed_client_column_grant !== false || table.public_column_grant !== false) {
      throw new Error(`Live DB verification refused: ${name} lacks forced RLS or has an unsafe owner, membership or Data API grant boundary.`);
    }
  }

  // The migration journal remains migrator-only through explicit grants.
  // `users` additionally MUST have forced RLS; the current seven reviewed
  // migrations do not implement that yet (NP-031). Do not allow a simulated
  // safe grant boundary to substitute for row security at fixture time.
  for (const name of PUBLIC_SCHEMA_EXCEPTIONS) {
    const table = tables.find((row) => row.table_name === name);
    if (!table || !table.owner_name || table.owner_name === appProbe.role_name ||
        table.app_can_assume_owner !== false ||
        table.exposed_client_grant !== false || table.public_grant !== false ||
        table.exposed_client_column_grant !== false || table.public_column_grant !== false ||
        (name === 'users' && (table.rls_enabled !== true || table.rls_forced !== true)) ||
        (name === 'nearpill_schema_migrations' &&
          (table.app_role_grant !== false || table.app_role_column_grant !== false ||
            table.app_role_switch_table_grant !== false ||
            table.app_role_switch_column_grant !== false))) {
      throw new Error(`Live DB verification refused: ${name} lacks required forced RLS or has an unsafe public-schema grant or owner boundary.`);
    }
  }

  // None of these permissions is protected by row-scoped tenant policies.
  // Apply to users and the migrator journal as well as the 25 RLS tables,
  // and fail closed on unreadable/unknown catalog fields before any writes.
  for (const name of [...PROTECTED_TABLES, ...PUBLIC_SCHEMA_EXCEPTIONS]) {
    const table = tables.find((row) => row.table_name === name);
    if (!table || table.app_non_rls_table_privilege !== false ||
        table.app_role_switch_non_rls_table_privilege !== false) {
      throw new Error(`Live DB verification refused: ${name} has an unsafe non-RLS table privilege.`);
    }
    if (table.app_non_rls_column_privilege !== false ||
        table.app_role_switch_non_rls_column_privilege !== false) {
      throw new Error(`Live DB verification refused: ${name} has an unsafe non-RLS column privilege.`);
    }
  }

  // Check database-wide CREATE separately from CREATE on existing schemas.
  // The least-privilege app must not be able to create a new schema or trusted
  // extension, directly or by SET ROLE; likewise Supabase clients and PUBLIC.
  // Fail closed before migrator access and synthetic fixture writes.
  const databaseResult = await appPool.query(DATABASE_CREATION_PRIVILEGE_PROBE_SQL);
  if (!databaseResult || !Array.isArray(databaseResult.rows) || databaseResult.rows.length !== 1) {
    throw new Error('Live DB verification refused: database CREATE privilege boundary is unavailable.');
  }
  const db = databaseResult.rows[0];
  if (!db || !db.database_owner || db.database_owner === appProbe.role_name ||
      db.app_can_assume_database_owner !== false ||
      db.app_can_create_database_objects !== false ||
      db.client_can_create_database_objects !== false ||
      db.public_can_create_database_objects !== false) {
    throw new Error('Live DB verification refused: unsafe database CREATE privilege boundary.');
  }

  // A permissive policy added under a reviewed table can defeat forced RLS
  // without changing table flags or grants. Detect missing, added, renamed,
  // broadened-role or altered-command policy tuples before fixture writes.
  const approvedPolicies = await reviewedRlsPolicyInventory();
  // Include both intentionally exceptional public tables in the actual policy
  // catalog read. Today the reviewed seven migrations define no policies on
  // `users` (NP-031) or the migrator-only journal; an ad hoc policy on either
  // must NOT evade comparison merely because it is outside PROTECTED_TABLES.
  // A future reviewed users-RLS migration must update the source-backed policy
  // contract and pass real authentication/tenant isolation tests separately.
  const policyTables = [...PROTECTED_TABLES, ...PUBLIC_SCHEMA_EXCEPTIONS, 'nearpill.prescription_reviews'];
  const actualPolicies = await appPool.query(POLICY_INVENTORY_PROBE_SQL, [policyTables]);
  assertActualRlsPolicyInventory(actualPolicies?.rows, approvedPolicies);

  // Check the schema itself, not only its current tables and routines.
  // On a genuine Supabase staging project the two Data API roles must exist;
  // an absent role must not masquerade as a negative effective-grant test.
  const schemaResult = await appPool.query(PUBLIC_SCHEMA_PRIVILEGE_PROBE_SQL);
  if (!schemaResult || !Array.isArray(schemaResult.rows) || schemaResult.rows.length !== 1) {
    throw new Error('Live DB verification refused: public-schema privileges are unavailable.');
  }
  const schema = schemaResult.rows[0];
  if (!schema || !schema.schema_owner || schema.schema_owner === appProbe.role_name ||
      schema.app_can_assume_schema_owner !== false || schema.app_can_create !== false ||
      schema.client_can_create !== false || schema.public_can_create !== false ||
      (env.NEARPILL_VERIFICATION_TARGET === 'staging' && schema.api_roles_present !== true)) {
    throw new Error('Live DB verification refused: public schema permits untrusted object creation or Supabase roles are unverifiable.');
  }

  // The private NearPill helper and extension schemas are part of the reviewed
  // PostgreSQL schema. Refuse missing/duplicate schemas, app-role object
  // creation or ownership, and any Supabase/PUBLIC schema usage or CREATE
  // grants, including non-inherited privileges accessible via SET ROLE.
  const expectedInternalSchemas = ['nearpill', 'nearpill_extensions'];
  const internalSchemaResult = await appPool.query(
    INTERNAL_SCHEMA_PRIVILEGE_PROBE_SQL, [expectedInternalSchemas],
  );
  const internalSchemas = internalSchemaResult?.rows;
  if (!Array.isArray(internalSchemas) || internalSchemas.length !== expectedInternalSchemas.length ||
      new Set(internalSchemas.map((row) => row?.schema_name)).size !== expectedInternalSchemas.length) {
    throw new Error('Live DB verification refused: missing or duplicate internal schema boundary.');
  }
  for (const name of expectedInternalSchemas) {
    const schemaRow = internalSchemas.find((row) => row?.schema_name === name);
    if (!schemaRow || !schemaRow.schema_owner || schemaRow.schema_owner === appProbe.role_name ||
        schemaRow.app_can_assume_schema_owner !== false || schemaRow.app_can_create !== false ||
        schemaRow.client_can_use !== false || schemaRow.client_can_create !== false ||
        schemaRow.public_can_use !== false || schemaRow.public_can_create !== false) {
      throw new Error(`Live DB verification refused: unsafe internal schema grants or ownership on ${name}.`);
    }
  }

  // Confirm the four reviewed RLS/trigger helpers are unprivileged and have
  // no PUBLIC or Supabase Data API execution grants. These checks are read-only
  // and precede migrator access and every fixture-writing operation.
  const internalRoutineResult = await appPool.query(INTERNAL_ROUTINE_PROBE_SQL);
  assertInternalRoutineBoundary(internalRoutineResult?.rows, appProbe.role_name, await reviewedInternalRoutineBodies());

  // The private sample review table and its identity sequence are the only reviewed relations.
  const internalRelations = (await appPool.query(INTERNAL_AUTH_RELATIONS_PROBE_SQL))?.rows;
  if (!Array.isArray(internalRelations) || internalRelations.length !== 2 ||
      !internalRelations.some((row) => row?.internal_relation_name === 'prescription_reviews' &&
        row.internal_relation_kind === 'r' && row.relrowsecurity === true && row.relforcerowsecurity === true && row.safe_acl === true) ||
      !internalRelations.some((row) => row?.internal_relation_name === 'prescription_reviews_id_seq' &&
        row.internal_relation_kind === 'S' && row.safe_acl === true)) {
    throw new Error('Live DB verification refused: unreviewed or unverifiable authorization-schema relation.');
  }

  // Verify the trigger wiring after attesting its helper body. A new trigger
  // can execute even when existing functions and RLS metadata are unchanged.
  // This is a read-only catalog check before migrator access/fixture writes.
  const appTriggers = await appPool.query(PUBLIC_APP_TRIGGER_PROBE_SQL);
  assertReviewedPublicAppTrigger(appTriggers?.rows);

  // A missing FK has no internal trigger to disable. Check the complete
  // canonical 41-relationship inventory before treating trigger status as safe.
  const expectedForeignKeys = await memoizedInventory('foreign-keys', async () =>
    reviewedForeignKeyInventoryFromSources(await loadCanonicalMigrationSources()));
  const foreignKeyInventory = await appPool.query(FOREIGN_KEY_INVENTORY_PROBE_SQL);
  assertReviewedForeignKeyInventory(foreignKeyInventory?.rows, expectedForeignKeys);

  // Protect reset, checkout, payment and entitlement uniqueness before
  // migrator access/fixture writes. Source CREATE UNIQUE INDEX is insufficient
  // if the deployed physical indexes are absent, invalid or have drifted.
  const partialUniqueIndexes = await appPool.query(REVIEWED_PARTIAL_UNIQUE_INDEX_PROBE_SQL);
  assertReviewedPartialUniqueIndexes(partialUniqueIndexes?.rows);

  // Attest six non-partial UNIQUE constraints: core membership/inventory
  // identity (0001), reservation identity (0006), and payment integrity (0007).
  const criticalUniqueConstraints = await appPool.query(REVIEWED_CRITICAL_UNIQUE_CONSTRAINT_PROBE_SQL);
  assertReviewedCriticalUniqueConstraints(criticalUniqueConstraints?.rows);

  // Verify physical stock/centavo CHECKs under the actual app role before
  // migrator access or any fixture writes. Do not trust source SQL alone.
  const stockAndMoneyChecks = await appPool.query(REVIEWED_STOCK_AND_MONEY_CHECK_PROBE_SQL);
  assertReviewedStockAndMoneyChecks(stockAndMoneyChecks?.rows);

  // A valid CHECK does not forbid NULL. Protect the reviewed BIGINT/INTEGER
  // representation and per-column nullability (including intentionally nullable
  // provider event amounts) across migrations 0001/0006/0007.
  const criticalStockMoneyColumns = await appPool.query(REVIEWED_STOCK_MONEY_COLUMN_PROBE_SQL);
  assertReviewedStockMoneyColumns(criticalStockMoneyColumns?.rows);

  // Do not confuse a valid application timestamp trigger with fully enabled
  // PostgreSQL constraint triggers. Reject catalog read failures and any FK/
  // constraint trigger that is disabled or fires only in replica mode. This
  // executes under the app role, before migrator access and fixture writes.
  const disabledConstraintTriggers = await appPool.query(DISABLED_INTERNAL_CONSTRAINT_TRIGGER_PROBE_SQL);
  if (!disabledConstraintTriggers || !Array.isArray(disabledConstraintTriggers.rows) ||
      disabledConstraintTriggers.rows.length !== 0) {
    throw new Error('Live DB verification refused: disabled or unverifiable internal constraint trigger.');
  }

  // A safe present-day grant inventory does not imply that future objects
  // will stay private. Refuse unsafe *explicit* default ACL entries before
  // connecting as the migrator or writing fixtures. Empty rows are required;
  // unavailable/malformed results fail closed.
  const defaultGrantProbe = await appPool.query(UNSAFE_DEFAULT_GRANTS_SQL);
  if (!defaultGrantProbe || !Array.isArray(defaultGrantProbe.rows) ||
      defaultGrantProbe.rows.length !== 0) {
    throw new Error('Live DB verification refused: unsafe or unverifiable reviewed-schema default privileges.');
  }

  // Reject unreviewed public tables even if all 27 known tables pass their
  // individual RLS/grant checks. Unknown/incomplete query results fail closed.
  const unexpectedRelations = await appPool.query(
    UNREVIEWED_PUBLIC_RELATIONS_SQL, [[...PROTECTED_TABLES, ...PUBLIC_SCHEMA_EXCEPTIONS]],
  );
  if (!unexpectedRelations || !Array.isArray(unexpectedRelations.rows) ||
      unexpectedRelations.rows.length !== 0) {
    throw new Error('Live DB verification refused: unreviewed public base, partitioned or foreign table.');
  }

  // The supplied migration history expects no public RPC/view entrypoints.
  // Sequence privileges are a separate boundary from has_table_privilege.
  // Run before any fixture writes and treat an unknown response as unsafe.
  const surfaceProbe = await appPool.query(PUBLIC_SURFACE_PROBE_SQL);
  if (!surfaceProbe || !Array.isArray(surfaceProbe.rows) || surfaceProbe.rows.length !== 0) {
    throw new Error('Live DB verification refused: unreviewed public view/routine or unsafe sequence owner/grant/UPDATE.');
  }

  if (!migratorPool || typeof migratorPool.query !== 'function') {
    throw new Error('Live DB verification refused: separate migrator connection required for migration history.');
  }
  const migratorProbe = (await migratorPool.query(ROLE_PROBE_SQL)).rows[0];
  assertRole(migratorProbe, env.MIGRATOR_DB_USER, env.DB_NAME, env.NEARPILL_VERIFICATION_TARGET);
  if (migratorProbe.role_name === appProbe.role_name) {
    throw new Error('Live DB verification refused: migrator and application use the same live role.');
  }
  await assertReviewedMigrationHistory(migratorPool);
  // Intentionally return no rows/role or connection information for logging.
}
