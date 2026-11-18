import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, readFileSync, copyFileSync, lstatSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { posixTest } from './helpers/posix.mjs';

const scanner = fileURLToPath(new URL('../../scripts/secret-scan.mjs', import.meta.url));
const verifier = fileURLToPath(new URL('../../scripts/verify-packet0.sh', import.meta.url));
const packageScript = fileURLToPath(new URL('../../scripts/package-source.sh', import.meta.url));

function scanFixture(t, files = {}, symlinks = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nearpill-source-scan-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, contents] of Object.entries(files)) {
    const target = join(root, name);
    mkdirSync(resolve(target, '..'), { recursive: true });
    writeFileSync(target, contents, { mode: 0o600 });
  }
  for (const [name, target] of Object.entries(symlinks)) symlinkSync(target, join(root, name));
  return spawnSync(process.execPath, [scanner], { cwd: root, encoding: 'utf8' });
}

test('a normal source tree with placeholder .env.example is allowed', (t) => {
  const result = scanFixture(t, { '.env.example': 'DB_PASSWORD=replace_me', '.npmrc': 'engine-strict=true' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS: no local environment files/);
});

test('distributable env example rejects literal credentials but permits placeholders', (t) => {
  // Assemble synthetic opaque values at runtime; never store a test credential
  // as a literal in the repository that the source scanner would flag.
  const samplePassword = ['fixture', 'opaque', 'value'].join('-');
  for (const [name, value] of [
    ['DB_PASSWORD', samplePassword],
    ['MIGRATOR_DB_PASSWORD', samplePassword],
    ['BREVO_API_KEY', samplePassword],
    ['SUPABASE_SERVICE_ROLE_KEY', samplePassword],
  ]) {
    const result = scanFixture(t, { '.env.example': `${name}=${value}\n` });
    assert.equal(result.status, 1, `${name} must block distributable env template: ${result.stderr}`);
    assert.match(result.stderr, /literal secret in environment template/i);
    assert.ok(!result.stderr.includes(samplePassword), 'do not echo secret values');
  }
  const safe = scanFixture(t, { '.env.example': [
    'DB_PASSWORD=replace-with-a-local-password',
    'MIGRATOR_DB_PASSWORD=replace-with-a-local-migrator-password',
    'BREVO_API_KEY=',
    'SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}',
    'API_TOKEN=[YOUR_TOKEN]',
    '# OWNER_PASSWORD=commented-out',
    '',
  ].join('\n') });
  assert.equal(safe.status, 0, safe.stderr);
});

test('generated-directory names nested under executable source are not trusted exclusions', (t) => {
  for (const name of ['backend/src/build/hidden.mjs', 'web/src/dist/hidden.ts', 'lib/node_modules/hidden.dart']) {
    const result = scanFixture(t, { [name]: 'export const unreviewed = true;\n' });
    assert.equal(result.status, 1, `${name} must block the source scanner: ${result.stdout} ${result.stderr}`);
    assert.match(result.stderr, /excluded generated directory inside first-party source/);
  }
});

test('generated-name directories in canonical migrations and served/bundled assets cannot bypass secret scans', (t) => {
  for (const name of [
    'backend/migrations/postgres/dist/hidden.sql',
    'backend/public/dist/hidden.js',
    'web/public/build/hidden.js',
    'assets/images/node_modules/hidden.js',
  ]) {
    const result = scanFixture(t, { [name]: 'export const unreviewed = true;\n' });
    assert.equal(result.status, 1, `${name} must block secret scanning: ${result.stdout} ${result.stderr}`);
    assert.match(result.stderr, /excluded generated directory inside first-party source/);
  }
});

test('local CI action code cannot hide beneath generated-name exclusions', (t) => {
  for (const name of ['.github/actions/check/dist/index.js', '.github/scripts/build/node_modules/runner.js']) {
    const result = scanFixture(t, { [name]: 'export const unexpected = true;\n' });
    assert.equal(result.status, 1, `${name} must block the source scanner: ${result.stdout} ${result.stderr}`);
    assert.match(result.stderr, /excluded generated directory inside first-party source/);
  }
});

posixTest('secret scanner refuses source entries that collide during case-insensitive extraction', (t) => {
  const result = scanFixture(t, { 'README.md': 'ordinary\n', 'readme.MD': 'different\n' });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /case-insensitive source name collision/i);
});

test('secret scanner rejects uppercase local environment files', (t) => {
  const result = scanFixture(t, { '.ENV': 'DB_PASSWORD=some-value\n', 'backend/.Env.Production': 'TEST=1\n' });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /local environment file included in source: \.ENV/);
  assert.match(result.stderr, /local environment file included in source: backend\/\.Env\.Production/);
});

posixTest('secret scanner refuses Windows-unportable source filenames and directories', (t) => {
  // Archive integrity must be reproducible on developer machines, including
  // Windows where these names are device aliases or prohibited components.
  for (const name of ['AUX.txt', 'infra/build:token.txt', 'docs/review. ', 'COM¹.log']) {
    const result = scanFixture(t, { [name]: 'ordinary fixture content\n' });
    assert.equal(result.status, 1, `${name} must block source scanning: ${result.stdout} ${result.stderr}`);
    assert.match(result.stderr, /non-portable Windows source name/i);
  }
});

test('packaged .env is rejected even without a recognizable secret pattern', (t) => {
  const result = scanFixture(t, { '.env': 'DB_PASSWORD=placeholder' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /local environment file included in source: \.env/);
  assert.doesNotMatch(result.stderr, /placeholder/);
});

test('production and local environment variants are never silently skipped', (t) => {
  const result = scanFixture(t, { '.env.production': 'DEBUG=0', 'backend/.env.local': 'SAFE=false' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\.env\.production/);
  assert.match(result.stderr, /backend\/\.env\.local/);
});

test('a real high-confidence token is rejected in ordinary source text', (t) => {
  const fakeToken = ['sk', 'a'.repeat(28)].join('-');
  const result = scanFixture(t, { 'config.ts': `const token = '${fakeToken}';` });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /OpenAI-style secret: config\.ts/);
  assert.doesNotMatch(result.stderr, new RegExp(fakeToken));
});

test('PEM encrypted, DSA and PGP private-key headers fail closed in ordinary source files', (t) => {
  // Compose synthetic PEM markers so the reviewed regression source never
  // itself looks like a distributed private key to the source scanner.
  for (const type of ['ENCRYPTED PRIVATE KEY', 'DSA PRIVATE KEY', 'PGP PRIVATE KEY BLOCK']) {
    const header = ['-----BEGIN', `${type}-----`].join(' ');
    const result = scanFixture(t, { 'web/src/fixture-config.ts': `const embedded = ${JSON.stringify(header)};\n` });
    assert.equal(result.status, 1, `${type} must fail closed: ${result.stdout} ${result.stderr}`);
    assert.match(result.stderr, /private key: web\/src\/fixture-config\.ts/);
    assert.ok(!result.stderr.includes(header), 'do not print the sensitive marker');
  }
  const publicHeader = ['-----BEGIN', 'PUBLIC KEY-----'].join(' ');
  const safe = scanFixture(t, { 'web/src/fixture-config.ts': `const publicPem = ${JSON.stringify(publicHeader)};\n` });
  assert.equal(safe.status, 0, safe.stderr);
});

test('opaque assets cannot conceal plaintext database or npm registry credentials', (t) => {
  // Opaque image metadata may contain readable configuration despite NUL bytes.
  // Build synthetic secrets at runtime rather than embedding credential-like
  // assignment strings in this reviewed regression file.
  const pgKey = ['PG', 'PASSWORD'].join('');
  const databaseSecret = 'SyntheticOpaqueLibpqPasswordForRegression';
  const npmSecret = 'SyntheticOpaqueNpmPasswordForRegression';
  const cases = [
    ['assets/icons/db.png', `\n${pgKey}=${databaseSecret}\n`, /literal libpq environment password in opaque asset/],
    ['assets/icons/registry.png', `\nhttps://robot:${npmSecret}@registry.example.invalid/\n`, /authenticated registry URL in opaque asset/],
  ];
  for (const [name, payload, diagnostic] of cases) {
    const bytes = Buffer.concat([Buffer.from([0, 255, 0, 254]), Buffer.from(payload)]);
    const result = scanFixture(t, { [name]: bytes });
    assert.equal(result.status, 1, `${name}: plaintext credentials inside an opaque asset must not ship`);
    assert.match(result.stderr, diagnostic);
    assert.ok(!result.stderr.includes(databaseSecret) && !result.stderr.includes(npmSecret),
      'source scanner must never print credentials');
  }
  const harmless = scanFixture(t, { 'assets/icons/harmless.png': Buffer.from([0, 255, 0, 254, 1, 2]) });
  assert.equal(harmless.status, 0, harmless.stderr);
});

test('secret scan includes deployment files, database migrations, and Android source', (t) => {
  const fakeToken = ['sk', 'a'.repeat(28)].join('-');
  const paths = [
    'backend/Dockerfile',
    'web/Containerfile',
    'backend/migrations/postgres/0001_core.sql',
    'infra/nginx/nginx.conf',
    'android/app/build.gradle.kts',
    'android/app/src/main/kotlin/dev/nearpill/mobile/MainActivity.kt',
  ];
  for (const name of paths) {
    const result = scanFixture(t, { [name]: `# leaked fixture ${fakeToken}\n` });
    assert.equal(result.status, 1, `${name} must be scanned: ${result.stdout}`);
    assert.ok(result.stderr.includes(name), `${name} must be named in scan evidence`);
    assert.doesNotMatch(result.stderr, new RegExp(fakeToken), 'never print raw tokens');
  }
});

test('unrecognized readable first-party files cannot bypass token scanning', (t) => {
  // A source ZIP can contain runnable scripts/configuration without a familiar
  // extension (e.g. Python, shell profile, or extensionless deploy secrets).
  // The detector must not depend on a finite list of source file suffixes.
  const marker = ['sk', 'x'.repeat(28)].join('-');
  for (const name of ['scripts/deploy.py', 'config/.envrc', 'infra/deploy_credentials']) {
    const result = scanFixture(t, { [name]: `EXAMPLE_TOKEN=${marker}\n` });
    assert.equal(result.status, 1, `${name} bypassed first-party secret scanning`);
    assert.match(result.stderr, /OpenAI-style secret/);
    assert.ok(result.stderr.includes(name));
    assert.ok(!result.stderr.includes(marker), 'secret values must remain redacted');
  }
  const binary = scanFixture(t, {
    'assets/icon.png': Buffer.concat([Buffer.from([0, 255, 0]), Buffer.from(marker)]),
  });
  assert.equal(binary.status, 1, 'recognizable plaintext tokens in binary assets must not ship');
  assert.match(binary.stderr, /OpenAI-style secret in opaque asset: assets\/icon\.png/);
  const corruptConfig = scanFixture(t, { 'infra/settings.json': Buffer.from([123, 0, 125]) });
  assert.equal(corruptConfig.status, 1, 'known configuration with NUL bytes must fail closed');
  assert.match(corruptConfig.stderr, /unreadable source text: infra\/settings\.json/);
});

test('opaque image metadata cannot carry an obvious plaintext API token into source handoffs', (t) => {
  // A legitimate opaque asset may contain human-readable metadata. Scan only
  // strong, recognizable ASCII token patterns, not arbitrary image bytes.
  const marker = ['sk', 'b'.repeat(28)].join('-');
  const image = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]),
    Buffer.from(`metadata ${marker}`, 'ascii'),
    Buffer.from([0, 255, 0]),
  ]);
  const result = scanFixture(t, { 'assets/photo.png': image });
  assert.equal(result.status, 1, `binary metadata token escaped the scan: ${result.stdout} ${result.stderr}`);
  assert.match(result.stderr, /OpenAI-style secret in opaque asset: assets\/photo\.png/);
  assert.doesNotMatch(result.stderr, new RegExp(marker));
  const harmless = scanFixture(t, { 'assets/icon.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 255, 0]) });
  assert.equal(harmless.status, 0, `harmless binary asset should remain allowed: ${harmless.stderr}`);
});

