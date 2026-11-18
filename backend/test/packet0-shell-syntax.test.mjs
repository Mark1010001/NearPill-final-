import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { posixTest as test } from './helpers/posix.mjs';

const checker = new URL('../../scripts/check-shell-syntax.sh', import.meta.url);
const packet0Runner = new URL('../../scripts/verify-packet0.sh', import.meta.url);

async function withShellSource(fn) {
  const root = await mkdtemp(join(tmpdir(), 'nearpill-shell-syntax-'));
  try {
    await mkdir(join(root, 'scripts'));
    await copyFile(checker, join(root, 'scripts/check-shell-syntax.sh'));
    await mkdir(join(root, 'backend/scripts'), { recursive: true });
    const run = () => spawnSync('bash', [join(root, 'scripts/check-shell-syntax.sh')], { cwd: root, encoding: 'utf8' });
    await fn({ root, run });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('Packet 0 requires first-party shell syntax verification', async () => {
  const runner = await readFile(packet0Runner, 'utf8');
  assert.match(runner, /run_required 'First-party shell parse checks' bash scripts\/check-shell-syntax\.sh/);
});

test('shell syntax gate accepts existing POSIX and Bash scripts', async () => {
  await withShellSource(async ({ root, run }) => {
    await writeFile(join(root, 'backend/scripts/safe.sh'), '#!/bin/sh\nif true; then\n  echo safe\nfi\n');
    await writeFile(join(root, 'scripts/works.sh'), '#!/usr/bin/env bash\narr=(one two)\n[[ ${#arr[@]} -eq 2 ]]\n');
    const result = run();
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /PASS: 3 first-party shell scripts/);
  });
});

test('shell syntax gate rejects a malformed POSIX shell script', async () => {
  await withShellSource(async ({ root, run }) => {
    await writeFile(join(root, 'backend/scripts/broken.sh'), '#!/bin/sh\nif true; then\necho incomplete\n');
    const result = run();
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /broken\.sh/);
  });
});

test('shell syntax gate rejects malformed Bash even when a valid script exists', async () => {
  await withShellSource(async ({ root, run }) => {
    await writeFile(join(root, 'scripts/broken.sh'), '#!/usr/bin/env bash\nfunction broken() {\necho incomplete\n');
    await writeFile(join(root, 'backend/scripts/valid.sh'), '#!/bin/sh\necho okay\n');
    const result = run();
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /scripts\/broken\.sh/);
  });
});

test('shell syntax gate excludes dependency caches and generated output', async () => {
  await withShellSource(async ({ root, run }) => {
    await mkdir(join(root, 'backend/node_modules/pkg'), { recursive: true });
    await writeFile(join(root, 'backend/node_modules/pkg/generated.sh'), '#!/bin/sh\nif true; then\n');
    await mkdir(join(root, 'web/dist'), { recursive: true });
    await writeFile(join(root, 'web/dist/generated.sh'), '#!/bin/sh\nif true; then\n');
    const result = run();
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /PASS: 1 first-party shell scripts/);
  });
});


test('shell syntax gate rejects malformed extensionless shell entrypoints', async () => {
  await withShellSource(async ({ root, run }) => {
    await writeFile(join(root, 'scripts/deploy'), '#!/usr/bin/env bash\nif true; then\necho incomplete\n');
    await writeFile(join(root, 'backend/scripts/healthy.sh'), '#!/bin/sh\necho okay\n');
    const result = run();
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /scripts\/deploy/);
  });
});

test('shell syntax gate recognizes POSIX and env -S extensionless scripts without treating Python as shell', async () => {
  await withShellSource(async ({ root, run }) => {
    await writeFile(join(root, 'scripts/run'), '#!/usr/bin/env -S bash -eu\narray=(a b)\n');
    await writeFile(join(root, 'backend/scripts/provision'), '#!/bin/sh\nif true; then\necho okay\nfi\n');
    await writeFile(join(root, 'scripts/python-tool'), '#!/usr/bin/env python3\ndef broken(:\n');
    const result = run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PASS: 3 first-party shell scripts/);
  });
});

// A process substitution does not propagate find(1)'s exit status to the
// consumer. A partial scan must never be reported as a complete syntax pass.
test('shell syntax gate fails closed when source discovery partially fails', async () => {
  await withShellSource(async ({ root }) => {
    const bin = join(root, 'test-bin');
    await mkdir(bin);
    const valid = join(root, 'backend/scripts/healthy.sh');
    await writeFile(valid, '#!/bin/sh\necho okay\n');
    const fakeFind = join(bin, 'find');
    await writeFile(fakeFind, '#!/bin/sh\nprintf "%s\\0" "$NEARPILL_TEST_SOURCE"\nexit 37\n');
    await chmod(fakeFind, 0o755);
    const result = spawnSync('bash', [join(root, 'scripts/check-shell-syntax.sh')], {
      cwd: root, encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, NEARPILL_TEST_SOURCE: valid },
    });
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.match(result.stderr, /discovery failed/i);
    assert.doesNotMatch(result.stdout, /PASS:/);
  });
});
