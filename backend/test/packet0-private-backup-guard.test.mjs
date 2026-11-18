import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, readdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { posixTest as test } from './helpers/posix.mjs';
import { assertIsolatedBackupTarget } from '../scripts/lib/verify-backup-target.mjs';

const script = fileURLToPath(new URL('../scripts/backup-postgres.sh', import.meta.url));

function backupFixture(t, changes = {}, { pgDumpExit = 0, pgDumpEmpty = false, pgRestoreExit = 0, pgPayloadExit = 0, existing = false, skipRun = false, raceOutput = false, raceOutputSymlinkToDirectory = false, raceOutputAsDirectory = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'nearpill-backup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, 'nearpill-test-20261020.dump');
  const marker = path.join(dir, 'pg-dump-ran');
  const restoreMarker = path.join(dir, 'pg-restore-list-ran');
  const fake = path.join(dir, 'pg_dump');
  const body = `#!/bin/sh
printf '%s|%s|%s|%s\n' "\${PGHOSTADDR:-}" "\${PGSERVICE:-}" "\${PGSSLMODE:-}" "$*" > '${marker}'
file=''
previous=''
for arg do
  if [ "$previous" = '-f' ]; then file="$arg"; fi
  previous="$arg"
done
${pgDumpEmpty ? ": > \"$file\"" : "printf 'fake custom PostgreSQL archive' > \"$file\""}
${raceOutput ? `printf 'racing file must remain' > '${output}'` : ':'}
${raceOutputSymlinkToDirectory ? `mkdir '${dir}/diverted'; ln -s '${dir}/diverted' '${output}'` : ':'}
${raceOutputAsDirectory ? `mkdir '${output}'` : ':'}
exit ${pgDumpExit}
`;
  writeFileSync(fake, body, { mode: 0o755 });
  chmodSync(fake, 0o755);
  {
    const restore = path.join(dir, 'pg_restore');
    writeFileSync(restore, `#!/bin/sh
printf '%s\n' "$*" >> '${restoreMarker}'
if [ "$1" = '--list' ]; then
  [ "$2" = '--' ] || exit 15
  [ -s "$3" ] || exit 16
  exit ${pgRestoreExit}
fi
if [ "$1" = '--file=/dev/null' ]; then
  [ "$2" = '--no-owner' ] || exit 17
  [ "$3" = '--no-acl' ] || exit 18
  [ "$4" = '--' ] || exit 19
  [ -s "$5" ] || exit 20
  exit ${pgPayloadExit}
fi
exit 14
`, { mode: 0o755 });
    chmodSync(restore, 0o755);
  }
  if (existing) writeFileSync(output, 'existing backup must survive');
  const env = {
    PATH: `${dir}:${process.env.PATH || ''}`,
    NODE_ENV: 'test', NEARPILL_VERIFICATION_TARGET: 'local-test',
    NEARPILL_BACKUP_CONFIRMATION: 'I_APPROVE_LOCAL_TEST_BACKUP',
    NEARPILL_BACKUP_EXPECTED_HOST: '127.0.0.1',
    NEARPILL_BACKUP_EXPECTED_DATABASE: 'nearpill_test_backup',
    DB_HOST: '127.0.0.1', DB_PORT: '5432', DB_USER: 'nearpill_migrator',
    MIGRATOR_DB_USER: 'nearpill_migrator', DB_NAME: 'nearpill_test_backup',
    DB_PASSWORD: 'synthetic-local-password', BACKUP_FILE: output,
    PGHOSTADDR: '198.51.100.9', PGSERVICE: 'unrelated-production', ...changes,
  };
  const result = skipRun ? { status: null, stderr: '', stdout: '' } : spawnSync('sh', [script], { env, encoding: 'utf8', timeout: 10000 });
  return { result, dir, output, marker, restoreMarker, env, executed: existsSync(marker), archiveInspected: existsSync(restoreMarker) };
}

test('approved private local-test backup configuration passes without side effects', (t) => {
  const fx = backupFixture(t, {}, { skipRun: true });
  assert.deepEqual(assertIsolatedBackupTarget(fx.env), {
    host: '127.0.0.1', database: 'nearpill_test_backup', port: 5432,
    user: 'nearpill_migrator', output: fx.output,
  });
  writeFileSync(fx.output, 'existing file');
  assert.throws(() => assertIsolatedBackupTarget(fx.env), /unused output/);
  const { BACKUP_FILE, ...withoutExistingFile } = fx.env;
  assert.throws(() => assertIsolatedBackupTarget(withoutExistingFile), /absolute.*filename/);
});

test('unapproved production/staging targets and incorrect role, database or confirmation are denied before pg_dump', (t) => {
  const invalid = [
    { NODE_ENV: 'production' },
    { NODE_ENV: 'staging', NEARPILL_VERIFICATION_TARGET: 'staging' },
    { NEARPILL_BACKUP_CONFIRMATION: '' },
    { DB_HOST: 'db.other.supabase.co', NEARPILL_BACKUP_EXPECTED_HOST: 'db.other.supabase.co' },
    { DB_NAME: 'nearpill', NEARPILL_BACKUP_EXPECTED_DATABASE: 'nearpill' },
    { DB_NAME: 'nearpill_test_other' },
    { DB_USER: 'postgres', MIGRATOR_DB_USER: 'postgres' },
    { DB_USER: 'nearpill_app' },
    { DB_PORT: 'not-a-number' },
    { DB_PASSWORD: '' },
  ];
  for (const change of invalid) {
    const fx = backupFixture(t, change);
    assert.equal(fx.result.status, 2, `${JSON.stringify(change)}: ${fx.result.stderr}`);
    assert.equal(fx.executed, false);
    assert.equal(existsSync(fx.output), false);
  }
});

test('backup rejects padded raw connection identity before invoking pg_dump', (t) => {
  // The shell passes raw environment values to pg_dump; earlier checks
  // normalized those values only for approval, permitting a mismatch.
  const invalid = [
    { DB_HOST: ' 127.0.0.1 ' },
    { DB_NAME: ' nearpill_test_backup ' },
    { DB_PORT: ' 5432 ' },
    { DB_USER: ' nearpill_migrator ' },
    { MIGRATOR_DB_USER: ' nearpill_migrator ' },
  ];
  for (const changes of invalid) {
    const fx = backupFixture(t, changes);
    assert.equal(fx.result.status, 2, `${Object.keys(changes)[0]} should fail: ${fx.result.stderr}`);
    assert.equal(fx.executed, false, 'pg_dump must not run for an unreviewed raw connection value');
    assert.equal(fx.archiveInspected, false, 'pg_restore must not inspect an unapproved backup');
    assert.equal(existsSync(fx.output), false);
  }
});

test('predefined PostgreSQL and NearPill owner logins cannot perform local backups', (t) => {
  // Like fixture/migration preflight, backup must reject elevated role names
  // before constructing pg_dump, even on a disposable loopback database.
  for (const name of ['pg_read_all_data', 'PG_MONITOR', 'pg_write_server_files', 'nearpill_owner']) {
    const fx = backupFixture(t, { DB_USER: name, MIGRATOR_DB_USER: name });
    assert.throws(() => assertIsolatedBackupTarget(fx.env), /non-admin migrator/);
    assert.equal(fx.result.status, 2, `unsafe backup role ${name} must fail closed`);
    assert.equal(fx.executed, false, `pg_dump must not execute as ${name}`);
  }
});

test('successful backup uses explicit target and private 0600 output without libpq overrides', (t) => {
  const fx = backupFixture(t);
  assert.equal(fx.result.status, 0, fx.result.stderr);
  assert.equal(fx.executed, true);
  assert.equal(fx.archiveInspected, true, 'pg_restore must inspect archive before publication');
  const restoreArgs = readFileSync(fx.restoreMarker, 'utf8');
  assert.match(restoreArgs, /^--list -- .*\.partial\./m);
  assert.match(restoreArgs, /^--file=\/dev\/null --no-owner --no-acl -- .*\.partial\./m);
  const inspectedPaths = restoreArgs.trim().split('\n').map((line) => line.slice(line.lastIndexOf(' -- ') + 4));
  assert.equal(inspectedPaths.length, 2);
  assert.equal(inspectedPaths[0], inspectedPaths[1], 'TOC and payload preflight must use the same private archive');
  assert.equal(readFileSync(fx.output, 'utf8'), 'fake custom PostgreSQL archive');
  assert.equal(lstatSync(fx.output).mode & 0o777, 0o600);
  assert.equal(fx.result.stdout.trim(), fx.output);
  const [hostaddr, service, sslMode, args] = readFileSync(fx.marker, 'utf8').trim().split('|');
  assert.equal(hostaddr, '');
  assert.equal(service, '');
  assert.equal(sslMode, 'disable');
  assert.match(args, /-h 127\.0\.0\.1 -p 5432 -U nearpill_migrator -d nearpill_test_backup -f /);
  assert.ok(!args.includes('synthetic-local-password'), 'credentials must not be command-line arguments');
});

test('existing archive cannot be overwritten or dumped into', (t) => {
  const fx = backupFixture(t, {}, { existing: true });
  assert.equal(fx.result.status, 2, fx.result.stderr);
  assert.equal(fx.executed, false);
  assert.equal(readFileSync(fx.output, 'utf8'), 'existing backup must survive');
});

test('symlink output and world-readable destination are denied before pg_dump', (t) => {
  const fx = backupFixture(t, {}, { skipRun: true });
  symlinkSync(path.join(fx.dir, 'secret'), fx.output);
  assert.equal(spawnSync('sh', [script], { env: fx.env, encoding: 'utf8' }).status, 2);
  assert.equal(fx.executed, false);
  rmSync(fx.output);
  chmodSync(fx.dir, 0o755);
  assert.equal(spawnSync('sh', [script], { env: fx.env, encoding: 'utf8' }).status, 2);
  assert.equal(fx.executed, false);
});

test('pg_dump failure never publishes a partial backup and cleans temporary files', (t) => {
  const fx = backupFixture(t, {}, { pgDumpExit: 7 });
  assert.equal(fx.result.status, 7);
  assert.equal(fx.executed, true);
  assert.equal(existsSync(fx.output), false);
  assert.deepEqual((readdirSync(fx.dir)).filter((file) => file.includes('.partial.')), []);
});

test('a concurrent destination creation cannot be overwritten during publication', (t) => {
  const fx = backupFixture(t, {}, { raceOutput: true });
  assert.notEqual(fx.result.status, 0);
  assert.equal(readFileSync(fx.output, 'utf8'), 'racing file must remain');
  assert.deepEqual(readdirSync(fx.dir).filter((file) => file.includes('.partial.')), []);
});

test('late destination symlink to directory cannot redirect backup publication', (t) => {
  // pg_dump is invoked only after the preflight has checked that BACKUP_FILE
  // does not exist. A concurrent actor can replace that path with a symlink
  // to a directory before the final hard-link publication operation.
  const fx = backupFixture(t, {}, { raceOutputSymlinkToDirectory: true });
  assert.notEqual(fx.result.status, 0,
    'publication must fail rather than creating a backup inside a substituted directory');
  assert.equal(lstatSync(fx.output).isSymbolicLink(), true,
    'do not remove or overwrite a destination introduced by another actor');
  assert.deepEqual(readdirSync(path.join(fx.dir, 'diverted')), [],
    'no sensitive archive may be hard-linked into a substituted directory');
  assert.deepEqual(readdirSync(fx.dir).filter((file) => file.includes('.partial.')), [],
    'private partial archive must be removed on publication failure');
  assert.equal(fx.result.stdout.trim(), '', 'failed publication must not report success');
});

test('late destination directory cannot absorb a backup under a generated partial name', (t) => {
  const fx = backupFixture(t, {}, { raceOutputAsDirectory: true });
  assert.notEqual(fx.result.status, 0, 'an existing destination directory must block publication');
  assert.deepEqual(readdirSync(fx.output), [], 'archive must not appear within that directory');
  assert.deepEqual(readdirSync(fx.dir).filter((file) => file.includes('.partial.')), [],
    'temporary archive must be cleaned up');
  assert.equal(fx.result.stdout.trim(), '', 'failed publication cannot report success');
});

test('empty pg_dump result is rejected and never published', (t) => {
  const fx = backupFixture(t, {}, { pgDumpEmpty: true });
  assert.equal(fx.result.status, 1);
  assert.equal(existsSync(fx.output), false);
  assert.match(fx.result.stderr, /BACKUP FAILED/);
});



test('unreadable dump is never published, and temporary data is removed', (t) => {
  const fx = backupFixture(t, {}, { pgRestoreExit: 8 });
  assert.equal(fx.executed, true);
  assert.equal(fx.archiveInspected, true);
  assert.equal(fx.result.status, 1);
  assert.match(fx.result.stderr, /BACKUP FAILED: pg_restore/);
  assert.equal(existsSync(fx.output), false);
  assert.deepEqual(readdirSync(fx.dir).filter((file) => file.includes('.partial.')), []);
});

test('archive inspection tool failure fails closed without publishing', (t) => {
  // Use an explicit failing executable to avoid accidentally invoking an
  // installed system pg_restore through PATH on the test host.
  const fx = backupFixture(t, {}, { pgRestoreExit: 127 });
  assert.equal(fx.result.status, 1);
  assert.equal(fx.archiveInspected, true);
  assert.equal(existsSync(fx.output), false);
  assert.deepEqual(readdirSync(fx.dir).filter((file) => file.includes('.partial.')), []);
});

test('backup cannot publish an archive whose catalog reads but payload extraction fails', (t) => {
  const fx = backupFixture(t, {}, { pgPayloadExit: 63 });
  assert.equal(fx.executed, true);
  assert.equal(fx.archiveInspected, true);
  assert.equal(fx.result.status, 1, 'a corrupt payload must block successful backup publication');
  assert.match(fx.result.stderr, /BACKUP FAILED: archive payload/);
  assert.match(readFileSync(fx.restoreMarker, 'utf8'), /^--list -- .*\.partial\./m);
  assert.match(readFileSync(fx.restoreMarker, 'utf8'), /^--file=\/dev\/null --no-owner --no-acl -- .*\.partial\./m);
  assert.equal(existsSync(fx.output), false);
  assert.deepEqual(readdirSync(fx.dir).filter((file) => file.includes('.partial.')), []);
});

test('a failed pg_dump cannot reach archive inspection', (t) => {
  const fx = backupFixture(t, {}, { pgDumpExit: 9 });
  assert.equal(fx.result.status, 9);
  assert.equal(fx.archiveInspected, false);
  assert.equal(existsSync(fx.output), false);
});


test('backup refuses inherited Node preloads before the database preflight executes', (t) => {
  const fx = backupFixture(t, {}, { skipRun: true });
  const injected = path.join(fx.dir, 'unexpected-preload.cjs');
  const preloadMarker = path.join(fx.dir, 'preload-executed');
  writeFileSync(injected, `require('node:fs').writeFileSync(${JSON.stringify(preloadMarker)}, 'executed');\n`);
  const result = spawnSync('sh', [script], {
    env: { ...fx.env, NODE_OPTIONS: `--require=${injected}` },
    encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /NODE_OPTIONS/);
  assert.equal(existsSync(preloadMarker), false, 'unreviewed preload cannot run before backup approval');
  assert.equal(existsSync(fx.marker), false, 'pg_dump must not execute');
});
