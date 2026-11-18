import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

// Packet 0's source-artifact scan is intentionally conservative. It does not
// replace a managed secret scanner or Git history scan, but it must never
// silently omit credentials accidentally included in a source package.
// Source-artifact scope mirrors the complete manifest: generated build/test
// directories are not shipped and must not create false packaging failures.
const ignoredDirectories = new Set([
  'node_modules', '.dart_tool', 'build', '.git', 'coverage',
  '.gradle', '.idea', '.next', '.turbo', '.vercel', 'dist',
]);
const generatedWebDirs = new Set([
  'web/playwright-report', 'web/test-results', 'web/playwright/.auth',
]);
// A generated-name directory nested under reviewed runtime source could
// contain executed but unscanned code. Ordinary root/backend/web build output
// remains excluded; source/test subtrees must fail closed instead.
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
// Lockfiles are distributable source, not dependency cache. Inspect them for
// embedded credentials just like other JSON configuration.
const lockfileNames = new Set(['package-lock.json', 'npm-shrinkwrap.json']);
const npmManifestName = 'package.json';
const textExtensions = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.dart', '.json', '.yaml', '.yml', '.md', '.html', '.css',
  '.properties', '.gradle', '.xml', '.sh', '.env', '.example', '.txt',
  '.sql', '.conf', '.kt', '.kts', '.toml', '.ini', '.tf', '.tfvars',
  // Flutter/iOS platform settings and vector assets are shipped as readable
  // source and can accidentally carry embedded API or signing credentials.
  '.plist', '.xcconfig', '.pbxproj', '.svg',
  // Deployment helpers must be parseable text. Previously a malformed UTF-8
  // .ps1/.cmd/.bat/.py file was treated like a binary asset and skipped,
  // despite potentially being executed by developer or CI tooling.
  '.ps1', '.psm1', '.psd1', '.cmd', '.bat', '.py',
]);
// Match security-sensitive conventional filenames using the same case-folded
// identity as the portable source archive checks (Windows extraction).
const namedConfigFiles = new Set([
  '.env.example', '.npmrc', 'Dockerfile', 'Containerfile', 'Makefile',
  '.gitignore', '.dockerignore',
].map((name) => name.toLowerCase()));
// Deployment, CI and source-packaging helpers are executable operational
// source even when extensionless or given an unfamiliar suffix. Never treat
// undecodable bytes inside these reviewed trees as harmless media. Binary
// images and other assets elsewhere retain their normal exemption.
const mandatoryTextSubtrees = ['scripts/', 'backend/scripts/', 'infra/', '.github/'];
// Apple App Store Connect .p8 signing keys and provisioning profiles are
// credentials/identity material even if they contain no known token prefix.
const privateCredentialExtensions = new Set([
  '.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.p8', '.mobileprovision',
]);
// libpq password files are credentials even when they have no recognizable
// vendor token prefix; they must be supplied outside a source archive.
const postgresPasswordFiles = new Set(['.pgpass', 'pgpass.conf']);
const postgresServiceFiles = new Set(['.pg_service.conf', 'pg_service.conf']);
// The source handoff cannot attest to the contents of an opaque compressed
// archive. An inner ZIP can contain .env, private keys or other credentials
// while the outer manifest verifies only the ZIP bytes. Reject such containers
// rather than claiming the text scanner inspected the hidden payload.
const archiveFileName = /\.(?:zip|tar|tgz|gz|7z|rar|jar|war|aar|apk|aab|ipa|zst|xz|bz2)$/i;
// PostgreSQL custom dumps are opaque and may contain customer/order/payment
// records even without credentials. .gitignore excludes *.dump, but source
// packaging is not Git-based, so fail closed on dump names and PGDMP magic.
const postgresBackupFileName = /\.(?:dump|backup|pgdump)$/i;
// SQLite databases are not part of the approved PostgreSQL source model.
// They can carry complete user/order snapshots and remain opaque to a text
// secret scanner. Reject known extensions and header magic if renamed.
const sqliteDatabaseFileName = /\.(?:sqlite|sqlite3|db|db3)$/i;
// SQLite WAL, shared-memory and rollback-journal sidecars are also database
// artifacts. A WAL may contain committed pages not yet in the main file;
// keeping only the sidecar in a source ZIP is still a disclosure risk.
const sqliteSidecarFileName = /(?:-wal|-shm|-journal)$/i;
function isSQLiteWAL(bytes) {
  return bytes.length >= 32 && bytes[0] === 0x37 && bytes[1] === 0x7f &&
    bytes[2] === 0x06 && (bytes[3] === 0x82 || bytes[3] === 0x83);
}
// A rollback journal contains original database pages and may be renamed to
// an unrelated binary extension. SQLite documents this eight-byte header.
function isSQLiteRollbackJournal(bytes) {
  const header = [0xd9, 0xd5, 0x05, 0xf9, 0x20, 0xa1, 0x63, 0xd7];
  return bytes.length >= header.length && header.every((value, index) => bytes[index] === value);
}
function isSQLiteDatabase(bytes) {
  return bytes.length >= 16 && bytes.subarray(0, 16).toString('ascii') === 'SQLite format 3\0';
}
function isPostgresCustomDump(bytes) {
  return bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === 'PGDMP';
}
// pg_dump / pg_dumpall also produce PLAIN SQL exports, which can contain
// customer, order, and payment data without a recognizable secret token.
// Recognize the upstream-generated header at the very beginning of the file;
// do not reject ordinary reviewed migration SQL merely because it mentions
// pg_dump in documentation or comments later in the source.
function isPlainPostgresDump(contents) {
  return /^(?:\uFEFF)?--\r?\n-- PostgreSQL database(?: cluster)? dump\r?\n--(?:\r?\n|$)/.test(contents);
}

function looksLikeBinaryArchive(bytes) {
  if (bytes.length < 4) return false;
  const startsWith = (...header) => header.every((byte, i) => bytes[i] === byte);
  // A TAR header has its magic at offset 257, not at byte zero. Checking
  // only leading bytes allows a renamed .tar file to bypass the source gate.
  const tarMagic = bytes.length >= 512 &&
    bytes.subarray(257, 262).toString('ascii') === 'ustar' &&
    (bytes[262] === 0 || bytes[262] === 0x20);
  return tarMagic ||
    startsWith(0x50, 0x4b, 0x03, 0x04) || // ZIP members
    startsWith(0x50, 0x4b, 0x05, 0x06) || // empty ZIP
    startsWith(0x50, 0x4b, 0x07, 0x08) || // spanned ZIP
    startsWith(0x1f, 0x8b) ||             // gzip
    startsWith(0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00) || // XZ
    (startsWith(0x42, 0x5a, 0x68) && bytes[3] >= 0x31 && bytes[3] <= 0x39) || // bzip2
    startsWith(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c) || // 7-Zip
    startsWith(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07) || // RAR
    startsWith(0x28, 0xb5, 0x2f, 0xfd);   // zstd
}