test('UTF-16 encoded deployment text cannot bypass source secret scanning', (t) => {
  // Windows PowerShell and deployment configuration files are often UTF-16.
  // Treat a valid text BOM as encoded source, not a binary NUL-byte exemption.
  const marker = ['sk', 'u'.repeat(28)].join('-');
  for (const [name, byteOrder] of [
    ['infra/config.ps1', 'le'],
    ['infra/settings.utf16', 'be'],
  ]) {
    const utf16 = Buffer.from(`EXAMPLE_TOKEN=${marker}\n`, 'utf16le');
    const encoded = byteOrder === 'le'
      ? Buffer.concat([Buffer.from([0xff, 0xfe]), utf16])
      : Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(utf16).swap16()]);
    const result = scanFixture(t, { [name]: encoded });
    assert.equal(result.status, 1, `${name} must not escape credential scanning`);
    assert.match(result.stderr, /OpenAI-style secret/);
    assert.ok(result.stderr.includes(name));
    assert.ok(!result.stderr.includes(marker), 'credential bytes must never appear in diagnostics');
  }
  const safe = scanFixture(t, {
    'infra/harmless.ps1': Buffer.concat([
      Buffer.from([0xff, 0xfe]), Buffer.from('Write-Host ok\n', 'utf16le'),
    ]),
  });
  assert.equal(safe.status, 0, 'safe UTF-16 source must remain distributable');
  const truncated = scanFixture(t, {
    'infra/truncated.bin': Buffer.from([0xff, 0xfe, 0x41]),
  });
  assert.equal(truncated.status, 1, 'truncated BOM-marked text must fail closed');
  assert.match(truncated.stderr, /unreadable source text: infra\/truncated\.bin/);
});

test('BOM-less UTF-16 deployment files cannot hide recognizable credentials', (t) => {
  // UTF-16LE/BE files are also emitted without a BOM by some deployment tools.
  // The known ASCII-rich encoding pattern must not be discarded as opaque binary.
  const marker = ['sk', 'v'.repeat(28)].join('-');
  for (const [filename, order] of [
    ['infra/deploy.ps1', 'le'],
    ['scripts/deploy-config', 'be'],
  ]) {
    const le = Buffer.from(`EXAMPLE_TOKEN=${marker}\n`, 'utf16le');
    const encoded = order === 'le' ? le : Buffer.from(le).swap16();
    const result = scanFixture(t, { [filename]: encoded });
    assert.equal(result.status, 1, `${filename} must not bypass the scanner`);
    assert.match(result.stderr, /OpenAI-style secret/);
    assert.ok(result.stderr.includes(filename));
    assert.ok(!result.stderr.includes(marker), 'credential values must remain redacted');
  }
  const safe = scanFixture(t, {
    'infra/safe.ps1': Buffer.from('Write-Host safe\n', 'utf16le'),
  });
  assert.equal(safe.status, 0, 'harmless UTF-16 text must remain distributable');
});

test('malformed executable deployment scripts cannot hide opaque bytes from the source scan', (t) => {
  // Windows PowerShell/CMD and project helper scripts are executable source,
  // not arbitrary binary assets. Reject undecodable bytes even when there is
  // no recognizable credential token to match.
  const malformedUtf8 = Buffer.from([0x23, 0x20, 0xc3, 0x28, 0x0a]);
  for (const name of [
    'infra/deploy.ps1',
    'infra/deploy.psm1',
    'scripts/setup.cmd',
    'scripts/setup.bat',
    'scripts/seed.py',
  ]) {
    const result = scanFixture(t, { [name]: malformedUtf8 });
    assert.equal(result.status, 1, `${name} must reject malformed source text: ${result.stdout} ${result.stderr}`);
    assert.match(result.stderr, /unreadable source text/, `${name} must fail closed`);
  }
  const safe = scanFixture(t, { 'scripts/seed.py': 'print(\"safe\")\n', 'infra/deploy.ps1': 'Write-Host safe\n' });
  assert.equal(safe.status, 0, `ordinary readable helper scripts must stay allowed: ${safe.stderr}`);
});

test('extensionless deployment and CI helpers must be readable source text', (t) => {
  // Executable release tooling can use unconventional names or extensions.
  // Unlike media assets, these reviewed directories cannot silently treat
  // undecodable scripts as opaque binary and skip credential inspection.
  const badUtf8 = Buffer.from([0x23, 0x20, 0xc3, 0x28, 0x0a]);
  const withNul = Buffer.from([0x65, 0x63, 0x68, 0x6f, 0, 0x74, 0x65, 0x73, 0x74]);
  for (const [name, bytes] of [
    ['scripts/deploy-helper', badUtf8],
    ['backend/scripts/prepare-release', withNul],
    ['infra/release-hook.custom', badUtf8],
    ['.github/actions/package/entrypoint', badUtf8],
  ]) {
    const result = scanFixture(t, { [name]: bytes });
    assert.equal(result.status, 1, `${name} must reject unreadable deployment source: ${result.stdout} ${result.stderr}`);
    assert.match(result.stderr, /unreadable source text/, `${name} must fail closed`);
  }
  const safe = scanFixture(t, {
    'scripts/deploy-helper': 'echo safe\n',
    'infra/release-hook.custom': 'echo safe\n',
    'assets/opaque-icon.png': Buffer.from([0, 255, 0, 1]),
  });
  assert.equal(safe.status, 0, `valid deployment text and binary media stay allowed: ${safe.stderr}`);
});

test('PostgreSQL backup artifacts cannot enter a reviewed source package', (t) => {
  // A PostgreSQL custom-format dump can contain real user/order/payment rows.
  // Its bytes are opaque to text scanning and must be rejected, even renamed.
  const customDump = Buffer.concat([Buffer.from('PGDMP'), Buffer.from([1, 15, 0, 4, 8, 1, 0, 0, 0])]);
  for (const [name, bytes] of [
    ['backups/private.dump', Buffer.from([0x00, 0xff, 0x00])],
    ['infra/staging.BACKUP', Buffer.from('opaque database export')],
    ['docs/snapshot.pgdump', Buffer.from('synthetic export')],
    ['assets/renamed.bin', customDump],
  ]) {
    const result = scanFixture(t, { [name]: bytes });
    assert.equal(result.status, 1, `${name} must be rejected: ${result.stdout} ${result.stderr}`);
    assert.match(result.stderr, /PostgreSQL database backup artifact/);
    assert.ok(result.stderr.includes(name));
  }
  const migration = scanFixture(t, {
    'backend/migrations/postgres/0001_core.sql': 'CREATE TABLE demo (id integer);\n',
  });
  assert.equal(migration.status, 0, `reviewed SQL migration must remain allowed: ${migration.stderr}`);
});

test('plain-text PostgreSQL dumps cannot ship as SQL or renamed text source', (t) => {
  // pg_dump and pg_dumpall can emit readable SQL exports with real customer
  // data. A text-only secret scan cannot distinguish that data from fixtures.
  const examples = [
    ['backups/staging.sql', '--\n-- PostgreSQL database dump\n--\n\n-- Dumped by pg_dump version 18.0\n'],
    ['docs/renamed.txt', '--\r\n-- PostgreSQL database cluster dump\r\n--\r\n\r\n'],
    ['infra/export.data', '--\n-- PostgreSQL database dump\n--\n\nCOPY public.orders (id) FROM stdin;\n1\n\\.\n'],
  ];
  for (const [name, contents] of examples) {
    const result = scanFixture(t, { [name]: contents });
    assert.equal(result.status, 1, `${name} must not be packaged: ${result.stdout} ${result.stderr}`);
    assert.match(result.stderr, /PostgreSQL database backup artifact/);
    assert.ok(result.stderr.includes(name));
  }
  const safe = scanFixture(t, {
    'backend/migrations/postgres/0001_core.sql': 'CREATE TABLE demo (id integer);\n',
  });
  assert.equal(safe.status, 0, `reviewed migrations are not database dumps: ${safe.stderr}`);
});

test('SQLite database artifacts cannot ship in reviewed source, even with renamed files', (t) => {
  // Opaque SQLite files may contain customer information and cannot be
  // attested by a source-text secret scan. This test contains only synthetic
  // file signatures and never creates a real customer database.
  const sqlite = Buffer.concat([
    Buffer.from('SQLite format 3\0', 'ascii'),
    Buffer.alloc(96),
  ]);
  for (const [name, bytes] of [
    ['backups/customer.sqlite', Buffer.from('synthetic database placeholder')],
    ['infra/staging.SQLITE3', Buffer.from('synthetic placeholder')],
    ['docs/legacy.db', Buffer.from([0x00, 0xff, 0x00])],
    ['assets/renamed.bin', sqlite],
  ]) {
    const result = scanFixture(t, { [name]: bytes });
    assert.equal(result.status, 1, `${name} must be rejected: ${result.stdout} ${result.stderr}`);
    assert.match(result.stderr, /SQLite database artifact in source/);
    assert.ok(result.stderr.includes(name));
  }
  const safe = scanFixture(t, {
    'backend/migrations/postgres/0001_core.sql': 'CREATE TABLE demo (id integer);\n',
    'assets/icon.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0xff]),
  });
  assert.equal(safe.status, 0, `Postgres migrations and ordinary assets remain allowed: ${safe.stderr}`);
});

test('SQLite WAL and journal sidecars cannot leak committed database pages through source handoffs', (t) => {
  // WAL frames and rollback journals can contain database page contents even
  // when the main .sqlite/.db file is absent. Use synthetic headers only.
  const walMagic = Buffer.concat([Buffer.from([0x37, 0x7f, 0x06, 0x82]), Buffer.alloc(40)]);
  const cases = [
    ['backups/customer.sqlite-wal', Buffer.from([0x00, 0xff, 0x01])],
    ['infra/customer.db-journal', Buffer.from('synthetic rollback journal')],
    ['docs/customer.sqlite-shm', Buffer.from([0x00, 0xff, 0x01])],
    ['assets/renamed-wal.bin', walMagic],
  ];
  for (const [name, bytes] of cases) {
    const result = scanFixture(t, { [name]: bytes });
    assert.equal(result.status, 1, `${name} must not pass source scanning: ${result.stdout} ${result.stderr}`);
    assert.match(result.stderr, /SQLite database artifact in source/);
    assert.ok(result.stderr.includes(name));
  }
  const safe = scanFixture(t, {
    'backend/migrations/postgres/0001_core.sql': 'CREATE TABLE demo (id integer);\n',
    'assets/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff]),
  });
  assert.equal(safe.status, 0, `normal source and media must remain allowed: ${safe.stderr}`);
});

