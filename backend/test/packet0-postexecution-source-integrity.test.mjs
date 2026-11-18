import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { posixTest as test } from './helpers/posix.mjs';

const runner = new URL('../../scripts/verify-packet0.sh', import.meta.url);

// This fixture simulates verifier commands, not application/database behavior.
// It proves a changed reviewed file *during* the test phase is rejected, even
// when the first source-integrity check succeeded. No live services are used.
test('Packet 0 rejects source changes made after pre-execution verification', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nearpill-postexecution-'));
  try {
    for (const dir of ['scripts', 'backend/test', 'test', 'bin']) {
      await mkdir(join(root, dir), { recursive: true });
    }
    await copyFile(runner, join(root, 'scripts/verify-packet0.sh'));
    await writeFile(join(root, 'README.md'), 'reviewed source\n');
    await mkdir(join(root, 'docs'), { recursive: true });
    const checkerFixture = '// synthetic source verifier intercepted by node command shim\n';
    for (const name of ['secret-scan.mjs', 'verify-source-manifest.mjs']) {
      await writeFile(join(root, 'scripts', name), checkerFixture);
    }
    const checkerHash = createHash('sha256').update(checkerFixture).digest('hex');
    await writeFile(join(root, 'docs/packet0-source-manifest-2026-10-21.sha256'),
      `${'a'.repeat(64)}  README.md\n` +
      ['secret-scan.mjs', 'verify-source-manifest.mjs']
        .map((name) => `${checkerHash}  scripts/${name}\n`).join(''));
    await writeFile(join(root, 'backend/test/packet0-fixture.test.mjs'), '// reviewed test\n');
    await writeFile(join(root, 'backend/test/other.test.mjs'), '// reviewed test\n');
    await writeFile(join(root, 'test/root.test.cjs'), '// reviewed test\n');
    await writeFile(join(root, 'scripts/check-shell-syntax.sh'), '#!/bin/sh\nexit 0\n');
    const nodeShim = `#!/bin/bash
case "$1" in
  --version) echo v22.16.0; exit 0 ;;
  scripts/secret-scan.mjs) exit 0 ;;
  scripts/verify-source-manifest.mjs)
    printf 'manifest\\n' >> manifest-probes.log
    if [[ "$(cat README.md)" == 'reviewed source' ]]; then exit 0; fi
    echo 'CHANGED: README.md' >&2
    exit 1 ;;
  scripts/run-packet0-tests.mjs)
    if [[ "$2" == '--partial-baseline' && "$NEARPILL_FIXTURE_MUTATE" == '1' ]]; then
      printf 'tampered by test\n' > README.md
    fi
    exit 0 ;;
  --test)
    if [[ "$NEARPILL_FIXTURE_MUTATE" == '1' ]]; then
      printf 'tampered by test\
' > README.md
    fi
    exit 0 ;;
  *) exit 0 ;;
esac
`;
    await writeFile(join(root, 'bin/node'), nodeShim);
    await writeFile(join(root, 'bin/npm'), '#!/bin/sh\necho 10.9.2\n');
    await chmod(join(root, 'bin/node'), 0o755);
    await chmod(join(root, 'bin/npm'), 0o755);
    const result = spawnSync('bash', ['scripts/verify-packet0.sh'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15000,
      env: { ...process.env, NEARPILL_FIXTURE_MUTATE: '1', PATH: `${join(root, 'bin')}:${process.env.PATH}` },
    });
    assert.equal(result.status, 1, `post-test changes must fail, not be reported as an environment-only BLOCKED status:\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout + result.stderr, /post-execution source integrity|CHANGED: README.md/i);
    const probes = await readFile(join(root, 'manifest-probes.log'), 'utf8');
    assert.equal(probes.trim().split('\n').length, 2, 'the exact source manifest must be checked before and after test execution');

    // Conversely, unchanged reviewed source must not be mislabeled a code
    // failure; its Node 22/npm 10 test environment stays BLOCKED (exit 2).
    await writeFile(join(root, 'README.md'), 'reviewed source\n');
    const clean = spawnSync('bash', ['scripts/verify-packet0.sh'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15000,
      env: { ...process.env, NEARPILL_FIXTURE_MUTATE: '0', PATH: `${join(root, 'bin')}:${process.env.PATH}` },
    });
    assert.equal(clean.status, 2, `unchanged source should remain environment-BLOCKED:\n${clean.stdout}\n${clean.stderr}`);
    assert.match(clean.stdout, /PASS: Post-execution source integrity/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