const detectors = [
  // PKCS#8 encrypted, legacy DSA, and OpenPGP private keys are private
  // credentials too; detect their PEM/armor markers even in .ts/.md/.json.
  { label: 'private key', pattern: /-----BEGIN (?:(?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/ },
  { label: 'OpenAI-style secret', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { label: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { label: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { label: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  // Supabase secret API keys map to a BYPASSRLS service role. A publishable
  // key is public by design, so intentionally do not flag sb_publishable_.
  { label: 'Supabase secret key', pattern: /\bsb_secret_[A-Za-z0-9_-]{20,}\b/ },
];

// Legacy Supabase service_role API keys are signed JWTs rather than sb_secret_
// keys. Inspect ONLY their decoded, untrusted payload's role claim; do not
// print raw JWTs and do not reject ordinary anon JWT/publishable keys.
const jwtCandidate = /\beyJ[A-Za-z0-9_-]{8,}\.([A-Za-z0-9_-]{12,8192})\.[A-Za-z0-9_-]{16,}\b/g;
function containsSupabaseServiceRoleJwt(contents) {
  for (const match of contents.matchAll(jwtCandidate)) {
    try {
      const payload = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
      if (payload && typeof payload === 'object' && payload.role === 'service_role') return true;
    } catch {
      // Not a decodable JWT payload; continue searching.
    }
  }
  return false;
}



// Android XML string resources, SVG, HTML attributes and plist strings decode
// character references before the application consumes them. Raw-text scanning
// can miss a credentialed database URI with encoded `:`, `/`, or `@`. Decode
// one entity pass (as XML/HTML consumers do) and reuse the existing detectors;
// never include decoded values in source-scanner diagnostics.
const xmlHtmlNamedEntities = Object.freeze({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  // Common HTML named forms for URL punctuation; XML only defines the five
  // above, but this check also covers HTML documents.
  colon: ':', sol: '/', commat: '@', equals: '=', quest: '?', num: '#',
});
function decodeXmlHtmlCharacterReferences(contents) {
  return contents.replace(/&(?:#(?:x[0-9a-f]+|[0-9]+)|amp|lt|gt|quot|apos|colon|sol|commat|equals|quest|num);/giu, (entity) => {
    if (entity.startsWith('&#')) {
      const hex = entity[2]?.toLowerCase() === 'x';
      const value = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
      // Invalid Unicode scalar values are not decoded as executable text.
      if (!Number.isInteger(value) || value < 1 || value > 0x10ffff ||
          (value >= 0xd800 && value <= 0xdfff)) return entity;
      return String.fromCodePoint(value);
    }
    return xmlHtmlNamedEntities[entity.slice(1, -1).toLowerCase()] ?? entity;
  });
}
function containsSecretInDecodedXmlHtml(contents) {
  const decoded = decodeXmlHtmlCharacterReferences(contents);
  if (decoded === contents) return false;
  return detectors.some(({ pattern }) => pattern.test(decoded)) ||
    containsSupabaseServiceRoleJwt(decoded) ||
    containsCredentialedPostgresUrl(decoded) ||
    containsCredentialedJDBCShortUrl(decoded) ||
    containsCredentialedLibpqConninfo(decoded) ||
    containsLiteralLibpqEnvironmentPassword(decoded);
}

// JavaScript/TypeScript runtime string literals accept escaped URL punctuation
// (\\x2f, \\u002f, and \\/), and source code may join adjacent string literals
// with `+`. Both are usable literal credentials after JavaScript evaluates the
// expression. Inspect only syntactically contiguous quoted literal joins;
// do not execute JavaScript, resolve variables, or inspect arbitrary runtime
// expressions. This is intentionally a conservative packaging heuristic.
function containsSecretInEscapedJavaScriptStrings(contents) {
  const escapeSequence = /\\(?:x([\da-f]{2})|u([\da-f]{4})|u\{([\da-f]{1,6})\}|([\\/]))/gi;
  const decode = (source) => source.replace(escapeSequence, (whole, short, medium, long, simple) => {
    if (simple) return simple;
    const point = Number.parseInt(short ?? medium ?? long, 16);
    if (point === 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return whole;
    return String.fromCodePoint(point);
  });
  const containsSecret = (value) =>
    detectors.some(({ pattern }) => pattern.test(value)) ||
    containsSupabaseServiceRoleJwt(value) ||
    containsCredentialedPostgresUrl(value) ||
    containsCredentialedJDBCShortUrl(value) ||
    containsCredentialedLibpqConninfo(value) ||
    containsLiteralLibpqEnvironmentPassword(value);

  // Handle individual quoted strings including template literals with no
  // interpolation. The scanner intentionally does not claim JS parser parity.
  const stringLiteral = /(['"`])(?:\\[\s\S]|(?!\1)[^\\])*?\1/g;
  for (const match of contents.matchAll(stringLiteral)) {
    const source = match[0].slice(1, -1);
    const decoded = decode(source);
    if (decoded !== source && containsSecret(decoded)) return true;
  }

  // A credential can be split across constant string literals so none of the
  // individual fragments contains a recognizable URL. Reassemble only direct
  // quoted `+` chains, including backtick templates WITHOUT interpolation.
  // Never execute JavaScript or treat a dynamic `${...}` template as static.
  // Escapes are decoded once per literal, never recursively.
  const quoted = String.raw`(?:'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|\x60(?:\\[\s\S]|[^\x60\\$]|\$(?!\{))*\x60)`;
  const joinedLiterals = new RegExp(`${quoted}(?:\\s*\\+\\s*${quoted})+`, 'g');
  const eachLiteral = new RegExp(quoted, 'g');
  for (const chain of contents.matchAll(joinedLiterals)) {
    const decoded = [...chain[0].matchAll(eachLiteral)]
      .map(([literal]) => decode(literal.slice(1, -1))).join('');
    if (containsSecret(decoded)) return true;
  }
  return false;
}

// A direct Supabase/PostgreSQL URI can hide a literal database password in a
// source/config file without matching any vendor-specific token detector.
// Flag userinfo with a password everywhere we scan, while permitting explicit
// documentation/env-substitution placeholders. Never print the URL itself.
// SQLAlchemy dialect URLs (e.g. postgresql+psycopg://) carry the same
// credentials as ordinary libpq URLs and must not bypass this source gate.
const postgresUrlCandidate = /\bpostgres(?:ql)?(?:\+[a-z][a-z0-9_.-]*)?:\/\/([^\s\"'`<>@/]+)@/gi;
// Only obvious documentation and environment-variable placeholders are safe.
// Query and userinfo passwords use the same narrow exception rule.
function isPasswordPlaceholder(value) {
  return /^\[[^\]\r\n]+\]$/.test(value) ||
    /^\$\{[A-Z_][A-Z0-9_]*\??\}$/.test(value);
}

// libpq also accepts credentials in URI query parameters, including percent-
// encoded parameter names (`%70assword`). A userinfo-only scan would permit
// a fully usable database password to ship in a source or build artifact.
const postgresUrlWithQueryCandidate = /\bpostgres(?:ql)?(?:\+[a-z][a-z0-9_.-]*)?:\/\/[^\s"'`<>\\]+/gi;
function containsCredentialedPostgresUrl(contents) {
  for (const match of contents.matchAll(postgresUrlCandidate)) {
    const userInfo = match[1];
    const colon = userInfo.indexOf(':');
    if (colon < 0 || !userInfo.slice(colon + 1)) continue;
    if (!isPasswordPlaceholder(userInfo.slice(colon + 1))) return true;
  }
  for (const match of contents.matchAll(postgresUrlWithQueryCandidate)) {
    if (!match[0].includes('?')) continue;
    let url;
    try {
      url = new URL(match[0]);
    } catch {
      // A malformed candidate containing query-based password material must
      // not be silently accepted as harmless documentation.
      if (/[?&](?:password|sslpassword)=/i.test(match[0])) return true;
      continue;
    }
    for (const [name, password] of url.searchParams) {
      if (!['password', 'sslpassword'].includes(name.toLowerCase())) continue;
      if (password && !isPasswordPlaceholder(password)) return true;
    }
  }
  return false;
}

// pgJDBC also accepts short URLs with no // authority component:
//   JDBC short-form connection URL (database name followed by query options)
// The libpq URL matcher requires :// and therefore cannot see these.
// Scan only the JDBC short form here, leaving ordinary JDBC //host URLs to
// the existing PostgreSQL URI detector. Do not print matched URL contents.
const jdbcShortUrlCandidate = /\bjdbc:postgresql:(?!\/\/)([^\s"'`<>\\]+)/gi;
function containsCredentialedJDBCShortUrl(contents) {
  for (const match of contents.matchAll(jdbcShortUrlCandidate)) {
    const questionMark = match[1].indexOf('?');
    if (questionMark < 0) continue;
    const params = new URLSearchParams(match[1].slice(questionMark + 1));
    for (const [name, password] of params) {
      if (!['password', 'sslpassword'].includes(name.toLowerCase())) continue;
      if (password && !isPasswordPlaceholder(password)) return true;
    }
  }
  return false;
}

// YAML double-quoted scalars can decode hex/Unicode escapes before a
// deployment tool consumes a PostgreSQL URL. A raw source regex cannot see
// a credentialed URL with its slashes or at-sign escaped. Decode only full
// double-quoted strings and standard YAML escapes, keeping escaped backslashes
// literal ("\\x2F" does not mean a slash). This is not a general YAML parser.
// Never print decoded values or credentials.
function containsCredentialedEscapedYamlPostgresUrl(contents) {
  const quotedScalar = /"(?:\\[\s\S]|[^"\\])*"/g;
  const escapeSequence = /\\(?:x([a-f\d]{2})|u([a-f\d]{4})|U([a-f\d]{8})|([\\"]))/gi;
  for (const match of contents.matchAll(quotedScalar)) {
    const decoded = match[0].slice(1, -1).replace(escapeSequence, (_, short, medium, long, literal) => {
      if (literal) return literal;
      const point = Number.parseInt(short ?? medium ?? long, 16);
      return point <= 0x10ffff ? String.fromCodePoint(point) : '';
    });
    if (containsCredentialedPostgresUrl(decoded)) return true;
  }
  return false;
}

// libpq also supports keyword/value conninfo, e.g. host=... dbname=...
// password='...'. This is not a URI and is otherwise invisible to the
// PostgreSQL URL detector. Require a connection-context option on the same
// line to avoid treating unrelated configuration keys as credentials.
// This is a conservative package heuristic, not a complete libpq parser.
function containsCredentialedLibpqConninfo(contents) {
  const context = /(?:^|[\s"'`])(?:host|hostaddr|dbname|service|user)\s*=/i;
  const passwordOption = /(?:^|[\s"'`])(?:password|sslpassword)\s*=\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|([^\s"'`;,]+))/gi;
  for (const line of contents.split(/\r?\n/)) {
    if (!context.test(line)) continue;
    for (const match of line.matchAll(passwordOption)) {
      const value = (match[1] ?? match[2] ?? match[3] ?? '').trim();
      if (value && !isPasswordPlaceholder(value)) return true;
    }
  }
  return false;
}

// libpq accepts an environment password without any connection URL or
// .pgpass file. Source/CI scripts must reference externally supplied values,
// not embed a literal credential under this PostgreSQL-recognized name.
function containsLiteralLibpqEnvironmentPassword(contents) {
  // Shell/CI assignment, PowerShell ($env:PGPASSWORD), and JavaScript
  // (process.env.PGPASSWORD / process.env['PGPASSWORD']) all configure the
  // same libpq credential. Analyze each form without executing source code.
  const shellAssignment = /(?:^|[\s;])PGPASSWORD\s*(?:=|:)\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s;,'"`#]+))/gi;
  const scriptAssignment = /(?:^|[\s;])(?:\$env:PGPASSWORD|process\.env\.PGPASSWORD|process\.env\[\s*(['"])PGPASSWORD\1\s*\])\s*=\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s;,'"`#]+))/gi;
  // Windows cmd uses `set "NAME=value"` to avoid trailing-space bugs,
  // while `setx NAME value` writes a persistent environment value. The
  // generic shell assignment matcher cannot see the leading quote or setx.
  const cmdQuotedSet = /(?:^|[\s&|])@?set\s+"PGPASSWORD\s*=\s*([^"\r\n]*)"/gi;
  const cmdSetx = /(?:^|[\s&|])@?setx\s+PGPASSWORD\s+(?:"([^"\r\n]*)"|([^\s&|]+))/gi;
  // Python deployment scripts can set this same libpq credential via
  // os.environ[...] or os.putenv(...). Match only quoted inline literals:
  // values supplied by os.getenv/os.environ remain external at runtime.
  const pythonEnvironLiteral = /\bos\.environ\[\s*(['"])PGPASSWORD\1\s*\]\s*=\s*(['"])([^'"\r\n]*)\2/gi;
  const pythonPutenvLiteral = /\bos\.putenv\(\s*(['"])PGPASSWORD\1\s*,\s*(['"])([^'"\r\n]*)\2\s*\)/gi;
  const isExternalReference = (value) =>
    isPasswordPlaceholder(value) ||
    /^\$[A-Z_][A-Z0-9_]*$/.test(value) ||
    /^\$env:[A-Z_][A-Z0-9_]*$/i.test(value) ||
    /^process\.env\.[A-Z_][A-Z0-9_]*$/.test(value) ||
    /^process\.env\[['"][A-Z_][A-Z0-9_]*['"]\]$/.test(value) ||
    /^\$\{\{\s*secrets\.[A-Z0-9_]+\s*\}\}$/.test(value);
  const isCmdExternalReference = (value) =>
    isExternalReference(value) ||
    /^%[A-Z_][A-Z0-9_]*%$/i.test(value) ||
    /^![A-Z_][A-Z0-9_]*!$/i.test(value);
  for (const line of contents.split(/\r?\n/)) {
    if (/^\s*(?:#|\/\/|--|rem\s|::)/i.test(line)) continue;
    for (const match of line.matchAll(cmdQuotedSet)) {
      const value = match[1].trim();
      if (value && !isCmdExternalReference(value)) return true;
    }
    for (const match of line.matchAll(cmdSetx)) {
      const value = (match[1] ?? match[2] ?? '').trim();
      if (value && !isCmdExternalReference(value)) return true;
    }
    for (const pattern of [pythonEnvironLiteral, pythonPutenvLiteral]) {
      for (const match of line.matchAll(pattern)) {
        const value = match[3].trim();
        if (value && !isExternalReference(value)) return true;
      }
    }
    for (const pattern of [shellAssignment, scriptAssignment]) {
      for (const match of line.matchAll(pattern)) {
        // scriptAssignment's first capture is the bracket quote delimiter;
        // the remaining captures contain potential credential values.
        const value = (pattern === scriptAssignment
          ? (match[2] ?? match[3] ?? match[4] ?? '')
          : (match[1] ?? match[2] ?? match[3] ?? '')).trim();
        if (value && !isExternalReference(value)) return true;
      }
    }
  }
  return false;
}

// Project .npmrc files are first-party source. npm registry credentials need
// not match a token provider's prefix to be sensitive: reject ANY literal
// _authToken, _auth or _password value, scoped or unscoped. npm explicitly
// supports ${ENV_VAR} and ${ENV_VAR?} references; these contain no credential.
function containsInlineNpmCredential(contents) {
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!/(?:^|:)_(?:authToken|auth|password)$/i.test(key)) continue;
    const value = trimmed.slice(separator + 1).trim();
    if (!value) continue;
    if (/^\$\{[A-Z_][A-Z0-9_]*\??\}$/.test(value)) continue;
    return true;
  }
  return false;
}


// npm configuration can also embed credentials directly in registry URLs:
// registry=https://user:password@registry.example.invalid/. Existing _authToken
// checks are not sufficient for this form. Keep environment substitutions in
// .npmrc legitimate, but never ship literal URL userinfo or print it in logs.
function containsAuthenticatedRegistryUrl(contents, allowEnvironmentPassword = false) {
  const candidate = /\bhttps?:\/\/([^\s\/"'`<>@]+)@[^\s\/"'`<>@]+/gi;
  for (const match of contents.matchAll(candidate)) {
    const userInfo = match[1];
    const colon = userInfo.indexOf(':');
    if (allowEnvironmentPassword && colon >= 0 &&
        isPasswordPlaceholder(userInfo.slice(colon + 1))) continue;
    return true;
  }
  return false;
}

// Some private npm registries and tarball gateways accept credentials in
// URL query parameters. Checking only HTTP userinfo misses this form in a
// .npmrc registry setting or an npm lockfile's resolved tarball URL. Parse
// the query so percent-encoded parameter names are handled, and keep the
// diagnostic limited to the path (never the credential or full URL).
function containsCredentialedRegistryQueryUrl(contents) {
  const candidate = /\bhttps?:\/\/[^\s\"'`<>]+/gi;
  const credentialParams = new Set([
    'token', 'authtoken', 'accesstoken', 'password', 'apikey', 'authorization', 'secret',
  ]);
  for (const match of contents.matchAll(candidate)) {
    let url;
    try { url = new URL(match[0]); } catch { continue; }
    for (const [name, value] of url.searchParams) {
      if (!credentialParams.has(name.toLowerCase().replace(/[-_]/g, ''))) continue;
      if (value && !isPasswordPlaceholder(value)) return true;
    }
  }
  return false;
}

// npm consumes parsed JSON registry values in lockfiles AND package manifests,
// not their serialized spelling (publishConfig.registry also lives in package.json).
// JSON permits escaped slashes (\\/) and Unicode URL characters (\\uXXXX),
// so a raw-text regex alone can miss a usable credential in a lockfile.
// Walk decoded JSON strings, including object keys, without ever logging a value.
function inspectDecodedNpmJson(contents) {
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return 'invalid';
  }
  const pending = [parsed];
  while (pending.length) {
    const entry = pending.pop();
    if (typeof entry === 'string') {
      if (containsAuthenticatedRegistryUrl(entry) || containsCredentialedRegistryQueryUrl(entry)) {
        return 'credential';
      }
      // The ordinary scan checks raw source text. JSON Unicode escapes can
      // conceal a token prefix until npm parses the lockfile, so reuse the
      // existing high-confidence and PostgreSQL connection detectors on each
      // decoded string as well. These include libpq environment assignments,
      // JDBC short URLs and keyword/value conninfo, which can also be hidden
      // by JSON Unicode escapes in npm scripts/config values.
      if (detectors.some(({ pattern }) => pattern.test(entry)) ||
          containsSupabaseServiceRoleJwt(entry) || containsCredentialedPostgresUrl(entry) ||
          containsLiteralLibpqEnvironmentPassword(entry) ||
          containsCredentialedJDBCShortUrl(entry) || containsCredentialedLibpqConninfo(entry)) {
        return 'secret';
      }
    } else if (Array.isArray(entry)) {
      pending.push(...entry);
    } else if (entry && typeof entry === 'object') {
      for (const [key, value] of Object.entries(entry)) {
        // npm registry auth values can be arbitrary opaque strings without a
        // recognizable token prefix. Decode JSON keys first, then apply the
        // same scoped/unscoped auth-key rule used for .npmrc files.
        if (/(?:^|:)_(?:authToken|auth|password)$/i.test(key) && value != null &&
            (typeof value !== 'string' ||
              (value.trim() && !/^\$\{[A-Z_][A-Z0-9_]*\??\}$/.test(value.trim())))) {
          return 'inline-auth';
        }
        pending.push(key, value);
      }
    }
  }
  return null;
}

// Ordinary JSON config can store opaque database passwords under explicit
// PostgreSQL keys even without a connection URL or provider token prefix.
// Inspect decoded keys/values so JSON escapes cannot hide the field name.
// Preserve the project's existing { ENV: 'DB_PASSWORD' } config contract.
function containsInlineJsonDatabasePassword(contents, file) {
  let data;
  try { data = JSON.parse(contents); } catch { return false; }
  const databaseFile = /^(?:database|db|postgres|postgresql)(?:\.[^.]+)?\.json$/i.test(path.basename(file));
  const explicitPasswordKey = /^(?:pgpassword|postgres(?:ql)?_?password|database_?password|db_?password|migration_?database_?password)$/i;
  const databaseContextKey = /^(?:db|database|postgres|postgresql|pg|libpq|supabase)$/i;
  // Node pg/Drizzle pool configs often use a generic `connection` or `pool`
  // object. Treat host + database/dbname (or the standard PostgreSQL port)
  // as a database context even if no ancestor is literally named `database`.
  // Do not classify unrelated SMTP/HTTP connection objects by host alone.
  const isDatabaseConnectionObject = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const fields = Object.fromEntries(Object.entries(value).map(([key, entry]) => [key.toLowerCase(), entry]));
    return typeof fields.host === 'string' &&
      (typeof fields.database === 'string' || typeof fields.dbname === 'string' ||
        String(fields.port) === '5432');
  };
  const isExternalValue = (value) => {
    if (typeof value === 'string') {
      const normalized = value.trim();
      return !normalized || isPasswordPlaceholder(normalized) ||
        /^\$[A-Z_][A-Z0-9_]*$/.test(normalized) ||
        /^process\.env\.[A-Z_][A-Z0-9_]*$/.test(normalized);
    }
    return value == null || (value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length === 1 &&
      typeof value.ENV === 'string' && /^[A-Z_][A-Z0-9_]*$/.test(value.ENV));
  };
  const pending = [{ value: data, databaseContext: databaseFile }];
  while (pending.length) {
    const { value, databaseContext } = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      for (const item of value) pending.push({ value: item, databaseContext });
      continue;
    }
    const inDatabaseContext = databaseContext || isDatabaseConnectionObject(value);
    for (const [key, child] of Object.entries(value)) {
      if ((explicitPasswordKey.test(key) || (/^(?:password|sslpassword)$/i.test(key) && inDatabaseContext)) &&
          !isExternalValue(child)) return true;
      pending.push({ value: child, databaseContext: inDatabaseContext || databaseContextKey.test(key) });
    }
  }
  return false;
}

// Deployment/CI YAML is another first-party configuration surface. A
// literal database password beneath a `database:` or `postgres:` mapping
// must not bypass the JSON-only password check. This is deliberately a
// conservative scalar/indentation heuristic, not a complete YAML parser.
// External secret references remain valid; never include values in findings.
function isExternalYamlPassword(raw, file) {
  let scalar = raw.trim().replace(/\s+#.*$/, '').trim();
  if ((scalar.startsWith('"') && scalar.endsWith('"')) ||
      (scalar.startsWith("'") && scalar.endsWith("'"))) scalar = scalar.slice(1, -1).trim();
  return !scalar || isPasswordPlaceholder(scalar) ||
    /^\$[A-Z_][A-Z0-9_]*$/.test(scalar) ||
    /^process\.env\.[A-Z_][A-Z0-9_]*$/.test(scalar) ||
    /^\$\{[A-Z_][A-Z0-9_]*:\?[^}]+\}$/.test(scalar) ||
    /^\$\{\{\s*(?:secrets|env|vars)\.[A-Z_][A-Z0-9_.]*\s*\}\}$/.test(scalar) ||
    (file === '.github/workflows/ci.yml' &&
      ['ci-verification-only', 'ci-migrator-only', 'ci-owner-only'].includes(scalar));
}

function containsInlineYamlDatabasePassword(contents, file) {
  const databaseContextKey = /^(?:db|database|postgres|postgresql|pg|libpq|supabase)$/i;
  const explicitPasswordKey = /^(?:pgpassword|postgres(?:ql)?[-_]?password|database[-_]?password|db[-_]?password|migration[-_]?database[-_]?password)$/i;
  const lines = contents.split(/\r?\n/);
  const yamlField = /^(\s*)(?:-\s+)?(['"]?)([A-Za-z_][A-Za-z0-9_-]*)\2\s*:\s*(.*?)\s*$/;
  // Generic driver settings frequently use `connection:` or `pool:` rather
  // than `database:`. Detect PostgreSQL-shaped *block* maps just as we do
  // their flow-style and JSON equivalents. Look only at direct child fields,
  // so SMTP/HTTP settings with a password are not reclassified as a DB.
  const isPostgresConnectionBlock = (index, parentIndent) => {
    let childIndent = Infinity;
    const directFields = new Map();
    for (let next = index + 1; next < lines.length; next++) {
      if (!lines[next].trim() || /^\s*#/.test(lines[next])) continue;
      const field = yamlField.exec(lines[next]);
      if (!field) continue; // non-mapping YAML data is not a field
      const indent = field[1].length;
      if (indent <= parentIndent) break;
      if (indent < childIndent) {
        childIndent = indent;
        directFields.clear();
      }
      if (indent === childIndent) directFields.set(field[3].toLowerCase(), field[4]);
    }
    const port = (directFields.get('port') ?? '').trim().replace(/^['"]|['"]$/g, '');
    return directFields.has('host') &&
      (directFields.has('database') || directFields.has('dbname') || port === '5432');
  };
  const stack = [];
  for (const [index, line] of lines.entries()) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    // Compose's list-style environment syntax is `- NAME=value`, not a YAML
    // mapping (`NAME: value`). Reject literal PostgreSQL passwords there too.
    // Both plain and quoted list strings are valid Compose input; the normal
    // block/flow mapping detector below never sees their `=` assignments.
    const envList = /^\s*-\s+(?:"([^"]*)"|'([^']*)'|([^#]*?))\s*(?:#.*)?$/.exec(line);
    if (envList) {
      const item = (envList[1] ?? envList[2] ?? envList[3]).trim();
      const assignment = /^(?:PGPASSWORD|PGSSLPASSWORD|POSTGRES(?:QL)?_PASSWORD|DB_PASSWORD|DATABASE_PASSWORD|MIGRATION_DATABASE_PASSWORD)=(.*)$/i.exec(item);
      if (assignment && !isExternalYamlPassword(assignment[1], file)) return true;
    }
    const match = yamlField.exec(line);
    if (!match) continue;
    const indent = match[1].length;
    const key = match[3];
    const value = match[4];
    while (stack.length && stack.at(-1).indent >= indent) stack.pop();
    const withinDatabase = stack.some(({ name }) => databaseContextKey.test(name));
    if ((explicitPasswordKey.test(key) || (/^(?:password|sslpassword)$/i.test(key) && withinDatabase)) &&
        value && !isExternalYamlPassword(value, file)) return true;

    // YAML also permits a one-line flow mapping: database: {host: ..., password: ...}.
    // The block-style indentation parser above would overlook its password.
    // Inspect only flow maps whose key is a database context (or a generic
    // connection with explicit PostgreSQL-shaped fields), not arbitrary SMTP
    // or HTTP connection maps. This is a conservative one-line heuristic,
    // NOT a general YAML parser or a substitute for managed secret scanning.
    const flow = /^\{(.*)\}(?:\s*#.*)?$/.exec(value);
    if (flow) {
      const fields = flow[1];
      const pgShapedConnection = /^(?:connection|pool)$/i.test(key) &&
        /(?:^|,)\s*['"]?host['"]?\s*:/i.test(fields) &&
        /(?:^|,)\s*['"]?(?:dbname|database|port)['"]?\s*:/i.test(fields);
      const inDatabaseFlow = withinDatabase || databaseContextKey.test(key) || pgShapedConnection;
      const flowFields = /(?:^|,)\s*(['"]?)([A-Za-z_][A-Za-z0-9_-]*)\1\s*:\s*("[^"]*"|'[^']*'|[^,}]+)\s*/g;
      for (const field of fields.matchAll(flowFields)) {
        if ((explicitPasswordKey.test(field[2]) ||
            (/^(?:password|sslpassword)$/i.test(field[2]) && inDatabaseFlow)) &&
            !isExternalYamlPassword(field[3], file)) return true;
      }
    }
    stack.push({
      indent,
      name: /^(?:connection|pool)$/i.test(key) && isPostgresConnectionBlock(index, indent)
        ? 'postgres'
        : key,
    });
  }
  return false;
}

// .env.example is distributable by design, unlike populated .env files.
// Reject arbitrary literal credentials even when they do not resemble a
// provider-specific API key. Keep the explicit placeholder conventions used
// by NearPill's shipped template and environment variable substitutions.
function containsInlineEnvironmentTemplateSecret(contents) {
  const credentialName = /(?:^|_)(?:PASSWORD|TOKEN|SECRET|API_KEY|PRIVATE_KEY|SERVICE_ROLE_KEY)$/i;
  for (const line of contents.split(/\r?\n/)) {
    if (/^\s*(?:#|$)/.test(line)) continue;
    const assignment = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i.exec(line);
    if (!assignment || !credentialName.test(assignment[1])) continue;
    let value = assignment[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).trim();
    }
    if (!value || isPasswordPlaceholder(value) ||
        /^\$[A-Z_][A-Z0-9_]*$/.test(value) ||
        /^%[A-Z_][A-Z0-9_]*%$/.test(value) ||
        /^![A-Z_][A-Z0-9_]*!$/.test(value) ||
        /^(?:replace(?:[-_](?:me|with(?:[-_].*)?))?|your[-_].+|placeholder(?:[-_].*)?|change[-_]?me)$/i.test(value)) {
      continue;
    }
    return true;
  }
  return false;
}

// libpq service profiles are INI-style and often put the host and password on
// different lines. A same-line keyword/value scanner cannot protect these.
// Do not print the configuration value: source-package diagnostics are shared.
function containsCredentialedPostgresService(contents) {
  for (const line of contents.split(/\r?\n/)) {
    if (/^\s*[#;]/.test(line)) continue;
    const match = /^\s*(?:password|sslpassword)\s*=\s*(.*?)\s*$/i.exec(line);
    if (!match) continue;
    const value = match[1].trim();
    if (value && !isPasswordPlaceholder(value)) return true;
  }
  return false;
}


// Some Windows deployment tools emit UTF-16 text without a BOM. Detect only
// strong ASCII-rich alternating-NUL byte patterns; ordinary binary assets
// remain excluded and well-formed UTF-16 text still passes through the same
// strict decoder and credential detectors as UTF-8 source.
function inferBomlessUtf16(bytes) {
  const pairs = Math.min(Math.floor(bytes.length / 2), 4096);
  if (pairs < 12) return null;
  let evenZero = 0;
  let oddZero = 0;
  let evenText = 0;
  let oddText = 0;
  const readable = (byte) => byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126);
  for (let i = 0; i < pairs * 2; i += 2) {
    const even = bytes[i];
    const odd = bytes[i + 1];
    if (even === 0) evenZero++;
    if (odd === 0) oddZero++;
    if (readable(even)) evenText++;
    if (readable(odd)) oddText++;
  }
  if (oddZero / pairs >= 0.9 && evenZero / pairs <= 0.05 && evenText / pairs >= 0.75) return 'utf-16le';
  if (evenZero / pairs >= 0.9 && oddZero / pairs <= 0.05 && oddText / pairs >= 0.75) return 'utf-16be';
  return null;
}

// Binary assets are not parsed as configuration, but their uncompressed
// metadata can still hold recognizable plaintext API keys. Check only the
// existing high-confidence ASCII patterns before skipping undecodable media;
// never print matching bytes. This does not inspect compressed image payloads.
function inspectOpaqueAsset(bytes, file) {
  const printable = bytes.toString('latin1');
  for (const detector of detectors) {
    if (detector.pattern.test(printable)) {
      findings.push(`${detector.label} in opaque asset: ${file}`);
    }
  }
  if (containsSupabaseServiceRoleJwt(printable)) {
    findings.push(`Supabase service-role JWT in opaque asset: ${file}`);
  }
  if (containsCredentialedPostgresUrl(printable)) {
    findings.push(`credentialed PostgreSQL URL in opaque asset: ${file}`);
  }
  // Readable asset metadata can also contain passwords in non-URL form.
  // Reuse the existing source detectors instead of exempting these patterns
  // solely because an otherwise harmless image contains binary bytes.
  if (containsLiteralLibpqEnvironmentPassword(printable)) {
    findings.push(`literal libpq environment password in opaque asset: ${file}`);
  }
  if (containsCredentialedJDBCShortUrl(printable) || containsCredentialedLibpqConninfo(printable)) {
    findings.push(`credentialed PostgreSQL connection in opaque asset: ${file}`);
  }
  if (containsAuthenticatedRegistryUrl(printable) || containsCredentialedRegistryQueryUrl(printable)) {
    findings.push(`authenticated registry URL in opaque asset: ${file}`);
  }
}

const findings = [];
async function walk(directory, output = []) {
  // Preserve archive portability: Windows commonly aliases case variants of
  // a path that Linux treats as distinct. Scan the actual files but fail the
  // handoff if source files or directories collide after case folding.
  const portableNames = new Map();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const portableName = entry.name.normalize('NFC').toLowerCase();
    const previous = portableNames.get(portableName);
    if (previous !== undefined && previous !== entry.name) {
      findings.push(`case-insensitive source name collision: ${path.join(directory, previous)} vs ${entry.name}`);
    }
    portableNames.set(portableName, entry.name);
    if (nonportableWindowsName(entry.name)) {
      findings.push(`non-portable Windows source name: ${path.join(directory, entry.name)}`);
    }
    const fullPath = path.posix.join(directory, entry.name);
    if (entry.isDirectory() && ignoredDirectories.has(entry.name) && inReviewedRuntimeSubtree(fullPath)) {
      findings.push(`excluded generated directory inside first-party source: ${fullPath}`);
      continue;
    }
    if (entry.isDirectory() && (ignoredDirectories.has(entry.name) || generatedWebDirs.has(fullPath))) continue;
    // Never follow symlinks that might point outside the source tree or hide
    // an unscanned local credentials file. Fail rather than quietly ignore.
    if (entry.isSymbolicLink()) {
      findings.push(`unreviewed source symlink: ${fullPath}`);
      continue;
    }
    if (entry.isDirectory()) {
      await walk(fullPath, output);
      continue;
    }
    // PostgreSQL password files are live credential stores (including the
    // Windows pgpass.conf name), even if their content looks like sample data.
    // Documentation can use a differently named template, never the live file.
    if (postgresPasswordFiles.has(entry.name.toLowerCase())) {
      findings.push(`PostgreSQL password file included in source: ${fullPath}`);
      continue;
    }
    // Private keys/keystores are sensitive even when they contain binary data
    // that the text-pattern detectors cannot decode.
    if (privateCredentialExtensions.has(path.extname(entry.name).toLowerCase())) {
      findings.push(`private credential/keystore file included in source: ${fullPath}`);
      continue;
    }
    // A local .env or .env.* file should not appear in a distributable NearPill
    // source artifact even when its contents do not match a token heuristic.
    const portableFileName = entry.name.toLowerCase();
    if (portableFileName === '.env' || portableFileName.startsWith('.env.')) {
      if (portableFileName !== '.env.example') {
        findings.push(`local environment file included in source: ${fullPath}`);
        continue;
      }
    }
    // Even if the archive is empty (or renamed), its unexamined contents
    // cannot be treated as secret-scanned first-party source.
    if (archiveFileName.test(entry.name)) {
      findings.push(`nested binary archive in source: ${fullPath}`);
      continue;
    }
    if (postgresBackupFileName.test(entry.name)) {
      findings.push(`PostgreSQL database backup artifact in source: ${fullPath}`);
      continue;
    }
    if (sqliteDatabaseFileName.test(entry.name) || sqliteSidecarFileName.test(entry.name)) {
      findings.push(`SQLite database artifact in source: ${fullPath}`);
      continue;
    }
    // Do not limit scanning to recognized language/config suffixes. Source
    // archives can contain readable scripts and secrets in extensionless files,
    // .envrc, Python, or other previously unknown formats. The reader below
    // distinguishes UTF-8 text from binary assets without following links.
    if (entry.isFile()) output.push(fullPath);
  }
  return output;
}

for (const file of await walk('.')) {
  let content;
  try {
    const bytes = await readFile(file);
    // Renaming a custom-format pg_dump must not turn it into a harmless
    // unrecognized binary asset in a distributable source archive.
    if (isPostgresCustomDump(bytes)) {
      findings.push(`PostgreSQL database backup artifact in source: ${file}`);
      continue;
    }
    if (isSQLiteDatabase(bytes) || isSQLiteWAL(bytes) || isSQLiteRollbackJournal(bytes)) {
      findings.push(`SQLite database artifact in source: ${file}`);
      continue;
    }
    if (looksLikeBinaryArchive(bytes)) {
      findings.push(`nested binary archive in source: ${file}`);
      continue;
    }
    // Binary images, fonts, and media are not reliably readable as source
    // text. Explicitly named source/config types must be valid text, however:
    // invalid UTF-8 or NUL bytes must not silently bypass their scan.
    const requiredText = textExtensions.has(path.extname(file).toLowerCase()) ||
      namedConfigFiles.has(path.basename(file).toLowerCase()) ||
      lockfileNames.has(path.basename(file).toLowerCase()) ||
      mandatoryTextSubtrees.some((prefix) => file.startsWith(prefix));
    // UTF-16 is common in Windows configuration and PowerShell scripts.
    // Its ordinary ASCII letters contain NUL bytes, so treating every NUL-
    // bearing file as binary would silently bypass token checks. A real BOM
    // identifies the encoding; unknown binary assets retain the old behavior.
    const utf16le = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;
    const utf16be = bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff;
    const inferredUtf16 = !utf16le && !utf16be && bytes.includes(0)
      ? inferBomlessUtf16(bytes) : null;
    if (!utf16le && !utf16be && !inferredUtf16 && bytes.includes(0)) {
      if (requiredText) findings.push(`unreadable source text: ${file}`);
      else inspectOpaqueAsset(bytes, file);
      continue;
    }
    try {
      const encoding = utf16le ? 'utf-16le' : utf16be ? 'utf-16be' : inferredUtf16 ?? 'utf-8';
      content = new TextDecoder(encoding, { fatal: true }).decode(
        utf16le || utf16be ? bytes.subarray(2) : bytes,
      );
      if (content.includes('\0')) {
        findings.push(`unreadable source text: ${file}`);
        continue;
      }
    } catch {
      if (requiredText || utf16le || utf16be) {
        findings.push(`unreadable source text: ${file}`);
      } else {
        inspectOpaqueAsset(bytes, file);
      }
      continue;
    }
  } catch {
    findings.push(`unreadable source file: ${file}`);
    continue;
  }
  if (isPlainPostgresDump(content)) {
    findings.push(`PostgreSQL database backup artifact in source: ${file}`);
    continue;
  }
  for (const detector of detectors) {
    if (detector.pattern.test(content)) findings.push(`${detector.label}: ${file}`);
  }
  if (containsCredentialedPostgresUrl(content)) {
    findings.push(`credentialed PostgreSQL URL: ${file}`);
  }
  if (/\.(?:js|mjs|cjs|jsx|ts|tsx)$/i.test(file) && containsSecretInEscapedJavaScriptStrings(content)) {
    findings.push(`credentialed PostgreSQL URL or other secret in decoded JavaScript string: ${file}`);
  }
  if (/\.(?:xml|svg|html|plist)$/i.test(file) && containsSecretInDecodedXmlHtml(content)) {
    findings.push(`credentialed PostgreSQL URL in decoded XML/HTML or other encoded secret: ${file}`);
  }
  if (containsLiteralLibpqEnvironmentPassword(content)) {
    findings.push(`literal libpq environment password: ${file}`);
  }
  if (containsCredentialedJDBCShortUrl(content)) {
    findings.push(`credentialed PostgreSQL JDBC URL: ${file}`);
  }
  if (containsCredentialedLibpqConninfo(content)) {
    findings.push(`credentialed PostgreSQL conninfo: ${file}`);
  }
  if (postgresServiceFiles.has(path.basename(file).toLowerCase()) &&
      containsCredentialedPostgresService(content)) {
    findings.push(`credentialed PostgreSQL service configuration: ${file}`);
  }
  if (containsSupabaseServiceRoleJwt(content)) {
    findings.push(`Supabase service-role JWT: ${file}`);
  }
  if (path.basename(file).toLowerCase() === '.env.example' &&
      containsInlineEnvironmentTemplateSecret(content)) {
    findings.push(`literal secret in environment template: ${file}`);
  }
  if (path.basename(file).toLowerCase() === '.npmrc' && containsInlineNpmCredential(content)) {
    findings.push(`inline npm registry credential: ${file}`);
  }
  if (path.basename(file).toLowerCase() === '.npmrc' &&
      containsAuthenticatedRegistryUrl(content, true)) {
    findings.push(`authenticated registry URL: ${file}`);
  }
  if ((path.basename(file).toLowerCase() === '.npmrc' ||
      lockfileNames.has(path.basename(file).toLowerCase())) &&
      containsCredentialedRegistryQueryUrl(content)) {
    findings.push(`credentialed registry query parameter: ${file}`);
  }
  // All JSON is parsed by its consumers, not just npm manifests/lockfiles.
  // A Unicode escape can split a recognized token or PostgreSQL URL in an
  // ordinary app settings JSON while defeating the raw-text source detectors.
  // Reuse one decoded-string walker; retain npm-specific failure diagnostics
  // relied on by the existing lockfile and packaging regression contracts.
  if (path.extname(file).toLowerCase() === '.json') {
    const name = path.basename(file).toLowerCase();
    const kind = lockfileNames.has(name) ? 'npm lockfile' :
      name === npmManifestName ? 'npm manifest' : 'application JSON';
    const decodedFinding = inspectDecodedNpmJson(content);
    if (decodedFinding === 'invalid') {
      findings.push(`invalid ${kind === 'npm manifest' ? 'npm package manifest' : kind} JSON: ${file}`);
    } else if (decodedFinding === 'credential') {
      findings.push(`credentialed registry URL in decoded ${kind}: ${file}`);
    } else if (decodedFinding === 'secret') {
      findings.push(`high-confidence secret in decoded ${kind}: ${file}`);
    } else if (decodedFinding === 'inline-auth') {
      findings.push(`inline npm auth field in decoded ${kind === 'npm manifest' ? 'manifest' : kind === 'npm lockfile' ? 'lockfile' : 'application JSON'}: ${file}`);
    }
  }
  if (path.extname(file).toLowerCase() === '.json' &&
      containsInlineJsonDatabasePassword(content, file)) {
    findings.push(`inline database password in JSON: ${file}`);
  }
  if (/\.ya?ml$/i.test(file) && containsInlineYamlDatabasePassword(content, file)) {
    findings.push(`inline database password in YAML: ${file}`);
  }
  if (/\.ya?ml$/i.test(file) && containsCredentialedEscapedYamlPostgresUrl(content)) {
    findings.push(`credentialed PostgreSQL URL in YAML-escaped scalar: ${file}`);
  }
  // npm can persist a resolved tarball URL containing HTTP userinfo in a
  // lockfile. These credentials may not have a recognizable provider prefix.
  // Only output the file path, never the URL or embedded password.
  if (lockfileNames.has(path.basename(file).toLowerCase()) && containsAuthenticatedRegistryUrl(content)) {
    findings.push(`authenticated registry URL: ${file}`);
  }
}

if (findings.length > 0) {
  console.error('Source-artifact secret scan failed:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log('PASS: no local environment files, unreviewed symlinks, or high-confidence secret patterns detected.');
}
