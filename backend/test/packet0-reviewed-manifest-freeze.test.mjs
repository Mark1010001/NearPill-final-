import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { posixTest as test } from './helpers/posix.mjs';

const originalRunner = new URL('../../scripts/verify-packet0.sh', import.meta.url);

// Disposable command shims test Packet 0's ordering and manifest continuity;
// they do not simulate real database acceptance or Node 24 builds.
test('Packet 0 rejects rewritten reviewed manifest even when both manifest checks say PASS', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nearpill-frozen-manifest-'));
  try {
    for (const directory of ['scripts', 'docs', 'backend/test', 'test', 'bin']) {
      await mkdir(join(root, directory), { recursive: true });
    }
    await copyFile(originalRunner, join(root, 'scripts/verify-packet0.sh'));
    const manifest = join(root, 'docs/packet0-source-manifest-2026-10-21.sha256');
    const checkerFixture = '// synthetic source verifier intercepted by node command shim\n';
    for (const name of ['secret-scan.mjs', 'verify-source-manifest.mjs']) {
      await writeFile(join(root, 'scripts', name), checkerFixture);
    }
    const checkerHash = createHash('sha256').update(checkerFixture).digest('hex');
    const reviewedManifest = `${'a'.repeat(64)}  README.md\n` +
      ['secret-scan.mjs', 'verify-source-manifest.mjs']
        .map((name) => `${checkerHash}  scripts/${name}\n`).join('');
    await writeFile(manifest, reviewedManifest);
    await writeFile(join(root, 'README.md'), 'original reviewed source\n');
    await writeFile(join(root, 'backend/test/packet0-example.test.mjs'), '// baseline fixture\n');
    await writeFile(join(root, 'backend/test/other.test.mjs'), '// non-packet fixture\n');
    await writeFile(join(root, 'test/root.test.cjs'), '// root fixture\n');
    await writeFile(join(root, 'scripts/check-shell-syntax.sh'), '#!/bin/sh\nexit 0\n');
    const nodeShim = `#!/bin/bash
case "$1" in
  --version) echo v22.16.0; exit 0 ;;
  scripts/secret-scan.mjs|scripts/verify-source-manifest.mjs) exit 0 ;;
  scripts/run-packet0-tests.mjs)
    if [[ "$2" == '--partial-baseline' && "$NEARPILL_MUTATE_REVIEW" == '1' ]]; then
      printf 'changed but internally consistent\n' > README.md
      printf '%064d  README.md\n' 0 > docs/packet0-source-manifest-2026-10-21.sha256
    fi
    exit 0 ;;
  --test)
    if [[ "$NEARPILL_MUTATE_REVIEW" == '1' ]]; then
      printf 'changed but internally consistent\\n' > README.md
      printf '%064d  README.md\\n' 0 > docs/packet0-source-manifest-2026-10-21.sha256
    fi
    exit 0 ;;
  *) exit 0 ;;
esac
`;
    await writeFile(join(root, 'bin/node'), nodeShim);
    await writeFile(join(root, 'bin/npm'), '#!/bin/sh\necho 10.9.2\n');
    await chmod(join(root, 'bin/node'), 0o755);
    await chmod(join(root, 'bin/npm'), 0o755);
    const run = (mutate) => spawnSync('bash', ['scripts/verify-packet0.sh'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15_000,
      env: { ...process.env, NEARPILL_MUTATE_REVIEW: mutate ? '1' : '0', PATH: `${join(root, 'bin')}:${process.env.PATH}` },
    });
    const changed = run(true);
    assert.equal(changed.status, 1,
      `rewritten manifest must be a code failure, not environment-only BLOCKED:\n${changed.stdout}\n${changed.stderr}`);
    assert.match(changed.stdout + changed.stderr, /reviewed manifest.*changed|manifest.*fingerprint.*changed/i);
    assert.notEqual(await readFile(manifest, 'utf8'), reviewedManifest);

    // The unchanged fixture must keep the normal unsupported-runtime BLOCKED
    // result; do not falsely report local acceptance or a code failure.
    await writeFile(manifest, reviewedManifest);
    await writeFile(join(root, 'README.md'), 'original reviewed source\n');
    const clean = run(false);
    assert.equal(clean.status, 2, `unchanged project remains environment-blocked:\n${clean.stdout}\n${clean.stderr}`);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
