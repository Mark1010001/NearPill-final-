import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

/**
 * One executable-source inventory for the canonical SQL runner and its
 * read-only preflight. No separate migrations, manifest or schema authority.
 * Reject suspicious files BEFORE opening a PostgreSQL connection.
 */
export function assertReviewedMigrationFilenames(entries) {
  if (!Array.isArray(entries)) {
    throw new Error('migration file inventory refused: unavailable directory listing.');
  }
  // Only the one documented README is non-executable migration metadata.
  // Ignoring other entries (e.g. .SQL, .sql.bak, or staging files) would make
  // the runner and security preflight silently share an incomplete history.
  if (entries.some((name) => typeof name !== 'string' ||
      (name !== 'README.md' && !name.endsWith('.sql')))) {
    throw new Error('migration file inventory refused: unexpected file in canonical migration directory.');
  }
  const filenames = entries.filter((name) => name.endsWith('.sql'));
  if (!filenames.length ||
      filenames.some((name) => !/^\d{4}_[a-z0-9_]+\.sql$/.test(name)) ||
      new Set(filenames).size !== filenames.length) {
    throw new Error('migration file inventory refused: unreviewed or duplicate executable SQL filename.');
  }
  filenames.sort();
  // Version gaps or duplicate sequence numbers are ambiguous even if file
  // names differ; later reviewed files must be sequentially added to the
  // existing migration history, not silently applied out of sequence.
  for (let i = 0; i < filenames.length; i++) {
    if (Number(filenames[i].slice(0, 4)) !== i + 1) {
      throw new Error('migration file inventory refused: non-contiguous or duplicate migration sequence.');
    }
  }
  return filenames;
}

/**
 * Read validated, regular SQL files without following symlinks. Load the
 * complete batch before the runner constructs a Pool or executes any DDL.
 * Source code review remains necessary; valid naming is NOT SQL approval.
 */
