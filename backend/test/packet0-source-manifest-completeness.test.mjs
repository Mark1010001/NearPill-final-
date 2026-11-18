import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { posixTest as test } from './helpers/posix.mjs';

const original = new URL('../../scripts/verify-source-manifest.mjs', import.meta.url);
const acceptanceSource = await readFile(new URL('../../scripts/verify-packet0.sh', import.meta.url), 'utf8');
const manifestName = 'packet0-source-manifest-2026-10-21.sha256';
const sha = (text) => createHash('sha256').update(text).digest('hex');

async function withFixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'nearpill-packet0-manifest-'));
  try {
    await mkdir(join(root, 'scripts'));
    await mkdir(join(root, 'docs'));
    await copyFile(original, join(root, 'scripts', 'verify-source-manifest.mjs'));
    await writeFile(join(root, 'package.json'), '{"type":"module"}\n');
    await writeFile(join(root, 'README.md'), 'source baseline\n');
    const files = {
      'README.md': 'source baseline\n',
      'package.json': '{"type":"module"}\n',
    };
    const verifier = await readFile(original);
    const manifest = Object.entries(files)
      .map(([path, text]) => `${sha(text)}  ${path}`);
    manifest.push(`${sha(verifier)}  scripts/verify-source-manifest.mjs`);
    await writeFile(join(root, 'docs', manifestName), `# fixture\n${manifest.join('\n')}\n`);
    const run = () => spawnSync(process.execPath, ['scripts/verify-source-manifest.mjs'], { cwd: root, encoding: 'utf8' });
    await fn({ root, run });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('packet0 acceptance invokes complete source manifest verification', () => {
  assert.match(acceptanceSource, /run_required 'Complete first-party source fingerprint' node scripts\/verify-source-manifest\.mjs/);
});

test('complete source manifest accepts an exact baseline and does not require database access', async () => {
  await withFixture(async ({ run }) => {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /3 first-party files match/);
  });
});

test('complete source manifest rejects unlisted newly added first-party files', async () => {
  await withFixture(async ({ root, run }) => {
    await writeFile(join(root, 'new-module.mjs'), 'export const unexpected = true;\n');
    const result = run();
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.match(result.stderr, /UNTRACKED: new-module\.mjs/);
  });
});

test('portable handoff refuses two manifest-valid files that collide on case-insensitive extraction', async () => {
  await withFixture(async ({ root, run }) => {
    const name = 'readme.MD';
    const value = 'separate file on a case-sensitive host\n';
    await writeFile(join(root, name), value);
    const manifest = join(root, 'docs', manifestName);
    await writeFile(manifest, (await readFile(manifest, 'utf8')) + `${sha(value)}  ${name}\n`);
    const result = run();
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.match(result.stderr, /case-insensitive source name collision/i);
  });
});

test('portable handoff refuses two case-equivalent source directory names', async () => {
  await withFixture(async ({ root, run }) => {
    await mkdir(join(root, 'components'));
    await mkdir(join(root, 'Components'));
    await writeFile(join(root, 'components', 'a.js'), 'export {}\n');
    await writeFile(join(root, 'Components', 'b.js'), 'export {}\n');
    const manifest = join(root, 'docs', manifestName);
    await writeFile(manifest, (await readFile(manifest, 'utf8')) +
      `${sha('export {}\n')}  components/a.js\n${sha('export {}\n')}  Components/b.js\n`);
    const result = run();
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.match(result.stderr, /case-insensitive source name collision/i);
  });
});

test('portable handoff refuses Windows device names, forbidden characters, and trailing dots/spaces', async () => {
  // These are valid Linux source names, but cannot be extracted reliably using
  // normal Windows file APIs. Listing their digests must not make them safe.
  for (const name of ['AUX.txt', 'infra/build:token.txt', 'docs/review. ', 'COM¹.log']) {
    await withFixture(async ({ root, run }) => {
      await mkdir(dirname(join(root, name)), { recursive: true });
      const contents = 'ordinary fixture content\n';
      await writeFile(join(root, name), contents);
      const manifest = join(root, 'docs', manifestName);
      await writeFile(manifest, (await readFile(manifest, 'utf8')) + `${sha(contents)}  ${name}\n`);
      const result = run();
      assert.equal(result.status, 1, `${name} must block source verification: ${result.stdout} ${result.stderr}`);
      assert.match(result.stderr, /non-portable Windows source name/i);
    });
  }
});

