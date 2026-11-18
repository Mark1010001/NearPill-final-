import { lstatSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Fail closed before exporting potentially sensitive data. Packet 0's manual
 * pg_dump path is for disposable local fixtures only; managed Supabase
 * backups and approved staging/prod runbooks are separate release gates.
 * Importing this module never connects to PostgreSQL or writes files.
 */
export function assertIsolatedBackupTarget(env) {
  if (!env || typeof env !== 'object') throw new Error('Backup requires explicit configuration.');
  if (env.NEARPILL_VERIFICATION_TARGET !== 'local-test' || env.NODE_ENV !== 'test' ||
      env.NEARPILL_BACKUP_CONFIRMATION !== 'I_APPROVE_LOCAL_TEST_BACKUP') {
    throw new Error('Backup is restricted to an explicitly approved disposable local-test database.');
  }
  // pg_dump receives raw DB_* values, not these normalized values. Never
  // approve one identity and execute a subtly different host/role/port.
  // The same no-connect rule applies to migrations and fixture verification.
  for (const key of ['DB_HOST', 'DB_NAME', 'DB_PORT', 'DB_USER', 'MIGRATOR_DB_USER']) {
    if (typeof env[key] === 'string' && env[key] !== env[key].trim()) {
      throw new Error(`Backup requires an unpadded ${key} connection value.`);
    }
  }
  const host = env.DB_HOST?.trim();
  const database = env.DB_NAME?.trim();
  const user = env.DB_USER?.trim();
  const rawPort = env.DB_PORT?.trim();
  const port = Number(rawPort);
  if (!['localhost', '127.0.0.1', '::1'].includes(host) ||
      host !== env.NEARPILL_BACKUP_EXPECTED_HOST?.trim() ||
      !database || !/^[a-z_][a-z0-9_]{0,62}$/i.test(database) ||
      !/(?:^|[_-])test(?:$|[_-])/i.test(database) ||
      database !== env.NEARPILL_BACKUP_EXPECTED_DATABASE?.trim() ||
      !rawPort || !/^\d+$/.test(rawPort) || !Number.isSafeInteger(port) || port < 1 || port > 65535 ||
      !user || !/^[a-z_][a-z0-9_]{0,62}$/i.test(user) ||
      user !== env.MIGRATOR_DB_USER?.trim() ||
      // Match the existing migration and fixture preflights: PostgreSQL's
      // reserved pg_ namespace is not an ordinary application/migrator login.
      // Reject quoted case variants and NearPill owner/app roles as well.
      user.toLowerCase().startsWith('pg_') ||
      ['postgres', 'supabase_admin', 'service_role', 'nearpill_app', 'nearpill_owner'].includes(user.toLowerCase()) ||
      !env.DB_PASSWORD?.trim()) {
    throw new Error('Backup requires exact loopback test-DB, port and non-admin migrator credentials.');
  }
  const output = env.BACKUP_FILE;
  if (!output || !path.isAbsolute(output) ||
      !/^[a-zA-Z0-9_.-]+\.dump$/.test(path.basename(output)) ||
      path.basename(output).startsWith('.') || path.basename(output).includes('..') ||
      path.resolve(output) !== output) {
    throw new Error('Backup requires an absolute, safe .dump output filename.');
  }
  const parent = path.dirname(output);
  let parentStat;
  try {
    if (realpathSync(parent) !== parent) throw new Error('symlink directory');
    parentStat = statSync(parent);
    // Fail closed on symlinks, even dangling symlinks. No overwriting backups.
    try { lstatSync(output); throw new Error('output exists'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  } catch {
    throw new Error('Backup destination must exist as a real private directory with an unused output filename.');
  }
  if (!parentStat.isDirectory() || (parentStat.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' && parentStat.uid !== process.getuid())) {
    throw new Error('Backup destination directory must be owned by the current user and inaccessible to group/others.');
  }
  return Object.freeze({ host, database, user, port, output });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { assertIsolatedBackupTarget(process.env); }
  catch (error) { console.error(`BACKUP BLOCKED: ${error.message}`); process.exitCode = 2; }
}
