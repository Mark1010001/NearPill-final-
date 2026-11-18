import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../backend/package.json', import.meta.url), 'utf8'));
let lock;
try {
  lock = JSON.parse(await readFile(new URL('../backend/package-lock.json', import.meta.url), 'utf8'));
} catch (error) {
  if (error?.code === 'ENOENT') {
    console.error('LOCKFILE BLOCKER: backend/package-lock.json must be recovered before npm ci, Docker build, or release verification.');
    process.exitCode = 2;
  } else {
    console.error(`LOCKFILE FAILURE: backend/package-lock.json cannot be parsed: ${error.message}`);
    process.exitCode = 1;
  }
}

// A pre-install structural guard, not lockfile provenance or audit evidence.
if (lock !== undefined) {
  const failures = [];
  const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const comparable = (value) => isRecord(value)
    ? JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
    : JSON.stringify(value);
  if (!isRecord(lock)) failures.push('backend lockfile must be a JSON object.');
  if (!Number.isInteger(lock?.lockfileVersion) || lock.lockfileVersion < 3) {
    failures.push('backend lockfile must use npm lockfileVersion 3 or newer.');
  }
  const root = isRecord(lock) ? lock.packages?.[''] : undefined;
  if (!isRecord(root)) {
    failures.push('backend lockfile must contain the root package entry.');
  } else {
    for (const key of ['name', 'version', 'dependencies', 'devDependencies', 'engines']) {
      const fallback = key === 'dependencies' || key === 'devDependencies' ? {} : null;
      if (comparable(root[key] ?? fallback) !== comparable(manifest[key] ?? fallback)) {
        failures.push(`backend lockfile ${key} does not match backend/package.json.`);
      }
    }
  }
  if (failures.length) {
    for (const failure of failures) console.error(`LOCKFILE FAILURE: ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: backend package-lock.json structurally aligned (lockfileVersion ${lock.lockfileVersion}).`);
  }
}