test('generated-directory names nested inside runtime source cannot conceal unreviewed modules', async () => {
  for (const name of ['backend/src/build/hidden.mjs', 'web/src/dist/hidden.ts', 'lib/node_modules/hidden.dart']) {
    await withFixture(async ({ root, run }) => {
      await mkdir(dirname(join(root, name)), { recursive: true });
      await writeFile(join(root, name), 'export const unreviewed = true;\n');
      const result = run();
      assert.equal(result.status, 1, `${name} must block source verification: ${result.stdout} ${result.stderr}`);
      assert.match(result.stderr, /excluded generated directory inside first-party source/);
    });
  }
});

test('generated-name directories in canonical migrations and served/bundled assets cannot bypass the manifest', async () => {
  // backend/public reset assets are served by Hono; web/public is emitted by
  // Vite and assets/images is packaged by Flutter. These are runtime inputs.
  for (const name of [
    'backend/migrations/postgres/dist/hidden.sql',
    'backend/public/dist/hidden.js',
    'web/public/build/hidden.js',
    'assets/images/node_modules/hidden.js',
  ]) {
    await withFixture(async ({ root, run }) => {
      await mkdir(dirname(join(root, name)), { recursive: true });
      await writeFile(join(root, name), 'export const unreviewed = true;\n');
      const result = run();
      assert.equal(result.status, 1, `${name} must block source verification: ${result.stdout} ${result.stderr}`);
      assert.match(result.stderr, /excluded generated directory inside first-party source/);
    });
  }
});

test('unreviewed generated-name directories inside local CI actions are not source exclusions', async () => {
  // Local GitHub actions can execute a checked-in dist/index.js directly.
  // They are not interchangeable with disposable root or web build output.
  for (const name of ['.github/actions/check/dist/index.js', '.github/scripts/build/node_modules/runner.js']) {
    await withFixture(async ({ root, run }) => {
      await mkdir(dirname(join(root, name)), { recursive: true });
      await writeFile(join(root, name), 'export const unexpected = true;\n');
      const result = run();
      assert.equal(result.status, 1, `${name} must block source verification: ${result.stdout} ${result.stderr}`);
      assert.match(result.stderr, /excluded generated directory inside first-party source/);
    });
  }
});

test('complete source manifest rejects changes to previously listed code', async () => {
  await withFixture(async ({ root, run }) => {
    await writeFile(join(root, 'README.md'), 'tampered content\n');
    const result = run();
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.match(result.stderr, /CHANGED: README\.md/);
  });
});

test('complete source manifest rejects missing source', async () => {
  await withFixture(async ({ root, run }) => {
    await rm(join(root, 'README.md'));
    const result = run();
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.match(result.stderr, /MISSING: README\.md/);
  });
});

test('complete source manifest rejects symlinked source instead of silently skipping it', async () => {
  const { symlink } = await import('node:fs/promises');
  await withFixture(async ({ root, run }) => {
    await symlink(join(root, 'README.md'), join(root, 'linked.md'));
    const result = run();
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.match(result.stderr, /symbolic link in first-party source/);
  });
});

test('complete source manifest refuses duplicate manifest records', async () => {
  await withFixture(async ({ root, run }) => {
    const path = join(root, 'docs', manifestName);
    const text = await readFile(path, 'utf8');
    await writeFile(path, text + `${sha('source baseline\n')}  README.md\n`);
    const result = run();
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.match(result.stderr, /duplicate manifest entry/);
  });
});


