import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { posixTest } from './helpers/posix.mjs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const runtime = await readFile(new URL('scripts/check-runtime.mjs', root), 'utf8');
const runner = await readFile(new URL('scripts/verify-packet0.sh', root), 'utf8');

// Exercise the real policy functions without replacing process.versions or
// weakening any production runtime check via test-only environment switches.
const parseSource = runtime.match(/function parseVersion\(value\) \{[\s\S]*?\n\}/)?.[0];
const compareSource = runner.match(/version_ge\(\) \{[\s\S]*?\n\}/)?.[0];

test('standalone runtime rejects Node/npm prereleases and malformed version suffixes', () => {
  assert.ok(parseSource, 'runtime must expose its existing version parser');
  const parseVersion = vm.runInNewContext(`(${parseSource})`);
  assert.deepEqual(Array.from(parseVersion('v24.7.0')), [24, 7, 0]);
  assert.deepEqual(Array.from(parseVersion('11.19.1')), [11, 19, 1]);
  for (const version of ['24.7.0-rc.1', 'v24.7.0-preview', '24.7.0junk', '11.19.1-beta.1']) {
    assert.throws(() => parseVersion(version), /Invalid semantic version/, `unsafe version accepted: ${version}`);
  }
  assert.match(runtime, /parseVersion\(npmBinaryVersion\)/, 'actual npm executable version must use the same strict parser');
  assert.doesNotMatch(runtime, /npmVersionMatch\[1\]/, 'caller-supplied user-agent cannot be npm authority');
});

posixTest('Packet 0 runtime comparison rejects prerelease Node and malformed versions', () => {
  assert.ok(compareSource, 'Packet 0 runtime comparison function must exist');
  const checked = spawnSync('bash', ['-c', `${compareSource}\nversion_ge "$1" "24.7.0"`, 'bash', 'v24.7.0-rc.1'], { encoding: 'utf8' });
  assert.notEqual(checked.status, 0, 'a prerelease must not pass the supported Node gate');
  const stable = spawnSync('bash', ['-c', `${compareSource}\nversion_ge "$1" "24.7.0"`, 'bash', 'v24.7.0'], { encoding: 'utf8' });
  assert.equal(stable.status, 0, stable.stderr);
  const newer = spawnSync('bash', ['-c', `${compareSource}\nversion_ge "$1" "24.7.0"`, 'bash', 'v24.22.0'], { encoding: 'utf8' });
  assert.equal(newer.status, 0, newer.stderr);
  assert.ok(runner.includes(String.raw`^11\.[0-9]+\.[0-9]+$`), 'npm 11 must use exact stable version matching');
});
