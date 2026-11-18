/**
 * Operator-only, side-effect-free gate for the canonical SQL migration runner.
 * Source checksums protect already-applied migrations; this guard independently
 * prevents migrations against an implicit or mismatched PostgreSQL endpoint.
 * A confirmation string is NOT proof of ownership, backup or live RLS safety.
 */
function usesStagingSessionPooler(env) {
  return env.NEARPILL_MIGRATION_TARGET === 'staging' &&
    env.NEARPILL_MIGRATION_PROJECT_REF === 'afqqozfjpiodanpogvfb' &&
    env.DB_HOST === 'aws-0-ap-southeast-1.pooler.supabase.com' &&
    env.DB_PORT === '5432' &&
    env.DB_USER === 'nearpill_migrator.afqqozfjpiodanpogvfb' &&
    env.MIGRATOR_DB_USER === env.DB_USER;
}

export function assertApprovedMigrationTarget(env) {
  const target = env?.NEARPILL_MIGRATION_TARGET;
  if (target !== 'local' && target !== 'staging') {
    throw new Error('Migration refused: select an explicit local or staging target. Production cutover requires a separate reviewed procedure.');
  }
  if (env.NEARPILL_MIGRATION_CONFIRMATION !== 'I_APPROVE_REVIEWED_SQL_MIGRATIONS') {
    throw new Error('Migration refused: explicit reviewed-migration consent is required.');
  }
  // pg.Pool receives the ORIGINAL DB_* strings below. Do not approve
  // trimmed copies while passing different raw host/database/login values
  // to the driver: refuse ambiguous operator input before any connection.
  for (const key of ['DB_HOST', 'DB_NAME', 'DB_PORT', 'DB_USER', 'MIGRATOR_DB_USER']) {
    const value = env[key];
    if (typeof value === 'string' && value !== value.trim()) {
      throw new Error(`Migration refused: ${key} contains leading/trailing whitespace.`);
    }
  }
  const host = env.DB_HOST?.trim();
  const database = env.DB_NAME?.trim();
  const portText = env.DB_PORT?.trim();
  const port = Number(portText);
  if (!host || !database || host !== env.NEARPILL_MIGRATION_EXPECTED_HOST?.trim() ||
      database !== env.NEARPILL_MIGRATION_EXPECTED_DATABASE?.trim() ||
      !portText || !/^\d+$/.test(portText) || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('Migration refused: explicit host, database and TCP port must match the separately confirmed target.');
  }
  const role = env.DB_USER?.trim();
  const migrator = env.MIGRATOR_DB_USER?.trim();
  const credential = env.DB_PASSWORD?.trim();
  const unsafeRoles = new Set(['postgres', 'supabase_admin', 'service_role', 'nearpill_app', 'nearpill_owner']);
  // Quoted PostgreSQL login names may preserve case. Match reserved names
  // without case dependence, before creating the migration connection.
  const normalizedRole = role?.toLowerCase();
  // A migration must use an explicitly reviewed direct PostgreSQL login.
  // Internal whitespace, controls, and invisible format characters make the
  // identity ambiguous and can represent an unintended quoted PostgreSQL
  // role. Check both configured names before opening a migration pool.
  const malformedRole = (name) => /[\p{White_Space}\p{Cc}\p{Cf}]/u.test(name);
  if (!role || !migrator || role !== migrator ||
      malformedRole(role) || malformedRole(migrator) ||
      unsafeRoles.has(normalizedRole.split('.')[0]) || normalizedRole.startsWith('pg_') || !credential) {
    throw new Error('Migration refused: connect using the explicitly designated non-admin migrator role and its credentials, not the app/owner role.');
  }
  if (target === 'local') {
    if (!['development', 'test'].includes(env.NODE_ENV) ||
        !['127.0.0.1', 'localhost', '::1'].includes(host) || env.DB_SSL === 'true') {
      throw new Error('Migration refused: local migrations require a loopback endpoint and development/test environment.');
    }
  } else {
    const ref = env.NEARPILL_MIGRATION_PROJECT_REF?.trim();
    if (env.NODE_ENV !== 'staging' || env.DB_SSL !== 'true' || port !== 5432 ||
        env.NEARPILL_MIGRATION_OWNER_APPROVED !== 'true' ||
        !ref || !/^[a-z0-9-]{5,40}$/.test(ref) ||
        (host !== `db.${ref}.supabase.co` && !usesStagingSessionPooler(env))) {
      throw new Error('Migration refused: staging requires an owner-approved NearPill Supabase project, direct TLS connection or approved staging session pooler, and matching project reference.');
    }
    // Supabase's direct PostgreSQL endpoint authenticates an unqualified
    // database role. <role>.<project-ref> is for the shared pooler and must
    // not be used for reviewed migrations, even if the host is direct.
    // Reject this operator mistake before constructing any migration pool.
    if (role.includes('.') && !usesStagingSessionPooler(env)) {
      throw new Error('Migration refused: staging direct login must use an unqualified PostgreSQL migrator role.');
    }
  }
  return Object.freeze({ target, host, database, port, migrator });
}

