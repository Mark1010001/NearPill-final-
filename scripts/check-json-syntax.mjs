#!/usr/bin/env node
// Packet 0: parse all first-party JSON configuration/data with no dependencies.
// This is a syntax and byte-encoding check, not a schema/business-policy check.
// Generated build/test caches are excluded, just as in the source manifest.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ignoredDirectories = new Set([
  '.git', 'node_modules', '.dart_tool', '.gradle', '.idea', '.next',
  '.turbo', '.vercel', 'dist', 'build', 'coverage',
]);
const generatedWebDirs = new Set([
  'web/playwright-report', 'web/test-results', 'web/playwright/.auth',
]);
const decoder = new TextDecoder('utf-8', { fatal: true });
const jsonPaths = [];
let failed = false;

async function collect(directory = '') {
  for (const entry of await readdir(directory || '.', { withFileTypes: true })) {
    const relative = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name) && !generatedWebDirs.has(relative)) await collect(relative);
    } else if (entry.isSymbolicLink()) {
      // A symlinked JSON configuration could introduce unreviewed external
      // bytes. Manifest verification also rejects symlinks; fail closed here.
      console.error(`FAIL: symlink in first-party source: ${relative}`);
      failed = true;
    } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.json') {
      jsonPaths.push(relative);
    } else if (entry.name.toLowerCase().endsWith('.json') && !entry.isFile()) {
      console.error(`FAIL: unsupported JSON source entry: ${relative}`);
      failed = true;
    }
  }
}

try {
  await collect();
} catch (error) {
  console.error(`FAIL: cannot enumerate first-party JSON files (${error.code || 'I/O error'}).`);
  failed = true;
}

for (const file of jsonPaths.sort()) {
  try {
    const bytes = await readFile(file);
    // TextDecoder strips a leading UTF-8 BOM by default. Keep source bytes
    // unambiguous: Node's direct UTF-8 read + JSON.parse would reject it.
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      throw new Error('UTF-8 BOM is not permitted in first-party JSON');
    }
    const text = decoder.decode(bytes);
    JSON.parse(text);
  } catch {
    // Do not echo parser exceptions containing fragments of configuration,
    // since source/security logs may be distributed beyond local machines.
    console.error(`FAIL: invalid JSON or UTF-8 in first-party file: ${file}`);
    failed = true;
  }
}
if (jsonPaths.length === 0) {
  console.error('FAIL: no first-party JSON files discovered; refusing empty gate.');
  failed = true;
}
if (failed) process.exitCode = 1;
else console.log(`PASS: parsed ${jsonPaths.length} first-party JSON files.`);
