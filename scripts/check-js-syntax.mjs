import { lstat, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const roots = ['backend', 'web', 'scripts', 'test'];
// These are first-party executable surfaces too, but may be absent in a
// minimal baseline fixture. Treat present ones as required source for syntax.
const optionalRoots = ['infra', '.github', 'android'];
const extensions = new Set(['.js', '.mjs', '.cjs']);
const ignored = new Set(['node_modules', 'build', 'dist', 'coverage', '.dart_tool']);

async function collect(directory, output = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`symbolic link in first-party source tree: ${fullPath}`);
    }
    if (entry.isDirectory()) {
      await collect(fullPath, output);
    } else if (extensions.has(path.extname(entry.name))) {
      output.push(fullPath);
    }
  }
  return output;
}

const files = [];
// Root-level configuration is executable JavaScript too (for example
// eslint.config.mjs). The four source roots alone omit it, so a malformed
// top-level config could appear to pass the Packet 0 parse gate.
try {
  for (const entry of await readdir('.', { withFileTypes: true })) {
    if (!extensions.has(path.extname(entry.name))) continue;
    if (entry.isSymbolicLink()) {
      throw new Error(`symbolic link in root-level JavaScript source: ${entry.name}`);
    }
    if (!entry.isFile()) {
      throw new Error(`unsupported root-level JavaScript source entry: ${entry.name}`);
    }
    files.push(entry.name);
  }
} catch (error) {
  console.error(`FAIL: cannot scan root-level JavaScript: ${error.message}`);
  process.exitCode = 1;
}
for (const root of [...roots, ...optionalRoots]) {
  try {
    // Never traverse symlinked roots outside the reviewed source tree.
    // Missing optional folders are fine; malformed or symlinked ones are not.
    let info;
    try {
      info = await lstat(root);
    } catch (error) {
      if (error.code === 'ENOENT' && optionalRoots.includes(root)) continue;
      throw error;
    }
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('root is not a regular source directory');
    }
    await collect(root, files);
  } catch (error) {
    console.error(`FAIL: cannot scan required source directory ${root}: ${error.message}`);
    process.exitCode = 1;
  }
}

let failed = process.exitCode === 1;
if (files.length === 0) {
  console.error('FAIL: no first-party JavaScript files found; refusing an empty syntax gate.');
  failed = true;
}
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(`PASS: parsed ${files.length} first-party JavaScript files.`);
}