test('renamed SQLite rollback-journal headers cannot bypass the source scanner', (t) => {
  // SQLite rollback journals contain old copies of changed database pages.
  // A renamed binary journal must still be recognized by its documented magic.
  const journal = Buffer.concat([
    Buffer.from([0xd9, 0xd5, 0x05, 0xf9, 0x20, 0xa1, 0x63, 0xd7]),
    Buffer.alloc(40),
  ]);
  const result = scanFixture(t, { 'assets/renamed-recovery.bin': journal });
  assert.equal(result.status, 1, `renamed journal must fail: ${result.stdout} ${result.stderr}`);
  assert.match(result.stderr, /SQLite database artifact in source/);
  assert.doesNotMatch(result.stderr, /\xd9|\xd5/i);

  const safe = scanFixture(t, {
    'backend/migrations/postgres/0001_core.sql': 'CREATE TABLE demo (id integer);\n',
    'assets/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff]),
  });
  assert.equal(safe.status, 0, `ordinary SQL and PNG assets must remain allowed: ${safe.stderr}`);
});

test('nested binary archives cannot hide secrets inside a published source artifact', (t) => {
  // A source manifest hashes an archive as opaque bytes; it does not inspect
  // contained environment files or keys. Reject compressed source containers
  // rather than claiming the text-only secret scan checked their contents.
  const fakeZipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
  const fakeGzipHeader = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0]);
  for (const [name, bytes] of [
    ['backups/export.zip', fakeZipHeader],
    ['infra/legacy.tar.gz', fakeGzipHeader],
    ['backend/archive.jar', fakeZipHeader],
    ['assets/disguised.dat', fakeZipHeader],
  ]) {
    const result = scanFixture(t, { [name]: bytes });
    assert.equal(result.status, 1, `${name} must never pass as an uninspected archive`);
    assert.match(result.stderr, /nested binary archive in source/);
    assert.ok(result.stderr.includes(name));
  }
  const ordinary = scanFixture(t, { 'assets/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0xff]) });
  assert.equal(ordinary.status, 0, 'normal binary assets are not nested source archives');
});

test('disguised TAR, XZ and bzip2 containers cannot bypass source archive scanning', (t) => {
  // TAR magic is at byte 257 rather than byte zero; XZ/bzip2 have different
  // magic than ZIP/gzip. A renamed binary archive must not become an opaque,
  // unscanned dependency of a supposedly secret-scanned source package.
  const tar = Buffer.alloc(1024);
  tar.write('data/.env', 0, 'ascii');
  tar.write('ustar\0', 257, 'ascii');
  tar.write('00', 263, 'ascii');
  const xz = Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00, 0x00, 0x00]);
  const bzip2 = Buffer.from([0x42, 0x5a, 0x68, 0x39, 0x00, 0x00, 0x00, 0x00]);
  for (const [name, bytes] of [
    ['assets/hidden-tar.dat', tar],
    ['infra/hidden-xz.bin', xz],
    ['backend/hidden-bzip2.dat', bzip2],
  ]) {
    const result = scanFixture(t, { [name]: bytes });
    assert.equal(result.status, 1, `${name} must not pass as an opaque source file`);
    assert.match(result.stderr, /nested binary archive in source/);
    assert.ok(result.stderr.includes(name));
  }
  const image = scanFixture(t, {
    'assets/safe-image.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]),
  });
  assert.equal(image.status, 0, 'ordinary binary images remain allowed');
});

