import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Fail-closed, side-effect-free gate for pg_restore --clean.
 * Restoration is destructive and is NOT authorized by fixture-test approval.
 * This script intentionally supports only disposable loopback test databases;
 * staging restores require a separately reviewed runbook and owner approval.
 */
export function assertIsolatedRestoreTarget(env) {
  if (!env || typeof env !== 'object') {
    throw new Error('Restore requires explicit environment configuration.');
  }
  if (env.NEARPILL_VERIFICATION_TARGET !== 'local-test' || env.NODE_ENV !== 'test') {
    throw new Error('Restore is restricted to disposable local-test databases with NODE_ENV=test.');
  }
  if (env.NEARPILL_RESTORE_CONFIRMATION !== 'I_APPROVE_DESTRUCTIVE_TEST_RESTORE') {
    throw new Error('Restore requires separate, explicit destructive-operation confirmation.');
  }
  // Destructive approval must identify the exact archive, not just the DB.
  // The shell compares this digest with the privately staged file before any
  // pg_restore invocation; syntax validation here has no file-system effects.
  if (!/^[a-f0-9]{64}$/.test(env.NEARPILL_RESTORE_EXPECTED_SHA256 ?? '')) {
    throw new Error('Restore requires an explicit lowercase 64-character approved archive SHA-256.');
  }

  // The destructive shell invocation passes raw connection variables to
  // pg_restore. Refuse values that differ from the normalized identity used
  // in this pre-connection approval check (as other NearPill guards do).
  for (const key of ['DB_HOST', 'DB_NAME', 'DB_PORT', 'DB_USER', 'MIGRATOR_DB_USER']) {
    if (typeof env[key] === 'string' && env[key] !== env[key].trim()) {
      throw new Error(`Restore requires an unpadded ${key} connection value.`);
    }
  }
  const host = env.DB_HOST?.trim();
  const database = env.DB_NAME?.trim();
  const portText = env.DB_PORT?.trim();
  const user = env.DB_USER?.trim();
  if (!host || !['localhost', '127.0.0.1', '::1'].includes(host) ||
      host !== env.NEARPILL_RESTORE_EXPECTED_HOST?.trim() ||
      !database || !/^[a-z_][a-z0-9_]{0,62}$/i.test(database) ||
      database !== env.NEARPILL_RESTORE_EXPECTED_DATABASE?.trim() ||
      !/(?:^|[_-])test(?:$|[_-])/i.test(database)) {
    throw new Error('Restore requires a matching loopback host and explicitly confirmed test database.');
  }
  const port = Number(portText);
  if (!portText || !/^\d+$/.test(portText) || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('Restore requires an explicit, valid local PostgreSQL port.');
  }
  if (!user || !/^[a-z_][a-z0-9_]{0,62}$/i.test(user) ||
      user !== env.MIGRATOR_DB_USER?.trim() ||
      // Fail closed for case variants of privileged built-in/provider roles.
      // Name filtering supplements, but does not replace, real pg_roles checks.
      // A predefined pg_* role can be granted elevated operational or
      // database-wide privileges without SUPERUSER/BYPASSRLS. Refuse it
      // (including case variants) before invoking destructive pg_restore.
      user.toLowerCase().startsWith('pg_') ||
      ['postgres', 'supabase_admin', 'service_role', 'nearpill_app', 'nearpill_owner'].includes(user.toLowerCase()) ||
      !env.DB_PASSWORD?.trim()) {
    throw new Error('Restore requires explicit non-admin migrator credentials and matching DB_USER.');
  }
  return Object.freeze({ host, database, port, user });
}

// Also serve as a tiny CLI check invoked BEFORE the shell script opens pg_restore.
// Importing for tests performs no verification and no I/O.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    assertIsolatedRestoreTarget(process.env);
  } catch (error) {
    console.error(`RESTORE BLOCKED: ${error.message}`);
    process.exitCode = 2;
  }
}