test('source packaging requires complete manifest validation before replacing an existing archive', async () => {
  const packaging = await readFile(new URL('../../scripts/package-source.sh', import.meta.url), 'utf8');
  const manifestGate = packaging.indexOf('node scripts/verify-source-manifest.mjs');
  const replacement = packaging.indexOf('mv -f -T -- "$staged_zip"');
  assert.ok(manifestGate >= 0 && manifestGate < replacement, 'the manifest must run before atomic replacement');
  assert.ok(packaging.indexOf('node scripts/secret-scan.mjs') < manifestGate, 'secret scan remains a required first check');
  assert.match(packaging, /unzip -tq "\$staged_zip"/);
  assert.doesNotMatch(packaging, /rm -f "\$OUTPUT"/);
});

test('unreviewed added source blocks real packaging and preserves the prior archive', async () => {
  await withFixture(async ({ root }) => {
    const packagingPath = new URL('../../scripts/package-source.sh', import.meta.url);
    const scannerPath = new URL('../../scripts/secret-scan.mjs', import.meta.url);
    await copyFile(packagingPath, join(root, 'scripts', 'package-source.sh'));
    await copyFile(scannerPath, join(root, 'scripts', 'secret-scan.mjs'));
    const manifestPath = join(root, 'docs', manifestName);
    const manifest = await readFile(manifestPath, 'utf8');
    const packageHash = createHash('sha256').update(await readFile(packagingPath)).digest('hex');
    const scannerHash = createHash('sha256').update(await readFile(scannerPath)).digest('hex');
    await writeFile(manifestPath, manifest + `${packageHash}  scripts/package-source.sh\n${scannerHash}  scripts/secret-scan.mjs\n`);
    await mkdir(join(root, '.git'));
    const archive = join(root, '.git', 'previous.zip');
    await writeFile(archive, 'previous-artifact-must-survive');
    await writeFile(join(root, 'unreviewed.js'), 'export const newCode = true;\n');
    const result = spawnSync('bash', [join(root, 'scripts', 'package-source.sh'), archive], {
      cwd: root, encoding: 'utf8',
    });
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.match(result.stderr, /UNTRACKED: unreviewed\.js/);
    assert.equal(await readFile(archive, 'utf8'), 'previous-artifact-must-survive');
  });
});

// A manifest-valid source must not lose its last good archive when a packaging
// dependency fails after preflight. These tests simulate zip/unzip failures;
// they never access the real database or installed dependency packages.
async function withReviewedPackagingFixture(fn) {
  await withFixture(async ({ root }) => {
    const packagingPath = new URL('../../scripts/package-source.sh', import.meta.url);
    const scannerPath = new URL('../../scripts/secret-scan.mjs', import.meta.url);
    await copyFile(packagingPath, join(root, 'scripts', 'package-source.sh'));
    await copyFile(scannerPath, join(root, 'scripts', 'secret-scan.mjs'));
    const manifestPath = join(root, 'docs', manifestName);
    const manifest = await readFile(manifestPath, 'utf8');
    const packageHash = sha(await readFile(packagingPath));
    const scannerHash = sha(await readFile(scannerPath));
    await writeFile(manifestPath, manifest + `${packageHash}  scripts/package-source.sh\n${scannerHash}  scripts/secret-scan.mjs\n`);
    const destination = await mkdtemp(join(tmpdir(), 'nearpill-packet0-output-'));
    try {
      const archive = join(destination, 'previous.zip');
      await writeFile(archive, 'known-good-archive');
      await fn({ root, destination, archive });
    } finally {
      await rm(destination, { recursive: true, force: true });
    }
  });
}

for (const command of ['zip', 'unzip']) {
  test(`failed ${command} preserves prior source ZIP and cleans staging directory`, async () => {
    await withReviewedPackagingFixture(async ({ root, destination, archive }) => {
      const tools = await mkdtemp(join(tmpdir(), 'nearpill-packet0-tools-'));
      try {
        const program = join(tools, command);
        await writeFile(program, '#!/bin/sh\necho "simulated archive failure" >&2\nexit 23\n');
        await chmod(program, 0o755);
        const result = spawnSync('bash', [join(root, 'scripts', 'package-source.sh'), archive], {
          cwd: root, encoding: 'utf8',
          env: { ...process.env, PATH: `${tools}:${process.env.PATH}` },
        });
        assert.equal(result.status, 23, result.stderr + result.stdout);
        assert.equal(await readFile(archive, 'utf8'), 'known-good-archive');
        const { readdir } = await import('node:fs/promises');
        assert.deepEqual((await readdir(destination)).sort(), ['previous.zip']);
      } finally {
        await rm(tools, { recursive: true, force: true });
      }
    });
  });
}

