/**
 * Packet 0 guard for the *existing* MySQL -> PostgreSQL conversion utility.
 * This path may run only against explicitly confirmed synthetic local test
 * databases. It cannot authorize a staging/production import or prove RLS.
 */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);
const PRIVILEGED = new Set(['root', 'postgres', 'supabase_admin', 'service_role', 'nearpill_app', 'nearpill_owner']);

function requiredPort(raw, label) {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) {
    throw new Error(`Legacy import refused: explicit ${label} is required.`);
  }
  const port = Number(raw.trim());
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Legacy import refused: invalid ${label}.`);
  }
  return port;
}

function localTestEndpoint(host, database, expectedHost, expectedDatabase, label) {
  if (typeof host !== 'string' || typeof database !== 'string' ||
      !LOOPBACK.has(host) || host !== expectedHost ||
      !/(?:^|[_-])test(?:$|[_-])/i.test(database) || database !== expectedDatabase) {
    throw new Error(`Legacy import refused: ${label} must match an explicitly confirmed loopback test database.`);
  }
}

export function assertApprovedLegacyImportTarget(env) {
  if (!env || env.NODE_ENV !== 'test' || env.NEARPILL_LEGACY_IMPORT_TARGET !== 'local-test' ||
      env.NEARPILL_LEGACY_IMPORT_SYNTHETIC_SOURCE !== 'true' ||
      env.NEARPILL_LEGACY_IMPORT_CONFIRMATION !== 'I_APPROVE_SYNTHETIC_LEGACY_IMPORT') {
    throw new Error('Legacy import refused: a synthetic local-test import and explicit consent are required; staging/production are prohibited.');
  }

  localTestEndpoint(env.LEGACY_DB_HOST, env.LEGACY_DB_NAME,
    env.NEARPILL_LEGACY_IMPORT_EXPECTED_SOURCE_HOST,
    env.NEARPILL_LEGACY_IMPORT_EXPECTED_SOURCE_DATABASE, 'MySQL source');
  localTestEndpoint(env.DB_HOST, env.DB_NAME,
    env.NEARPILL_LEGACY_IMPORT_EXPECTED_TARGET_HOST,
    env.NEARPILL_LEGACY_IMPORT_EXPECTED_TARGET_DATABASE, 'PostgreSQL target');

  const mysqlPort = requiredPort(env.LEGACY_DB_PORT, 'LEGACY_DB_PORT');
  const postgresPort = requiredPort(env.DB_PORT, 'DB_PORT');
  const legacyRole = env.LEGACY_DB_USER?.trim();
  const migratorRole = env.DB_USER?.trim();
  if (!legacyRole || !migratorRole || !env.MIGRATOR_DB_USER ||
      env.MIGRATOR_DB_USER !== migratorRole ||
      PRIVILEGED.has(legacyRole.toLowerCase().split('.')[0]) || PRIVILEGED.has(migratorRole.toLowerCase().split('.')[0]) ||
      // Synthetic conversion also connects to PostgreSQL: predefined pg_ roles
      // must not become the import migrator, even in disposable local tests.
      migratorRole.toLowerCase().startsWith('pg_') ||
      !env.LEGACY_DB_PASSWORD || !env.DB_PASSWORD || env.DB_SSL !== 'false') {
    throw new Error('Legacy import refused: explicitly credentialed, non-privileged source and migrator roles and local non-TLS target are required.');
  }
  return Object.freeze({ mysqlPort, postgresPort });
}
