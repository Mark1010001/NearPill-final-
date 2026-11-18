import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const checker = new URL('../../scripts/check-json-syntax.mjs', import.meta.url);
const runner = new URL('../../scripts/verify-packet0.sh', import.meta.url);

async function withFixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'nearpill-packet0-json-'));
  try {
    await mkdir(join(root, 'web/public'), { recursive: true });
    await writeFile(join(root, 'package.json'), '{"name":"fixture"}\n');
    const run = () => spawnSync(process.execPath, [fileURLToPath(checker)], { cwd: root, encoding: 'utf8' });
    await fn({ root, run });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('Packet 0 requires the canonical first-party JSON parse gate', async () => {
  const source = await readFile(runner, 'utf8');
  assert.match(source, /run_required 'First-party JSON parse checks' node scripts\/check-json-syntax\.mjs/);
});

test('JSON gate accepts first-party JSON in root and nested web configuration', async () => {
  await withFixture(async ({ root, run }) => {
    await writeFile(join(root, 'web/public/policies.json'), '{"policy":{"allowed":false}}\n');
    const result = run();
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /PASS: parsed 2 first-party JSON files/);
  });
});

test('JSON gate rejects malformed nested web policy configuration', async () => {
  await withFixture(async ({ root, run }) => {
    await writeFile(join(root, 'web/public/policies.json'), '{"allowed": true,,}\n');
    const result = run();
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.match(result.stderr, /web\/public\/policies\.json/);
  });
});

test('JSON gate rejects malformed root package configuration', async () => {
  await withFixture(async ({ root, run }) => {
    await writeFile(join(root, 'package.json'), '{"name":\n');
    const result = run();
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.match(result.stderr, /package\.json/);
  });
});

test('JSON gate excludes dependency and generated JSON files', async () => {
  await withFixture(async ({ root, run }) => {
    await mkdir(join(root, 'backend/node_modules/lib'), { recursive: true });
    await mkdir(join(root, 'web/test-results'), { recursive: true });
    await writeFile(join(root, 'backend/node_modules/lib/generated.json'), '{broken');
    await writeFile(join(root, 'web/test-results/report.json'), '{broken');
    const result = run();
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /PASS: parsed 1 first-party JSON files/);
  });
});

test('JSON gate rejects symlinked JSON configuration rather than following it', async () => {
  await withFixture(async ({ root, run }) => {
    await symlink(join(root, 'package.json'), join(root, 'web/public/linked.json'));
    const result = run();
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.match(result.stderr, /symlink.*web\/public\/linked\.json/i);
  });
});

test('JSON gate rejects non-UTF8 configuration rather than silently replacing bytes', async () => {
  await withFixture(async ({ root, run }) => {
    await writeFile(join(root, 'web/public/policies.json'), Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]));
    const result = run();
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.match(result.stderr, /web\/public\/policies\.json/);
  });
});

test('JSON gate rejects UTF-8 BOM rather than silently normalizing source bytes', async () => {
  await withFixture(async ({ root, run }) => {
    // A default TextDecoder silently strips EF BB BF even though the same
    // bytes fail JSON.parse when read as a Node UTF-8 string.
    await writeFile(join(root, 'web/public/policies.json'),
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"allowed":true}')]));
    const result = run();
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.match(result.stderr, /web\/public\/policies\.json/);
  });
});

test('JSON gate refuses empty source JSON inventory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nearpill-packet0-empty-json-'));
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(checker)], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.match(result.stderr, /no first-party JSON files/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