test('an unreviewed source symlink fails closed instead of being omitted', (t) => {
  const result = scanFixture(t, {}, { 'private.txt': 'nonexistent-target' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unreviewed source symlink: private\.txt/);
});

posixTest('scanner runs as a required code-failure gate in the Packet 0 runner', () => {
  const result = spawnSync('bash', ['-n', verifier], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const source = readFileSync(verifier, 'utf8');
  assert.match(source, /run_required 'Source artifact secret scan' node scripts\/secret-scan\.mjs/);
  assert.ok(source.indexOf("run_required 'Source artifact secret scan'") < source.indexOf('== Full Node baseline =='));
});


test('private key and release keystore files are rejected regardless of binary contents', (t) => {
  const result = scanFixture(t, { 'backend/cert.pem': 'binary-sample', 'android/release.jks': 'binary-sample' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /private credential\/keystore file included in source: backend\/cert\.pem/);
  assert.match(result.stderr, /android\/release\.jks/);
});

test('mobile signing keys and plaintext platform configuration are scanned before source publication', (t) => {
  // App Store Connect private keys use a .p8 extension, which is not a
  // generic script/config suffix. Even opaque .p8 material must be excluded
  // from published source artifacts, alongside already-rejected keystores.
  for (const name of ['ios/AuthKey_example.p8', 'ios/App_Store.mobileprovision']) {
    const result = scanFixture(t, { [name]: 'synthetic binary credential fixture\n' });
    assert.equal(result.status, 1, `${name} must be rejected without relying on detectable key text`);
    assert.match(result.stderr, /private credential\/keystore file included in source/);
    assert.ok(result.stderr.includes(name));
  }
  // Source text in Apple/mobile config and SVG assets can contain API keys.
  // Use a synthetic marker that matches the existing high-confidence detector.
  const marker = ['sk', 'a'.repeat(28)].join('-');
  for (const name of ['ios/Runner/Info.plist', 'ios/Flutter/Release.xcconfig',
    'ios/Runner.xcodeproj/project.pbxproj', 'assets/badge.svg']) {
    const result = scanFixture(t, { [name]: `FAKE_TOKEN=${marker}\n` });
    assert.equal(result.status, 1, `${name} must be inspected for secrets`);
    assert.match(result.stderr, /OpenAI-style secret/);
    assert.ok(!result.stderr.includes(marker), 'secret values must remain redacted');
  }
});

posixTest('the source packaging script scans before verified atomic archive replacement', () => {
  const scriptSource = readFileSync(packageScript, 'utf8');
  assert.ok(scriptSource.includes('node scripts/secret-scan.mjs'));
  const replacement = scriptSource.indexOf('mv -f -T -- "$staged_zip"');
  assert.ok(replacement > scriptSource.indexOf('node scripts/secret-scan.mjs'));
  assert.match(scriptSource, /unzip -tq "\$staged_zip"/);
  assert.doesNotMatch(scriptSource, /rm -f "\$OUTPUT"/);
  assert.equal(spawnSync('bash', ['-n', packageScript], { encoding: 'utf8' }).status, 0);
});

posixTest('failed packaging secret scan preserves an existing output archive', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'nearpill-package-guard-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  copyFileSync(scanner, join(root, 'scripts', 'secret-scan.mjs'));
  copyFileSync(packageScript, join(root, 'scripts', 'package-source.sh'));
  copyFileSync(new URL('../../scripts/verify-source-manifest.mjs', import.meta.url),
    join(root, 'scripts', 'verify-source-manifest.mjs'));
  mkdirSync(join(root, 'docs'));
  const digest = (name) => createHash('sha256').update(readFileSync(join(root, 'scripts', name))).digest('hex');
  writeFileSync(join(root, 'docs/packet0-source-manifest-2026-10-21.sha256'),
    ['secret-scan.mjs', 'verify-source-manifest.mjs']
      .map((name) => `${digest(name)}  scripts/${name}\n`).join(''));
  // Unlike the scanner-only test, this executes the actual packaging script.
  writeFileSync(join(root, '.env'), 'TEST_VALUE=dummy');
  const existing = join(root, 'existing.zip');
  writeFileSync(existing, 'do-not-delete');
  const result = spawnSync('bash', [join(root, 'scripts', 'package-source.sh'), existing], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /local environment file included in source/);
  assert.equal(readFileSync(existing, 'utf8'), 'do-not-delete');
});

posixTest('packaging a verified archive cannot be diverted into a late directory symlink', (t) => {
  // Model the filesystem changing after both preflight scans and ZIP checks,
  // immediately before publication. Ordinary `mv -f` treats a symlink to a
  // directory as a directory and silently deposits source.zip *inside* it.
  const fixture = mkdtempSync(join(tmpdir(), 'nearpill-package-publish-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const app = join(fixture, 'app');
  const outputDir = join(fixture, 'out');
  const bin = join(fixture, 'bin');
  const diverted = join(fixture, 'diverted');
  mkdirSync(join(app, 'scripts'), { recursive: true });
  mkdirSync(join(app, 'docs'), { recursive: true });
  mkdirSync(outputDir);
  mkdirSync(bin);
  mkdirSync(diverted);
  for (const [name, origin] of [
    ['scripts/package-source.sh', packageScript],
    ['scripts/secret-scan.mjs', scanner],
    ['scripts/verify-source-manifest.mjs', fileURLToPath(new URL('../../scripts/verify-source-manifest.mjs', import.meta.url))],
  ]) copyFileSync(origin, join(app, name));
  writeFileSync(join(app, 'README.md'), 'synthetic source packaging fixture\n');
  const reviewed = ['README.md', 'scripts/package-source.sh', 'scripts/secret-scan.mjs', 'scripts/verify-source-manifest.mjs'];
  const lines = reviewed.map((name) => `${createHash('sha256').update(readFileSync(join(app, name))).digest('hex')}  ${name}`);
  writeFileSync(join(app, 'docs/packet0-source-manifest-2026-10-21.sha256'), `${lines.join('\n')}\n`);

  const output = join(outputDir, 'nearpill.zip');
  const lateMv = join(bin, 'mv');
  writeFileSync(lateMv, `#!/bin/sh\nln -s -- '${diverted}' '${output}'\nexec /usr/bin/mv "$@"\n`, { mode: 0o755 });
  const completed = spawnSync('bash', [join(app, 'scripts/package-source.sh'), output], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH || ''}` },
    encoding: 'utf8', timeout: 20_000,
  });
  assert.equal(completed.status, 0, completed.stderr);
  assert.equal(lstatSync(output).isFile(), true, 'publish must resolve to the exact approved output filename');
  assert.deepEqual(readdirSync(diverted), [], 'no verified archive may be diverted into a symlink target directory');
  const integrity = spawnSync('unzip', ['-tq', output], { encoding: 'utf8' });
  assert.equal(integrity.status, 0, integrity.stderr);

  // A regular directory substituted at publish time must be rejected, not
  // treated as a destination that receives an extra source.zip entry.
  rmSync(output);
  writeFileSync(lateMv, `#!/bin/sh\nmkdir -p -- '${output}'\nexec /usr/bin/mv "$@"\n`, { mode: 0o755 });
  const withDirectory = spawnSync('bash', [join(app, 'scripts/package-source.sh'), output], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH || ''}` },
    encoding: 'utf8', timeout: 20_000,
  });
  assert.notEqual(withDirectory.status, 0, 'a directory appearing at the publish path must cause failure');
  assert.deepEqual(readdirSync(output), [], 'the source ZIP cannot be written inside a substituted directory');
});

test('source packaging scan skips generated browser artifacts but still rejects first-party secrets', (t) => {
  const fakeToken = ['sk', 'a'.repeat(28)].join('-');
  const generated = scanFixture(t, {
    'web/dist/bundle.js': `const token = '${fakeToken}';`,
    'web/playwright-report/index.html': `generated ${fakeToken}`,
    'web/test-results/results.json': `"generated": "${fakeToken}"`,
    'web/playwright/.auth/state.json': `"generated": "${fakeToken}"`,
  });
  assert.equal(generated.status, 0, generated.stderr);
  const source = scanFixture(t, {
    'web/src/config.ts': `const token = '${fakeToken}';`,
  });
  assert.equal(source.status, 1, source.stderr);
  assert.match(source.stderr, /OpenAI-style secret: web\/src\/config\.ts/);
});


test('Supabase elevated secret keys are rejected in backend, SQL and client files', (t) => {
  const fakeSecret = ['sb', 'secret', 'S'.repeat(32)].join('_');
  for (const name of [
    'backend/src/config.ts',
    'backend/migrations/postgres/0002_rls.sql',
    'web/src/api.ts',
    'lib/core/config/api_config.dart',
  ]) {
    const result = scanFixture(t, { [name]: `SUPABASE_SECRET_KEY=${fakeSecret}\n` });
    assert.equal(result.status, 1, `${name}: ${result.stdout}`);
    assert.match(result.stderr, /Supabase secret key/);
    assert.ok(result.stderr.includes(name));
    assert.ok(!result.stderr.includes(fakeSecret), 'secret value must not appear in logs');
  }
});

test('legacy Supabase service_role JWT is detected without flagging public anon credentials', (t) => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const jwt = (role) => [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({ role, iss: 'supabase', ref: 'not-a-real-project' }),
    'f'.repeat(43),
  ].join('.');
  const elevated = jwt('service_role');
  const result = scanFixture(t, { 'infra/nginx/keys.conf': `apikey=${elevated}\n` });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /Supabase service-role JWT: infra\/nginx\/keys\.conf/);
  assert.ok(!result.stderr.includes(elevated), 'JWT value must be redacted');
  const publicKey = ['sb', 'publishable', 'p'.repeat(32)].join('_');
  const allowed = scanFixture(t, {
    'web/src/config.ts': `anon=${jwt('anon')}\npublishable=${publicKey}\n`,
    'README.md': 'An invalid token eyJnot.a.jwt\n',
  });
  assert.equal(allowed.status, 0, allowed.stderr);
});


test('npm registry credentials in .npmrc must be env references, never inline secrets', (t) => {
  const credentialCases = [
    '//registry.npmjs.org/:_authToken=ordinaryOpaqueTokenNotMatchedByOtherDetectors',
    '//registry.npmjs.org/:_password=bm90LWFjdHVhbC1wYXNzd29yZA==',
    '//registry.npmjs.org/:_auth=YmFzaWMtYXV0aC1zdHJpbmc=',
    '_authToken=literalCredentialInUnscopedConfig',
  ];
  for (const [i, credential] of credentialCases.entries()) {
    const result = scanFixture(t, { [i % 2 ? 'web/.npmrc' : '.npmrc']: `${credential}\n` });
    assert.equal(result.status, 1, `literal npm credential must fail: case ${i}`);
    assert.match(result.stderr, /inline npm registry credential/);
    assert.ok(!result.stderr.includes(credential.split('=')[1]), 'never log the credential');
  }
  const allowed = scanFixture(t, {
    '.npmrc': '//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n# _authToken=comment\n',
    'web/.npmrc': '//registry.npmjs.org/:_password=${NPM_PASSWORD?}\n',
  });
  assert.equal(allowed.status, 0, allowed.stderr);
});


test('npmrc registry URLs cannot embed HTTP basic-auth credentials', (t) => {
  const protocol = ['https', '://'].join('');
  const credential = 'synthetic-opaque-registry-password';
  for (const name of ['.npmrc', 'web/.NPMRC']) {
    const result = scanFixture(t, {
      [name]: `registry=${protocol}builder:${credential}@registry.example.invalid/\n`,
    });
    assert.equal(result.status, 1, `${name} must reject credentialed registry URLs: ${result.stdout} ${result.stderr}`);
    assert.match(result.stderr, /authenticated registry URL/);
    assert.doesNotMatch(result.stderr, new RegExp(credential), 'never print registry credentials');
  }
  const allowed = scanFixture(t, {
    '.npmrc': `registry=${protocol}builder:${'${NPM_PASSWORD}'}@registry.example.invalid/\n`,
    'web/.npmrc': `registry=${protocol}registry.npmjs.org/\n`,
  });
  assert.equal(allowed.status, 0, allowed.stderr);
});

test('case-variant npm config and lockfile names cannot conceal registry credentials', (t) => {
  // Windows source handoffs may surface these case variants as the canonical
  // npm configuration filenames. The scanner must not rely on exact casing.
  const opaqueToken = 'ordinaryFixtureCredentialNotMatchingPrefixRules';
  for (const name of ['.NPMRC', 'web/.NpmRc']) {
    const result = scanFixture(t, { [name]: `//registry.npmjs.org/:_authToken=${opaqueToken}\n` });
    assert.equal(result.status, 1, `${name}: ${result.stdout} ${result.stderr}`);
    assert.match(result.stderr, /inline npm registry credential/i);
    assert.ok(!result.stderr.includes(opaqueToken), 'never log the credential');
  }
  const registry = 'https://builder:opaque-fixture-credential@registry.example.invalid/pkg.tgz';
  for (const name of ['PACKAGE-LOCK.JSON', 'backend/Npm-Shrinkwrap.Json']) {
    const result = scanFixture(t, { [name]: JSON.stringify({ resolved: registry }) });
    assert.equal(result.status, 1, `${name}: ${result.stdout} ${result.stderr}`);
    assert.match(result.stderr, /authenticated registry URL/i);
    assert.ok(!result.stderr.includes('opaque-fixture-credential'), 'never log the credential');
  }
  const allowed = scanFixture(t, {
    '.NPMRC': '//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n',
    'PACKAGE-LOCK.JSON': JSON.stringify({ resolved: 'https://registry.npmjs.org/pkg.tgz' }),
  });
  assert.equal(allowed.status, 0, allowed.stderr);
});

test('npm registry query credentials cannot enter source through .npmrc or lockfile URLs', (t) => {
  // A private registry or artifact gateway may authenticate using query
  // parameters rather than HTTP userinfo. Inspect URL-encoded parameter names
  // too, but permit credentials supplied at runtime through npm env templates.
  const secret = 'synthetic-private-registry-credential';
  for (const [name, value] of [
    ['.npmrc', `registry=https://npm.example.invalid/?access_token=${secret}\n`],
    ['backend/.NPMRC', `@nearpill:registry=https://npm.example.invalid/?%74oken=${secret}\n`],
    ['package-lock.json', JSON.stringify({ packages: { 'node_modules/x': {
      resolved: `https://npm.example.invalid/x.tgz?authToken=${secret}`,
    } } })],
  ]) {
    const result = scanFixture(t, { [name]: value });
    assert.equal(result.status, 1, `${name} must reject an embedded registry query credential: ${result.stdout}`);
    assert.match(result.stderr, /credentialed registry query parameter/i);
    assert.ok(!result.stderr.includes(secret), 'credential value must stay out of diagnostic output');
  }
  const allowed = scanFixture(t, {
    '.npmrc': 'registry=https://npm.example.invalid/?access_token=${NPM_TOKEN}\n',
    'backend/package-lock.json': JSON.stringify({ packages: { 'node_modules/x': {
      resolved: 'https://npm.example.invalid/x.tgz?token=${NPM_TOKEN}',
    } } }),
  });
  assert.equal(allowed.status, 0, allowed.stderr);
});

test('JSON-escaped npm lockfile URLs cannot hide registry credentials from source scanning', (t) => {
  // JSON decoding makes escaped slashes and Unicode escapes into real URL
  // characters. npm uses decoded `resolved` values, not their raw text.
  const credential = 'synthetic-registry-only-credential';
  const examples = [
    JSON.stringify({ packages: { 'node_modules/a': {
      resolved: `https://ci:${credential}@npm.example.invalid/a.tgz`,
    } } }).replaceAll('/', '\\/'),
    JSON.stringify({ packages: { 'node_modules/b': {
      resolved: `https://npm.example.invalid/b.tgz?token=${credential}`,
    } } }).replace('https', 'h\\u0074tps').replaceAll('/', '\\/'),
  ];
  for (const [i, json] of examples.entries()) {
    const name = i === 0 ? 'package-lock.json' : 'backend/npm-shrinkwrap.json';
    assert.doesNotThrow(() => JSON.parse(json), 'fixture is valid JSON');
    const result = scanFixture(t, { [name]: json });
    assert.equal(result.status, 1, `${name} allowed escaped credential-bearing JSON: ${result.stdout}`);
    assert.match(result.stderr, /registry|credential/i);
    assert.ok(!result.stderr.includes(credential), 'never print credential values');
  }
  const safe = JSON.stringify({ packages: { 'node_modules/safe': {
    resolved: 'https://npm.example.invalid/safe.tgz?token=${NPM_TOKEN}',
  } } }).replaceAll('/', '\\/');
  const safeResult = scanFixture(t, { 'package-lock.json': safe });
  assert.equal(safeResult.status, 0, safeResult.stderr);
  const brokenResult = scanFixture(t, { 'npm-shrinkwrap.json': '{invalid-json' });
  assert.equal(brokenResult.status, 1, 'malformed lockfiles must fail closed');
  assert.match(brokenResult.stderr, /invalid npm lockfile JSON/);
});

test('JSON-escaped npm lockfile metadata cannot conceal high-confidence secret tokens', (t) => {
  // A raw-text regex cannot recognize a secret when a valid JSON Unicode
  // escape splits its prefix. The decoded content is the actual lockfile data.
  const token = ['sk', 'proj', 'Q'.repeat(28)].join('-');
  const json = JSON.stringify({ lockfileVersion: 3, packages: {}, metadata: { token } })
    .replace('sk-', 's\\u006b-');
  assert.equal(JSON.parse(json).metadata.token, token);
  const result = scanFixture(t, { 'backend/package-lock.json': json });
  assert.equal(result.status, 1, `encoded credential was accepted: ${result.stdout} ${result.stderr}`);
  assert.match(result.stderr, /secret in decoded npm lockfile/i);
  assert.ok(!result.stderr.includes(token), 'secret value must not appear in diagnostics');

  const allowed = scanFixture(t, {
    'backend/package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: {},
      metadata: { token: '${NPM_TOKEN}', checksum: 'public-checksum' } }),
  });
  assert.equal(allowed.status, 0, allowed.stderr);
});

test('ordinary application JSON is decoded before high-confidence secret screening', (t) => {
  // Only npm JSON received decoded-string screening previously. App JSON is
  // likewise parsed by consumers, so Unicode escapes must not conceal secrets.
  const token = ['sb', 'secret', 'SyntheticFixtureOnly'.repeat(2)].join('_');
  const credential = 'SyntheticConfigDatabasePasswordNeverUse';
  const uri = `${['post', 'gresql'].join('')}://nearpill:${credential}@db.example.invalid/nearpill`;
  const samples = [
    ['web/public/config.json', JSON.stringify({ apiKey: token })
      .replace('sb_secret_', 's\\u0062_secret_'), 'apiKey', token],
    ['backend/config/settings.json', JSON.stringify({ connection: uri })
      .replace('postgresql://', 'p\\u006fstgresql://'), 'connection', uri],
  ];
  for (const [name, json, field, value] of samples) {
    assert.equal(JSON.parse(json)[field], value, 'JSON escape reconstructs the credential');
    assert.ok(json.includes('\\u00'), 'raw JSON actually contains a Unicode escape');
    const result = scanFixture(t, { [name]: json });
    assert.equal(result.status, 1, `${name} permitted an escaped credential: ${result.stdout}`);
    assert.match(result.stderr, /decoded application JSON/i);
    assert.ok(!result.stderr.includes(value) && !result.stderr.includes(credential),
      'diagnostics must never disclose a detected credential');
  }
  const allowed = scanFixture(t, {
    'web/public/config.json': JSON.stringify({ apiBase: '/api/v1', asset: 'public.svg' }),
    'backend/config/settings.json': JSON.stringify({ databaseUrl: '${DATABASE_URL}' }),
  });
  assert.equal(allowed.status, 0, allowed.stderr);
});

test('decoded npm lockfile auth fields cannot hide opaque registry credentials', (t) => {
  // npm credentials need not resemble a provider token. Check decoded JSON
  // object property names, including registry-scoped auth keys.
  const opaqueCredential = 'opaqueFixtureCredentialWithoutRecognizedTokenPrefix';
  for (const name of ['package-lock.json', 'backend/npm-shrinkwrap.json']) {
    const result = scanFixture(t, { [name]: JSON.stringify({
      lockfileVersion: 3,
      metadata: { '//registry.example.invalid/:_authToken': opaqueCredential },
    }) });
    assert.equal(result.status, 1, `${name} must reject an inline npm auth field: ${result.stdout}`);
    assert.match(result.stderr, /inline npm auth field in decoded lockfile/i);
    assert.ok(!result.stderr.includes(opaqueCredential), 'never log credential values');
  }
  const allowed = scanFixture(t, {
    'package-lock.json': JSON.stringify({ lockfileVersion: 3, metadata: {
      '_authToken': '${NPM_TOKEN}', '_password': '${NPM_PASSWORD}',
      'integrity': 'sha512-public-fixture',
    } }),
  });
  assert.equal(allowed.status, 0, allowed.stderr);
});

test('JSON-escaped npm package manifests cannot conceal registry credentials', (t) => {
  // npm consumes decoded package.json publishConfig values; the raw source
  // can hide the URL scheme or password behind valid JSON escapes.
  const credential = ['fixture', 'registry', 'password'].join('-');
  const manifest = JSON.stringify({ name: 'fixture', version: '1.0.0', publishConfig: {
    registry: `https://publisher:${credential}@npm.example.invalid/`,
  } }).replace('https', 'h\\u0074tps').replaceAll('/', '\\/');
  assert.equal(JSON.parse(manifest).publishConfig.registry,
    `https://publisher:${credential}@npm.example.invalid/`);
  const result = scanFixture(t, { 'web/package.json': manifest });
  assert.equal(result.status, 1, `decoded manifest registry credential escaped detection: ${result.stdout}`);
  assert.match(result.stderr, /decoded npm|registry credential/i);
  assert.ok(!result.stderr.includes(credential), 'never print credentials in diagnostics');

  const safe = scanFixture(t, { 'package.json': JSON.stringify({ name: 'fixture',
    publishConfig: { registry: 'https://npm.example.invalid/' },
    config: { token: '${NPM_TOKEN}' },
  }) });
  assert.equal(safe.status, 0, safe.stderr);
});

test('decoded npm JSON cannot hide libpq environment passwords behind Unicode escapes', (t) => {
  const key = ['PG', 'PASSWORD'].join('');
  const credential = 'SyntheticLibpqPasswordForDecodedFixtureOnly';
  for (const filename of ['package.json', 'backend/package-lock.json']) {
    const original = JSON.stringify({ name: 'synthetic-fixture', scripts: {
      backup: `export ${key}='${credential}' pg_dump --version`,
    } });
    const escaped = original.replace(key, 'PGPASS\\u0057ORD');
    assert.notEqual(escaped, original, 'fixture must actually contain a JSON escape');
    assert.ok(JSON.parse(escaped).scripts.backup.includes(key));
    const result = scanFixture(t, { [filename]: escaped });
    assert.equal(result.status, 1, `${filename} must reject decoded libpq secrets: ${result.stdout}`);
    assert.match(result.stderr, /secret in decoded npm|credential in decoded npm/i);
    assert.ok(!result.stderr.includes(credential), 'never print the password');
  }
  const allowed = scanFixture(t, { 'package.json': JSON.stringify({ scripts: {
    backup: `export ${key}=${'${MIGRATOR_PASSWORD}'} pg_dump --version`,
  } }) });
  assert.equal(allowed.status, 0, allowed.stderr);
});

test('decoded npm JSON cannot hide JDBC or libpq conninfo credentials', (t) => {
  const credential = 'SyntheticConnectionPasswordForDecodedFixtureOnly';
  const jdbcPrefix = ['jdbc', 'postgresql'].join(':');
  const option = ['pass', 'word'].join('');
  const jdbc = JSON.stringify({ config: { connection: `${jdbcPrefix}:sample?${option}=${credential}` } })
    .replace(`${option}=`, 'pass\\u0077ord=');
  const conninfo = JSON.stringify({ config: { connection: `host=localhost dbname=nearpill ${option}=${credential}` } })
    .replace(`${option}=`, 'pass\\u0077ord=');
  for (const [name, contents] of [
    ['web/package.json', jdbc], ['npm-shrinkwrap.json', conninfo],
  ]) {
    const result = scanFixture(t, { [name]: contents });
    assert.equal(result.status, 1, `${name} must reject decoded DB credentials: ${result.stdout}`);
    assert.match(result.stderr, /secret in decoded npm|credential in decoded npm/i);
    assert.ok(!result.stderr.includes(credential));
  }
});

test('packaged npm lockfiles are scanned for secrets and authenticated registry URLs', (t) => {
  const fakeToken = ['sk', 'a'.repeat(28)].join('-');
  const registry = 'https://builder:opaque-fixture-credential@registry.example.invalid/package/-/package-1.0.0.tgz';
  for (const name of ['package-lock.json', 'backend/package-lock.json', 'web/npm-shrinkwrap.json']) {
    const source = JSON.stringify({ name: 'nearpill-fixture', lockfileVersion: 3, packages: {
      'node_modules/fixture': { resolved: registry, metadata: fakeToken },
    } });
    const result = scanFixture(t, { [name]: source });
    assert.equal(result.status, 1, `${name} must be covered`);
    assert.ok(result.stderr.includes(name), `scan evidence identifies ${name}`);
    assert.match(result.stderr, /OpenAI-style secret/);
    assert.match(result.stderr, /authenticated registry URL/);
    assert.ok(!result.stderr.includes(fakeToken), 'token must never appear in diagnostics');
    assert.ok(!result.stderr.includes('opaque-fixture-credential'), 'URL password must never appear in diagnostics');
  }
  const allowed = scanFixture(t, {
    'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: {
      'node_modules/fixture': { resolved: 'https://registry.npmjs.org/fixture/-/fixture-1.0.0.tgz' },
    } }),
  });
  assert.equal(allowed.status, 0, allowed.stderr);
});


