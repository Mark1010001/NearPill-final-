import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, existsSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { posixTest as test } from './helpers/posix.mjs';
import { assertIsolatedRestoreTarget } from '../scripts/lib/verify-restore-target.mjs';

const script = fileURLToPath(new URL('../scripts/restore-postgres.sh', import.meta.url));
const testDumpContents = 'a simulated archive, not PostgreSQL data';
const testDumpSha256 = createHash('sha256').update(testDumpContents).digest('hex');
const safeEnv = Object.freeze({
  NODE_ENV: 'test',
  NEARPILL_VERIFICATION_TARGET: 'local-test',
  NEARPILL_RESTORE_CONFIRMATION: 'I_APPROVE_DESTRUCTIVE_TEST_RESTORE',
  NEARPILL_RESTORE_EXPECTED_SHA256: testDumpSha256,
  DB_HOST: '127.0.0.1',
  DB_PORT: '5432',
  DB_NAME: 'nearpill_test_restore',
  DB_USER: 'nearpill_migrator',
  MIGRATOR_DB_USER: 'nearpill_migrator',
  DB_PASSWORD: 'synthetic-test-password',
  NEARPILL_RESTORE_EXPECTED_HOST: '127.0.0.1',
  NEARPILL_RESTORE_EXPECTED_DATABASE: 'nearpill_test_restore',
});

