import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { posixTest } from './helpers/posix.mjs';

const scriptPath = new URL('../../scripts/verify-packet0.sh', import.meta.url);
const source = await readFile(scriptPath, 'utf8');

posixTest('Packet 0 verifier stays syntactically executable', () => {
  const checked = spawnSync('bash', ['-n', fileURLToPath(scriptPath)], { encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
});

posixTest('Packet 0 treats missing Node as a blocked toolchain, not a source-code failure', async () => {
  const { mkdtemp, mkdir, copyFile, writeFile, symlink, rm, readFile: read } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { createHash } = await import('node:crypto');
  const base = await mkdtemp(join(tmpdir(), 'nearpill-no-node-'));
  const root = join(base, 'project');
  const isolatedPath = join(base, 'bin');
  try {
    await mkdir(join(root, 'scripts'), { recursive: true });
    await mkdir(join(root, 'docs'));
    await mkdir(isolatedPath);
    const copied = ['verify-packet0.sh', 'secret-scan.mjs', 'verify-source-manifest.mjs'];
    for (const name of copied) {
      await copyFile(new URL(`../../scripts/${name}`, import.meta.url), join(root, 'scripts', name));
    }
    const records = [];
    for (const name of ['secret-scan.mjs', 'verify-source-manifest.mjs']) {
      const relative = `scripts/${name}`;
      const hash = createHash('sha256').update(await read(join(root, relative))).digest('hex');
      records.push(`${hash}  ${relative}`);
    }
    await writeFile(join(root, 'docs', 'packet0-source-manifest-2026-10-21.sha256'), `${records.join('\n')}\n`);
    // Provide only the shell preflight's required OS utilities. The test
    // never changes the real system PATH and never starts npm or a DB client.
    for (const name of ['dirname', 'awk', 'sha256sum']) {
      const found = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' });
      assert.equal(found.status, 0, `${name} is required by the shell preflight`);
      await symlink(found.stdout.trim(), join(isolatedPath, name));
    }
    const checked = spawnSync('/bin/bash', ['scripts/verify-packet0.sh'], {
      cwd: root, encoding: 'utf8', timeout: 10000,
      env: { PATH: isolatedPath, HOME: base },
    });
    assert.equal(checked.status, 2, checked.stdout + checked.stderr);
    assert.match(checked.stderr, /ENVIRONMENT BLOCKER: Node\.js is not installed/);
    assert.match(checked.stderr, /NOT RUN/);
    assert.doesNotMatch(checked.stdout + checked.stderr, /FAIL: source integrity preflight|PASS: Source artifact secret scan/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

posixTest('Packet 0 rejects unreviewed test symlinks before executing source tests', async () => {
  const { mkdtemp, mkdir, copyFile, writeFile, symlink, rm, readFile: read } = await import('node:fs/promises');
  const { existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { createHash } = await import('node:crypto');
  const base = await mkdtemp(join(tmpdir(), 'nearpill-unreviewed-test-'));
  const root = join(base, 'project');
  const marker = join(base, 'executed-marker');
  try {
    for (const directory of ['scripts', 'backend/test', 'test', 'docs', 'web']) {
      await mkdir(join(root, directory), { recursive: true });
    }
    const sourceCopies = [
      ['scripts/verify-packet0.sh', new URL('../../scripts/verify-packet0.sh', import.meta.url)],
      ['scripts/secret-scan.mjs', new URL('../../scripts/secret-scan.mjs', import.meta.url)],
      ['scripts/verify-source-manifest.mjs', new URL('../../scripts/verify-source-manifest.mjs', import.meta.url)],
    ];
    for (const [relative, from] of sourceCopies) await copyFile(from, join(root, relative));
    const regularFiles = [
      ...sourceCopies.map(([relative]) => relative),
      'backend/test/packet0-safe.test.mjs', 'test/safe.test.mjs', 'README.md',
    ];
    await writeFile(join(root, 'backend/test/packet0-safe.test.mjs'), 'export const safe = true;\n');
    await writeFile(join(root, 'test/safe.test.mjs'), 'export const safe = true;\n');
    await writeFile(join(root, 'README.md'), 'Disposable baseline source.\n');
    const entries = [];
    for (const relative of regularFiles.sort()) {
      const hash = createHash('sha256').update(await read(join(root, relative))).digest('hex');
      entries.push(`${hash}  ${relative}`);
    }
    await writeFile(join(root, 'docs/packet0-source-manifest-2026-10-21.sha256'), `${entries.join('\n')}\n`);
    // A new test symlink is not in the reviewed source manifest. Running it
    // before source preflight would execute code outside the canonical tree.
    const outside = join(base, 'outside.test.mjs');
    await writeFile(outside, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed');\n`);
    await symlink(outside, join(root, 'backend/test/packet0-unreviewed.test.mjs'));
    const run = spawnSync('bash', ['scripts/verify-packet0.sh'], {
      cwd: root, encoding: 'utf8', timeout: 15000,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')),
    });
    assert.equal(run.status, 1, `source review must fail closed: ${run.stdout} ${run.stderr}`);
    assert.equal(existsSync(marker), false, 'unreviewed test code must not execute before integrity preflight');
    assert.match(run.stdout + run.stderr, /source (?:integrity|preflight)|source manifest|symbolic link/i);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('Packet 0 cannot claim supported Node acceptance from lockfile names alone', () => {
  assert.match(source, /node_supported == 1 && lockfiles_ready == 1/);
  assert.match(source, /dependencies_ready=0/);
  assert.match(source, /npm ci --ignore-scripts/);
  assert.match(source, /npm ci --prefix backend --ignore-scripts/);
  assert.match(source, /npm ci --prefix web --ignore-scripts/);
  assert.match(source, /node_supported == 1 && dependencies_ready == 1/);
});

test('Web compilation and TypeScript baseline are required after successful clean installs', () => {
  for (const command of [
    "run_required 'Root strict TypeScript check' npm run typecheck",
    "run_required 'Web portal TypeScript check' npm run typecheck:web",
    "run_required 'Web portal production build' npm run build:web",
  ]) assert.ok(source.includes(command), `missing required gate: ${command}`);
  assert.ok(source.indexOf("dependencies_ready=1") < source.indexOf("npm run build:web"));
});

test('Flutter checks require pinned versions and successful dependency resolution', () => {
  assert.match(source, /\^Flutter\[\[:space:\]\]\+3/);
  assert.match(source, /3\\.44\\.4/);
  assert.match(source, /3\.12\.2/);
  assert.match(source, /if ! flutter pub get --enforce-lockfile; then/);
  assert.match(source, /run_required 'Flutter analyzer' flutter analyze/);
  assert.match(source, /run_required 'Flutter tests' flutter test/);
});

test('Verifier does not equate a toolchain pass with live Supabase RLS or restore acceptance', () => {
  assert.match(source, /BLOCKED: Packet 0 acceptance requires independently executed real NearPill-owned PostgreSQL/);
  assert.match(source, /environment_blocker != 0/);
  assert.match(source, /exit 2/);
});


test('Packet 0 automatically includes auth credential and future characterization tests', () => {
  assert.match(source, /for file in backend\/test\/\*\*\/packet0-\*\.test\.mjs backend\/test\/\*\*\/packet0-\*\.test\.cjs backend\/test\/\*\*\/packet0-\*\.test\.js; do/);
  assert.match(source, /node scripts\/run-packet0-tests\.mjs "\$\{packet0_tests\[@\]\}"/);
  assert.match(source, /FAIL: no Packet 0 characterization tests found/);
});


test('Packet 0 runner treats CommonJS and JavaScript characterization files as mandatory, not optional baseline tests', async () => {
  const { mkdtemp, mkdir, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'nearpill-packet0-mixed-formats-'));
  try {
    await mkdir(join(root, 'backend', 'test'), { recursive: true });
    const cjsName = 'backend/test/packet0-commonjs.test.cjs';
    const jsName = 'backend/test/packet0-javascript.test.js';
    const guard = fileURLToPath(new URL('../../scripts/run-packet0-tests.mjs', import.meta.url));
    await writeFile(join(root, cjsName), "const test = require('node:test'); test('cjs', () => {});\n");
    await writeFile(join(root, jsName), "const test = require('node:test'); test('js', () => {});\n");
    const run = () => spawnSync(process.execPath, [guard, cjsName, jsName], {
      cwd: root, encoding: 'utf8', timeout: 20000,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')),
    });
    const passed = run();
    assert.equal(passed.status, 0, passed.stderr + passed.stdout);
    assert.match(passed.stdout, /Packet 0 TAP attests 2\/2 executed tests/);
    await writeFile(join(root, cjsName), "const test = require('node:test'); test.skip('security case not executed', () => {});\n");
    const skipped = run();
    assert.equal(skipped.status, 1, 'skipped .cjs characterization must fail: ' + skipped.stdout + skipped.stderr);
    assert.doesNotMatch(skipped.stdout, /PASS: Packet 0 TAP attests/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Packet 0 runner rejects duplicate file arguments before executing source tests', async () => {
  const { mkdtemp, mkdir, writeFile, rm, access } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'nearpill-packet0-duplicate-inputs-'));
  const runner = fileURLToPath(new URL('../../scripts/run-packet0-tests.mjs', import.meta.url));
  const marker = join(root, 'executed-marker');
  try {
    await mkdir(join(root, 'backend/test'), { recursive: true });
    await mkdir(join(root, 'test'));
    const source = `import { writeFileSync } from 'node:fs';
import test from 'node:test';
writeFileSync(${JSON.stringify(marker)}, 'ran');
test('fixture', () => {});
`;
    const packetFile = 'backend/test/packet0-duplicate.test.mjs';
    const baselineFile = 'test/duplicate.test.mjs';
    await writeFile(join(root, packetFile), source);
    await writeFile(join(root, baselineFile), source);
    for (const args of [
      [packetFile, packetFile],
      ['--baseline', baselineFile, baselineFile],
      ['--partial-baseline', baselineFile, baselineFile],
    ]) {
      const result = spawnSync(process.execPath, [runner, ...args], {
        cwd: root, encoding: 'utf8', timeout: 10000,
        env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')),
      });
      assert.equal(result.status, 1, `duplicate arguments must fail closed: ${result.stdout}${result.stderr}`);
      assert.match(result.stderr, /duplicate test file/i);
      await assert.rejects(access(marker), { code: 'ENOENT' }, 'duplicate inputs must not run any test file');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Packet 0 discovery includes the existing reconciliation and acceptance-gate tests', async () => {
  const { readdir } = await import('node:fs/promises');
  const names = (await readdir(new URL('./', import.meta.url))).filter((name) => /^packet0-.*\.test\.mjs$/.test(name));
  assert.ok(names.includes('packet0-reconciliation-completeness.test.mjs'));
  assert.ok(names.includes('packet0-acceptance-gates.test.mjs'));
  assert.ok(names.length >= 17, 'source test inventory must remain fully discoverable');
});


test('supported-runtime Node baseline covers root contracts exactly once, in addition to Packet 0', () => {
  const supportedPath = source.slice(source.indexOf('  remaining_backend_tests=()'), source.indexOf('== Flutter baseline =='));
  assert.match(supportedPath, /remaining_backend_tests=\(\)/);
  assert.ok(supportedPath.includes('[[ "${file##*/}" == packet0-*.test.mjs || "${file##*/}" == packet0-*.test.cjs || "${file##*/}" == packet0-*.test.js ]] && continue'));
  assert.match(supportedPath, /node scripts\/run-packet0-tests\.mjs --baseline "\$\{remaining_backend_tests\[@\]\}" "\$\{root_node_tests\[@\]\}"/);
  assert.match(supportedPath, /node scripts\/run-packet0-tests\.mjs --partial-baseline "\$\{runnable_backend_tests\[@\]\}" "\$\{root_node_tests\[@\]\}"/);
  assert.match(supportedPath, /backend\/test\/password-migration\.test\.mjs/);
  assert.match(supportedPath, /FAIL: no remaining backend contracts discovered/);
});


test('wrong Flutter SDK versions block dependency resolution and mobile test acceptance', () => {
  const flutterGate = source.slice(source.indexOf('== Flutter baseline =='));
  assert.ok(flutterGate.includes('channel[[:space:]]+stable([[:space:]]|$)'), 'require pinned stable Flutter channel');
  assert.ok(flutterGate.includes('3\\.12\\.2[[:space:]]+\\(stable\\)'), 'require pinned stable Dart version');
  assert.match(flutterGate, /SKIP: Flutter dependency resolution and tests cannot establish acceptance on a mismatched SDK/);
  assert.ok(flutterGate.includes('elif [[ ! -f pubspec.lock || -L pubspec.lock ]]; then')); 
  assert.match(flutterGate, /elif ! flutter pub get --enforce-lockfile; then/);
  assert.doesNotMatch(flutterGate, /\n  if ! flutter pub get; then/);
});


test('a clean local build cannot exit 0 as Packet 0 acceptance without the live database gates', () => {
  const ending = source.slice(source.lastIndexOf("echo 'PASS: Packet 0 local toolchain/build baseline completed.'"));
  assert.match(ending, /BLOCKED: Packet 0 acceptance requires independently executed real NearPill-owned PostgreSQL/);
  assert.match(ending, /app-role RLS, migration, 100-way inventory, reconciliation and restore gates/);
  assert.match(ending, /exit 2\s*$/);
  assert.doesNotMatch(ending, /exit 0/);
});

test('the current unsupported environment remains blocked, not a fake success', () => {
  // Execute the actual script, but avoid duplicating its expensive suite here.
  // The supported-runtime branch cannot be reached in this test environment;
  // compare the exit paths structurally rather than shadowing installed tools.
  assert.match(source, /if \(\( environment_blocker != 0 \)\); then[\s\S]*?exit 2/);
  assert.match(source, /if \(\( code_failure != 0 \)\); then[\s\S]*?exit 1/);
  assert.match(source, /There is deliberately no environment-variable bypass/);
});


test('Packet 0 acceptance invokes the canonical syntax checker rather than duplicating file traversal', () => {
  assert.match(source, /run_required 'First-party JavaScript parse checks' node scripts\/check-js-syntax\.mjs/);
  assert.doesNotMatch(source, /find backend web scripts test -type f/);
  assert.doesNotMatch(source, /while IFS= read -r -d '' file/);
});

test('standalone first-party syntax helper covers tooling and tests without generated/dependency directories', async () => {
  const { readFile } = await import('node:fs/promises');
  const helper = await readFile(new URL('../../scripts/check-js-syntax.mjs', import.meta.url), 'utf8');
  assert.match(helper, /const roots = \['backend', 'web', 'scripts', 'test'\]/);
  for (const ignored of ['node_modules', 'dist', 'build', 'coverage', '.dart_tool']) {
    assert.ok(helper.includes(`'${ignored}'`), `expected excluded directory ${ignored}`);
  }
  assert.match(helper, /spawnSync\(process\.execPath, \['--check', file\]/);
});


test('canonical syntax gate fails closed on an empty source tree', async () => {
  const { mkdtemp, mkdir, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'nearpill-packet0-syntax-'));
  try {
    for (const directory of ['backend', 'web', 'scripts', 'test']) {
      await mkdir(join(root, directory));
    }
    // The helper is ESM by extension, even in a disposable directory.
    const checked = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/check-js-syntax.mjs', import.meta.url))], {
      cwd: root, encoding: 'utf8',
    });
    assert.equal(checked.status, 1, checked.stderr + checked.stdout);
    assert.match(checked.stderr, /no first-party JavaScript files found/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('canonical syntax gate fails closed when one required source tree is missing', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'nearpill-packet0-missing-tree-'));
  try {
    for (const directory of ['backend', 'scripts', 'test']) {
      await mkdir(join(root, directory));
    }
    await writeFile(join(root, 'backend', 'valid.mjs'), 'export const ok = true;\n');
    const checked = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/check-js-syntax.mjs', import.meta.url))], {
      cwd: root, encoding: 'utf8',
    });
    assert.equal(checked.status, 1, checked.stderr + checked.stdout);
    assert.match(checked.stderr, /cannot scan required source directory web/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('canonical syntax gate refuses symbolic links in first-party source trees', async () => {
  const { mkdtemp, mkdir, writeFile, symlink, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'nearpill-packet0-symlink-'));
  try {
    for (const directory of ['backend', 'web', 'scripts', 'test']) await mkdir(join(root, directory));
    await writeFile(join(root, 'backend', 'valid.mjs'), 'export const ok = true;\n');
    await symlink(join(root, 'backend', 'valid.mjs'), join(root, 'web', 'linked.mjs'));
    const checked = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/check-js-syntax.mjs', import.meta.url))], {
      cwd: root, encoding: 'utf8',
    });
    assert.equal(checked.status, 1, checked.stderr + checked.stdout);
    assert.match(checked.stderr, /symbolic link in first-party source tree/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('first-party JavaScript syntax gate rejects malformed root-level runtime configuration', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'nearpill-packet0-root-js-'));
  try {
    for (const directory of ['backend', 'web', 'scripts', 'test']) {
      await mkdir(join(root, directory));
    }
    await writeFile(join(root, 'backend', 'valid.mjs'), 'export const ok = true;\n');
    await writeFile(join(root, 'eslint.config.mjs'), 'export default {\n');
    const checked = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/check-js-syntax.mjs', import.meta.url))], {
      cwd: root, encoding: 'utf8',
    });
    assert.equal(checked.status, 1, 'a malformed root-level config must fail, not silently PASS: ' + checked.stdout);
    assert.doesNotMatch(checked.stdout, /^PASS: parsed/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('Packet 0 verifier partitions characterization and remaining Node tests without duplicate execution', () => {
  assert.match(source, /remaining_backend_tests=\(\)/);
  assert.match(source, /for file in backend\/test\/\*\*\/\*\.test\.mjs backend\/test\/\*\*\/\*\.test\.cjs backend\/test\/\*\*\/\*\.test\.js; do/);
  assert.ok(source.includes('[[ "${file##*/}" == packet0-*.test.mjs || "${file##*/}" == packet0-*.test.cjs || "${file##*/}" == packet0-*.test.js ]] && continue'));
  assert.match(source, /"\$\{remaining_backend_tests\[@\]\}" "\$\{root_node_tests\[@\]\}"/);
  assert.match(source, /for file in "\$\{remaining_backend_tests\[@\]\}"; do/);
  assert.match(source, /"\$\{runnable_backend_tests\[@\]\}" "\$\{root_node_tests\[@\]\}"/);
  assert.doesNotMatch(source, /node --test --test-concurrency=2 backend\/test\/\*\.test\.mjs/);
});


test('Packet 0 Node acceptance discovers all first-party CommonJS and JavaScript test files rather than one hardcoded root test', () => {
  // New test files must be executed automatically, not silently omitted from
  // the gate when the filename differs from the historical service test.
  assert.match(source, /for file in backend\/test\/\*\*\/\*\.test\.mjs backend\/test\/\*\*\/\*\.test\.cjs backend\/test\/\*\*\/\*\.test\.js; do/);
  assert.match(source, /for file in test\/\*\*\/\*\.test\.mjs test\/\*\*\/\*\.test\.cjs test\/\*\*\/\*\.test\.js; do/);
  assert.match(source, /"\$\{root_node_tests\[@\]\}"/);
  assert.doesNotMatch(source, /test\/web_service_information\.test\.cjs/);
});

// The standalone mobile gate is often used independently of verify-packet0.
// It must not declare success using a Flutter/Dart SDK that the canonical
// Packet 0 acceptance gate explicitly rejects.
posixTest('standalone mobile verifier refuses unsupported Flutter and Dart toolchains before dependency resolution', async () => {
  const { mkdtemp, mkdir, writeFile, chmod, rm, copyFile, readFile: read } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'nearpill-packet0-mobile-sdk-'));
  try {
    await mkdir(join(root, 'scripts'));
    await mkdir(join(root, 'test'));
    await mkdir(join(root, 'bin'));
    await copyFile(new URL('../../scripts/verify-mobile.sh', import.meta.url), join(root, 'scripts/verify-mobile.sh'));
    // This test isolates SDK enforcement; the reviewed-checker bootstrap must
    // first be satisfied with clean synthetic files, not skipped with a stub.
    const { createHash } = await import('node:crypto');
    await mkdir(join(root, 'docs'));
    const checkers = ['secret-scan.mjs', 'verify-source-manifest.mjs'];
    const checkerStub = '// synthetic checker intercepted by fake node\n';
    for (const file of checkers) await writeFile(join(root, 'scripts', file), checkerStub);
    const digest = createHash('sha256').update(checkerStub).digest('hex');
    await writeFile(join(root, 'docs/packet0-source-manifest-2026-10-21.sha256'),
      checkers.map((file) => `${digest}  scripts/${file}\n`).join(''));
    const fakeNode = join(root, 'bin/node');
    const fakeNpm = join(root, 'bin/npm');
    const fakeFlutter = join(root, 'bin/flutter');
    const fakeDart = join(root, 'bin/dart');
    await writeFile(fakeNode, '#!/bin/sh\nif [ "$1" = "--version" ]; then printf "v24.22.0\\n"; exit 0; fi\nexit 0\n');
    await writeFile(fakeNpm, '#!/bin/sh\nif [ "$1" = "--version" ]; then printf "11.19.1\\n"; exit 0; fi\nexit 1\n');
    await writeFile(fakeFlutter, '#!/bin/sh\nif [ "$1" = "--version" ]; then printf "%s\\n" "$FAKE_FLUTTER_VERSION"; exit 0; fi\nprintf "flutter %s\\n" "$*" >> "$FAKE_CALLS"\n');
    await writeFile(fakeDart, '#!/bin/sh\nif [ "$1" = "--version" ]; then printf "%s\\n" "$FAKE_DART_VERSION"; exit 0; fi\nexit 1\n');
    await Promise.all([fakeNode, fakeNpm, fakeFlutter, fakeDart].map((file) => chmod(file, 0o755)));
    const calls = join(root, 'sdk-calls.txt');
    const run = (flutterVersion, dartVersion) => spawnSync('bash', [join(root, 'scripts/verify-mobile.sh')], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`,
        FAKE_CALLS: calls, FAKE_FLUTTER_VERSION: flutterVersion, FAKE_DART_VERSION: dartVersion },
    });
    for (const [flutterVersion, dartVersion] of [
      ['Flutter 3.43.0 • channel stable', 'Dart SDK version: 3.12.2 (stable)'],
      ['Flutter 3.44.4 • channel stable', 'Dart SDK version: 3.11.0 (stable)'],
      ['Flutter 3.44.40 • channel stable', 'Dart SDK version: 3.12.2 (stable)'],
      ['Flutter 3.44.4 • channel stable', 'Dart SDK version: 3.12.2-rc.1 (prerelease)'],
      ['Flutter 3.44.4 • channel stable', 'Dart SDK version: 3.12.2-dev.7 (dev)'],
      ['Flutter 3.44.4 • channel beta', 'Dart SDK version: 3.12.2 (stable)'],
      ['Flutter 3.44.4 • channel stable', 'Dart SDK version: 3.12.2 (beta)'],
    ]) {
      const result = run(flutterVersion, dartVersion);
      assert.equal(result.status, 2, `unsupported SDK must BLOCK, not succeed: ${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /BLOCKED:.*Flutter.*Dart/i);
      const seen = await read(calls, 'utf8').catch(() => '');
      assert.equal(seen, '', 'unsupported SDK must not run pub get, analyze, or test');
    }
    const missingLock = run('Flutter 3.44.4 • channel stable', 'Dart SDK version: 3.12.2 (stable)');
    assert.equal(missingLock.status, 2, 'missing Flutter lockfile must block acceptance');
    assert.match(missingLock.stdout + missingLock.stderr, /pubspec\.lock/i);
    assert.equal(await read(calls, 'utf8').catch(() => ''), '', 'missing lockfile must not invoke flutter pub get');
    await writeFile(join(root, 'pubspec.lock'), '# synthetic reviewed fixture (not a real resolved lockfile)\n');
    const supported = run('Flutter 3.44.4 • channel stable', 'Dart SDK version: 3.12.2 (stable)');
    assert.equal(supported.status, 0, supported.stdout + supported.stderr);
    assert.equal(await read(calls, 'utf8'), 'flutter pub get --enforce-lockfile\nflutter analyze\nflutter test\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('Packet 0 rejects inconsistent npm lockfiles before install and suppresses web lifecycle hooks', () => {
  const lockfileGate = source.indexOf('== Pre-install lockfile/package contracts ==');
  const installGate = source.indexOf('== Locked clean installs and relevant builds ==');
  assert.ok(lockfileGate > 0 && installGate > lockfileGate, 'all lockfile checks precede npm installation');
  for (const checker of ['check-lockfile.mjs', 'check-backend-lockfile.mjs', 'check-web-lockfile.mjs']) {
    assert.ok(source.slice(lockfileGate, installGate).includes(checker), `missing ${checker} before npm install`);
  }
  assert.match(source, /if \(\( lockfile_structure_ok == 1 \)\); then/);
  assert.match(source, /web\) install_cmd=\(npm ci --prefix web --ignore-scripts\)/);
  assert.doesNotMatch(source, /web\) install_cmd=\(npm ci --prefix web\)/);
});

test('Web lockfile structural check blocks absent/mismatched dependencies without installing packages', async () => {
  const { copyFile, mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const scratch = await mkdtemp(join(tmpdir(), 'nearpill-web-lockfile-gate-'));
  try {
    await mkdir(join(scratch, 'web'), { recursive: true });
    await mkdir(join(scratch, 'scripts'), { recursive: true });
    const checker = join(scratch, 'scripts/check-web-lockfile.mjs');
    await copyFile(new URL('../../scripts/check-web-lockfile.mjs', import.meta.url), checker);
    const manifest = {
      name: '@nearpill/web', version: '0.1.0',
      dependencies: { react: '19.3.1' }, devDependencies: { vite: '8.3.4' },
      engines: { node: '>=24.7.0 <25' },
    };
    await writeFile(join(scratch, 'web/package.json'), JSON.stringify(manifest));
    const run = () => spawnSync(process.execPath, [checker], { cwd: scratch, encoding: 'utf8' });
    const missing = run();
    assert.equal(missing.status, 2, missing.stderr);
    assert.match(missing.stderr, /LOCKFILE BLOCKER/);
    await writeFile(join(scratch, 'web/package-lock.json'), 'null');
    const invalid = run();
    assert.equal(invalid.status, 1, invalid.stderr);
    assert.match(invalid.stderr, /must be a JSON object/);
    const lockfile = { lockfileVersion: 3, packages: { '': {
      name: manifest.name, version: manifest.version,
      dependencies: { react: '19.2.0' }, devDependencies: manifest.devDependencies,
      engines: manifest.engines,
    } } };
    await writeFile(join(scratch, 'web/package-lock.json'), JSON.stringify(lockfile));
    const mismatch = run();
    assert.equal(mismatch.status, 1, mismatch.stderr);
    assert.match(mismatch.stderr, /dependencies does not match/);
    lockfile.packages[''].dependencies = manifest.dependencies;
    await writeFile(join(scratch, 'web/package-lock.json'), JSON.stringify(lockfile));
    const match = run();
    assert.equal(match.status, 0, match.stderr);
    assert.match(match.stdout, /structurally aligned/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('Root and backend preinstall lockfile gates reject missing, malformed, and divergent manifests', async () => {
  const { copyFile, mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const scratch = await mkdtemp(join(tmpdir(), 'nearpill-all-lockfile-gates-'));
  try {
    await mkdir(join(scratch, 'scripts'));
    await mkdir(join(scratch, 'backend'));
    for (const surface of ['root', 'backend']) {
      const name = surface === 'root' ? 'check-lockfile.mjs' : 'check-backend-lockfile.mjs';
      const directory = surface === 'root' ? scratch : join(scratch, 'backend');
      await copyFile(new URL(`../../scripts/${name}`, import.meta.url), join(scratch, 'scripts', name));
      const manifest = {
        name: surface === 'root' ? 'nearpill-root' : 'nearpill-backend',
        version: '0.1.0',
        dependencies: { bravo: '2.0.0', alpha: '1.0.0' },
        devDependencies: { other: '4.0.0', tools: '3.0.0' },
        engines: { node: '>=24.7.0 <25', npm: '>=11 <12' },
      };
      await writeFile(join(directory, 'package.json'), JSON.stringify(manifest));
      const run = () => spawnSync(process.execPath, [join(scratch, 'scripts', name)], {
        cwd: scratch, encoding: 'utf8',
      });
      assert.equal(run().status, 2, `${surface}: absent lockfile must block`);
      await writeFile(join(directory, 'package-lock.json'), 'null');
      assert.equal(run().status, 1, `${surface}: null lockfile must fail closed`);
      const lockfile = { lockfileVersion: 3, packages: { '': {
        name: manifest.name, version: manifest.version,
        // Object key insertion order does not change package dependency identity.
        dependencies: { alpha: '1.0.0', bravo: '2.0.0' },
        devDependencies: { tools: '3.0.0', other: '4.0.0' },
        engines: { npm: '>=11 <12', node: '>=24.7.0 <25' },
      } } };
      const check = async (expected, message) => {
        await writeFile(join(directory, 'package-lock.json'), JSON.stringify(lockfile));
        const result = run();
        assert.equal(result.status, expected, `${surface}: ${message}\n${result.stdout}\n${result.stderr}`);
      };
      await check(0, 'reordered equivalent dependency maps must be accepted');
      lockfile.packages[''].dependencies.alpha = '9.0.0';
      await check(1, 'changed production dependency must be rejected');
      lockfile.packages[''].dependencies.alpha = '1.0.0';
      lockfile.packages[''].name = 'different-application';
      await check(1, 'changed package identity must be rejected');
      lockfile.packages[''].name = manifest.name;
      lockfile.packages[''].engines.node = '<21';
      await check(1, 'changed runtime engine must be rejected');
      lockfile.packages[''].engines.node = manifest.engines.node;
      lockfile.packages[''].devDependencies.extra = '1.0.0';
      await check(1, 'unexpected development dependency must be rejected');
      delete lockfile.packages[''].devDependencies.extra;
      delete lockfile.packages[''];
      await check(1, 'missing root lockfile package must be rejected');
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('Packet 0 TAP guard rejects skipped characterization, even when Node test runner exits zero', async () => {
  const { mkdtemp, mkdir, rm, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const guard = fileURLToPath(new URL('../../scripts/run-packet0-tests.mjs', import.meta.url));
  const root = await mkdtemp(join(tmpdir(), 'nearpill-tap-attestation-'));
  try {
    await mkdir(join(root, 'backend/test'), { recursive: true });
    const file = 'backend/test/packet0-fixture.test.mjs';
    const fixture = join(root, file);
    const run = () => spawnSync(process.execPath, [guard, file], {
      cwd: root, encoding: 'utf8', timeout: 20000,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')),
    });
    await writeFile(fixture, 'import test from "node:test"; test.skip("critical RLS negative skipped", () => {});\n');
    const skippedOnly = run();
    assert.equal(skippedOnly.status, 1, skippedOnly.stdout + skippedOnly.stderr);
    assert.match(skippedOnly.stderr, /skipped=1/);
    await writeFile(fixture, 'import test from "node:test"; test("good", () => {}); test.skip("security negative skipped", () => {});\n');
    const mixed = run();
    assert.equal(mixed.status, 1, mixed.stdout + mixed.stderr);
    assert.match(mixed.stderr, /skipped=1/);
    await writeFile(fixture, 'import test from "node:test"; test("verified", () => {});\n');
    const accepted = run();
    assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
    assert.match(accepted.stdout, /TAP attests 1\/1 executed tests/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('supported-runtime Node baseline TAP guard rejects skipped contracts despite zero child exit', async () => {
  const { mkdtemp, mkdir, rm, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const guard = fileURLToPath(new URL('../../scripts/run-packet0-tests.mjs', import.meta.url));
  const root = await mkdtemp(join(tmpdir(), 'nearpill-remaining-tap-attestation-'));
  try {
    await mkdir(join(root, 'backend/test'), { recursive: true });
    await mkdir(join(root, 'test'), { recursive: true });
    const backendFile = 'backend/test/remaining-fixture.test.mjs';
    const rootFile = 'test/root-fixture.test.cjs';
    const run = (...files) => spawnSync(process.execPath, [guard, '--baseline', ...files], {
      cwd: root, encoding: 'utf8', timeout: 20000,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')),
    });
    await writeFile(join(root, backendFile), 'import test from "node:test"; test("backend pass", () => {});\n');
    await writeFile(join(root, rootFile), 'const test = require("node:test"); test.skip("root security contract skipped", () => {});\n');
    const mixed = run(backendFile, rootFile);
    assert.equal(mixed.status, 1, mixed.stdout + mixed.stderr);
    assert.match(mixed.stderr, /skipped=1/);
    await writeFile(join(root, rootFile), 'const test = require("node:test"); test("root pass", () => {});\n');
    const pass = run(backendFile, rootFile);
    assert.equal(pass.status, 0, pass.stdout + pass.stderr);
    assert.match(pass.stdout, /Remaining Node baseline TAP attests 2\/2 executed tests/);
    const noncanonical = run('backend/test/packet0-unsafe.test.mjs');
    assert.equal(noncanonical.status, 1, noncanonical.stderr);
    assert.match(noncanonical.stderr, /canonical remaining/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('unsupported-runtime Node subset is PARTIAL, never PASS, with skipped contracts', async () => {
  const { mkdtemp, mkdir, rm, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const guard = fileURLToPath(new URL('../../scripts/run-packet0-tests.mjs', import.meta.url));
  const root = await mkdtemp(join(tmpdir(), 'nearpill-partial-tap-attestation-'));
  try {
    await mkdir(join(root, 'backend/test'), { recursive: true });
    await mkdir(join(root, 'test'), { recursive: true });
    const backendFile = 'backend/test/remaining-fixture.test.mjs';
    const rootFile = 'test/root-fixture.test.cjs';
    const run = (...files) => spawnSync(process.execPath, [guard, '--partial-baseline', ...files], {
      cwd: root, encoding: 'utf8', timeout: 20000,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')),
    });
    await writeFile(join(root, backendFile), 'import test from "node:test"; test("runs", () => {});\n');
    await writeFile(join(root, rootFile), 'const test = require("node:test"); test.skip("Node 24-only", () => {});\n');
    const mixed = run(backendFile, rootFile);
    assert.equal(mixed.status, 0, mixed.stdout + mixed.stderr);
    assert.match(mixed.stdout, /PARTIAL: unsupported-runtime Node subset: 1\/2 passed, 1 skipped/);
    assert.doesNotMatch(mixed.stdout, /PASS:.*TAP attests/);
    await writeFile(join(root, backendFile), 'import test from "node:test"; test.skip("also skipped", () => {});\n');
    const allSkipped = run(backendFile, rootFile);
    assert.equal(allSkipped.status, 1, allSkipped.stdout + allSkipped.stderr);
    await writeFile(join(root, backendFile), 'import test from "node:test"; test("fails", () => { throw new Error("failure"); });\n');
    const failure = run(backendFile, rootFile);
    assert.equal(failure.status, 1, failure.stdout + failure.stderr);
    const invalid = run('backend/test/packet0-wrong.test.mjs');
    assert.equal(invalid.status, 1, invalid.stderr);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('first-party JS syntax gate checks optional infrastructure, GitHub automation, and Android JS', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'nearpill-packet0-adjacent-js-'));
  try {
    for (const required of ['backend', 'web', 'scripts', 'test']) await mkdir(join(root, required));
    await writeFile(join(root, 'backend/valid.mjs'), 'export const valid = true;\n');
    const syntaxGate = fileURLToPath(new URL('../../scripts/check-js-syntax.mjs', import.meta.url));
    // These are optional source roots; a missing one must not block the
    // existing minimal baseline, but any present JS must be parsed.
    const initial = spawnSync(process.execPath, [syntaxGate], { cwd: root, encoding: 'utf8' });
    assert.equal(initial.status, 0, initial.stdout + initial.stderr);
    for (const directory of ['infra', '.github/scripts', 'android/tooling']) {
      await mkdir(join(root, directory), { recursive: true });
      const broken = join(root, directory, 'unsafe.mjs');
      await writeFile(broken, 'export const broken = ;\n');
      const scanned = spawnSync(process.execPath, [syntaxGate], { cwd: root, encoding: 'utf8' });
      assert.equal(scanned.status, 1,
        `malformed first-party JS in ${directory} must fail syntax acceptance: ${scanned.stdout}\n${scanned.stderr}`);
      await rm(broken);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('nested first-party characterization and baseline tests are mandatory', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'nearpill-nested-test-inventory-'));
  const runner = fileURLToPath(new URL('../../scripts/run-packet0-tests.mjs', import.meta.url));
  try {
    await mkdir(join(root, 'backend/test/identity'), { recursive: true });
    await mkdir(join(root, 'test/features'), { recursive: true });
    const files = [
      'backend/test/identity/packet0-nested.test.mjs',
      'backend/test/identity/contract-nested.test.mjs',
      'test/features/root-nested.test.mjs',
    ];
    for (const file of files) {
      await writeFile(join(root, file), `import test from 'node:test'; test('nested check', () => {});\n`);
    }
    const run = (...args) => spawnSync(process.execPath, [runner, ...args], {
      cwd: root, encoding: 'utf8', timeout: 20000,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')),
    });
    const packet = run(files[0]);
    assert.equal(packet.status, 0, packet.stdout + packet.stderr);
    assert.match(packet.stdout, /Packet 0 TAP attests 1\/1 executed tests/);
    const baseline = run('--baseline', files[1], files[2]);
    assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
    assert.match(baseline.stdout, /Remaining Node baseline TAP attests 2\/2 executed tests/);
    await writeFile(join(root, files[0]), `import test from 'node:test'; test.skip('not executed', () => {});\n`);
    const skipped = run(files[0]);
    assert.equal(skipped.status, 1, 'skipped nested characterization must block acceptance');
    assert.match(source, /globstar/);
    assert.match(source, /backend\/test\/\*\*\/packet0-/);
    assert.match(source, /for file in test\/\*\*\/\*\.test\.mjs/);
    assert.equal(run('backend/test/identity/../packet0-nested.test.mjs').status, 1,
      'test inventory must reject a non-canonical traversal path');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


// Reviewed first-party files under dot-prefixed feature directories are part
// of the canonical source manifest. Bash globstar does not traverse those
// directories unless dotglob is enabled, creating a silent coverage gap.
posixTest('recursive Node test discovery includes reviewed dot-prefixed feature directories', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const scratch = await mkdtemp(join(tmpdir(), 'nearpill-hidden-node-tests-'));
  try {
    for (const directory of ['backend/test/.identity', 'backend/test/visible', 'test/.security']) {
      await mkdir(join(scratch, directory), { recursive: true });
    }
    const expected = [
      'backend/test/.identity/packet0-session.test.mjs',
      'backend/test/visible/packet0-public.test.cjs',
      'backend/test/.identity/authorization.test.js',
      'test/.security/authorization.test.mjs',
    ];
    for (const file of expected) await writeFile(join(scratch, file), "export const reviewed = true;\n");

    // Execute the actual shell options from the verifier, not a separately
    // maintained approximation. Test all three existing discovery patterns.
    const optionLine = source.split('\n').find((line) => /^\s*shopt -s globstar nullglob/.test(line));
    assert.ok(optionLine, 'Packet 0 verifier must enable recursive nullglob discovery');
    const discovered = spawnSync('bash', ['-c', `${optionLine}
for f in backend/test/**/packet0-*.test.mjs backend/test/**/packet0-*.test.cjs backend/test/**/packet0-*.test.js backend/test/**/*.test.mjs backend/test/**/*.test.cjs backend/test/**/*.test.js test/**/*.test.mjs test/**/*.test.cjs test/**/*.test.js; do
  [[ -f "$f" ]] && printf '%s\\n' "$f"
done`], {
      cwd: scratch, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(discovered.status, 0, discovered.stderr);
    const found = new Set(discovered.stdout.trim().split('\n'));
    for (const file of expected) {
      assert.ok(found.has(file), `reviewed hidden-directory test omitted from Node baseline: ${file}`);
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

// Node's built-in test runner reports a test module with zero registered
// `node:test` cases as a passing file-level subtest. Packet 0 must not accept
// that wrapper as proof that an auth/security characterization ran.
test('Packet 0 TAP attestation rejects empty test modules in every verification mode', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const root = await mkdtemp(join(tmpdir(), 'nearpill-empty-node-case-'));
  const runner = fileURLToPath(new URL('../../scripts/run-packet0-tests.mjs', import.meta.url));
  try {
    await mkdir(join(root, 'backend/test'), { recursive: true });
    await mkdir(join(root, 'test'), { recursive: true });
    const packetFile = 'backend/test/packet0-empty.test.mjs';
    const otherFile = 'test/empty.test.cjs';
    const passingFile = 'test/meaningful.test.mjs';
    await writeFile(join(root, packetFile), 'export const noTests = true;\n');
    await writeFile(join(root, otherFile), 'module.exports = { noTests: true };\n');
    await writeFile(join(root, passingFile), "import test from 'node:test'; test('real assertion', () => {});\n");
    const run = (...args) => spawnSync(process.execPath, [runner, ...args], {
      cwd: root, encoding: 'utf8', timeout: 15000,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')),
    });
    for (const inputs of [
      [packetFile],
      ['--baseline', passingFile, otherFile],
      ['--partial-baseline', passingFile, otherFile],
    ]) {
      const result = run(...inputs);
      assert.equal(result.status, 1, `empty test module must never be a characterization pass: ${result.stdout}${result.stderr}`);
      assert.match(result.stderr, /empty|no registered|file-level/i);
      assert.doesNotMatch(result.stdout, /PASS:.*TAP attests/);
    }
    const meaningful = run('--baseline', passingFile);
    assert.equal(meaningful.status, 0, meaningful.stdout + meaningful.stderr);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Packet 0 runner attests every file in bounded batches and rejects a later skip', async () => {
  const { mkdtemp, mkdir, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'nearpill-packet0-batches-'));
  const runner = fileURLToPath(new URL('../../scripts/run-packet0-tests.mjs', import.meta.url));
  const files = Array.from({ length: 19 }, (_, i) => `backend/test/packet0-batch-${String(i).padStart(2, '0')}.test.mjs`);
  const run = () => spawnSync(process.execPath, [runner, ...files], {
    cwd: root, encoding: 'utf8', timeout: 60000,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')),
  });
  try {
    await mkdir(join(root, 'backend/test'), { recursive: true });
    for (const file of files) await writeFile(join(root, file), "import test from 'node:test'; test('fixture', () => {});\n");
    const successful = run();
    assert.equal(successful.status, 0, successful.stderr + successful.stdout);
    // A 19-file inventory must be split into three small batches, not two
    // 18-file groups that have repeatedly exceeded the watchdog on this host.
    assert.match(successful.stdout, /Packet 0 batch 1\/3/);
    assert.match(successful.stdout, /Packet 0 batch 2\/3/);
    assert.match(successful.stdout, /Packet 0 batch 3\/3/);
    assert.match(successful.stdout, /Packet 0 TAP attests 19\/19 executed tests/);
    await writeFile(join(root, files.at(-1)), "import test from 'node:test'; test.skip('security', () => {});\n");
    const skipped = run();
    assert.equal(skipped.status, 1, skipped.stdout + skipped.stderr);
    assert.doesNotMatch(skipped.stdout, /PASS: Packet 0 TAP attests/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Packet 0 runner fails closed on a stalled batch and never attests later batches', async () => {
  const { mkdtemp, mkdir, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'nearpill-packet0-hung-batch-'));
  const runner = fileURLToPath(new URL('../../scripts/run-packet0-tests.mjs', import.meta.url));
  const stuck = 'backend/test/packet0-never-finishes.test.mjs';
  const later = 'backend/test/packet0-later.test.mjs';
  try {
    await mkdir(join(root, 'backend/test'), { recursive: true });
    await writeFile(join(root, stuck), "import test from 'node:test'; test('blocked', async () => { await new Promise((resolve) => setTimeout(resolve, 8000)); });\n");
    await writeFile(join(root, later), "import test from 'node:test'; test('later', () => {});\n");
    const run = spawnSync(process.execPath, [runner, stuck, later], {
      cwd: root, encoding: 'utf8', timeout: 3500,
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')),
        NEARPILL_PACKET0_BATCH_TIMEOUT_MS: '900' },
    });
    assert.equal(run.status, 1, `the runner must reject a hung batch itself, not be killed by its caller: ${run.error?.message ?? ''} ${run.stderr}`);
    assert.match(run.stderr + run.stdout, /batch 1.*(?:deadline|timed out)/i);
    assert.doesNotMatch(run.stdout, /PASS: Packet 0 TAP attests/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