test('credential-bearing PostgreSQL URLs cannot be shipped in first-party source', (t) => {
  const credential = 'sampleLocalDatabasePasswordOnlyForNegativeTest';
  const scheme = ['postgre', 'sql'].join('');
  const sources = [
    'backend/src/db.ts',
    'backend/drizzle.config.ts',
    'infra/database.yml',
  ];
  for (const file of sources) {
    const result = scanFixture(t, { [file]: `DATABASE_URL=${scheme}://nearpill_app:${credential}@db.test.invalid/nearpill\n` });
    assert.equal(result.status, 1, `must reject embedded DB passwords in ${file}: ${result.stdout}`);
    assert.match(result.stderr, /credentialed PostgreSQL URL/);
    assert.ok(!result.stderr.includes(credential), 'credential must be redacted');
  }
  const allowed = scanFixture(t, {
    'docs/database.md': `${scheme}://postgres:[YOUR-PASSWORD]@db.example.invalid/postgres\n`,
    'infra/database.yml': `DATABASE_URL: ${scheme}://nearpill_app:${'${DATABASE_PASSWORD}'}@db.test.invalid/nearpill\n`,
  });
  assert.equal(allowed.status, 0, allowed.stderr);
});

// SQLAlchemy/async driver URLs use a '+driver' suffix in the protocol.
// The same database password must not evade the source-artifact gate merely
// because the URL uses a PostgreSQL dialect name rather than libpq's scheme.
test('PostgreSQL dialect URLs reject literal secrets and retain safe placeholders', (t) => {
  const scheme = ['postgre', 'sql+psycopg'].join('');
  const asyncScheme = ['postgre', 'sql+asyncpg'].join('');
  const credential = ['Synthetic', 'Dialect', 'Only', 'Credential'].join('');
  for (const url of [
    `${scheme}://app:${credential}@db.example.invalid/nearpill`,
    `${asyncScheme}://db.example.invalid/nearpill?password=${credential}`,
    `${scheme}://db.example.invalid/nearpill?%70assword=${credential}`,
  ]) {
    const result = scanFixture(t, { 'infra/database.py': `DATABASE_URI = ${JSON.stringify(url)}\n` });
    assert.equal(result.status, 1, 'driver-suffixed PostgreSQL URL must never ship a literal password');
    assert.match(result.stderr, /credentialed PostgreSQL URL/);
    assert.ok(!result.stderr.includes(credential), 'source-scanning diagnostic must redact credentials');
  }
  const allowed = scanFixture(t, {
    'infra/database.py': `DATABASE_URI = ${JSON.stringify(`${scheme}://app:${'${DATABASE_PASSWORD}'}@db.example.invalid/nearpill`)}\n`,
    'docs/database.md': `${asyncScheme}://app:[YOUR-PASSWORD]@db.example.invalid/nearpill\n`,
  });
  assert.equal(allowed.status, 0, allowed.stderr);
});

