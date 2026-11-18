import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';

const checker = fileURLToPath(new URL('../../scripts/check-runtime.mjs', import.meta.url));

async function withNpmVersion(output, callback) {
  const directory = await mkdtemp(join(tmpdir(), 'nearpill-npm-runtime-'));
  try {
    const npm = join(directory, process.platform === 'win32' ? 'npm.cmd' : 'npm');
    await writeFile(npm, process.platform === 'win32' ? `@echo ${output}\r\n` : `#!/bin/sh\nprintf '%s\\n' '${output}'\n`);
    await chmod(npm, 0o755);
    const checked = spawnSync(process.execPath, [checker], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${directory}${delimiter}${process.env.PATH || ''}`, npm_config_user_agent: 'npm/11.19.1 node/v24.22.0' },
    });
    await callback(checked);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('standalone runtime must use executable npm version rather than a spoofed user-agent', async () => {
  await withNpmVersion('10.9.2', (checked) => {
    assert.equal(checked.status, 2);
    assert.match(checked.stderr, /npm 10\.9\.2.*required npm 11/i);
  });
});

test('standalone runtime rejects a prerelease npm binary independently of caller metadata', async () => {
  await withNpmVersion('11.19.1-rc.1', (checked) => {
    assert.equal(checked.status, 2);
    assert.match(checked.stderr, /npm.*stable semantic version/i);
  });
});

test('standalone runtime recognizes stable npm 11 but retains the actual Node 24 gate', async () => {
  await withNpmVersion('11.19.1', (checked) => {
    assert.doesNotMatch(checked.stderr, /npm.*(?:required npm 11|stable semantic version)/i);
    if (Number(process.versions.node.split('.')[0]) !== 24) {
      assert.equal(checked.status, 2);
      assert.match(checked.stderr, /Node.*outside supported range/i);
    }
  });
});
