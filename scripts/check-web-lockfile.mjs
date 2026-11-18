#!/usr/bin/env node
// Packet 0 pre-install contract only. This is not a dependency provenance or
// vulnerability attestation; the canonical source manifest and secret scan
// provide separate checks before this file may be executed.
import { readFile } from 'node:fs/promises';

const packageUrl = new URL('../web/package.json', import.meta.url);
const lockUrl = new URL('../web/package-lock.json', import.meta.url);

const manifest = JSON.parse(await readFile(packageUrl, 'utf8'));
let lock;
try {
  lock = JSON.parse(await readFile(lockUrl, 'utf8'));
} catch (error) {
  if (error?.code === 'ENOENT') {
    console.error('LOCKFILE BLOCKER: web/package-lock.json is required for reproducible npm ci.');
    process.exitCode = 2;
  } else {
    console.error(`LOCKFILE FAILURE: web/package-lock.json cannot be parsed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (lock !== undefined) {
  const failures = [];
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) {
    console.error('LOCKFILE FAILURE: web lockfile must be a JSON object.');
    process.exitCode = 1;
  }

  const root = lock && typeof lock === 'object' && !Array.isArray(lock) ? lock.packages?.[''] : undefined;
  if (!Number.isInteger(lock?.lockfileVersion) || lock.lockfileVersion < 3) {
    failures.push('web lockfile must use npm lockfileVersion 3 or newer.');
  }
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    failures.push('web lockfile must contain the root package entry.');
  } else {
    for (const key of ['name', 'version', 'dependencies', 'devDependencies', 'engines']) {
      const fromManifest = manifest[key] ?? (key === 'dependencies' || key === 'devDependencies' ? {} : null);
      const fromLock = root[key] ?? (key === 'dependencies' || key === 'devDependencies' ? {} : null);
      // npm lockfiles can reorder keys without changing dependency identity.
      const comparable = (value) => value && typeof value === 'object' && !Array.isArray(value)
        ? JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
        : JSON.stringify(value);
      if (comparable(fromManifest) !== comparable(fromLock)) {
        failures.push(`web lockfile root ${key} does not match web/package.json.`);
      }
    }
  }
  if (failures.length) {
    for (const failure of failures) console.error(`LOCKFILE FAILURE: ${failure}`);
    process.exitCode = 1;
  } else if (process.exitCode !== 1) {
    console.log(`PASS: web package-lock.json structurally aligned (lockfileVersion ${lock.lockfileVersion}).`);
  }
}
