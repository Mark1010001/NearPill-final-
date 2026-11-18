import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

function parseVersion(value) {
  const match = String(value)
    .trim()
    .match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`Invalid semantic version: ${value}`);
  return match.slice(1).map(Number);
}

function compare(actual, expected) {
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] !== expected[index]) return actual[index] - expected[index];
  }
  return 0;
}

const minimum = parseVersion('24.7.0');
const pinned = parseVersion((await readFile(new URL('../.nvmrc', import.meta.url), 'utf8')).trim());
let actual;
const failures = [];
try {
  actual = parseVersion(process.versions.node);
} catch {
  failures.push(`Node ${process.versions.node} is not a stable semantic version.`);
}
// npm_config_user_agent is caller-controlled and may claim npm 11 while the
// executable on PATH is npm 10 (or missing). Check the installed binary, as
// the Packet 0 wrapper does, before claiming a supported standalone runtime.
let npmBinaryVersion;
try {
  npmBinaryVersion = execFileSync(
    process.platform === 'win32' ? 'cmd.exe' : 'npm',
    process.platform === 'win32' ? ['/d', '/c', 'npm.cmd --version'] : ['--version'],
    {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  ).trim();
} catch {
  failures.push('npm executable is unavailable or failed its version check.');
}

if (actual && (compare(actual, minimum) < 0 || actual[0] >= 25)) {
  failures.push(`Node ${process.versions.node} is outside supported range >=24.7.0 <25.`);
}
if (actual && actual[0] !== pinned[0]) {
  failures.push(`Node major ${actual[0]} does not match pinned Node ${pinned.join('.')}.`);
}
if (npmBinaryVersion !== undefined) {
  try {
    const npmVersion = parseVersion(npmBinaryVersion);
    if (npmVersion[0] !== 11)
      failures.push(`npm ${npmBinaryVersion} does not satisfy required npm 11.`);
  } catch {
    failures.push('npm executable version must be a stable semantic version.');
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`RUNTIME BLOCKER: ${failure}`);
  process.exitCode = 2;
} else {
  console.log(`PASS: Node ${process.versions.node} satisfies NearPill engineering runtime policy.`);
}
