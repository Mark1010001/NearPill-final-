/**
 * Fail-closed, side-effect-free operator preflight for database checks that
 * INSERT/UPDATE/DELETE test fixtures. This is not database-role or RLS proof.
 * The live scripts must call this before constructing a pool or connecting.
 */
export function assertApprovedFixtureTarget(env) {
  const target = env.NEARPILL_VERIFICATION_TARGET;
  if (!['local-test', 'staging'].includes(target)) {
    throw new Error('Fixture-writing verification requires NEARPILL_VERIFICATION_TARGET=local-test or staging.');
  }
  if (env.NODE_ENV !== (target === 'staging' ? 'staging' : 'test')) {
    throw new Error('Fixture verification requires NODE_ENV=test for local-test or NODE_ENV=staging for staging.');
  }
  if (env.NEARPILL_VERIFICATION_CONFIRMATION !== 'I_APPROVE_TEST_FIXTURE_WRITES') {
    throw new Error('Fixture-writing verification requires explicit operator confirmation.');
  }
  // Both app and migrator pools receive unmodified process.env values.
  // Reject padding before approval, rather than validating a trimmed
  // hostname/role/port and connecting with a different raw string.
  const connectionKeys = ['DB_HOST', 'DB_NAME', 'DB_PORT', 'DB_USER', 'MIGRATOR_DB_USER'];
  if (target === 'staging') connectionKeys.push('MIGRATOR_DB_HOST', 'MIGRATOR_DB_PORT');
  for (const key of connectionKeys) {
    const value = env[key];
    if (typeof value === 'string' && value !== value.trim()) {
      throw new Error(key === 'DB_PORT'
        ? 'Fixture verification requires an explicit valid DB_PORT.'
        : `Fixture verification requires an unpadded ${key} connection value.`);
    }
  }

  const host = env.DB_HOST?.trim();
  const database = env.DB_NAME?.trim();
  if (!host || !database ||
      host !== env.NEARPILL_VERIFICATION_EXPECTED_HOST?.trim() ||
      database !== env.NEARPILL_VERIFICATION_EXPECTED_DATABASE?.trim()) {
    throw new Error('Explicit DB_HOST and DB_NAME must match the expected fixture-test target.');
  }

  // Never silently fall back to the script's default port. Supabase's
  // transaction pooler commonly uses 6543; it is not compatible with the
  // persistent/session-sensitive verification flow used here. The supported
  // direct and shared session-mode endpoints both use port 5432.
  const rawPort = env.DB_PORT?.trim();
  const port = Number(rawPort);
  if (!rawPort || !/^\d+$/.test(rawPort) || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('Fixture verification requires an explicit valid DB_PORT.');
  }
  if (target === 'staging' && port !== 5432) {
    throw new Error('Supabase staging fixture verification requires direct or session-mode PostgreSQL on port 5432; transaction pooling is forbidden.');
  }

  const appRole = env.DB_USER?.trim();
  const migratorRole = env.MIGRATOR_DB_USER?.trim();
  // System pg_ roles must never be fixture-writing application or migrator
  // logins, even if somebody has enabled LOGIN on a predefined role.
  // Live role and grant probes remain mandatory after this no-connect gate.
  // The reserved NearPill database-owner role must never write fixtures,
  // including through a Supabase session-pooler login suffix.
  // Compare privilege-sensitive names case-insensitively: PostgreSQL can
  // authenticate quoted mixed-case roles, which must not bypass this guard.
  const forbidden = (name) => {
    const normalized = name.toLowerCase();
    return normalized.startsWith('pg_') ||
      ['postgres', 'service_role', 'supabase_admin', 'nearpill_owner'].includes(normalized.split('.')[0]);
  };
  // An identity containing internal whitespace, control or invisible format
  // characters is not an explicitly reviewed database login. Reject it at
  // the no-connect boundary instead of letting a driver normalize or attempt
  // an unexpected quoted PostgreSQL role. Legitimate Supabase suffixes stay
  // supported, and real role/grant checks remain mandatory on staging.
  const malformedRole = (name) => /[\p{White_Space}\p{Cc}\p{Cf}]/u.test(name);
  if (!appRole || !migratorRole || appRole === migratorRole ||
      malformedRole(appRole) || malformedRole(migratorRole) ||
      forbidden(appRole) || forbidden(migratorRole)) {
    throw new Error('Fixture verification requires distinct, explicitly configured non-admin app and migrator roles.');
  }

  if (target === 'local-test') {
    if (!['localhost', '127.0.0.1', '::1'].includes(host) || !/(?:^|[_-])test(?:$|[_-])/i.test(database)) {
      throw new Error('local-test requires a loopback host and an explicitly named test database.');
    }
  } else {
    if (['localhost', '127.0.0.1', '::1'].includes(host) ||
        env.DB_SSL !== 'true' ||
        !env.DB_PASSWORD?.trim() || !env.MIGRATOR_DB_PASSWORD?.trim() ||
        !env.NEARPILL_VERIFICATION_PROJECT_REF?.trim() ||
        env.NEARPILL_VERIFICATION_OWNER_APPROVED !== 'true') {
      throw new Error('staging requires TLS, explicit credentials, project reference and recorded owner approval.');
    }
    // Binding the declared project ref to the actual connection endpoint/role
    // prevents accidentally pointing fixture tests at a different Supabase
    // project merely by changing BOTH operator-supplied host confirmation values.
    // This still does NOT independently verify NearPill project ownership.
    const ref = env.NEARPILL_VERIFICATION_PROJECT_REF.trim();
    const endpoint = host.toLowerCase();
    if (!/^[a-z0-9-]{5,40}$/.test(ref)) {
      throw new Error('staging requires a valid Supabase project reference.');
    }
    // Direct PostgreSQL accepts an unqualified role; the shared session
    // pooler requires exactly <role>.<project-ref>. Reject mixed-mode and
    // multiply qualified usernames here, before constructing a DB pool.
    // The live ROLE_PROBE_SQL separately verifies the actual authenticated
    // database identity; this string check is not independent ownership proof.
    const direct = endpoint === `db.${ref}.supabase.co` && !appRole.includes('.');
    const unqualifiedRole = appRole.split('.')[0];
    const sessionPooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(endpoint) &&
      unqualifiedRole.length > 0 && appRole === `${unqualifiedRole}.${ref}`;
    if (!direct && !sessionPooler) {
      throw new Error('staging host and application login must bind to the declared Supabase project reference (direct or session pooler).');
    }
    // The app can use the session pooler, but migrator journal reads and
    // fixture setup must use the separately approved DIRECT Supabase endpoint.
    // The direct connection uses an ordinary PostgreSQL role without the
    // <role>.<project-ref> username suffix required by the shared pooler.
    // Never silently reuse DB_HOST if the separate endpoint is absent.
    const migratorHost = env.MIGRATOR_DB_HOST?.trim();
    const expectedMigratorHost = env.NEARPILL_VERIFICATION_EXPECTED_MIGRATOR_HOST?.trim();
    const migratorPort = env.MIGRATOR_DB_PORT?.trim();
    if (!migratorHost || !expectedMigratorHost ||
        migratorHost !== expectedMigratorHost ||
        migratorHost.toLowerCase() !== `db.${ref}.supabase.co` ||
        migratorPort !== '5432' ||
        migratorRole.includes('.') ||
        appRole.split('.')[0] === migratorRole) {
      throw new Error('staging migrator requires an explicitly approved direct Supabase host, port 5432 and unqualified database role.');
    }
  }
  return target;
}

/**
 * The order/inventory verifier calls expireOldOrders(), which deliberately
 * processes all eligible orders in the database. Operator approval of a
 * Supabase staging project does not make unrelated orders safe to expire.
 * Keep this verifier confined to a disposable local test database until its
 * expiry assertion can target only orders created by this verification run.
 */
export function assertIsolatedOrderVerifierTarget(env) {
  // Validate the usual host, database, role and environment protections first.
  const target = assertApprovedFixtureTarget(env);
  if (target !== 'local-test') {
    throw new Error('Order expiry verifier is local-test only: expireOldOrders() can mutate unrelated staging orders. Use a disposable local test DB.');
  }
  return target;
}