// Evaluate the *actual* connected session on each checked-out client before
// issuing transactional DDL; supplied environment names are not role proof.
// This is still not a substitute for a controlled staging migration rehearsal.
const MIGRATOR_IDENTITY_SQL = `
  SELECT current_user AS role_name, session_user AS session_role_name,
         current_database() AS database_name,
         r.rolsuper AS is_superuser, r.rolbypassrls AS bypass_rls,
         r.rolcreaterole AS can_create_roles, r.rolcreatedb AS can_create_databases,
         r.rolreplication AS can_replicate,
         EXISTS (
           SELECT 1 FROM pg_roles AS privileged
           -- Do not exclude privileged.oid = r.oid: a predefined role
           -- made LOGIN-capable must also be rejected as the current role.
           -- PostgreSQL reserves pg_ for its predefined system roles; this
           -- prefix covers future additions without changing the deny-list.
           WHERE (left(privileged.rolname, 3) = 'pg_' OR
                  privileged.rolsuper OR privileged.rolbypassrls OR
                  privileged.rolcreaterole OR privileged.rolcreatedb OR
                  privileged.rolreplication OR
                  -- Predefined data-wide, monitoring and server-file/program
                  -- roles are elevated even when the login itself has no
                  -- SUPERUSER/BYPASSRLS attribute. MEMBER also detects
                  -- SET-able membership not currently inherited.
                  privileged.rolname IN (
                    'postgres', 'supabase_admin', 'service_role',
                    'pg_maintain', 'pg_read_all_data', 'pg_write_all_data',
                    'pg_read_server_files', 'pg_write_server_files',
                    'pg_execute_server_program', 'pg_monitor',
                    'pg_read_all_settings', 'pg_read_all_stats',
                    'pg_stat_scan_tables', 'pg_signal_backend',
                    'pg_checkpoint', 'pg_create_subscription',
                    'pg_use_reserved_connections',
                    'pg_signal_autovacuum_worker'
                  ))
             AND pg_has_role(r.oid, privileged.oid, 'MEMBER')
         ) AS elevated_role_membership,
         -- An otherwise non-superuser migrator may own the database or
         -- SET ROLE to its owner. Database ownership gives broad database-
         -- level DDL authority beyond the reviewed schema grants; reject
         -- both direct and MEMBER-reachable ownership in the live session.
         EXISTS (
           SELECT 1 FROM pg_database AS d
           WHERE d.datname = current_database()
             AND pg_has_role(r.oid, d.datdba, 'MEMBER')
         ) AS can_assume_database_owner,
         (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS tls_active
  FROM pg_roles AS r WHERE r.rolname = current_user
`;

export async function assertSafeMigrationSession(client, env) {
  if (!client || typeof client.query !== 'function') {
    throw new Error('Migration refused: no live migration connection to verify.');
  }
  const result = await client.query(MIGRATOR_IDENTITY_SQL);
  if (!Array.isArray(result?.rows) || result.rows.length !== 1) {
    throw new Error('Migration refused: connected role identity is unavailable.');
  }
  const role = result.rows[0];
  const pooled = usesStagingSessionPooler(env);
  const expectedRole = pooled ? 'nearpill_migrator' : env.DB_USER;
  // Supavisor terminates client TLS, so pg_stat_ssl describes a different socket.
  const socket = client.connection?.stream;
  const verifiedTls = pooled
    ? socket?.encrypted === true && socket.authorized === true && socket.servername === env.DB_HOST
    : role.tls_active === true;
  if (role.role_name !== expectedRole || role.session_role_name !== expectedRole ||
      role.database_name !== env.DB_NAME ||
      role.is_superuser !== false || role.bypass_rls !== false ||
      role.can_create_roles !== false || role.can_create_databases !== false ||
      role.can_replicate !== false || role.elevated_role_membership !== false ||
      role.can_assume_database_owner !== false ||
      (env.NEARPILL_MIGRATION_TARGET === 'staging' && !verifiedTls)) {
    throw new Error('Migration refused: actual role, database, TLS or effective elevated privileges violate the approved target.');
  }
}