// YAML consumers decode quoted hex/Unicode escapes before passing URLs to
// PostgreSQL drivers. A source gate must inspect that effective value, not
// treat an encoded slash or @ as preventing credentials from being usable.
test('YAML double-quoted escaped PostgreSQL URLs cannot conceal credentials', (t) => {
  const scheme = ['postgre', 'sql'].join('');
  const password = ['Opaque', 'Yaml', 'Fixture', 'Password'].join('');
  const slash = String.raw`\x2F`;
  const unicodeSlash = String.raw`\u002F`;
  const atSign = String.raw`\u0040`;
  const samples = [
    `${scheme}:${slash}${slash}app:${password}@db.example.invalid/nearpill`,
    `${scheme}:${unicodeSlash}${unicodeSlash}app:${password}${atSign}db.example.invalid/nearpill`,
    `${scheme}:${slash}${slash}db.example.invalid/nearpill?%70assword=${password}`,
  ];
  for (const encoded of samples) {
    const checked = scanFixture(t, { 'infra/database.yaml': `connection: "${encoded}"\n` });
    assert.equal(checked.status, 1, 'effective YAML-encoded PostgreSQL credentials must be rejected');
    assert.match(checked.stderr, /credentialed PostgreSQL URL in YAML-escaped scalar/);
    assert.ok(!checked.stderr.includes(password), 'never print credentials in scanner findings');
  }
  const permitted = scanFixture(t, {
    'infra/database.yaml': `connection: "${scheme}:${slash}${slash}app:${'${DATABASE_PASSWORD}'}@db.example.invalid/nearpill"\n`,
    'docs/connection.yml': `connection: "${scheme}:${slash}${slash}app:[YOUR-PASSWORD]@db.example.invalid/nearpill"\n`,
    'infra/escaped.yml': `connection: "${scheme}:${String.raw`\\x2F`}${String.raw`\\x2F`}app:${password}@db.example.invalid/nearpill"\n`,
  });
  assert.equal(permitted.status, 0, permitted.stderr);
});

test('PostgreSQL URI query-password credentials are rejected without logging their values', (t) => {
  // libpq accepts password= in the URI query, not only user:password@host.
  // Assemble the URI scheme here so this regression source is not a token
  // fixture itself when the main source scanner scans the project.
  const scheme = ['postgre', 'sql'].join('');
  const shortScheme = ['post', 'gres'].join('');
  const password = 'fixtureOpaqueDatabasePasswordOnlyForNegativeTest';
  for (const uri of [
    `${scheme}://db.example.invalid/nearpill?user=nearpill_app&password=${password}`,
    `${shortScheme}://db.example.invalid/nearpill?%70assword=${password}`,
    `${scheme}:///nearpill?host=db.example.invalid&password=${password}`,
    `${scheme}://db.example.invalid/nearpill?sslpassword=${password}`,
  ]) {
    const result = scanFixture(t, { 'backend/config.json': JSON.stringify({ databaseUrl: uri }) });
    assert.equal(result.status, 1, `must reject PostgreSQL query-password credentials: ${result.stdout}`);
    assert.match(result.stderr, /credentialed PostgreSQL URL/);
    assert.ok(!result.stderr.includes(password), 'scanner must never disclose a credential');
  }
  const allowed = scanFixture(t, {
    'docs/connections.md': `${scheme}://db.example.invalid/nearpill?password=[YOUR-PASSWORD]\n`,
    'infra/database.yml': `${scheme}://db.example.invalid/nearpill?password=${"${DATABASE_PASSWORD}"}\n`,
  });
  assert.equal(allowed.status, 0, allowed.stderr);
});

test('libpq keyword/value conninfo passwords are rejected without disclosing their values', (t) => {
  // PostgreSQL accepts credentialed keyword/value conninfo, not only URLs.
  // Compose the option names so this characterization fixture is not itself
  // misidentified as a live credential by the first-party source scanner.
  const option = (name, value) => `${name}=${value}`;
  const host = option(['ho', 'st'].join(''), 'db.example.invalid');
  const dbname = option(['db', 'name'].join(''), 'nearpill');
  const passwordKey = ['pass', 'word'].join('');
  const sslPasswordKey = ['ssl', 'password'].join('');
  const credential = 'OnlyAFixtureCredNeverLogThisValue';
  for (const conninfo of [
    [host, dbname, option(passwordKey, credential)].join(' '),
    [host, option(passwordKey, `'${credential} with spaces'`)].join(' '),
    [dbname, option(sslPasswordKey, credential)].join(' '),
  ]) {
    const result = scanFixture(t, { 'backend/connection.conf': conninfo });
    assert.equal(result.status, 1, `must reject inline libpq conninfo password: ${result.stdout}`);
    assert.match(result.stderr, /credentialed PostgreSQL conninfo/);
    assert.ok(!result.stderr.includes(credential), 'credential must not appear in diagnostics');
  }
  const allowed = scanFixture(t, {
    'docs/connections.md': [
      [host, dbname, option(passwordKey, '[YOUR-PASSWORD]')].join(' '),
      [host, option(passwordKey, '${DATABASE_PASSWORD}')].join(' '),
    ].join('\n'),
    '.env.example': 'DB_HOST=db.example.invalid\nDB_PASSWORD=replace-with-a-secret\n',
  });
  assert.equal(allowed.status, 0, allowed.stderr);
});

test('PostgreSQL password files and credentialed service profiles cannot ship in source', (t) => {
  // libpq supports a separate pgpass file and INI-style service settings.
  // Neither syntax resembles a postgres:// URI nor a one-line conninfo string.
  const credential = 'OpaqueLocalPgpassFixtureOnlyDoNotLog';
  const pgpassEntry = ['db.example.invalid', '5432', 'nearpill', 'nearpill_app', credential].join(':');
  const sensitiveOption = ['pass', 'word'].join('');
  for (const name of ['.pgpass', 'backend/.pgpass', 'infra/postgresql/pgpass.conf']) {
    const result = scanFixture(t, { [name]: pgpassEntry + '\n' });
    assert.equal(result.status, 1, `${name} must be rejected: ${result.stdout}`);
    assert.match(result.stderr, /PostgreSQL password file included in source/);
    assert.ok(result.stderr.includes(name));
    assert.ok(!result.stderr.includes(credential), 'password must not appear in scanner diagnostics');
  }
  for (const name of ['.pg_service.conf', 'infra/postgresql/pg_service.conf']) {
    const result = scanFixture(t, {
      [name]: ['[nearpill]', 'host=db.example.invalid', 'user=nearpill_app', `${sensitiveOption}=${credential}`].join('\n'),
    });
    assert.equal(result.status, 1, `${name} service password must be rejected: ${result.stdout}`);
    assert.match(result.stderr, /credentialed PostgreSQL service configuration/);
    assert.ok(!result.stderr.includes(credential), 'password must not appear in scanner diagnostics');
  }
  const allowed = scanFixture(t, {
    '.pg_service.conf': ['[nearpill]', 'host=db.example.invalid', 'password=${DATABASE_PASSWORD}'].join('\n'),
    'infra/pg_service.conf': ['[staging]', 'host=db.example.invalid', 'sslpassword=[SSL-PASSWORD]'].join('\n'),
    'docs/database.md': '.pgpass is supplied externally, never committed',
  });
  assert.equal(allowed.status, 0, allowed.stderr);
});

test('literal libpq environment passwords cannot ship in scripts or CI source', (t) => {
  // libpq reads this environment variable directly, even without a connection
  // URL. Split the token here so this test itself is not a synthetic leak.
  const passwordOption = ['PG', 'PASSWORD'].join('');
  const credential = 'OpaquePasswordFixtureForNegativeSourceScan';
  for (const [filename, body] of [
    ['infra/db-restore.sh', `export ${passwordOption}='${credential}'\n`],
    ['scripts/db-backup.sh', `env ${passwordOption}=${credential} pg_dump --version\n`],
    ['.github/workflows/backup.yml', `env:\n  ${passwordOption}: ${credential}\n`],
  ]) {
    const result = scanFixture(t, { [filename]: body });
    assert.equal(result.status, 1, `${filename}: hardcoded libpq password escaped the scanner`);
    assert.match(result.stderr, /literal libpq environment password/);
    assert.ok(!result.stderr.includes(credential), 'secret bytes must never appear in diagnostics');
  }
  const safe = scanFixture(t, {
    'infra/db-restore.sh': `env ${passwordOption}="$DB_PASSWORD" pg_restore --version\n`,
    'scripts/db-backup.sh': `export ${passwordOption}='${'${MIGRATOR_DB_PASSWORD}'}'\n`,
    '.github/workflows/backup.yml': `env:\n  ${passwordOption}: ${'${MIGRATOR_DB_PASSWORD}'}\n`,
  });
  assert.equal(safe.status, 0, safe.stderr);
});

test('PowerShell and JavaScript libpq environment assignments cannot embed passwords', (t) => {
  // Source deployments may set libpq's password variable through PowerShell
  // or Node. These syntax forms were invisible to the shell/YAML-only rule.
  const key = ['PG', 'PASSWORD'].join('');
  const secret = 'SyntheticDatabasePasswordNeverPublished';
  for (const [name, body] of [
    ['infra/restore.ps1', `$env:${key} = '${secret}'\n`],
    ['scripts/backup.mjs', `process.env.${key} = \"${secret}\";\n`],
    ['infra/config.ts', `process.env['${key}'] = '${secret}';\n`],
    ['infra/config2.js', `process.env[\"${key}\"] = '${secret}';\n`],
  ]) {
    const result = scanFixture(t, { [name]: body });
    assert.equal(result.status, 1, `${name}: embedded libpq password was not blocked`);
    assert.match(result.stderr, /literal libpq environment password/);
    assert.doesNotMatch(result.stderr, new RegExp(secret));
  }
  const safe = scanFixture(t, {
    'infra/restore.ps1': `$env:${key} = $env:MIGRATOR_DB_PASSWORD\n`,
    'scripts/backup.mjs': `process.env.${key} = process.env.MIGRATOR_DB_PASSWORD;\n`,
    'infra/config.ts': `process.env['${key}'] = process.env.MIGRATOR_DB_PASSWORD;\n`,
  });
  assert.equal(safe.status, 0, safe.stderr);
});