test('packaging rejects an output inside the application source tree', async () => {
  await withReviewedPackagingFixture(async ({ root }) => {
    const archive = join(root, '.git', 'previous.zip');
    await mkdir(dirname(archive));
    await writeFile(archive, 'known-good-archive');
    const result = spawnSync('bash', [join(root, 'scripts', 'package-source.sh'), archive], {
      cwd: root, encoding: 'utf8',
    });
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.match(result.stderr, /Refusing to package inside the source tree/);
    assert.equal(await readFile(archive, 'utf8'), 'known-good-archive');
  });
});

test('successful packaging atomically replaces a prior archive with an integrity-checked ZIP', async () => {
  await withReviewedPackagingFixture(async ({ root, destination, archive }) => {
    const result = spawnSync('bash', [join(root, 'scripts', 'package-source.sh'), archive], {
      cwd: root, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const check = spawnSync('unzip', ['-tq', archive], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr + check.stdout);
    const extracted = spawnSync('unzip', ['-p', archive, 'README.md'], { encoding: 'utf8' });
    assert.equal(extracted.status, 0, extracted.stderr);
    assert.equal(extracted.stdout, 'source baseline\n');
    const { readdir } = await import('node:fs/promises');
    assert.deepEqual((await readdir(destination)).sort(), ['previous.zip']);
  });
});

// The manifest is intentionally excluded from its own hash list. A concurrent
// edit to BOTH a reviewed file and this manifest can otherwise pass the staged
// recheck, even though these were not the bytes admitted by initial preflight.
test('source package refuses a manifest replaced with a self-consistent new baseline during ZIP creation', async () => {
  await withReviewedPackagingFixture(async ({ root, destination, archive }) => {
    const tools = await mkdtemp(join(tmpdir(), 'nearpill-manifest-swap-tools-'));
    try {
      const zipShim = join(tools, 'zip');
      const fakeZip = [
        '#!/bin/sh',
        'set -eu',
        `printf 'different source after review\\n' > "$NEARPILL_TEST_ROOT/README.md"`,
        'hash=$(/usr/bin/sha256sum "$NEARPILL_TEST_ROOT/README.md")',
        'hash=${hash%% *}',
        `/usr/bin/sed -i "s|^[a-f0-9]\\{64\\}  README.md$|$hash  README.md|" "$NEARPILL_TEST_ROOT/docs/${manifestName}"`,
        'exec /usr/bin/zip "$@"',
      ].join('\n') + '\n';
      await writeFile(zipShim, fakeZip, { mode: 0o755 });
      const result = spawnSync('bash', [join(root, 'scripts/package-source.sh'), archive], {
        cwd: root, encoding: 'utf8', timeout: 20_000,
        env: { ...process.env, PATH: `${tools}:${process.env.PATH}`, NEARPILL_TEST_ROOT: root },
      });
      assert.notEqual(result.status, 0, 'a manifest swapped after preflight must block publication');
      assert.match(result.stderr + result.stdout, /manifest.*changed|reviewed manifest/i);
      assert.equal(await readFile(archive, 'utf8'), 'known-good-archive');
      const { readdir } = await import('node:fs/promises');
      assert.deepEqual((await readdir(destination)).sort(), ['previous.zip']);
    } finally {
      await rm(tools, { recursive: true, force: true });
    }
  });
});

// The rolling Implementation Ledger is intentionally excluded from the
// immutable first-party manifest so this evidence can be updated per run.
// Nevertheless a ZIP must never publish a stale ledger after concurrent edits.
test('source package rejects a rolling ledger changed after zip and preserves the prior artifact', async () => {
  await withReviewedPackagingFixture(async ({ root, destination, archive }) => {
    const ledger = join(root, 'NearPill_Master_In_Place_Whole_Codebase_Refactor_Engineering_Plan_2026-10-17.md');
    await writeFile(ledger, 'ledger at archive creation\n');
    const tools = await mkdtemp(join(tmpdir(), 'nearpill-ledger-race-tools-'));
    try {
      const zipShim = join(tools, 'zip');
      await writeFile(zipShim, [
        '#!/bin/sh',
        '/usr/bin/zip "$@" || exit $?',
        `printf 'ledger changed after archive creation\\n' > "$NEARPILL_TEST_LEDGER"`,
      ].join('\n') + '\n', { mode: 0o755 });
      const result = spawnSync('bash', [join(root, 'scripts', 'package-source.sh'), archive], {
        cwd: root, encoding: 'utf8', timeout: 20_000,
        env: { ...process.env, PATH: `${tools}:${process.env.PATH}`, NEARPILL_TEST_LEDGER: ledger },
      });
      assert.notEqual(result.status, 0, 'a changed rolling ledger must block archive publication');
      assert.match(result.stdout + result.stderr, /byte-for-byte identical|NearPill_Master_/);
      assert.equal(await readFile(archive, 'utf8'), 'known-good-archive');
      const { readdir } = await import('node:fs/promises');
      assert.deepEqual((await readdir(destination)).sort(), ['previous.zip']);
    } finally {
      await rm(tools, { recursive: true, force: true });
    }
  });
});

// A valid preflight is insufficient: zip must not publish bytes that differ
// from the reviewed tree. Inject a file *after* the real zip command runs,
// producing a CRC-valid archive whose contents no longer match the manifest.
for (const [caseName, path, contents, expectedFinding] of [
  ['unreviewed source', 'unexpected.js', 'export const injected = true;\n', /UNTRACKED: unexpected\.js/],
  ['modified reviewed source', 'README.md', 'archive-only tampering\n', /CHANGED: README\.md/],
]) {
  test(`packaging rejects ${caseName} injected into the staged ZIP and preserves old output`, async () => {
    await withReviewedPackagingFixture(async ({ root, destination, archive }) => {
      const tools = await mkdtemp(join(tmpdir(), 'nearpill-packet0-inject-tools-'));
      const injection = await mkdtemp(join(tmpdir(), 'nearpill-packet0-inject-bytes-'));
      try {
        await writeFile(join(injection, path), contents);
        const zipShim = join(tools, 'zip');
        await writeFile(zipShim, '#!/bin/sh\n/usr/bin/zip "$@" || exit $?\ncd "$NEARPILL_TEST_INJECTION_DIR" || exit 1\n/usr/bin/zip -q "$2" "$NEARPILL_TEST_INJECTION_FILE"\n');
        await chmod(zipShim, 0o755);
        const result = spawnSync('bash', [join(root, 'scripts', 'package-source.sh'), archive], {
          cwd: root,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${tools}:${process.env.PATH}`,
            NEARPILL_TEST_INJECTION_DIR: injection,
            NEARPILL_TEST_INJECTION_FILE: path,
          },
        });
        assert.equal(result.status, 1, result.stderr + result.stdout);
        assert.match(result.stderr, expectedFinding);
        assert.equal(await readFile(archive, 'utf8'), 'known-good-archive');
        const { readdir } = await import('node:fs/promises');
        assert.deepEqual((await readdir(destination)).sort(), ['previous.zip']);
      } finally {
        await rm(tools, { recursive: true, force: true });
        await rm(injection, { recursive: true, force: true });
      }
    });
  });
}

// Build and browser tools must not make a reviewed first-party package appear
// to contain new application code, nor leak their output into the handoff.
test('generated web, Android and nested JS outputs do not invalidate the source manifest', async () => {
  await withFixture(async ({ root, run }) => {
    const generated = [
      'web/dist/bundle.js', 'backend/dist/api.js', 'backend/build/output.js',
      'web/playwright-report/index.html', 'web/test-results/results.json',
      'web/playwright/.auth/session.json', '.gradle/cache/manifest.txt',
      '.idea/workspace.xml', '.next/cache/index.js', '.turbo/state.json',
      '.vercel/project.json', 'web/node_modules/dependency/index.js',
    ];
    for (const path of generated) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), 'synthetic generated output\n');
    }
    const result = run();
    assert.equal(result.status, 0, result.stderr + result.stdout);
  });
});

test('generated-directory env files do not falsely block a reviewed source package', async () => {
  await withReviewedPackagingFixture(async ({ root, archive }) => {
    for (const file of [
      'web/dist/.env.generated',
      'backend/node_modules/fixture/.env.local',
      'android/.gradle/.env.cache',
      'web/test-results/.env.browser',
    ]) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), 'DUMMY_NON_SECRET=value\n');
    }
    const result = spawnSync('bash', [join(root, 'scripts', 'package-source.sh'), archive], {
      cwd: root, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const contents = spawnSync('unzip', ['-Z1', archive], { encoding: 'utf8' });
    assert.equal(contents.status, 0, contents.stderr);
    for (const file of [
      'web/dist/.env.generated', 'backend/node_modules/fixture/.env.local',
      'android/.gradle/.env.cache', 'web/test-results/.env.browser',
    ]) {
      assert.ok(!contents.stdout.split('\n').includes(file), `generated file archived: ${file}`);
    }
  });
});

test('packaging excludes generated artifacts but retains reviewed application source', async () => {
  await withReviewedPackagingFixture(async ({ root, archive }) => {
    const generated = [
      'web/dist/bundle.js', 'backend/dist/api.js', 'backend/build/output.js',
      'web/playwright-report/index.html', 'web/test-results/results.json',
      'web/playwright/.auth/session.json', '.gradle/cache/manifest.txt',
      '.idea/workspace.xml', '.next/cache/index.js', '.turbo/state.json',
      '.vercel/project.json', 'web/node_modules/dependency/index.js',
    ];
    for (const path of generated) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), 'synthetic generated output\n');
    }
    const result = spawnSync('bash', [join(root, 'scripts', 'package-source.sh'), archive], {
      cwd: root, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const zipEntries = spawnSync('unzip', ['-Z1', archive], { encoding: 'utf8' });
    assert.equal(zipEntries.status, 0, zipEntries.stderr);
    const entries = zipEntries.stdout.split('\n').filter(Boolean);
    assert.ok(entries.some((entry) => entry === 'README.md'));
    for (const file of generated) {
      assert.ok(!entries.includes(file), `generated output was archived: ${file}`);
    }
  });
});

// The ZIP deliberately omits generated logs/Finder noise and stale analyzer
// output. A reviewed manifest must never approve such an entry: otherwise the
// archive can pass verification while silently omitting a source-listed file.
for (const file of ['backend/src/reviewed.log', 'web/src/.DS_Store', 'analyze-output.txt']) {
  test(`packaging refuses manifest-approved file excluded from ZIP: ${file}`, async () => {
    await withReviewedPackagingFixture(async ({ root, archive }) => {
      await mkdir(dirname(join(root, file)), { recursive: true });
      const contents = 'synthetic reviewed content\n';
      await writeFile(join(root, file), contents);
      const manifest = join(root, 'docs', manifestName);
      await writeFile(manifest, (await readFile(manifest, 'utf8')) + `${sha(contents)}  ${file}\n`);
      const result = spawnSync('bash', [join(root, 'scripts', 'package-source.sh'), archive], {
        cwd: root, encoding: 'utf8', timeout: 20000,
      });
      assert.equal(result.status, 1, `manifest-approved ZIP-excluded source must fail: ${result.stdout} ${result.stderr}`);
      assert.match(result.stdout + result.stderr, /excluded from source package|unpackaged reviewed source/i);
      assert.equal(await readFile(archive, 'utf8'), 'known-good-archive');
    });
  });
}
