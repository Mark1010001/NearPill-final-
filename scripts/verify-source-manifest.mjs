#!/usr/bin/env node
// Packet 0 baseline lock: verify both source bytes AND the complete first-party file set.
// A plain `sha256sum -c` detects tampered/listed files, but not newly introduced files.
// This is a reproducibility check, not a cryptographic signature or deployment attestation.
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestRelative = 'docs/packet0-source-manifest-2026-10-21.sha256';
const ignoredDirs = new Set([
  '.git', '.dart_tool', '.gradle', '.idea', '.next', 'node_modules',
  'dist', 'build', 'coverage', '.turbo', '.vercel',
]);
// Browser test runs can create private auth/session artifacts in these paths.
// They are generated output, never reviewable first-party source.
const generatedWebDirs = new Set([
  'web/playwright-report', 'web/test-results', 'web/playwright/.auth',
]);
// Excluding a generated directory by its basename is safe at normal build
// output locations, not inside executable first-party source/test trees.
// Otherwise backend/src/build/payload.mjs could execute without a reviewed
// manifest entry. Treat these nested directories as violations rather than
// ignoring them (or silently adding them to the package).
const reviewedRuntimeSubtrees = [
  'backend/src', 'backend/scripts', 'backend/test', 'backend/postgres',
  'backend/migrations', // canonical Drizzle/PostgreSQL SQL migration history
  'backend/public', // Hono-served password recovery assets
  'web/src', 'web/public', 'web/test', 'web/tests', 'web/e2e',
  'lib', 'assets', // Flutter sources and declared bundled image assets
  'scripts', 'test', 'infra', 'android/app/src',
  '.github/workflows', '.github/actions', '.github/scripts',
];
// Reject names that normal Windows tools cannot create or extract reliably.
function nonportableWindowsName(name) {
  return /[<>:"/\\|?*\x00-\x1f]/u.test(name) ||
    /[. ]$/u.test(name) ||
    /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(name);
}
function inReviewedRuntimeSubtree(relativePath) {
  return reviewedRuntimeSubtrees.some((prefix) => relativePath.startsWith(`${prefix}/`));
}

// Keep the canonical reviewed-source inventory aligned with packaging's
// global ZIP exclusions. Otherwise a hash-valid .log/Finder/analyzer artifact
// can be in the manifest but omitted by zip and by the archive parity diff.
// The known Packet 0 evidence logs remain excluded by `excluded` below.
function excludedFromSourcePackage(path) {
  const name = path.split('/').at(-1);
  return name.endsWith('.log') || name === '.DS_Store' || name === 'analyze-output.txt';
}

function excluded(path) {
  if (path === manifestRelative || path === 'NearPill_Master_In_Place_Whole_Codebase_Refactor_Engineering_Plan_2026-10-17.md') return true;
  if (/^packet0-verification-\d{4}-\d{2}-\d{2}[^/]*\.log$/.test(path)) return true;
  if (/^docs\/packet0-verification-\d{4}-\d{2}-\d{2}[^/]*\.(?:txt|log)$/.test(path)) return true;
  if (/^docs\/packet0-source-integrity-\d{4}-\d{2}-\d{2}[^/]*\.log$/.test(path)) return true;
  if (/^docs\/packet0-manifest-check-\d{4}-\d{2}-\d{2}[^/]*\.txt$/.test(path)) return true;
  return false;
}

async function sourceFiles() {
  const files = [];
  async function walk(directory) {
    const entries = await readdir(join(root, directory), { withFileTypes: true });
    // A source ZIP verified on Linux can overwrite one of two reviewed files
    // when extracted onto default case-insensitive Windows filesystems.
    // Check siblings, including directories, before applying exclusions.
    const portableNames = new Map();
    for (const entry of entries) {
      const portableName = entry.name.normalize('NFC').toLowerCase();
      const previous = portableNames.get(portableName);
      if (previous !== undefined && previous !== entry.name) {
        throw new Error(`case-insensitive source name collision: ${directory || '.'}/${previous} vs ${entry.name}`);
      }
      portableNames.set(portableName, entry.name);
      if (nonportableWindowsName(entry.name)) {
        throw new Error(`non-portable Windows source name: ${directory || '.'}/${entry.name}`);
      }
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (path.includes('\n') || path.includes('\r')) throw new Error(`unsupported newline in file name: ${JSON.stringify(path)}`);
      if (excluded(path)) continue;
      if (excludedFromSourcePackage(path)) {
        throw new Error(`unpackaged reviewed source is excluded from source package: ${path}`);
      }
      if (entry.isSymbolicLink()) throw new Error(`symbolic link in first-party source: ${path}`);
      if (entry.isDirectory()) {
        if (ignoredDirs.has(entry.name) && inReviewedRuntimeSubtree(path)) {
          throw new Error(`excluded generated directory inside first-party source: ${path}`);
        }
        if (!ignoredDirs.has(entry.name) && !generatedWebDirs.has(path)) await walk(path);
      } else if (entry.isFile()) {
        files.push(path);
      } else {
        throw new Error(`unsupported source entry type: ${path}`);
      }
    }
  }
  await walk('');
  return files.sort();
}

function parseManifest(contents) {
  const records = new Map();
  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    if (!line || line.startsWith('#')) continue;
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match) throw new Error(`invalid manifest line ${index + 1}`);
    const path = match[2];
    if (path.startsWith('/') || path.startsWith('./') || path.includes('\\') ||
      path.split('/').some((part) => part === '' || part === '..' || part === '.') || excluded(path)) {
      throw new Error(`unsafe or excluded manifest path on line ${index + 1}: ${path}`);
    }
    // Windows device names must keep their stronger diagnostic, even when
    // their extension also happens to be excluded by the source packager.
    if (excludedFromSourcePackage(path) && !path.split('/').some(nonportableWindowsName)) {
      throw new Error(`manifest path excluded from source package on line ${index + 1}: ${path}`);
    }
    if (records.has(path)) throw new Error(`duplicate manifest entry: ${path}`);
    records.set(path, match[1]);
  }
  if (!records.size) throw new Error('empty source manifest');
  return records;
}

async function main() {
  const manifestBytes = await readFile(join(root, manifestRelative));
  const expected = parseManifest(manifestBytes.toString('utf8'));
  const actual = await sourceFiles();
  const actualSet = new Set(actual);
  const untracked = actual.filter((file) => !expected.has(file));
  const absent = [...expected.keys()].filter((file) => !actualSet.has(file)).sort();
  const modified = [];
  for (const path of actual) {
    if (!expected.has(path)) continue;
    const digest = createHash('sha256').update(await readFile(join(root, path))).digest('hex');
    if (digest !== expected.get(path)) modified.push(path);
  }
  if (untracked.length || absent.length || modified.length) {
    for (const path of untracked) console.error(`UNTRACKED: ${path}`);
    for (const path of absent) console.error(`MISSING: ${path}`);
    for (const path of modified) console.error(`CHANGED: ${path}`);
    throw new Error(`source manifest mismatch: ${untracked.length} untracked, ${absent.length} missing, ${modified.length} changed`);
  }
  const manifestHash = createHash('sha256').update(manifestBytes).digest('hex');
  console.log(`PASS: ${actual.length} first-party files match the complete SHA-256 manifest (manifest sha256 ${manifestHash}).`);
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