function runRestore(t, overrides = {}, { missingArchive = false, invalidArchive = false, invalidPayload = false, mutateAfterInspection = false, symlinkArchive = false, swapToSymlinkAtCopy = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'nearpill-restore-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fakePgRestore = path.join(dir, 'pg_restore');
  const marker = path.join(dir, 'restore-ran');
  const inherited = path.join(dir, 'libpq-env-seen');
  const restoredContent = path.join(dir, 'restored-archive-content');
  const archivePaths = path.join(dir, 'archive-paths');
  const dump = path.join(dir, 'synthetic.dump');
  writeFileSync(fakePgRestore, `#!/bin/sh
printf '%s\\n' '--CALL--' "$@" >> "${marker}"
printf '%s\\n' "\${PGHOSTADDR:-}" > "${inherited}"
last=''
for value do last="$value"; done
if [ "$1" = '--list' ]; then
  printf '%s\\n' "$last" >> "${archivePaths}"
  if [ "${invalidArchive ? '1' : '0'}" = '1' ]; then exit 42; fi
  if [ "${mutateAfterInspection ? '1' : '0'}" = '1' ]; then
    printf 'modified archive after TOC inspection' > "${dump}"
  fi
elif [ "$1" = '--file=/dev/null' ]; then
  printf '%s\\n' "$last" >> "${archivePaths}"
  if [ "${invalidPayload ? '1' : '0'}" = '1' ]; then exit 43; fi
else
  printf '%s\\n' "$last" >> "${archivePaths}"
  cat -- "$last" > "${restoredContent}"
fi
`);
  chmodSync(fakePgRestore, 0o755);
  if (swapToSymlinkAtCopy) {
    // Deterministically swap the caller's regular file after its initial
    // -f/-L check but before the real cp opens it. Pre-fix cp dereferences
    // this late symlink and allows the unexpected archive into pg_restore.
    const redirected = path.join(dir, 'late-redirected.dump');
    writeFileSync(redirected, 'late symlink target archive, not the approved source');
    chmodSync(redirected, 0o640);
    const fakeCopy = path.join(dir, 'cp');
    writeFileSync(fakeCopy, `#!/bin/sh
rm -f -- '${dump}'
ln -s -- '${redirected}' '${dump}'
exec /bin/cp "$@"
`);
    chmodSync(fakeCopy, 0o755);
  }
  if (!missingArchive) {
    if (symlinkArchive) {
      const other = path.join(dir, 'redirected.dump');
      writeFileSync(other, 'a simulated archive, not PostgreSQL data');
      symlinkSync(other, dump);
    } else {
      writeFileSync(dump, testDumpContents);
    }
  }
  const env = {
    PATH: `${dir}:${process.env.PATH || ''}`,
    RESTORE_ARGUMENTS_FILE: marker,
    ...safeEnv,
    ...overrides,
  };
  const completed = spawnSync('sh', [script, dump], { env, encoding: 'utf8', timeout: 10_000 });
  return { ...completed, invoked: existsSync(marker), args: existsSync(marker) ? readFileSync(marker, 'utf8') : '',
    inheritedHostAddress: existsSync(inherited) ? readFileSync(inherited, 'utf8').trim() : null,
    restoredContent: existsSync(restoredContent) ? readFileSync(restoredContent, 'utf8') : null,
    archivePaths: existsSync(archivePaths) ? readFileSync(archivePaths, 'utf8').trim().split('\n') : [],
    redirectedMode: swapToSymlinkAtCopy ? (statSync(path.join(dir, 'late-redirected.dump')).mode & 0o777) : null };
}

test('the restore approval predicate permits only explicitly confirmed loopback test database', () => {
  assert.deepEqual(assertIsolatedRestoreTarget(safeEnv), {
    host: '127.0.0.1', database: 'nearpill_test_restore', port: 5432, user: 'nearpill_migrator',
  });
});

test('production, staging, role, host, database and missing-approval variants fail closed', () => {
  const bad = [
    { NEARPILL_VERIFICATION_TARGET: 'staging', NODE_ENV: 'staging' },
    { NEARPILL_VERIFICATION_TARGET: 'production', NODE_ENV: 'production' },
    { NODE_ENV: 'production' },
    { NEARPILL_RESTORE_CONFIRMATION: 'I_APPROVE_TEST_FIXTURE_WRITES' },
    { NEARPILL_RESTORE_CONFIRMATION: undefined },
    { DB_HOST: 'db.example-project.supabase.co', NEARPILL_RESTORE_EXPECTED_HOST: 'db.example-project.supabase.co' },
    { DB_HOST: 'localhost' },
    { DB_NAME: 'nearpill', NEARPILL_RESTORE_EXPECTED_DATABASE: 'nearpill' },
    { DB_NAME: 'nearpill_test_other' },
    { DB_NAME: 'postgresql://evil.example/test_db', NEARPILL_RESTORE_EXPECTED_DATABASE: 'postgresql://evil.example/test_db' },
    { DB_PORT: '6543' + 'x' },
    { DB_PORT: undefined },
    { DB_USER: 'postgres', MIGRATOR_DB_USER: 'postgres' },
    { DB_USER: 'nearpill_app' },
    { DB_PASSWORD: '' },
  ];
  for (const change of bad) {
    assert.throws(() => assertIsolatedRestoreTarget({ ...safeEnv, ...change }), /Restore /);
  }
});

test('restore rejects padded raw connection identity before any pg_restore invocation', (t) => {
  // The shell forwards unmodified DB_* to pg_restore, so approval cannot
  // silently normalize a different host, database, port, or role.
  const invalid = [
    { DB_HOST: ' 127.0.0.1 ' },
    { DB_NAME: ' nearpill_test_restore ' },
    { DB_PORT: ' 5432 ' },
    { DB_USER: ' nearpill_migrator ' },
    { MIGRATOR_DB_USER: ' nearpill_migrator ' },
  ];
  for (const changes of invalid) {
    const result = runRestore(t, changes);
    assert.equal(result.status, 2, `${Object.keys(changes)[0]} should fail: ${result.stderr}`);
    assert.equal(result.invoked, false, 'pg_restore must not execute for unreviewed raw connection values');
  }
});

test('unapproved or mismatched archive SHA-256 is denied before pg_restore', (t) => {
  const cases = [
    { NEARPILL_RESTORE_EXPECTED_SHA256: undefined },
    { NEARPILL_RESTORE_EXPECTED_SHA256: 'not-a-sha256' },
    { NEARPILL_RESTORE_EXPECTED_SHA256: '0'.repeat(64) },
  ];
  for (const overrides of cases) {
    if (overrides.NEARPILL_RESTORE_EXPECTED_SHA256 !== '0'.repeat(64)) {
      assert.throws(() => assertIsolatedRestoreTarget({ ...safeEnv, ...overrides }), /SHA-256/,
        'approval preflight must reject missing or malformed expected digest');
    }
    const result = runRestore(t, overrides);
    assert.equal(result.status, 2, `unapproved archive must fail: ${result.stderr}`);
    assert.equal(result.invoked, false, 'no pg_restore operation may inspect or restore an unapproved archive');
    assert.doesNotMatch(result.stderr, /synthetic-test-password|a simulated archive/);
  }
});

test('case-variant privileged PostgreSQL roles are rejected before any restore', (t) => {
  // PostgreSQL role names can be case-variant (quoted identifiers). Approval
  // must not rely on case-sensitive spelling of privileged role names.
  for (const privileged of ['POSTGRES', 'Supabase_Admin', 'SERVICE_ROLE']) {
    const configured = { ...safeEnv, DB_USER: privileged, MIGRATOR_DB_USER: privileged };
    assert.throws(() => assertIsolatedRestoreTarget(configured),
      /non-admin migrator credentials/, `must reject privileged role ${privileged}`);
    const result = runRestore(t, { DB_USER: privileged, MIGRATOR_DB_USER: privileged });
    assert.equal(result.status, 2, 'unsafe role must stop before pg_restore');
    assert.equal(result.invoked, false);
  }
});

test('predefined PostgreSQL and NearPill owner logins cannot perform destructive restores', (t) => {
  for (const name of ['pg_read_all_data', 'PG_MONITOR', 'pg_execute_server_program', 'nearpill_owner']) {
    const config = { ...safeEnv, DB_USER: name, MIGRATOR_DB_USER: name };
    assert.throws(() => assertIsolatedRestoreTarget(config), /non-admin migrator/);
    const result = runRestore(t, { DB_USER: name, MIGRATOR_DB_USER: name });
    assert.equal(result.status, 2, `unsafe restore role ${name} must fail closed`);
    assert.equal(result.invoked, false, `pg_restore must not execute as ${name}`);
  }
});

test('unsafe staging target is rejected before pg_restore is executed', (t) => {
  const result = runRestore(t, {
    NODE_ENV: 'staging', NEARPILL_VERIFICATION_TARGET: 'staging',
    DB_HOST: 'db.example-project.supabase.co', NEARPILL_RESTORE_EXPECTED_HOST: 'db.example-project.supabase.co',
  });
  assert.equal(result.status, 2);
  assert.equal(result.invoked, false);
  assert.match(result.stderr, /RESTORE BLOCKED/);
});

test('missing explicit restore consent is rejected before pg_restore', (t) => {
  const result = runRestore(t, { NEARPILL_RESTORE_CONFIRMATION: '' });
  assert.equal(result.status, 2);
  assert.equal(result.invoked, false);
});

test('invalid or missing dump file cannot invoke pg_restore', (t) => {
  const result = runRestore(t, {}, { missingArchive: true });
  assert.equal(result.status, 2);
  assert.equal(result.invoked, false);
});

test('approved disposable restore uses one transaction and exits on errors, no default target', (t) => {
  const result = runRestore(t, { PGHOSTADDR: '192.0.2.60', PGSERVICE: 'some-other-db' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.invoked, true);
  assert.match(result.args, /--CALL--\n--list\n--\n/);
  assert.match(result.args, /--CALL--\n--file=\/dev\/null\n/);
  assert.match(result.args, /--CALL--\n--clean\n/);
  assert.ok(result.args.indexOf('--list') < result.args.indexOf('--file=/dev/null'), 'archive catalog must be verified before payload extraction');
  assert.ok(result.args.indexOf('--file=/dev/null') < result.args.indexOf('--clean'), 'offline archive extraction must precede --clean');
  assert.equal(result.inheritedHostAddress, '', 'libpq host override must not reach pg_restore');
  for (const token of ['--clean', '--if-exists', '--single-transaction', '--exit-on-error', '--no-owner', '--no-acl']) {
    assert.match(result.args, new RegExp(`^${token}$`, 'm'));
  }
  assert.match(result.args, /^nearpill_test_restore$/m);
  assert.doesNotMatch(result.args, /synthetic-test-password/);
});


test('corrupt archive is rejected by non-destructive TOC preflight before --clean', (t) => {
  const result = runRestore(t, {}, { invalidArchive: true });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /RESTORE BLOCKED: archive inspection failed/);
  assert.equal(result.invoked, true, 'offline pg_restore --list must run');
  assert.match(result.args, /--CALL--\n--list\n--\n/);
  assert.doesNotMatch(result.args, /^--clean$/m, 'never run destructive restore after bad archive');
  assert.doesNotMatch(result.stderr, /synthetic-test-password/, 'do not expose credentials');
});



test('unreadable archive payload is rejected offline before destructive restore', (t) => {
  const result = runRestore(t, {}, { invalidPayload: true });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /RESTORE BLOCKED: archive payload verification failed/);
  assert.match(result.args, /--CALL--\n--file=\/dev\/null\n/,
    'pg_restore must extract the private archive to a discarded script');
  assert.doesNotMatch(result.args, /^--clean$/m, 'bad payload must never reach database operations');
  assert.doesNotMatch(result.stderr, /synthetic-test-password/, 'credential values must stay private');
});

