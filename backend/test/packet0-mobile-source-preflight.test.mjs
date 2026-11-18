import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { posixTest as test } from './helpers/posix.mjs';

const projectRoot = new URL('../../', import.meta.url);

// Only disposable synthetic fixtures. No real Flutter SDK, database, or network is used.
test('standalone mobile verifier rejects changed source before executing mobile tests', async () => {
  const base = await mkdtemp(join(tmpdir(), 'nearpill-mobile-preflight-'));
  const root = join(base, 'project');
  const marker = join(base, 'unreviewed-mobile-test-executed');
  try {
    for (const directory of ['scripts', 'test', 'docs']) {
      await mkdir(join(root, directory), { recursive: true });
    }
    const source = [
      'scripts/verify-mobile.sh',
      'scripts/secret-scan.mjs',
      'scripts/verify-source-manifest.mjs',
      'scripts/run-packet0-tests.mjs',
    ];
    for (const relative of source) {
      await copyFile(new URL(`../../${relative}`, import.meta.url), join(root, relative));
    }
    const testFile = 'test/mobile-architecture.test.mjs';
    await writeFile(join(root, testFile), "import test from 'node:test'; test('clean review', () => {});\n");
    const files = [...source, testFile].sort();
    const records = [];
    for (const relative of files) {
      const sha = createHash('sha256').update(await readFile(join(root, relative))).digest('hex');
      records.push(`${sha}  ${relative}`);
    }
    await writeFile(join(root, 'docs/packet0-source-manifest-2026-10-21.sha256'), `${records.join('\n')}\n`);
    // The manifest was reviewed for the harmless test above. A later change
    // must be rejected BEFORE the test can run, not merely flagged afterwards.
    await writeFile(join(root, testFile),
      `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'executed');\n`);

    const run = spawnSync('bash', ['scripts/verify-mobile.sh'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 20000,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')),
    });
    assert.equal(run.status, 1, `changed first-party source must block mobile tests: ${run.stdout} ${run.stderr}`);
    assert.equal(existsSync(marker), false, 'unreviewed mobile test must not execute');
    assert.match(run.stdout + run.stderr, /source (?:integrity|manifest|preflight)|CHANGED|fingerprint/i);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

// Packet 0 accepts neither a changed application file after mobile tests nor
// a rewritten manifest that makes the changed file appear internally valid.
// Tests run only inside disposable projects, with a deliberately unsupported
// fake Flutter binary so no mobile dependency resolution or SDK is invoked.
async function runMobileSourceMutation({ rewriteManifest }) {
  const base = await mkdtemp(join(tmpdir(), 'nearpill-mobile-postflight-'));
  const root = join(base, 'project');
  try {
    for (const directory of ['scripts', 'test', 'docs']) {
      await mkdir(join(root, directory), { recursive: true });
    }
    const source = [
      'scripts/verify-mobile.sh',
      'scripts/secret-scan.mjs',
      'scripts/verify-source-manifest.mjs',
      'scripts/run-packet0-tests.mjs',
    ];
    for (const relative of source) {
      await copyFile(new URL(`../../${relative}`, import.meta.url), join(root, relative));
    }
    await writeFile(join(root, 'README.md'), 'reviewed mobile baseline\n');
    const maliciousTest = [
      "import test from 'node:test';",
      "import { readFileSync, writeFileSync } from 'node:fs';",
      "import { createHash } from 'node:crypto';",
      "test('mutate reviewed source after preflight', () => {",
      "  writeFileSync('README.md', 'tampered after mobile preflight\\n');",
      ...(rewriteManifest ? [
        "  const path = 'docs/packet0-source-manifest-2026-10-21.sha256';",
        "  const manifest = readFileSync(path, 'utf8');",
        "  const hash = createHash('sha256').update(readFileSync('README.md')).digest('hex');",
        "  writeFileSync(path, manifest.replace(/^[a-f0-9]{64}  README\\.md$/m, `${hash}  README.md`));",
      ] : []),
      '});',
    ].join('\n');
    await writeFile(join(root, 'test/mobile-architecture.test.mjs'), `${maliciousTest}\n`);
    const records = [];
    for (const relative of [...source, 'README.md', 'test/mobile-architecture.test.mjs'].sort()) {
      records.push(`${createHash('sha256').update(await readFile(join(root, relative))).digest('hex')}  ${relative}`);
    }
    await writeFile(join(root, 'docs/packet0-source-manifest-2026-10-21.sha256'), `${records.join('\n')}\n`);
    await mkdir(join(base, 'bin'), { recursive: true });
    const fakeFlutter = join(base, 'bin', 'flutter');
    await writeFile(fakeFlutter, "#!/bin/sh\nprintf 'Flutter 0.0.0 • channel stable\\n'\n");
    await chmod(fakeFlutter, 0o755);

    const run = spawnSync('bash', ['scripts/verify-mobile.sh'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 20000,
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')),
        PATH: `${join(base, 'bin')}:${process.env.PATH ?? ''}`,
      },
    });
    return run;
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

test('standalone mobile verifier rejects source changed by an executed mobile test', async () => {
  const result = await runMobileSourceMutation({ rewriteManifest: false });
  assert.equal(result.status, 1, `source mutation must fail, not count as an environment-only block: ${result.stdout} ${result.stderr}`);
  assert.match(result.stdout + result.stderr, /post-execution source|CHANGED: README\.md/i);
});

test('standalone mobile verifier rejects a rewritten source manifest after mobile tests', async () => {
  const result = await runMobileSourceMutation({ rewriteManifest: true });
  assert.equal(result.status, 1, `rewriting both source and manifest must fail closed: ${result.stdout} ${result.stderr}`);
  assert.match(result.stdout + result.stderr, /reviewed manifest.*changed|post-execution source/i);
});

// A completely missing Node installation is an unavailable toolchain gate,
// not evidence of modified first-party source. The trusted shell/manifest
// checker preflight must still run before returning BLOCKED (exit 2).
test('standalone mobile verifier treats missing Node as NOT RUN/BLOCKED', async () => {
  const base = await mkdtemp(join(tmpdir(), 'nearpill-mobile-no-node-'));
  const root = join(base, 'project');
  try {
    for (const directory of ['scripts', 'docs', 'bin']) {
      await mkdir(join(root, directory), { recursive: true });
    }
    const reviewedCheckers = ['scripts/secret-scan.mjs', 'scripts/verify-source-manifest.mjs'];
    await copyFile(new URL('../../scripts/verify-mobile.sh', import.meta.url), join(root, 'scripts/verify-mobile.sh'));
    const records = [];
    for (const relative of reviewedCheckers) {
      await copyFile(new URL(`../../${relative}`, import.meta.url), join(root, relative));
      records.push(`${createHash('sha256').update(await readFile(join(root, relative))).digest('hex')}  ${relative}`);
    }
    await writeFile(join(root, 'docs/packet0-source-manifest-2026-10-21.sha256'), `${records.join('\n')}\n`);
    // Isolate PATH: retain only necessary shell utilities, and no Node/npm,
    // Flutter or Dart. Never alter the actual toolchain on the host.
    for (const command of ['dirname', 'awk', 'sha256sum']) {
      await symlink(`/usr/bin/${command}`, join(root, 'bin', command));
    }
    const result = spawnSync('/bin/bash', ['scripts/verify-mobile.sh'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10000,
      env: { PATH: join(root, 'bin'), HOME: base },
    });
    assert.equal(result.status, 2, `missing Node should be BLOCKED, not source FAILURE: ${result.stdout} ${result.stderr}`);
    assert.match(result.stdout + result.stderr, /Node(?:\.js)? .*not installed|Node(?:\.js)? .*unavailable/i);
    assert.match(result.stdout + result.stderr, /NOT RUN/i);
    assert.doesNotMatch(result.stdout + result.stderr, /PASS: mobile architecture contracts/);

    // A missing runtime must not hide an independently detected source defect.
    // The initial shell-only checker digest gate still has priority.
    await writeFile(join(root, 'scripts/secret-scan.mjs'), '// tampered checker\n');
    const tampered = spawnSync('/bin/bash', ['scripts/verify-mobile.sh'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10000,
      env: { PATH: join(root, 'bin'), HOME: base },
    });
    assert.equal(tampered.status, 1, `tampered reviewed checker must fail even without Node: ${tampered.stdout} ${tampered.stderr}`);
    assert.match(tampered.stdout + tampered.stderr, /source checker changed before Node execution/i);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

// Node's test runner reports status 0 even when every test is skipped. The
// standalone mobile gate must attest actual executed architecture contracts,
// not convert a skipped suite into a pass before Flutter becomes available.
test('standalone mobile verifier does not accept skipped-only architecture tests', async () => {
  const base = await mkdtemp(join(tmpdir(), 'nearpill-mobile-skip-gate-'));
  const root = join(base, 'project');
  try {
    for (const directory of ['scripts', 'test', 'docs']) {
      await mkdir(join(root, directory), { recursive: true });
    }
    const files = [
      'scripts/verify-mobile.sh',
      'scripts/secret-scan.mjs',
      'scripts/verify-source-manifest.mjs',
      'scripts/run-packet0-tests.mjs',
    ];
    for (const file of files) {
      await copyFile(new URL(`../../${file}`, import.meta.url), join(root, file));
    }
    const testFile = 'test/mobile-architecture.test.mjs';
    await writeFile(join(root, testFile),
      "import test from 'node:test'; test.skip('architecture contract unavailable', () => {});\n");
    const records = [];
    for (const file of [...files, testFile].sort()) {
      records.push(`${createHash('sha256').update(await readFile(join(root, file))).digest('hex')}  ${file}`);
    }
    await writeFile(join(root, 'docs/packet0-source-manifest-2026-10-21.sha256'), `${records.join('\n')}\n`);

    const run = spawnSync('bash', ['scripts/verify-mobile.sh'], {
      cwd: root, encoding: 'utf8', timeout: 20000,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')),
    });
    assert.equal(run.status, 1,
      `skipped-only architecture tests must fail even without Flutter: ${run.stdout} ${run.stderr}`);
    assert.match(run.stdout + run.stderr, /skipped|must have only executed/i);
    assert.doesNotMatch(run.stdout, /PASS: mobile architecture contracts/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

// A green standalone mobile gate must not attest an unsupported Node runtime.
// This fixture simulates a pinned Flutter/Dart SDK without installing it or
// running real Flutter. The actual Node binary executes test contracts; only
// its `--version` response is simulated through the isolated PATH.
test('standalone mobile acceptance blocks unsupported Node even when Flutter commands succeed', async () => {
  const base = await mkdtemp(join(tmpdir(), 'nearpill-mobile-node-version-'));
  const root = join(base, 'project');
  const bin = join(base, 'bin');
  try {
    for (const directory of ['scripts', 'test', 'docs']) {
      await mkdir(join(root, directory), { recursive: true });
    }
    await mkdir(bin);
    const files = [
      'scripts/verify-mobile.sh', 'scripts/secret-scan.mjs',
      'scripts/verify-source-manifest.mjs', 'scripts/run-packet0-tests.mjs',
    ];
    for (const relative of files) {
      await copyFile(new URL(`../../${relative}`, import.meta.url), join(root, relative));
    }
    const architecture = 'test/mobile-architecture.test.mjs';
    await writeFile(join(root, architecture), "import test from 'node:test'; test('mobile architecture', () => {});\n");
    const records = [];
    for (const relative of [...files, architecture].sort()) {
      records.push(`${createHash('sha256').update(await readFile(join(root, relative))).digest('hex')}  ${relative}`);
    }
    await writeFile(join(root, 'docs/packet0-source-manifest-2026-10-21.sha256'), `${records.join('\n')}\n`);

    const fakeNode = join(bin, 'node');
    await writeFile(fakeNode,
      `#!/bin/sh\nif [ "$1" = "--version" ]; then printf 'v22.16.0\\n'; exit 0; fi\nexec ${JSON.stringify(process.execPath)} "$@"\n`);
    await chmod(fakeNode, 0o755);
    const fakeFlutter = join(bin, 'flutter');
    await writeFile(fakeFlutter,
      "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf 'Flutter 3.44.4 • channel stable\\n'; fi\nexit 0\n");
    await chmod(fakeFlutter, 0o755);
    const fakeDart = join(bin, 'dart');
    await writeFile(fakeDart,
      "#!/bin/sh\nprintf 'Dart SDK version: 3.12.2 (stable) (synthetic)\\n'\n");
    await chmod(fakeDart, 0o755);

    const run = spawnSync('bash', ['scripts/verify-mobile.sh'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 20000,
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT' && key !== 'NODE_OPTIONS')),
        PATH: `${bin}:${process.env.PATH ?? ''}`,
      },
    });
    assert.equal(run.status, 2,
      `unsupported Node must not pass standalone mobile acceptance with fake pinned Flutter: ${run.stdout} ${run.stderr}`);
    assert.match(run.stdout + run.stderr, /Node.*(?:24|unsupported|outside|supported)/i);
    assert.match(run.stdout + run.stderr, /BLOCKED/i);
    assert.doesNotMatch(run.stdout + run.stderr, /FAIL: mobile source|source manifest mismatch/i);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

// A standalone mobile acceptance result must attest the declared npm toolchain
// as well as Node and Flutter. Reaching Flutter through a synthetic supported
// Node binary with npm 10 must not produce a false green acceptance result.
test('standalone mobile acceptance blocks npm 10 even with supported Node and Flutter fixtures', async () => {
  const base = await mkdtemp(join(tmpdir(), 'nearpill-mobile-npm-version-'));
  const root = join(base, 'project');
  const bin = join(base, 'bin');
  try {
    for (const directory of ['scripts', 'test', 'docs']) {
      await mkdir(join(root, directory), { recursive: true });
    }
    await mkdir(bin);
    const files = [
      'scripts/verify-mobile.sh', 'scripts/secret-scan.mjs',
      'scripts/verify-source-manifest.mjs', 'scripts/run-packet0-tests.mjs',
    ];
    for (const relative of files) {
      await copyFile(new URL(`../../${relative}`, import.meta.url), join(root, relative));
    }
    const architecture = 'test/mobile-architecture.test.mjs';
    await writeFile(join(root, architecture), "import test from 'node:test'; test('mobile architecture', () => {});\n");
    await writeFile(join(root, 'pubspec.lock'), '# synthetic tracked lockfile for fake Flutter only\n');
    files.push('pubspec.lock');
    const records = [];
    for (const relative of [...files, architecture].sort()) {
      records.push(`${createHash('sha256').update(await readFile(join(root, relative))).digest('hex')}  ${relative}`);
    }
    await writeFile(join(root, 'docs/packet0-source-manifest-2026-10-21.sha256'), `${records.join('\n')}\n`);

    const fakeNode = join(bin, 'node');
    await writeFile(fakeNode,
      `#!/bin/sh\nif [ "$1" = "--version" ]; then printf 'v24.22.0\\n'; exit 0; fi\nexec ${JSON.stringify(process.execPath)} "$@"\n`);
    const fakeNpm = join(bin, 'npm');
    await writeFile(fakeNpm, '#!/bin/sh\nif [ "$1" = "--version" ]; then printf "%s\\n" "$FAKE_NPM_VERSION"; exit 0; fi\nexit 1\n');
    const fakeFlutter = join(bin, 'flutter');
    await writeFile(fakeFlutter, '#!/bin/sh\nif [ "$1" = "--version" ]; then printf "Flutter 3.44.4 • channel stable\\n"; fi\nexit 0\n');
    const fakeDart = join(bin, 'dart');
    await writeFile(fakeDart, '#!/bin/sh\nprintf "Dart SDK version: 3.12.2 (stable) (synthetic)\\n"\n');
    for (const path of [fakeNode, fakeNpm, fakeFlutter, fakeDart]) await chmod(path, 0o755);

    const run = (npmVersion) => spawnSync('bash', ['scripts/verify-mobile.sh'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 20000,
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT' && key !== 'NODE_OPTIONS')),
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        FAKE_NPM_VERSION: npmVersion,
      },
    });
    const outdated = run('10.9.2');
    assert.equal(outdated.status, 2, `npm 10 must block mobile acceptance: ${outdated.stdout} ${outdated.stderr}`);
    assert.match(outdated.stdout + outdated.stderr, /npm.*11.*(?:required|supported|outside|BLOCKED)|BLOCKED.*npm/i);
    const accepted = run('11.19.1');
    assert.equal(accepted.status, 0, `supported synthetic toolchains should satisfy this isolated mobile check: ${accepted.stdout} ${accepted.stderr}`);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
