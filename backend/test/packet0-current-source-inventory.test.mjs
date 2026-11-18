import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const baseline = await readFile(new URL('docs/packet-0-baseline-characterization.md', root), 'utf8');
const bootstrap = await readFile(new URL('backend/src/bootstrap/server.ts', root), 'utf8');
const routeSource = await readFile(new URL('backend/src/http/routes/v1/register.ts', root), 'utf8');

async function filesUnder(relative) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(new URL(directory, root), { withFileTypes: true })) {
      const path = `${directory}${entry.name}`;
      if (entry.isDirectory()) await walk(`${path}/`);
      else if (entry.isFile()) files.push(path);
    }
  }
  await walk(`${relative}/`);
  return files;
}

test('Packet 0 canonical inventory counts the actual existing backend, web, Flutter and migration surfaces', async () => {
  const backend = await filesUnder('backend/src');
  const web = await filesUnder('web/src');
  const mobile = await filesUnder('lib');
  const migrations = (await filesUnder('backend/migrations/postgres')).filter((p) => /\/\d{4}_[^/]+\.sql$/.test(p));
  const routes = [...routeSource.matchAll(/\{ id: '[^']+', method: '([^']+)', path: '([^']+)'/g)];

  // The 2026-10-31 baseline is a historical floor: the application has since
  // gained files, routes and migrations, but must never fall below it, and the
  // migration sequence must stay contiguous from 0001.
  assert.ok(backend.filter((p) => /\.(?:ts|js)$/.test(p)).length >= 53);
  assert.ok(web.filter((p) => p.endsWith('.tsx')).length >= 8);
  assert.ok(web.filter((p) => p.endsWith('.ts')).length >= 2);
  assert.ok(mobile.filter((p) => p.endsWith('.dart')).length >= 41);
  assert.ok(migrations.length >= 18);
  assert.deepEqual(migrations.map((p) => p.split('/').at(-1).slice(0, 4)),
    Array.from({ length: migrations.length }, (_, index) => String(index + 1).padStart(4, '0')));
  assert.ok(new Set(routes.map(([, method, path]) => `${method} ${path}`)).size >= 61);
  assert.match(baseline, /## 2026-10-31 canonical source baseline/);
  assert.match(baseline, /53 backend source JS\/TS files/);
  assert.match(baseline, /8 React TSX and 2 web TS files/);
  assert.match(baseline, /41 Flutter Dart files/);
  assert.match(baseline, /61 unique Hono route contracts/);
  assert.match(baseline, /seven unchanged canonical PostgreSQL migrations/);
});

test('Packet 0 cleanup map preserves one backend and blocks legacy deletion until parity', async () => {
  assert.match(bootstrap, /createPostgresDatabase/);
  assert.match(bootstrap, /createHttpApp/);
  assert.doesNotMatch(bootstrap, /(?:from|import\s*\()\s*['"][^'"]*(?:mysql|express)/i);
  for (const source of [
    'backend/src/infrastructure/postgres/client.js',
    'backend/src/infrastructure/mysql',
    'web/src/app/App.tsx',
    'lib/features/cart/presentation/cart_view_model.dart',
  ]) {
    assert.ok((await stat(new URL(source, root))).isFile() || (await stat(new URL(source, root))).isDirectory());
  }
  assert.match(baseline, /do not remove legacy paths before verified parity/i);
  assert.match(baseline, /Supabase PostgreSQL/i);
  assert.match(baseline, /non-owner.*RLS/i);
});

// Packet 0: the old Express/MySQL adapter remains a rollback reference, not a
// second runtime authority. A direct-import-only check of bootstrap misses a
// reintroduced transitive import elsewhere in the live Hono dependency graph.
// This is a literal import-graph characterization, not a compiled/build proof.
const sourceRootPath = fileURLToPath(root);
const backendRootPath = resolve(sourceRootPath, 'backend');
const runtimeSourcePath = resolve(backendRootPath, 'src');
// The canonical runtime still imports these two characterized root-level
// modules; everything else outside src/ remains non-runtime until migrated.
const reviewedRootRuntimeFiles = new Set([
  resolve(backendRootPath, 'passwords.js'),
  resolve(backendRootPath, 'email.js'),
]);
const runtimeEntrypoint = resolve(backendRootPath, 'src/bootstrap/server.ts');

// ECMAScript permits whitespace and comments between static import/export
// tokens and the quoted module identifier; those edges must be traversed.
const moduleTrivia = String.raw`(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*\r?\n)*`;

function literalModuleSpecifiers(contents) {
  // Cover regular/multiline static imports, re-exports, side-effect imports,
  // and string-literal dynamic imports; do not evaluate source code.
  const matches = [
    ...contents.matchAll(new RegExp(String.raw`\bfrom${moduleTrivia}['"]([^'"]+)['"]`, 'g')),
    ...contents.matchAll(new RegExp(String.raw`\bimport${moduleTrivia}['"]([^'"]+)['"]`, 'g')),
    ...contents.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
  ];
  return [...new Set(matches.map((match) => match[1]))];
}

// All runtime loader calls in this reviewed source graph must be traversable
// by the literal-import collector. Computed ESM imports and CommonJS loader
// bridges otherwise evade the transitive authority check. This is a narrow
// textual source gate, not a JS/TS parser or dependency provenance proof.
function assertReviewedRuntimeLoaders(importer, contents) {
  const literalImports = new Set(
    [...contents.matchAll(/\bimport\s*\(\s*(['"])[^'"\r\n]+\1\s*\)/g)].map((match) => match.index),
  );
  // JS permits comments between the loader keyword and `(`. A whitespace-
  // only search leaves that executable path outside the reviewed import graph.
  // Deliberately reject these forms (even with a literal target) until a
  // parser-based resolver can attest their exact module edges.
  const dynamicImportCall = new RegExp(String.raw`\bimport${moduleTrivia}\(`, 'g');
  // `require?.(...)`, `require.call(...)` and `require.apply(...)` are
  // executable alternative invocations. Reject rather than treating them as
  // reviewed ESM edges; same for `createRequire`'s call variants.
  const commonJsLoaderCall = new RegExp(
    String.raw`\b(?:require|createRequire)${moduleTrivia}(?:(?:\?\.|\.)${moduleTrivia}(?:call|apply)${moduleTrivia})?(?:\?\.)?${moduleTrivia}\(`,
    'g',
  );
  for (const match of contents.matchAll(dynamicImportCall)) {
    assert.ok(literalImports.has(match.index),
      `unreviewed runtime loader in ${importer}: computed/non-literal import()`);
  }
  assert.doesNotMatch(contents, commonJsLoaderCall,
    `unreviewed runtime loader in ${importer}: CommonJS loader bridge`);
}

function assertCanonicalRuntimeEdge(importer, specifier) {
  // Module StringLiterals may contain \u / \x / escaped-character sequences.
  // Their runtime target can differ from the raw text extracted above.
  // Reject all backslashes rather than trying to partially decode JavaScript
  // strings in a regex-only source graph; normal ESM imports use `/` paths.
  assert.ok(!specifier.includes('\\'),
    `escaped runtime module specifier in ${importer}: ${specifier}`);
  const legacyPackages = new Set(['express', 'mysql', 'mysql2', '@supabase/supabase-js', 'supabase']);
  const externalPackage = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
  assert.ok(!legacyPackages.has(externalPackage) && !externalPackage.startsWith('@supabase/'),
    `retired or parallel persistence/auth runtime imported by ${importer}: ${specifier}`);
  // URL-based imports (including executable data: payloads), absolute paths
  // and package.json #imports aliases can resolve outside the reviewed Hono
  // source graph. Only ordinary packages and node: built-ins are exempt from
  // relative path traversal; this check does not prove dependency integrity.
  assert.ok(
    specifier.startsWith('node:') || !/^(?:[a-z][a-z\d+.-]*:|[\/\\]|#)/i.test(specifier),
    `unreviewed runtime module specifier in ${importer}: ${specifier}`,
  );
  if (!specifier.startsWith('.')) return null;
  const resolved = resolve(dirname(resolve(sourceRootPath, importer)), specifier);
  assert.ok(resolved.startsWith(`${backendRootPath}${sep}`),
    `unexpected local runtime import outside existing backend: ${importer} → ${specifier}`);
  assert.ok(!relative(backendRootPath, resolved).split(sep).includes('mysql'),
    `legacy MySQL adapter is reachable from Hono: ${importer} → ${specifier}`);
  assert.ok(resolved.startsWith(`${runtimeSourcePath}${sep}`) || reviewedRootRuntimeFiles.has(resolved),
    `unexpected runtime import outside backend/src runtime source boundary: ${importer} → ${specifier}`);
  return resolved;
}

test('Packet 0 transitive Hono source graph does not import retired MySQL/Express or parallel Supabase auth', async () => {
  const visited = new Set();
  const pending = [runtimeEntrypoint];
  let checkedEdges = 0;
  while (pending.length > 0) {
    const filename = pending.pop();
    if (visited.has(filename)) continue;
    visited.add(filename);
    const importer = relative(sourceRootPath, filename).split(sep).join('/');
    const text = await readFile(filename, 'utf8');
    assertReviewedRuntimeLoaders(importer, text);
    for (const specifier of literalModuleSpecifiers(text)) {
      checkedEdges++;
      const target = assertCanonicalRuntimeEdge(importer, specifier);
      if (target) pending.push(target);
    }
  }
  assert.ok(visited.size >= 40, `unexpectedly small live backend graph: ${visited.size} modules`);
  assert.ok(checkedEdges >= 75, `unexpectedly small reviewed runtime graph: ${checkedEdges} edges`);
});

test('Packet 0 graph gate detects transitive legacy and parallel-authority imports', () => {
  assert.deepEqual(literalModuleSpecifiers(`
    import { service } from '../application/service.js';
    export { policy } from '../domain/policy.js';
    import '../startup.js';
    await import('../compat.js');
  `), ['../application/service.js', '../domain/policy.js', '../startup.js', '../compat.js']);
  assert.throws(() => assertCanonicalRuntimeEdge('backend/src/application/unsafe.js', 'mysql2/promise'),
    /retired or parallel/);
  assert.throws(() => assertCanonicalRuntimeEdge('backend/src/application/unsafe.js',
    '../infrastructure/mysql/order-repository.js'), /legacy MySQL adapter/);
  assert.throws(() => assertCanonicalRuntimeEdge('backend/src/application/unsafe.js',
    '@supabase/supabase-js'), /retired or parallel/);
});

// Adversarial regression: the live runtime graph must never claim a legacy
// migration/test runner or an alternate Supabase SDK as reviewed application
// code merely because the import is relative to backend/ or is a scoped SDK.
test('Packet 0 Hono graph refuses backend tooling and all scoped Supabase client imports', () => {
  for (const specifier of ['../../passwords.js', '../../email.js']) {
    assert.ok(assertCanonicalRuntimeEdge('backend/src/bootstrap/server.ts', specifier),
      `existing characterized runtime bridge must remain valid: ${specifier}`);
  }
  for (const specifier of [
    '../../scripts/migrate-postgres.mjs',
    '../../test/packet0-users-auth-bootstrap-rls.test.mjs',
    '../../migrations/postgres/0001_core.sql',
  ]) {
    assert.throws(
      () => assertCanonicalRuntimeEdge('backend/src/application/unsafe.js', specifier),
      /runtime source boundary|outside backend\/src/,
      `backend runtime import should not reach non-runtime file ${specifier}`,
    );
  }
  for (const specifier of ['@supabase/ssr', '@supabase/postgrest-js']) {
    assert.throws(
      () => assertCanonicalRuntimeEdge('backend/src/application/unsafe.js', specifier),
      /retired or parallel/,
      `second Supabase client authority must be rejected: ${specifier}`,
    );
  }
});

// Non-relative Node ESM identifiers are not all installed packages: data:
// modules execute inline code and file:/absolute/#imports can evade the
// reviewed relative source tree. Keep built-in node: imports and installed
// package specifiers permitted, but fail closed on unreviewed source loaders.
test('Packet 0 Hono graph refuses URL, absolute-file and package-import-map escapes', () => {
  const importer = 'backend/src/application/unsafe.js';
  for (const specifier of [
    'data:text/javascript,export%20default%201',
    'file:///tmp/unreviewed-module.js',
    'https://example.invalid/remote.mjs',
    '/tmp/unreviewed-module.js',
    '#unreviewed-loader',
  ]) {
    assert.throws(
      () => assertCanonicalRuntimeEdge(importer, specifier),
      /unreviewed runtime module specifier/,
      `non-relative runtime escape must not bypass source inventory: ${specifier}`,
    );
  }
  assert.equal(assertCanonicalRuntimeEdge(importer, 'node:crypto'), null);
  assert.equal(assertCanonicalRuntimeEdge(importer, 'drizzle-orm/node-postgres'), null);
});

// Packet 0 adversarial characterization: syntactically valid runtime loader
// calls must not silently bypass literal import-graph traversal.
// Valid JavaScript permits comments between a loader keyword and its call.
// A whitespace-only pattern previously missed these executable forms, so
// source graph attestation could report green without following the import.
test('Packet 0 Hono graph rejects comment-separated runtime loader calls', () => {
  const importer = 'backend/src/application/unsafe.js';
  for (const source of [
    'await import/*unreviewed*/("../../infrastructure/mysql/order-repository.js");',
    'await import /* unreviewed */ (moduleName);',
    'const legacy = require/*unreviewed*/("mysql2/promise");',
    'const bridge = createRequire /* unreviewed */ (import.meta.url);',
    'await import // hidden loader\n  ("data:text/javascript,export%20default%201");',
  ]) {
    assert.throws(
      () => assertReviewedRuntimeLoaders(importer, source),
      /unreviewed runtime loader/,
      `comment-separated runtime loader must be rejected: ${source}`,
    );
  }
});

// JavaScript also accepts comment trivia between `from`/`import` and the
// quoted static module specifier. The module collector must traverse that
// import rather than silently excluding a legacy runtime edge.
test('Packet 0 graph traverses comment-separated static imports and re-exports', () => {
  const source = `
    import /* comment */ 'mysql2/promise';
    import { describe } from /* comment */ '@supabase/supabase-js';
    export { default } from /* comment */ '../../infrastructure/mysql/order-repository.js';
  `;
  const specifiers = literalModuleSpecifiers(source);
  assert.deepEqual(specifiers, [
    '@supabase/supabase-js',
    '../../infrastructure/mysql/order-repository.js',
    'mysql2/promise',
  ]);
  for (const specifier of specifiers) {
    assert.throws(
      () => assertCanonicalRuntimeEdge('backend/src/application/unsafe.js', specifier),
      /retired or parallel|legacy MySQL adapter/,
      `static module edge cannot bypass source graph: ${specifier}`,
    );
  }
});

// CommonJS-compatible loader functions can be invoked with optional calls or
// Function.prototype.call/apply, without a direct `require(` token. These
// valid JavaScript call shapes must not evade the test-only source gate.
test('Packet 0 graph rejects indirect and optional CommonJS loader invocation', () => {
  const importer = 'backend/src/application/unsafe.js';
  for (const source of [
    'const legacy = require?.("mysql2/promise");',
    'const legacy = require.call(null, "mysql2/promise");',
    'const legacy = require.apply(null, ["mysql2/promise"]);',
    'const legacy = createRequire?.(import.meta.url);',
    'const legacy = require?.call(null, "@supabase/supabase-js");',
    'const legacy = require.call?.(null, "mysql2/promise");',
  ]) {
    assert.throws(
      () => assertReviewedRuntimeLoaders(importer, source),
      /unreviewed runtime loader/,
      `indirect CommonJS loader invocation must be rejected: ${source}`,
    );
  }
});

test('Packet 0 runtime graph rejects computed imports and CommonJS loader bridges', () => {
  const importer = 'backend/src/application/unsafe.js';
  for (const source of [
    'await import(variableModule);',
    'await import(`../../infrastructure/mysql/inventory-repository.js`);',
    'const loader = createRequire(import.meta.url);',
    'const legacy = require("mysql2/promise");',
  ]) {
    assert.throws(
      () => assertReviewedRuntimeLoaders(importer, source),
      /unreviewed runtime loader/,
      `computed or CommonJS loader must not bypass graph: ${source}`,
    );
  }
  assert.doesNotThrow(() => assertReviewedRuntimeLoaders(importer, `
    import { getClient } from '../infrastructure/postgres/client.js';
    await import('../domain/policy.js');
  `));
});

// JavaScript evaluates escape sequences in a module StringLiteral before
// resolving its target. This textual source inventory deliberately does not
// interpret escapes; a name such as `mysql\u0032/promise` must fail closed
// rather than resolve to an unreviewed package at runtime.
test('Packet 0 graph rejects escaped static module specifiers before authority checks', () => {
  const importer = 'backend/src/application/unsafe.js';
  const source = String.raw`
    import 'mysql\u0032/promise';
    export * from '\u0040supabase/supabase-js';
    import { oldAdapter } from '../infrastructure/mysq\u006c/adapter.js';
  `;
  const specifiers = literalModuleSpecifiers(source);
  assert.equal(specifiers.length, 3, 'all literal edges must remain visible');
  for (const specifier of specifiers) {
    assert.throws(
      () => assertCanonicalRuntimeEdge(importer, specifier),
      /escaped runtime module specifier/,
      `escaped module identifier must fail closed: ${specifier}`,
    );
  }
});