test('restore consumes the same private archive snapshot that passed preflight even if original changes', (t) => {
  const result = runRestore(t, {}, { mutateAfterInspection: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.restoredContent, 'a simulated archive, not PostgreSQL data',
    'unverified post-inspection mutation must not reach --clean');
  assert.equal(result.archivePaths.length, 3);
  assert.ok(result.archivePaths.every((archive) => archive === result.archivePaths[0]),
    'catalog preflight, payload verification and destructive restore must use the identical private archive path');
  assert.equal(existsSync(result.archivePaths[0]), false,
    'private staging copy must be deleted after the restore command exits');
});


test('symlinked restore archives are blocked before any pg_restore invocation', (t) => {
  const result = runRestore(t, {}, { symlinkArchive: true });
  assert.equal(result.status, 2);
  assert.equal(result.invoked, false, 'unsafe input redirection must not reach database tooling');
  assert.match(result.stderr, /RESTORE BLOCKED/);
});


test('late symlink substitution during restore staging is denied before any pg_restore', (t) => {
  const result = runRestore(t, {}, { swapToSymlinkAtCopy: true });
  assert.equal(result.status, 2, 'a swapped source symlink must never be accepted');
  assert.equal(result.invoked, false, 'no catalog, payload or destructive restore after a late symlink substitution');
  assert.equal(result.redirectedMode, 0o640, 'chmod must not follow the replacement link and change its target');
  assert.match(result.stderr, /RESTORE BLOCKED/);
  assert.doesNotMatch(result.stderr, /late symlink target archive/, 'no archive content may be logged');
});


test('restore refuses inherited Node preloads before its destructive approval gate', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nearpill-restore-preload-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const injected = path.join(dir, 'unexpected-preload.cjs');
  const preloadMarker = path.join(dir, 'preload-executed');
  writeFileSync(injected, `require('node:fs').writeFileSync(${JSON.stringify(preloadMarker)}, 'executed');\n`);
  const result = runRestore(t, { NODE_OPTIONS: `--require=${injected}` });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /NODE_OPTIONS/);
  assert.equal(existsSync(preloadMarker), false, 'unreviewed preload cannot run before restore approval');
  assert.equal(result.invoked, false, 'pg_restore must not execute');
});