test('Python database helpers cannot embed libpq environment passwords', (t) => {
  // Python's os.environ assignment and os.putenv can set the same libpq
  // environment credential as shell/PowerShell, without a PostgreSQL URL.
  const key = ['PG', 'PASSWORD'].join('');
  const secret = 'SyntheticPythonPasswordForNegativeSourceGate';
  for (const [name, body] of [
    ['infra/backup.py', `import os\nos.environ['${key}'] = '${secret}'\n`],
    ['scripts/restore.py', `import os\nos.environ["${key}"] = "${secret}"\n`],
    ['infra/seed.py', `import os\nos.putenv('${key}', '${secret}')\n`],
    ['scripts/export.py', `import os\nos.putenv("${key}", "${secret}")\n`],
  ]) {
    const result = scanFixture(t, { [name]: body });
    assert.equal(result.status, 1, `${name}: Python literal libpq password escaped source scanning`);
    assert.match(result.stderr, /literal libpq environment password/);
    assert.ok(!result.stderr.includes(secret), 'source scanner must not print secret values');
  }
  const allowed = scanFixture(t, {
    'scripts/backup.py': `import os\nos.environ['${key}'] = os.environ['MIGRATOR_DB_PASSWORD']\n`,
    'scripts/restore.py': `import os\nos.putenv('${key}', os.getenv('MIGRATOR_DB_PASSWORD'))\n`,
  });
  assert.equal(allowed.status, 0, allowed.stderr);
});

test('Windows cmd quoted set and setx cannot embed a libpq password in source', (t) => {
  // cmd.exe supports set "NAME=value"; setx persists an environment value.
  // Split the protected key in the fixture to avoid embedding sample secrets
  // as plausible source assignments in this regression itself.
  const key = ['PG', 'PASSWORD'].join('');
  const secret = 'SyntheticCmdLibpqSecretForNegativeRegression';
  for (const [name, body] of [
    ['infra/backup.cmd', `@echo off\nset "${key}=${secret}"\n`],
    ['infra/restore.bat', `SET "${key}=${secret}"\r\n`],
    ['scripts/persist.cmd', `setx ${key} "${secret}"\n`],
  ]) {
    const result = scanFixture(t, { [name]: body });
    assert.equal(result.status, 1, `${name}: literal cmd.exe libpq password escaped the source scanner`);
    assert.match(result.stderr, /literal libpq environment password/);
    assert.ok(!result.stderr.includes(secret), 'do not log the actual credential');
  }
  const allowed = scanFixture(t, {
    'infra/backup.cmd': `set "${key}=%MIGRATOR_DB_PASSWORD%"\n`,
    'infra/restore.bat': `set "${key}=!MIGRATOR_DB_PASSWORD!"\n`,
    'scripts/persist.cmd': `setx ${key} "%MIGRATOR_DB_PASSWORD%"\n`,
  });
  assert.equal(allowed.status, 0, allowed.stderr);
});