export async function loadReviewedMigrationSources(directory) {
  const sourceDir = directory instanceof URL ? fileURLToPath(directory) : directory;
  // Refuse symlinks in EVERY directory component. Checking only the last
  // postgres/ directory is insufficient if its migrations/ or project-root
  // ancestor is a symlink to unreviewed external SQL. Keep the canonical
  // migration runner and read-only security preflight on this one boundary.
  // This checks observed paths; it is not an atomic defense against hostile
  // concurrent filesystem mutation. Source/manifest provenance is still required.
  const resolvedDir = path.resolve(sourceDir);
  const components = [];
  for (let current = resolvedDir; ; current = path.dirname(current)) {
    components.push(current);
    if (path.dirname(current) === current) break;
  }
  for (const component of components.reverse()) {
    let stat;
    try {
      stat = await lstat(component);
    } catch (error) {
      throw new Error('migration file inventory refused: cannot inspect migration directory ancestry.', { cause: error });
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('migration file inventory refused: migration directory ancestry includes a symlink or non-directory.');
    }
  }
  const entries = await readdir(resolvedDir, { withFileTypes: true });
  const names = assertReviewedMigrationFilenames(entries.map((entry) => entry.name));
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  // Even non-executable metadata may not be a symlink or special device.
  // That would hide unexpected out-of-tree state behind an allowed name.
  const readme = byName.get('README.md');
  if (readme && !readme.isFile()) {
    throw new Error('migration file inventory refused: README.md is not a regular file.');
  }
  const files = [];
  for (const filename of names) {
    if (!byName.get(filename)?.isFile()) {
      throw new Error(`migration file inventory refused: ${filename} is not a regular SQL file.`);
    }
    let handle;
    try {
      // O_NOFOLLOW protects against a symlink substituted after readdir.
      handle = await open(path.join(resolvedDir, filename), constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error('not a regular file');
      // Node's default UTF-8 decoding silently replaces malformed bytes with
      // U+FFFD. Migration execution and checksum review must use exact decoded
      // source, not text modified by lossy decoding.
      const bytes = await handle.readFile();
      // WHATWG TextDecoder silently strips a UTF-8 BOM. A reviewed SQL
      // source must not turn into different text before migration hashing or
      // execution; reject BOM-prefixed files instead of normalizing them.
      if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        throw new Error('UTF-8 BOM in SQL migration source');
      }
      let sql;
      try {
        sql = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch (error) {
        throw new Error('invalid UTF-8 migration source', { cause: error });
      }
      if (sql.includes('\0')) throw new Error('NUL byte in SQL migration source');
      if (!sql.trim()) throw new Error('empty SQL source');
      files.push({ filename, sql });
    } catch (error) {
      throw new Error(`migration file inventory refused: cannot safely read ${filename}.`, { cause: error });
    } finally {
      await handle?.close();
    }
  }
  return files;
}


// Shared literal SQL statement scanner for source-only Packet 0 characterization
// and preflight. Not an arbitrary SQL parser or proof of live RLS.
export function literalSqlStatements(sql, filename) {
  const statements = [];
  let buffer = '';
  let index = 0;
  let line = 1;
  let startLine = 1;
  let quote = '';
  let escapeStringQuote = false;
  let dollarTag = '';
  let blockDepth = 0;
  let lineComment = false;
  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];
    if (char === '\n') line++;
    if (lineComment) {
      if (char === '\n') { lineComment = false; buffer += '\n'; }
      index++;
      continue;
    }
    if (blockDepth) {
      if (char === '/' && next === '*') { blockDepth++; index += 2; continue; }
      if (char === '*' && next === '/') { blockDepth--; index += 2; continue; }
      if (char === '\n') buffer += '\n';
      index++;
      continue;
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, index)) {
        buffer += dollarTag;
        index += dollarTag.length;
        dollarTag = '';
      } else { buffer += char; index++; }
      continue;
    }
    if (quote) {
      buffer += char;
      // PostgreSQL E'...' literals allow backslash-escaped quote characters.
      // A semicolon following an escaped quote is still literal content, not
      // a top-level statement separator used by the RLS source preflight.
      if (quote === "'" && escapeStringQuote && char === '\\' && next !== undefined) {
        buffer += next;
        if (next === '\n') line++;
        index += 2;
        continue;
      }
      if (char === quote) {
        if (next === quote) { buffer += next; index += 2; continue; }
        quote = '';
        escapeStringQuote = false;
      }
      index++;
      continue;
    }
    if (char === '-' && next === '-') { lineComment = true; index += 2; buffer += ' '; continue; }
    if (char === '/' && next === '*') { blockDepth = 1; index += 2; buffer += ' '; continue; }
    if (char === "'" || char === '"') {
      quote = char;
      // E'...' is a single lexical token; an identifier ending in E isn't.
      escapeStringQuote = char === "'" && /[Ee]/.test(sql[index - 1] ?? '') &&
        (index < 2 || !/[a-z0-9_$]/i.test(sql[index - 2]));
      buffer += char;
      index++;
      continue;
    }
    if (char === '$') {
      const tag = /^\$(?:[a-z_][a-z_0-9]*)?\$/i.exec(sql.slice(index));
      if (tag) { dollarTag = tag[0]; buffer += dollarTag; index += dollarTag.length; continue; }
    }
    if (char === ';') {
      if (buffer.trim()) statements.push({ statement: buffer.trim(), line: startLine });
      buffer = '';
      startLine = line;
    } else buffer += char;
    index++;
  }
  if (quote || dollarTag || blockDepth) throw new Error(`unclosed SQL quote/comment in ${filename}`);
  if (buffer.trim()) statements.push({ statement: buffer.trim(), line: startLine });
  return statements;
}


/**
 * Literal, top-level DROP TABLE target inventory for reviewed migration replay.
 * PostgreSQL automatically removes policies attached to a dropped table.
 * Fail closed on unfamiliar identifier/DDL forms rather than attributing old
 * policies to a later table with the same name. This is source-only evidence.
 */
export function reviewedDropTableTargets(statement, filename, line) {
  if (!/^DROP\s+TABLE\b/i.test(statement)) return null;
  const match = /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(.+?)(?:\s+(?:CASCADE|RESTRICT))?$/i.exec(statement);
  const targets = match?.[1].split(',').map((name) => name.trim());
  if (!targets?.length || targets.some((name) => !/^(?:(?:public|nearpill)\.)?[a-z_][a-z0-9_]*$/i.test(name))) {
    throw new Error(`unreviewed DROP TABLE syntax at ${filename}:${line}`);
  }
  return targets.map((name) => name.replace(/^public\./i, '').toLowerCase());
}
