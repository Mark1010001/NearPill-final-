import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { posixTest as test } from './helpers/posix.mjs';

// Isolated, synthetic source: no real database, package installation or secrets.
test('standalone foundation verifier rejects changed source before executing test code', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'nearpill-foundation-preexec-'));
  const root = join(scratch, 'project');
  const marker = join(scratch, 'unreviewed-test-ran');
  try {
    for (const dir of ['scripts', 'test', 'docs']) {
      await mkdir(join(root, dir), { recursive: true });
    }
    const existing = [
      'scripts/verify-foundation.sh',
      'scripts/check-runtime.mjs',
      'scripts/check-lockfile.mjs',
      'scripts/secret-scan.mjs',
      'scripts/verify-source-manifest.mjs',
    ];
    for (const path of existing) {
      await copyFile(new URL(`../../${path}`, import.meta.url), join(root, path));
    }
    for (const path of ['test/engineering-foundation.test.mjs', 'test/env-config.test.mjs']) {
      await writeFile(join(root, path), "import test from 'node:test'; test('reviewed harmless fixture', () => {});\n");
    }
    const source = [...existing, 'test/engineering-foundation.test.mjs', 'test/env-config.test.mjs'].sort();
    const manifest = [];
    for (const path of source) {
      manifest.push(`${createHash('sha256').update(await readFile(join(root, path))).digest('hex')}  ${path}`);
    }
    await writeFile(join(root, 'docs/packet0-source-manifest-2026-10-21.sha256'), manifest.join('\n') + '\n');

    // Change code after review: an untrusted test must never get to execute.
    await writeFile(join(root, 'test/engineering-foundation.test.mjs'),
      `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'executed');\n`);
    const result = spawnSync('bash', ['scripts/verify-foundation.sh'], {
      cwd: root, encoding: 'utf8', timeout: 25000,
      env: Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'NODE_TEST_CONTEXT')),
    });
    assert.equal(result.status, 1, `unreviewed source must cause a code failure: ${result.stdout} ${result.stderr}`);
    assert.equal(existsSync(marker), false, 'unreviewed test code must never execute');
    assert.match(result.stdout + result.stderr, /source (?:integrity|manifest|pre-execution)|CHANGED|fingerprint/i);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});


test('all canonical source verification and packaging entrypoints reject ambient NODE_OPTIONS before Node executes', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'nearpill-node-preload-'));
  const root = join(scratch, 'project');
  const marker = join(scratch, 'unreviewed-preload-ran');
  const preload = join(scratch, 'unreviewed-preload.cjs');
  try {
    await mkdir(join(root, 'scripts'), { recursive: true });
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'docs/packet0-source-manifest-2026-10-21.sha256'), 'synthetic marker\n');
    await writeFile(preload,
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');\n` +
      `throw new Error('unreviewed Node preload must not execute');\n`);
    for (const script of ['verify-packet0.sh', 'verify-foundation.sh', 'verify-mobile.sh', 'package-source.sh']) {
      await copyFile(new URL(`../../scripts/${script}`, import.meta.url), join(root, 'scripts', script));
      const result = spawnSync('bash', [`scripts/${script}`], {
        cwd: root, encoding: 'utf8', timeout: 15000,
        env: { ...process.env, NODE_OPTIONS: `--require=${preload}` },
      });
      assert.equal(result.status, 1, `${script} must fail closed: ${result.stdout} ${result.stderr}`);
      assert.equal(existsSync(marker), false,
        `${script} must reject ambient preloads before running any Node child`);
      assert.match(result.stdout + result.stderr, /NODE_OPTIONS|preload|source integrity/i);
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});


test('canonical verification and packaging entrypoints refuse tampered source checkers before Node executes them', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'nearpill-checker-bootstrap-'));
  const root = join(scratch, 'project');
  const marker = join(scratch, 'tampered-secret-scanner-executed');
  try {
    for (const dir of ['scripts', 'docs']) await mkdir(join(root, dir), { recursive: true });
    const reviewedScanner = "console.log('clean scanner fixture');\n";
    const verifier = "process.exit(1);\n"; // stop any unguarded script after its first scanner
    const files = {
      'scripts/secret-scan.mjs': reviewedScanner,
      'scripts/verify-source-manifest.mjs': verifier,
    };
    for (const [relative, value] of Object.entries(files)) {
      await writeFile(join(root, relative), value);
    }
    await writeFile(join(root, 'docs/packet0-source-manifest-2026-10-21.sha256'),
      Object.entries(files).map(([relative, value]) =>
        `${createHash('sha256').update(value).digest('hex')}  ${relative}`).join('\n') + '\n');
    // A tampered scanner OR manifest checker must be stopped by the shell,
    // before either unreviewed JavaScript file can execute.
    for (const alteredChecker of Object.keys(files)) {
      const hostile = `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed');\n`;
      await writeFile(join(root, alteredChecker), hostile);
      for (const entrypoint of ['verify-packet0.sh', 'verify-foundation.sh', 'verify-mobile.sh', 'package-source.sh']) {
        await copyFile(new URL(`../../scripts/${entrypoint}`, import.meta.url), join(root, 'scripts', entrypoint));
        const args = [`scripts/${entrypoint}`];
        if (entrypoint === 'package-source.sh') args.push(join(scratch, 'handoff.zip'));
        const run = spawnSync('bash', args, {
          cwd: root, encoding: 'utf8', timeout: 15000,
          env: Object.fromEntries(Object.entries(process.env).filter(([key]) =>
            key !== 'NODE_OPTIONS' && key !== 'NODE_TEST_CONTEXT')),
        });
        assert.equal(existsSync(marker), false,
          `${entrypoint} executed the tampered ${alteredChecker}: ${run.stdout} ${run.stderr}`);
        assert.equal(run.status, 1, `${entrypoint} must fail closed: ${run.stdout} ${run.stderr}`);
        assert.match(run.stdout + run.stderr, /source (?:verification )?checker (?:changed|missing)|reviewed source checker digest/i);
      }
      await writeFile(join(root, alteredChecker), files[alteredChecker]);
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});


test('source checker bootstrap rejects symlinked manifest or checker parent directories before Node', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'nearpill-checker-ancestor-'));
  const root = join(scratch, 'project');
  try {
    await mkdir(join(root, 'scripts'), { recursive: true });
    await mkdir(join(scratch, 'outside-docs'), { recursive: true });
    const content = "console.log('fixture');\n";
    for (const name of ['secret-scan.mjs', 'verify-source-manifest.mjs']) {
      await writeFile(join(root, 'scripts', name), content);
    }
    const digest = createHash('sha256').update(content).digest('hex');
    await writeFile(join(scratch, 'outside-docs', 'packet0-source-manifest-2026-10-21.sha256'),
      ['secret-scan.mjs', 'verify-source-manifest.mjs']
        .map((name) => `${digest}  scripts/${name}\n`).join(''));
    await symlink(join(scratch, 'outside-docs'), join(root, 'docs'));
    await copyFile(new URL('../../scripts/verify-mobile.sh', import.meta.url), join(root, 'scripts', 'verify-mobile.sh'));
    const result = spawnSync('bash', ['scripts/verify-mobile.sh'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /source verification directory missing or symlinked/i);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