test('Drizzle configuration contains no implicit database credential fallback', () => {
  const text = readFileSync(fileURLToPath(new URL('../drizzle.config.ts', import.meta.url)), 'utf8');
  assert.doesNotMatch(text, /postgres(?:ql)?:\/\//i, 'do not embed even local database credential URLs');
  assert.match(text, /process\.env\.DATABASE_URL/);
  assert.match(text, /dbCredentials/);
});

test('short-form PostgreSQL JDBC URLs with password properties cannot ship in source', (t) => {
  // pgJDBC accepts a short database-name form with password query option.
  // The existing PostgreSQL URI matcher only examines :// URLs.
  const prefix = ['jdbc:', 'postgre', 'sql:'].join('');
  const key = ['pass', 'word'].join('');
  const opaque = 'SyntheticShortFormJDBCCredentialForNegativeRegression';
  const cases = [
    ['android/gradle.properties', `${prefix}nearpill?user=app&${key}=${opaque}`],
    ['backend/config.json', JSON.stringify({ jdbc: `${prefix}nearpill?%70assword=${opaque}` })],
  ];
  for (const [file, text] of cases) {
    const result = scanFixture(t, { [file]: text });
    assert.equal(result.status, 1, `${file}: short JDBC URL must reject embedded password`);
    assert.match(result.stderr, /credentialed PostgreSQL JDBC URL/);
    assert.ok(result.stderr.includes(file));
    assert.ok(!result.stderr.includes(opaque), 'never print raw credentials');
  }
  const allowed = scanFixture(t, {
    'docs/jdbc.md': `${prefix}nearpill?${key}=[YOUR-PASSWORD]`,
    'android/gradle.properties': `${prefix}nearpill?${key}=${'${DATABASE_PASSWORD}'}`,
    'backend/config.json': JSON.stringify({ jdbc: `${prefix}nearpill?user=app` }),
  });
  assert.equal(allowed.status, 0, allowed.stderr);
});

test('JSON database configuration cannot embed literal PostgreSQL password fields', (t) => {
  const opaque = ['Synthetic', 'Database', 'Password', 'ForFixture'].join('');
  const pgKey = 'PG' + 'PASSWORD';
  const configs = [
    { file: 'backend/config.json', contents: { postgres: { host: 'db.example.invalid', password: opaque } } },
    { file: 'infra/staging.json', contents: { [pgKey]: opaque } },
    { file: 'backend/settings.json', contents: { database: { credentials: { password: opaque } } } },
    { file: 'backend/config.json', contents: { db_password: opaque } },
  ];
  for (const { file, contents } of configs) {
    const result = scanFixture(t, { [file]: JSON.stringify(contents) });
    assert.equal(result.status, 1, `${file}: source scan must reject embedded DB passwords`);
    assert.match(result.stderr, /inline database password in JSON/i);
    assert.doesNotMatch(result.stderr, new RegExp(opaque));
  }
});

test('generic JSON connection objects with PostgreSQL coordinates cannot ship literal passwords', (t) => {
  // Typical pool clients accept connection.host/database/password rather than
  // nesting credentials beneath a key literally named postgres or database.
  const opaque = ['Synthetic', 'Connection', 'Password', 'Fixture'].join('');
  const fixtures = [
    { connection: { host: 'db.example.invalid', database: 'nearpill', user: 'app', password: opaque } },
    { settings: { pool: { host: 'db.example.invalid', dbname: 'nearpill', password: opaque } } },
    { pg: { host: 'db.example.invalid', password: opaque } },
  ];
  for (const [i, value] of fixtures.entries()) {
    const result = scanFixture(t, { 'backend/settings.json': JSON.stringify(value) });
    assert.equal(result.status, 1, `database connection fixture ${i} must reject literal password: ${result.stderr}`);
    assert.match(result.stderr, /inline database password in JSON/i);
    assert.ok(!result.stderr.includes(opaque), 'do not disclose scanned credential values');
  }
  const allowed = scanFixture(t, { 'backend/settings.json': JSON.stringify({
    connection: { host: 'db.example.invalid', database: 'nearpill', password: '${DATABASE_PASSWORD}' },
    settings: { pool: { host: 'db.example.invalid', dbname: 'nearpill', password: { ENV: 'DB_PASSWORD' } } },
    unrelated: { connection: { host: 'smtp.example.invalid', password: 'ordinary-smtp-fixture' } },
  }) });
  assert.equal(allowed.status, 0, allowed.stderr);
});

test('JSON PostgreSQL TLS key passwords must not be shipped as literal values', (t) => {
  // The PostgreSQL sslpassword field protects a TLS client key and is just as
  // sensitive as a connection password. Build the fixture value at runtime.
  const secret = ['synthetic', 'tls', 'private', 'key', 'password'].join('-');
  for (const settings of [
    { postgres: { host: 'db.example.invalid', sslpassword: secret } },
    { pool: { host: 'db.example.invalid', database: 'nearpill', sslpassword: secret } },
    { connection: { host: 'db.example.invalid', port: 5432, sslpassword: secret } },
  ]) {
    const checked = scanFixture(t, { 'infra/runtime.json': JSON.stringify(settings) });
    assert.equal(checked.status, 1, `literal TLS key password must fail closed: ${checked.stdout} ${checked.stderr}`);
    assert.match(checked.stderr, /inline database password in JSON/i);
    assert.ok(!checked.stderr.includes(secret), 'scanner logs must not disclose the password');
  }
  const permitted = scanFixture(t, { 'infra/runtime.json': JSON.stringify({
    connection: { host: 'db.example.invalid', database: 'nearpill', sslpassword: '${PG_SSL_PASSWORD}' },
  }) });
  assert.equal(permitted.status, 0, permitted.stderr);
  const unrelated = scanFixture(t, { 'infra/runtime.json': JSON.stringify({
    smtp: { host: 'mail.example.invalid', sslpassword: secret },
  }) });
  assert.equal(unrelated.status, 0, unrelated.stderr);
});

test('JSON database configuration keeps environment-backed passwords valid', (t) => {
  const pgKey = 'PG' + 'PASSWORD';
  const configs = {
    'backend/database.json': JSON.stringify({ dev: { password: { ENV: 'DB_PASSWORD' } } }),
    'infra/staging.json': JSON.stringify({ postgres: { password: '${PGPASSWORD}' } }),
    'backend/settings.json': JSON.stringify({ [pgKey]: '[YOUR-PASSWORD]' }),
  };
  const result = scanFixture(t, configs);
  assert.equal(result.status, 0, result.stderr);
});


test('YAML database configuration rejects inline PostgreSQL passwords but permits external references', (t) => {
  const secret = ['fixture', 'local', 'credential'].join('-');
  for (const [name, yaml] of [
    ['infra/database.yaml', `database:\n  host: db.example.invalid\n  password: ${secret}\n`],
    ['.github/workflows/db-check.yml', `jobs:\n  verify:\n    postgres:\n      host: db.example.invalid\n      password: "${secret}"\n`],
    ['infra/compose.yaml', `services:\n  db:\n    environment:\n      POSTGRES_PASSWORD: ${secret}\n`],
  ]) {
    const run = scanFixture(t, { [name]: yaml });
    assert.equal(run.status, 1, `${name}: YAML literal password must fail closed: ${run.stdout} ${run.stderr}`);
    assert.match(run.stderr, /inline database password in YAML/i);
    assert.ok(!run.stderr.includes(secret), 'source scanner must not log credentials');
  }
  const safe = scanFixture(t, {
    'infra/database.yml': 'database:\n  host: db.example.invalid\n  password: ${DB_PASSWORD}\n',
    '.github/workflows/ci.yaml': 'postgres:\n  password: ${{ secrets.DB_PASSWORD }}\n',
    'infra/mail.yaml': 'smtp:\n  host: mail.example.invalid\n  password: fixture-not-a-postgres-secret\n',
  });
  assert.equal(safe.status, 0, safe.stderr);
});

test('block-style generic PostgreSQL connections cannot conceal literal passwords', (t) => {
  // A connection/pool mapping with libpq-style coordinates is a database
  // configuration even if the parent name does not say postgres or db.
  const credential = ['synthetic', 'block', 'yaml', 'password'].join('-');
  for (const [filename, config] of [
    ['infra/service.yaml', `service:\n  connection:\n    host: db.example.invalid\n    dbname: nearpill\n    password: ${credential}\n`],
    ['infra/pool.yml', `pool:\n  host: db.example.invalid\n  port: 5432\n  sslpassword: ${credential}\n`],
    ['.github/workflows/deploy.yml', `jobs:\n  build:\n    connection:\n      host: db.example.invalid\n      database: nearpill\n      password: '${credential}'\n`],
  ]) {
    const scanned = scanFixture(t, { [filename]: config });
    assert.equal(scanned.status, 1, `${filename}: database password must be rejected: ${scanned.stdout} ${scanned.stderr}`);
    assert.match(scanned.stderr, /inline database password in YAML/i);
    assert.ok(!scanned.stderr.includes(credential), 'scanner output must not expose credential values');
  }
  const safe = scanFixture(t, {
    'infra/service.yaml': `connection:\n  host: db.example.invalid\n  database: nearpill\n  password: \${DATABASE_PASSWORD}\n`,
    'infra/mail.yaml': `connection:\n  host: smtp.example.invalid\n  port: 587\n  password: ${credential}\n`,
  });
  assert.equal(safe.status, 0, safe.stderr);
});

test('Docker Compose YAML environment lists must not embed database passwords', (t) => {
  // Compose supports a list of NAME=value strings as well as environment maps.
  // Build the value at runtime so the regression itself ships no credential.
  const credential = ['synthetic', 'compose', 'list', 'credential'].join('-');
  for (const [file, config] of [
    ['infra/compose.yaml', `services:\n  db:\n    environment:\n      - POSTGRES_PASSWORD=${credential}\n`],
    ['infra/compose.yml', `services:\n  db:\n    environment:\n      - "DB_PASSWORD=${credential}"\n`],
    ['.github/workflows/database.yml', `jobs:\n  test:\n    environment:\n      - 'PGPASSWORD=${credential}'\n`],
  ]) {
    const scan = scanFixture(t, { [file]: config });
    assert.equal(scan.status, 1, `${file}: literal database secret in YAML list must be rejected`);
    assert.match(scan.stderr, /inline database password in YAML/i);
    assert.ok(!scan.stderr.includes(credential), 'scanner output must not print credentials');
  }
  const permitted = scanFixture(t, {
    'infra/compose.yml': [
      'services:', '  db:', '    environment:',
      '      - POSTGRES_PASSWORD=${DATABASE_PASSWORD}',
      '      - "DB_PASSWORD=${DB_PASSWORD:?required}"',
      '      - PGPASSWORD', // inherited environment, no inline value
      '      - SMTP_PASSWORD=fixture-mail-value',
      '',
    ].join('\n'),
  });
  assert.equal(permitted.status, 0, permitted.stderr);
});

test('YAML flow-style PostgreSQL settings cannot conceal literal database passwords', (t) => {
  // Build synthetic fixtures at test time, not as committed credentials.
  const credential = ['synthetic', 'flow', 'yaml', 'db', 'value'].join('-');
  for (const [filename, yaml] of [
    ['infra/database.yml', `database: {host: db.example.invalid, password: "${credential}"}\n`],
    ['infra/pg.yaml', `pg: {host: db.example.invalid, sslpassword: '${credential}'}\n`],
    ['infra/pg-tls.yml', `postgres:\n  host: db.example.invalid\n  sslpassword: ${credential}\n`],
    ['infra/pool.yml', `connection: {host: db.example.invalid, dbname: nearpill, password: ${credential}}\n`],
  ]) {
    const result = scanFixture(t, { [filename]: yaml });
    assert.equal(result.status, 1, `${filename}: inline PostgreSQL flow mapping secret must be rejected: ${result.stdout}`);
    assert.match(result.stderr, /inline database password in YAML/);
    assert.ok(!result.stderr.includes(credential), 'never print the credential');
  }
  const safe = scanFixture(t, {
    'infra/db.yml': `database: {host: db.example.invalid, password: "${'${DB_PASSWORD}'}"}\n`,
    'infra/migration.yaml': `pg: {password: [YOUR-PASSWORD]}\n`,
    'infra/notifications.yaml': `smtp: {host: mail.example.invalid, password: ${credential}}\n`,
  });
  assert.equal(safe.status, 0, safe.stderr);
});

// Android string resources, SVG, and HTML decode numeric character references
// before handing values to clients. Scan the effective text, not just raw XML.
test('XML/HTML numeric character references cannot conceal a PostgreSQL connection secret', (t) => {
  const scheme = ['postgre', 'sql'].join('');
  const syntheticPassword = ['Packet0', 'Xml', 'Only', 'Password'].join('');
  const encodedUri = `${scheme}&#58;&#x2f;&#47;nearpill_app&#58;${syntheticPassword}&#64;db.example.invalid/nearpill`;
  const encodedQuery = `${scheme}&#58;&#47;&#47;db.example.invalid/nearpill?user=app&amp;password=${syntheticPassword}`;
  const namedHtmlUri = `${scheme}&colon;&sol;&sol;nearpill_app&colon;${syntheticPassword}&commat;db.example.invalid/nearpill`;
  for (const [file, body] of [
    ['android/app/src/main/res/values/strings.xml', `<resources><string name="db_uri">${encodedUri}</string></resources>`],
    ['web/public/config.html', `<meta name="db" content="${encodedUri}">`],
    ['web/public/named.html', `<meta name="db" content="${namedHtmlUri}">`],
    ['assets/identity.svg', `<svg xmlns="http://www.w3.org/2000/svg"><desc>${encodedQuery}</desc></svg>`],
    ['ios/Runner/Config.plist', `<plist><dict><key>DB_URL</key><string>${encodedUri}</string></dict></plist>`],
  ]) {
    const result = scanFixture(t, { [file]: body });
    assert.equal(result.status, 1, `decoded XML/HTML credentials must fail closed in ${file}: ${result.stdout}`);
    assert.match(result.stderr, /credentialed PostgreSQL URL in decoded (?:XML|HTML)/i);
    assert.ok(!result.stderr.includes(syntheticPassword), 'scanner must never print the secret');
  }
  const allowed = scanFixture(t, {
    'android/app/src/main/res/values/strings.xml': `<resources><string name="db_uri">${scheme}&#58;&#47;&#47;app&#58;${'${DATABASE_PASSWORD}'}&#64;db.example.invalid/nearpill</string></resources>`,
    'web/public/config.html': `<meta name="db" content="${scheme}&#58;&#47;&#47;app&#58;[YOUR-PASSWORD]&#64;db.example.invalid/nearpill">`,
  });
  assert.equal(allowed.status, 0, allowed.stderr);
});

test('JavaScript and TypeScript escaped PostgreSQL connection strings cannot hide packaged credentials', (t) => {
  // Construct the synthetic secret and literal JavaScript escapes at runtime;
  // the test module itself must not contain a real or directly usable URL.
  const secret = ['synthetic', 'escaped', 'runtime', 'credential'].join('-');
  const slashes = String.raw`\x2f\u002f`;
  const encodedAt = String.raw`\x40`;
  const escaped = ['postgresql:', slashes, 'nearpill_app:', secret, encodedAt, 'db.example.invalid/nearpill'].join('');
  for (const filename of ['backend/src/config/connection.ts', 'scripts/db-connection.mjs']) {
    const checked = scanFixture(t, { [filename]: `const connection = '${escaped}';\n` });
    assert.equal(checked.status, 1, `${filename}: escaped runtime credential must be blocked: ${checked.stdout} ${checked.stderr}`);
    assert.match(checked.stderr, /credentialed PostgreSQL URL|encoded secret/i);
    assert.ok(!checked.stderr.includes(secret), 'scanner diagnostics must never expose credentials');
  }
  const safe = ['postgresql:', slashes, 'nearpill_app:', '${DATABASE_PASSWORD}', encodedAt, 'db.example.invalid/nearpill'].join('');
  const permitted = scanFixture(t, { 'backend/src/config/connection.ts': `const connection = '${safe}';\n` });
  assert.equal(permitted.status, 0, permitted.stderr);
});


test('JavaScript adjacent literal concatenation cannot hide a packaged PostgreSQL credential', (t) => {
  // Build the synthetic credential from fragments in the test itself; it must
  // never become a real connection string or be printed in diagnostics.
  const synthetic = ['synthetic', 'literal', 'join', 'password'].join('-');
  const pieces = ['postgresql:', '//nearpill_app:', synthetic, '@db.example.invalid/nearpill'];
  const application = `const databaseUrl = ${pieces.map((piece) => JSON.stringify(piece)).join(' + ')};\n`;
  const denied = scanFixture(t, { 'backend/src/config/database.ts': application });
  assert.equal(denied.status, 1, `contiguous literal join must fail the source scanner: ${denied.stdout} ${denied.stderr}`);
  assert.match(denied.stderr, /credentialed PostgreSQL URL|decoded JavaScript string/i);
  assert.ok(!denied.stderr.includes(synthetic), 'never disclose a packaged credential in diagnostics');

  const safePieces = ['postgresql:', '//nearpill_app:', '${DATABASE_PASSWORD}', '@db.example.invalid/nearpill'];
  const allowed = scanFixture(t, {
    'backend/src/config/database.ts': `const databaseUrl = ${safePieces.map((piece) => JSON.stringify(piece)).join(' + ')};\n`,
  });
  assert.equal(allowed.status, 0, allowed.stderr);
});


test('constant backtick literal joins cannot hide a PostgreSQL credential', (t) => {
  // A template literal without interpolation is a static JavaScript string.
  // Keep the synthetic credential assembled only in the temporary fixture.
  const synthetic = ['synthetic', 'backtick', 'concat', 'password'].join('-');
  const parts = ['postgresql:', '//nearpill_app:', synthetic, '@db.example.invalid/nearpill'];
  const source = `const databaseUrl = ${parts.map((p) => `\`${p}\``).join(' + ')};\n`;
  const denied = scanFixture(t, { 'backend/src/config/database.ts': source });
  assert.equal(denied.status, 1, `static backtick joins must be rejected: ${denied.stdout} ${denied.stderr}`);
  assert.match(denied.stderr, /credentialed PostgreSQL URL|decoded JavaScript string/i);
  assert.ok(!denied.stderr.includes(synthetic), 'diagnostics must not print credential values');

  // Constant backticks may be mixed with ordinary strings and JS escapes.
  const mixedPieces = ['postgresql:', '//nearpill_app:', synthetic, '@db.example.invalid/nearpill'];
  const mixedSource = 'const databaseUrl = `postgresql:` + ' +
    JSON.stringify(mixedPieces[1]) + ' + ' +
    '`' + mixedPieces[2] + '` + ' + JSON.stringify(mixedPieces[3]) + ';\n';
  const mixed = scanFixture(t, { 'web/src/config/db.ts': mixedSource });
  assert.equal(mixed.status, 1, 'mixed constant backticks and quotes must also be scanned');

  const safe = ['postgresql:', '//nearpill_app:', '${DATABASE_PASSWORD}', '@db.example.invalid/nearpill'];
  const allowed = scanFixture(t, {
    'backend/src/config/database.ts': `const databaseUrl = ${safe.map((p) => `\`${p}\``).join(' + ')};\n`,
  });
  assert.equal(allowed.status, 0, allowed.stderr);

  const interpolated = scanFixture(t, {
    'backend/src/config/database.ts': 'const base = `postgresql://nearpill_app:${process.env.DATABASE_PASSWORD}` + `@db.example.invalid/nearpill`;\n',
  });
  assert.equal(interpolated.status, 0, 'runtime env interpolation is not a committed literal credential');
});
