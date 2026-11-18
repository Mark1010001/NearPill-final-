# NearPill

NearPill is a single in-place codebase containing the existing Flutter customer app, Hono/PostgreSQL backend, and React/TypeScript/Vite operations portal in `web/`. The refactor keeps those application roots canonical; it does not create a replacement V2 application.

## Pre-execution source verification (Packet 0)

Before running Node-based source/secret checks, the four canonical shell
entrypoints (`scripts/verify-packet0.sh`, `scripts/verify-foundation.sh`,
`scripts/verify-mobile.sh`, and `scripts/package-source.sh`) now compare the
**existing** `scripts/secret-scan.mjs` and `scripts/verify-source-manifest.mjs`
against their exact entries in the reviewed source SHA-256 manifest using
shell-only utilities. A missing/changed checker, ambiguous manifest entry, or
checker/parent-directory symlink fails before either Node checker executes. Full source
verification then continues as before, including the Packet 0 post-execution
manifest fingerprint. This prevents a single altered verification script from
running *before* the change is detected. It assumes the shell entrypoint,
reviewed manifest and host tools are trustworthy; the SHA-256 manifest is
not an externally signed source attestation or a substitute for CI provenance.

## Case-insensitive npm credential scanning (Packet 0)

The existing source-artifact scanner checks npm `.npmrc`, `package-lock.json`,
and `npm-shrinkwrap.json` credentials using case-folded filenames so case variants
from Windows-compatible source handoffs cannot hide inline registry passwords.
It keeps externally sourced npm tokens (`${NPM_TOKEN}`) and ordinary public
registry URLs permitted. This check covers distributable source artifacts only:
it is not a repository-history secret scan or a live Supabase security result.

## npm registry query-string credential gate (Packet 0)

The source-artifact scanner rejects literal sensitive query parameters in npm
registry and resolved tarball URLs inside `.npmrc`, `package-lock.json`, and
`npm-shrinkwrap.json`, including percent-encoded parameter names. Credentials
may be supplied through `${NPM_TOKEN}`-style environment substitutions; these
are not treated as embedded secrets. This source-handoff guard does not inspect
npm account permissions, installed dependencies, Git history, or Supabase RLS.

## JSON-decoded npm lockfile credential gate (Packet 0)

The source scanner checks both the raw text and the **decoded JSON strings**
from `package-lock.json` and `npm-shrinkwrap.json`. Escaped URL slashes and
Unicode escapes can hide registry credentials from a raw-text regex even when
npm later consumes a real credentialed `resolved` URL. The scanner rejects
HTTP userinfo and sensitive URL query parameters in decoded lockfile strings,
with path-only diagnostics; a malformed lockfile also fails closed. Public
registry URLs and `${NPM_TOKEN}`-style environment placeholders remain valid.
This verifies a source artifact only, not dependency provenance or access to
any npm registry or Supabase database.

## Decoded npm lockfile auth-field gate (Packet 0)

The existing source scanner also rejects opaque credentials stored directly
under decoded JSON auth keys (`_auth`, `_authToken`, `_password`, and
registry-scoped equivalents) in npm lockfiles. Such values need not resemble
known provider token formats. An externally supplied `${NPM_TOKEN}`-style
reference remains allowed. Findings include only a file path and category,
never the credential. This is source-package protection, **not** evidence of
npm registry authentication, dependency provenance, or live Supabase security.

## SQLite database artifacts excluded from source handoffs (Packet 0)

The canonical NearPill database remains **Supabase PostgreSQL**; SQLite files
are not an alternate application datastore. The Packet 0 source-secret scanner
now rejects SQLite database filenames (`.sqlite`, `.sqlite3`, `.db`, `.db3`,
case-insensitively), SQLite-format binary signatures, SQLite sidecar names
(`-wal`, `-shm`, `-journal`), and SQLite WAL **and rollback-journal** binary headers even if renamed.
A text-only scan cannot attest to customer/order records inside a
SQLite database, and a source ZIP must not distribute a private snapshot.
Reviewed Drizzle/PostgreSQL `.sql` migrations and ordinary image assets remain
allowed. This is an offline source-handoff check, not a database restore, live
Supabase RLS test, or proof of production data privacy.

## PostgreSQL backups excluded from source handoffs (Packet 0)

The reviewed source-artifact scanner rejects files ending in `.dump`, `.backup`
or `.pgdump`, detects PostgreSQL custom-format `PGDMP` magic even when
an export is renamed, and rejects standard plain-text `pg_dump` / `pg_dumpall`
SQL export headers even under generic `.txt` names. A backup can contain
private account, order or payment data without containing a recognizable
password, so it must never appear in a distributable source ZIP. Normal
reviewed SQL migrations (`backend/migrations/postgres/*.sql`) remain allowed.
This is a local packaging gate, not a backup/restore drill or confirmation
of the selected NearPill-owned Supabase deployment.

## Required toolchains

- Node.js `24.22.0` for the engineering/backend runtime (`>=24.7.0 <25` is accepted by package policy).
- npm `11.19.1` for the pinned engineering package manager (`>=11 <12` remains the engine policy).
- Flutter `3.44.4` / Dart `3.12.2` for the existing mobile application.
- Docker Compose v2 only when using the containerized local topology.

Use `.nvmrc` or `.node-version` to select the pinned Node runtime before running the root JavaScript gates. Packet 0 and the standalone runtime checker require stable three-component Node/npm versions; prereleases such as `24.7.0-rc.1` and `11.19.1-beta.1` do not satisfy acceptance, even when their numeric portions meet the minimum.

## Environment configuration

`.env.example` is the non-secret configuration template. Never commit a populated `.env` file.

For Compose:

```bash
cp .env.example .env
# replace the local placeholder database passwords
```

For direct backend startup, use the backend-specific template. The Hono backend uses PostgreSQL through the extracted repository layer:

```bash
cp backend/.env.example backend/.env
# replace the local placeholder database password
```

The typed contract in `backend/src/config/env.ts` documents the PostgreSQL-oriented configuration boundary. The Hono composition root validates that environment before constructing infrastructure adapters.

## Trusted ingress address policy (NP-047; source mitigation pending live acceptance)

The backend-owned login/recovery rate limiter uses the **actual TCP peer** by
default. It ignores all client-supplied `X-Forwarded-For` values, even when
requests happen to arrive through NGINX. An operator may opt in to a *list of
exact, observed reverse-proxy socket IPs* using the server-only
`TRUSTED_PROXY_IPS` variable (comma-separated IPs, no CIDRs or wildcards).
Only a request received from an explicitly listed socket peer may use a
single, syntactically valid forwarded IP. Multiple forwarded hops and
malformed addresses fall back to that socket peer, not to a spoofable string.
`::ffff:` IPv4-mapped peers are normalized to IPv4 for exact comparisons.

The reviewed NGINX `/api/` location overwrites incoming `X-Forwarded-For`
with its own `$remote_addr`; it does not append an attacker-controlled chain.
**Do not** populate `TRUSTED_PROXY_IPS` from a browser header, from an entire
Docker/private-network range, or by guessing the proxy's address. Validate
all deployed ingress paths and actual peer IPs first; the Compose backend is
intentionally not exposed as a public host port. With no trusted peer
configured, legitimate users behind the same NGINX may share a rate-limit
bucket: this conservative fallback is *not* final availability acceptance.
A protected production configuration therefore requires an operator-reviewed
proxy address policy and negative direct-access tests, plus installed-Hono
Node 24 authentication and rate-limit verification. NP-047 is source-mitigated
only. No live deployment security/availability or Supabase RLS is attested.

## Existing application startup

Direct backend startup uses the canonical Hono entrypoint:

```bash
npm ci --prefix backend
npm run start:backend
```

**Selected staging/production provider: Supabase-managed PostgreSQL.** The PostgreSQL service described below is a **disposable local development/integration fixture**, not an alternative production database. The existing Drizzle migrations and Hono authorization remain canonical. Do not point the fixture-writing verifiers or migration job at any Supabase project until NearPill ownership, backup/restore, least-privilege roles, TLS and RLS gates have been independently accepted.

The local container topology builds the same React `web/` surface and backend behind NGINX, with disposable PostgreSQL 18 + pgvector and a one-shot migration job:

```bash
cp .env.example .env
# replace DB_PASSWORD, MIGRATOR_DB_PASSWORD, and POSTGRES_OWNER_PASSWORD first
docker compose config --quiet
docker compose up --build
```

When healthy, the gateway is available at `http://localhost:8080`; the API and PostgreSQL service are not published directly to the host. `db-migrate` applies reviewed checksum-locked SQL before the API starts.

## Web portal

The portal uses the canonical `/api/v1` contract, server-owned cookie sessions, CSRF protection, and TanStack Query for server state. Browser role/branch storage, CoreDB/tenant globals, demo credentials, raw business-data `innerHTML`, and client-side tenant filtering have been retired.

```bash
npm ci --prefix web
npm run typecheck:web
npm run build:web
npm run test:web:e2e
```

See [web portal architecture](docs/web-portal.md). A generated `web/package-lock.json` is required before the clean-install/build commands can pass.

## Flutter mobile app

The existing Flutter application now uses one Dio transport, feature repositories/view models, secure rotating credentials, user-scoped centavo cart state, and the canonical `/api/v1` contract through NGINX. The Android emulator default is `http://10.0.2.2:8080`; use `--dart-define=API_BASE_URL=...` for another environment.

```bash
npm run verify:mobile
```

The standalone mobile verifier first runs the same **source secret scan and full SHA-256 source-manifest check** as Packet 0; changed/unreviewed files fail **before** mobile Node tests or `flutter pub get`. It then requires exactly **stable-channel Flutter 3.44.4 / stable Dart 3.12.2** before running `flutter pub get`, `flutter analyze`, or `flutter test`; prerelease variants such as `3.12.2-rc.1`, non-stable Flutter channels and unavailable SDKs return **BLOCKED (exit 2)** rather than claiming mobile acceptance. The canonical Packet 0 verifier applies the same exact-version guard. Android release builds additionally require an owner-approved `NEARPILL_APPLICATION_ID`, a Maps API key, and `android/key.properties`; release configuration intentionally refuses debug signing or the development application ID. See [mobile architecture](docs/mobile-architecture.md).

## HTTP API contract

The canonical API is `/api/v1/*`, with its OpenAPI document at `/api/v1/openapi.json`. The superseded unversioned `/api/*` compatibility aliases were removed after both first-party web and Flutter clients migrated to `/api/v1`. See [HTTP API transport](docs/http-api.md).

## PostgreSQL migration and verification

The active backend runtime uses PostgreSQL repositories. Drizzle defines the version-controlled schema model, while reviewed SQL migrations own PostgreSQL-specific roles, constraints, indexes, and RLS policies.

**Reviewed migration inventory:** The existing `backend/scripts/lib/reviewed-migration-sources.mjs` now rejects unexpected entries in `backend/migrations/postgres/` (including renamed `.SQL`, `.sql.bak`, hidden staging files and metadata symlinks) rather than silently omitting them from both the migration runner and read-only staging preflight. The sole permitted non-SQL entry is a regular `README.md`; numbered SQL migration order, history, Drizzle schema and SQL behavior are unchanged. The shared loader also decodes SQL as **strict UTF-8** and refuses malformed bytes or NUL characters before migrations are hashed or any connection is opened; Node's permissive replacement decoding is not accepted as migration source truth. A UTF-8 byte-order mark is also refused because `TextDecoder` otherwise drops its leading bytes, making executable SQL differ from the reviewed file; existing migration SQL is not rewritten. The shared loader now rejects symlinks at the migration directory **or any ancestor directory** before enumerating files, so a regular `postgres/` folder reached through a linked `migrations/` or project-root path cannot redirect the reviewed history outside the project. Individual SQL files also retain `O_NOFOLLOW` protection. The source-only SQL statement characterization now treats backslash-escaped quotes inside PostgreSQL `E'...'` string literals correctly, so embedded semicolons or policy-like text cannot be mistaken for standalone DDL by the migration/RLS preflight. This is not a full SQL parser or a replacement for live database authorization tests. This is an offline path validation; it does not prove race-free filesystem semantics or live database acceptance. This is a source-integrity guard, not a live Supabase migration or RLS acceptance result.

```bash
npm run db:migrate
npm run db:reconcile
npm run db:verify-security
```

**Read-only reconciliation safety:** `npm run db:reconcile` now requires an
explicitly approved verification target using the same fail-closed operator
preflight as the fixture verifiers. It needs `DB_USER`/`DB_PASSWORD` for the
least-privilege application-role metadata check and separate
`MIGRATOR_DB_USER`/`MIGRATOR_DB_PASSWORD` for full-row integrity reads.
For disposable local verification set `NODE_ENV=test`,
`NEARPILL_VERIFICATION_TARGET=local-test`, matching
`NEARPILL_VERIFICATION_EXPECTED_HOST` and
`NEARPILL_VERIFICATION_EXPECTED_DATABASE`, and
`NEARPILL_VERIFICATION_CONFIRMATION=I_APPROVE_TEST_FIXTURE_WRITES`.
That confirmation is required by the shared safety boundary even though
reconciliation itself is SELECT-only. Staging additionally requires a
NearPill-owned project identity, owner approval, and TLS. Its verification migrator connection additionally requires `MIGRATOR_DB_HOST` (the independently confirmed `db.<project-ref>.supabase.co` direct endpoint), `MIGRATOR_DB_PORT=5432` and `NEARPILL_VERIFICATION_EXPECTED_MIGRATOR_HOST`; the app may use direct or session-mode pooling, but migrator and reconciliation reads must not be routed through that pooler. Do not run it
against production or an unrelated Supabase project. Successful local
reconciliation does not prove live RLS tenant isolation or backup/restore.
Reconciliation also checks strictly positive refund centavos, nonnegative
optional provider-event centavos, and a confirmation timestamp for every
provider-confirmed refund. All checks run read-only in the existing
repeatable-read migrator snapshot; they do not validate payment-provider
authorization or replace signed-webhook and live database tests.

**Reviewed SQL migration staging guard:** `npm run db:migrate` uses the existing
`backend/scripts/lib/verify-migration-target.mjs` preflight. For approved
Supabase staging it requires the **direct** `db.<project-ref>.supabase.co:5432`
endpoint and an **unqualified** `DB_USER=MIGRATOR_DB_USER` database role (for
example `nearpill_migrator`). A `<role>.<project-ref>` login is valid for the
shared session pooler, **not** the direct migration endpoint, and is rejected
before `pg.Pool` is constructed. The live migration session still independently
checks role identity, privilege flags and TLS. The migration session probe
also rejects inherited or SET-able PostgreSQL predefined global data,
monitoring, maintenance and server-file/program roles (including
`pg_read_all_data` and `pg_write_all_data`) even if the login is not
itself a superuser or `BYPASSRLS` role. It also refuses membership
in `pg_create_subscription`, `pg_use_reserved_connections`, and
`pg_signal_autovacuum_worker`, which PostgreSQL 17/18 documents as
replication/operational capabilities inappropriate for the NearPill migrator.
The shared live fixture preflight applies the same three denials to the
app/migrator roles and Supabase `anon`/`authenticated` roles. The same live read-only probe now
refuses direct or membership-reachable **database ownership**, including a
migrator that could assume the current database-owner role. A dedicated
migrator must receive only its reviewed DDL grants, not ownership of the
NearPill database. Recording-contract tests
characterize this read-only probe; only a real PostgreSQL role/ACL
inspection can validate an actual NearPill Supabase deployment.
The guard is not proof of NearPill project ownership or permission
to run production SQL.

**Packet 0 backup safety:** `backend/scripts/backup-postgres.sh` now requires an
explicitly confirmed disposable local test database and a private, unused
absolute `.dump` destination. It refuses staging/production and strips
inherited libpq overrides. See `docs/packet-0-db-fixture-safety.md` for the
operator contract and no-database tests. The backup command now also
requires `pg_restore --list` and an offline full-payload extraction to
`/dev/null` against the **same private temporary archive** before publishing.
Unreadable payloads fail closed without exposing SQL or account data.
Publication now uses GNU `ln -T` so a destination switched to a directory or
symlink to a directory after preflight cannot divert the archive to a different
pathname or produce a false success. An intercepted publication returns a
failure, removes the private partial archive, and does not follow the link.
This protects the existing local-test backup tooling only. These
checks do **not** prove recoverability. Real Supabase
backups and restore acceptance are separate, unverified operational gates.

**Disposable test restore:** `backend/scripts/restore-postgres.sh` keeps the
separate destructive-operation confirmation and loopback-only target guard.
It also requires `NEARPILL_RESTORE_EXPECTED_SHA256`, the lowercase SHA-256
of the independently selected archive. After staging, the script hashes the
private snapshot and refuses to invoke `pg_restore` unless the bytes match
the approved fingerprint. Compute and confirm the hash independently with
`sha256sum /path/to/approved.dump`; a matching digest is not proof of archive
trust, sanitation, database recoverability or independent operator approval.
The entry point rejects case variants of the reserved `postgres`,
`supabase_admin`, and `service_role` database usernames before any restore
invocation. This conservative name check does not replace verification of the
actual database role attributes and membership. It also rejects symlink input
and stages the supplied archive in a private temporary directory. Offline `pg_restore --list`, offline full-payload SQL extraction to `/dev/null`,
and the existing `pg_restore --clean --single-transaction` all use that same
staged snapshot. It also copies without following source symlinks and rejects a
late symlink substitution before chmod or any pg_restore invocation. A payload
extraction failure blocks the destructive command
before connecting to PostgreSQL, and replacing the original after inspection
cannot change the restore input. The staged copy is removed on exit. These
checks improve archive readability screening but **do not** audit potentially
unsafe SQL or prove real database recovery; a separate disposable restore drill
and owner-approved Supabase staging acceptance remain required.

`db:verify-security` is the live database gate: it checks cross-customer RLS and runs a 100-way inventory contention fixture. It requires a real PostgreSQL service and the app/migrator credentials from `.env`. The legacy MySQL adapter/source scripts are retained only as migration/rollback evidence and are not part of the active runtime.

## Durable identity and pharmacy authorization

Authentication/session authority is now PostgreSQL-backed. Access, rotating refresh, and browser-session credentials are distinct; only credential hashes are stored. The web portal uses the server-owned session cookie plus CSRF validation, and pharmacy authorization comes from active `pharmacy_memberships` rather than browser role/branch state.

Run the targeted identity contracts with:

```bash
npm run test:identity-security
```

When a real PostgreSQL 18 service is available, run the live tenant/replay gate with:

```bash
npm run db:verify-identity
```

See [identity/security architecture](docs/identity-security.md).

## Engineering verification

Packet-scoped verification is preferred over repeatedly running unrelated suites:

```bash
npm run verify:foundation
```

The standalone foundation verifier checks the reviewed source fingerprint and
source secret scan **before running foundation tests or local build tools**,
matching Packet 0 and mobile verification. Unreviewed/modified source blocks
execution with exit `1`; this preflight does not clear the Node 24, npm 11,
lockfile, or Supabase database acceptance gates.

The verifier returns:

- `0` when all Packet 1 gates available to the repository pass on the required toolchain;
- `1` for a code/configuration failure;
- `2` when required tooling is unavailable or the active runtime is outside policy.

Individual foundation gates are also available:

```bash
npm run check:runtime
npm run check:lockfile
npm run test:foundation
npm run test:config
npm run check:syntax
npm run check:json-syntax
npm run check:shell-syntax
npm run typecheck
npm run lint
npm run format:check
npm run secret:scan
```

Packet 0 also runs `node scripts/check-js-syntax.mjs` as a required code-failure gate. Along with backend, web, tooling and test JavaScript, it now parses **root-level `.js`/`.mjs`/`.cjs` configuration files** such as `eslint.config.mjs`; an invalid root config cannot silently pass the baseline. The syntax checker is not a TypeScript compiler or substitute for the Node 24 build gate.

The standalone `npm run check:runtime` gate reads the installed `npm --version` executable directly, not the caller-controlled `npm_config_user_agent`; missing, prerelease or npm 10 executables block supported-runtime acceptance. The main Packet 0 verifier uses its existing independent npm executable check. This does not install tooling or clear a Node 24/npm 11 environment blocker.

Packet 0 also runs `node scripts/check-json-syntax.mjs` as a required source gate. It strictly parses all first-party `.json` files (including root, backend and web configuration), rejects malformed UTF-8 and symlinked entries, and excludes dependency caches and generated browser reports. This is syntax verification only: it does not validate configuration schemas or substitute for supported Node 24/npm 11 installs, TypeScript checks, or runtime tests.

Packet 0 also runs `bash scripts/check-shell-syntax.sh` as a required code-failure gate. The check discovers `.sh` files **and extensionless first-party shell entrypoints with a `sh`/`bash` shebang**, excluding generated/dependency trees. It handles direct and `env`/`env -S` interpreter declarations, excludes non-shell shebangs, and parses scripts with POSIX `sh` or Bash as appropriate. The inventory is fully collected before any script is checked, so a failed `find`/sort traversal cannot masquerade as a partial pass. It requires no database or npm installation; syntax acceptance is not a runtime backup/restore drill.

The Packet 0, foundation, mobile and source-packaging shell entrypoints reject any nonempty inherited
`NODE_OPTIONS` **before the first Node process is launched**. Otherwise Node's
`--require`/`--import` options could load code outside the reviewed repository
before the secret scan and SHA-256 source-integrity gate runs. This protects
against ambient Node preloads during verification; it does not attest the host
shell, `PATH`, Node executable, or external deployment. For a clean run, unset
`NODE_OPTIONS` instead of bypassing the check.

The canonical Packet 0 runner freezes the SHA-256 digest of the reviewed source manifest *before* repository execution. It compares that same digest after preflight and after all runnable tests/builds, in addition to scanning secrets and checking individual source hashes at both boundaries. A test that modifies both a source file and its manifest entry fails as a **code-integrity error (exit 1)**; an untouched source on missing toolchains remains **BLOCKED (exit 2)**. This is local run consistency, not an externally signed source attestation.

The Packet 0 Node runner caps test-file concurrency at two workers and divides first-party contracts into disjoint runs: the full `backend/test/packet0-*.test.mjs` characterization set first, then the remaining backend and root Node contracts, dynamically including `.test.mjs`, `.test.cjs`, and `.test.js` files. Every discovered test file is still executed once (except the unsupported-runtime `password-migration.test.mjs` in the Node 22 fallback); this avoids an unnecessary second run of hundreds of database/security characterization cases that previously caused wrapper timeouts. A completed local suite does **not** replace supported Node 24/npm 11 build or live Supabase acceptance gates.

## Clean source artifacts

Create a source archive without dependency caches, build output, local environment files, or stale analyzer output:

```bash
npm run package:source -- ../NearPill-source.zip
```

The packager refuses to run if a populated `.env*` file is present. `.env.example` is intentionally retained as documentation. The existing secret scan also rejects literal credentials in PostgreSQL libpq URLs, keyword/value conninfo, and PostgreSQL JDBC short-form database-name URLs (including percent-encoded password parameter names); documented environment placeholders are allowed. It also refuses hard-coded libpq `PGPASSWORD` assignments in source, deployment scripts, and CI—including PowerShell `$env:PGPASSWORD` and JavaScript `process.env.PGPASSWORD` or bracketed environment assignments—and Python `os.environ[...]` / `os.putenv(...)` literal assignments, while allowing variable or CI-secret references; this does not change the existing runtime-supplied backup/restore credentials. The scanner also rejects Apple `.p8` signing keys and `.mobileprovision` profiles and scans `.plist`, `.xcconfig`, `.pbxproj`, and SVG source text for high-confidence secrets. The scanner now also **requires decodable text** throughout the operational helper trees (`scripts/`, `backend/scripts/`, `infra/`, `.github/`), including extensionless and custom-suffix files. Invalid UTF-8 or unexpected NUL bytes there fail closed, while ordinary binary media under `assets/` remain permitted. This is not a replacement for scanning arbitrary binary assets. The scanner also inspects UTF-8-readable first-party source regardless of filename extension (such as `.py`, `.envrc`, or extensionless deployment files), and scans BOM-marked UTF-16LE/UTF-16BE source plus strongly identifiable ASCII-rich BOM-less UTF-16 deployment text (including Windows scripts), rather than mistaking their NUL bytes for binary assets. Unknown binary assets are not parsed as source or decompressed, but recognizable plaintext API keys, Supabase service-role JWTs, and credentialed PostgreSQL URLs embedded in opaque asset bytes now block the source handoff; harmless media remains allowed. Malformed known text configurations and malformed BOM-marked text fail closed. The source scanner also rejects nested compressed/container archives by filename or recognizable binary header, including renamed TAR archives (whose `ustar` marker is at byte 257), XZ and bzip2 streams, because an opaque inner archive could hide unscanned credentials even when the outer source manifest matches. This policy covers source handoffs, not an inspection of an archive’s inner contents. This is a heuristic source-artifact gate, not a managed secret scan of history, opaque binary payloads, or installed dependencies. The source packager also uses GNU `mv -T` for exact-filename publication after ZIP and source-manifest verification, so a directory or directory symlink appearing at the destination cannot divert the verified archive into an unexpected folder. In addition, it binds the published archive to the SHA-256 of the manifest read **before** the initial preflight: a simultaneous source-and-manifest substitution during ZIP creation cannot redefine the accepted baseline. This is local consistency checking, not an externally authenticated release signature.

## Existing service/readiness documentation

- [Data and order inventory](docs/data-inventory.md)
- [Readiness audit and outstanding launch requirements](docs/readiness-audit.md)
- [Shared prelaunch policy text](web/policies.json)


### Packet 0 PostgreSQL predefined-login hardening (26 October 2026)

The existing side-effect-free migration/fixture target gates now refuse `pg_*` as an
application or migration login, including PostgreSQL's predefined data-wide,
monitoring and operational roles. Their live role-membership SQL also checks the
current role itself (not just its other memberships) and includes the reserved
`pg_` namespace to cover additional PostgreSQL predefined roles. This removes
a source-level blind spot if a privileged predefined role were ever enabled
for LOGIN; it does **not** assert that such a login exists on NearPill Supabase.
These are characterization/least-privilege preflight improvements only: they do
not modify actual roles or permissions or establish staging RLS, migrations,
backup/restore or Packet 0 acceptance. Refer to the 26 October Implementation
Ledger entry for red-first tests and environmental blockers.

### Packet 0 mixed-case privileged login preflight alignment (26 October 2026)

The canonical migration, app/migrator fixture and disposable legacy-import
preflights now reject reserved PostgreSQL `pg_*` login names and privileged
provider/owner role names without relying on exact letter case. PostgreSQL
quoted identifiers can preserve mixed case; string preflight checks must not
silently admit `PG_READ_ALL_DATA` or `Postgres` where a lowercase equivalent
would be rejected. The synthetic legacy importer explicitly denies reserved
`pg_*` names for its PostgreSQL migrator. These no-connect checks supplement,
not replace, the mandatory read-only live role, grant, RLS and ownership
verification on an approved NearPill Supabase staging database. The existing
SQL migrations and backend-owned application identity are unchanged.

### Packet 0 fixture-writing owner-role preflight alignment (26 October 2026)

The existing `backend/scripts/lib/verify-fixture-target.mjs` now refuses a
`nearpill_owner` application **or** migration login for local and authorized
Supabase staging fixture-writing verification, including quoted-case variants
and session-pooler `<role>.<project-ref>` usernames. Previously the same role
was rejected by the migration/backup/restore guards but could pass this
fixture-writing **pre-connection** gate. Backend-owned authentication, normal
`nearpill_app` fixture role handling, actual RLS policies and all reviewed SQL
migrations remain unchanged. A fail-closed name check is not live role/grant
attestation: no fixture write or database connection was executed for this fix.
Packet 0 acceptance still needs the approved NearPill Supabase staging role/RLS,
100-way contention, reconciliation and restore evidence.

### Packet 0 local backup/restore role preflight alignment (26 October 2026)

The existing *local-test-only* `pg_dump` and destructive `pg_restore --clean`
preflights now refuse any database login in PostgreSQL's reserved `pg_*`
namespace, including quoted/case-variant spellings, as well as the NearPill
application and owner login names. This aligns their no-connect name checks
with the existing fixture/migration security gates and prevents these elevated
logins from reaching either subprocess in the reviewed local workflow. It
retains the explicitly confirmed loopback test database, distinct restore
approval and archive digest restrictions. **This is not live PostgreSQL role
attestation or an authorized staging restore drill**: effective grants, RLS,
real backup recoverability and Supabase ownership remain independently blocked.

### Packet 0 nested generated-directory source review (26 October 2026)

The existing source manifest and source-secret scanner previously excluded
`build`, `dist`, `node_modules` and other generated-directory names regardless
of location. That correctly excludes normal `web/dist` and `backend/build`
artifacts, but also silently omitted executable source placed at
`backend/src/build/`, `web/src/dist/` or `lib/node_modules/`. The Packet 0
pre-execution integrity check could therefore pass despite an unreviewed
module inside an active source subtree.

Both existing verifiers now reject excluded-name directories nested under
first-party runtime, test, scripts and infrastructure source paths. They still
exclude ordinary generated/dependency caches outside those protected paths.
The red-first regression reproduced this omission in both verifiers, while
the focused tests prove that normal generated output remains allowed. This
change affects source-review tooling only; it makes no application runtime,
SQL migration, database-role or provider changes. The SHA-256 manifest and
operator Supabase/RLS acceptance gates remain independent.

### Packet 0 served/bundled asset directory integrity (26 October 2026)

The manifest verifier and source-secret scanner now apply the same fail-closed
nested generated-directory rule to served Hono assets (`backend/public`), Vite
static assets (`web/public`), and Flutter-bundled assets (`assets`). Previously,
`backend/public/dist/`, `web/public/build/`, and
`assets/images/node_modules/` could hide newly introduced files from both
reviewed source inventory and secret scanning. Red-first fixture regressions
prove the omission and its correction; ordinary `web/dist` and
`backend/build` generated outputs remain excluded.

This is local Packet 0 source-artifact characterization only, not a runtime
feature change, live Supabase role/RLS attestation, or release approval. No
PostgreSQL migration, auth, order or payment logic changed. The supported
Node/Flutter toolchain, source lockfiles, and real NearPill-owned Supabase
security/integrity/recovery acceptance gates remain separately blocked.

### Packet 0 canonical migration-directory source integrity (26 October 2026)

The existing complete-source manifest and secret scanner now also protect
`backend/migrations/`, the canonical Drizzle/PostgreSQL SQL migration tree.
Previously a directory such as `backend/migrations/postgres/dist/` was
skipped as disposable build output by both scanners even though it was within
reviewed migration source. Two red-first fixture regressions reproduced the
omission; the existing checks now reject that nested generated-name directory
without changing migration SQL, ordering, Drizzle configuration or live roles.
Ordinary root/backend/web generated outputs remain excluded. Source checks
are not proof of migration replay or RLS safety on Supabase staging.

### Packet 0 local GitHub Action source integrity (26 October 2026)

The two existing source-review gates now also refuse unreviewed `build`, `dist`
(or other excluded generated-name) folders under `.github/actions/` and
`.github/scripts/`. These locations can hold executable local CI action code,
not disposable root build output. The regression fixtures reproduced the
previous skip and now pass; ordinary root/backend/web generated output remains
excluded. This is an offline source-handoff safeguard only, not a live Supabase
role, RLS, migration, restore, or release acceptance result.

### Packet 0 acceptance status versus local checks (20 October 2026)

`npm run verify:packet0` is a **fail-closed packet acceptance gate**, not merely a
Node/Flutter smoke test. Exit `1` means a runnable check failed; exit `2` means
required evidence is blocked or missing.
The existing secret scan and SHA-256 manifest run **both before and after**
characterization/build checks: a test-created or altered first-party source file
returns exit `1` even when the supported-runtime or staging gates would
otherwise cause exit `2`. These are local consistency checks, not a signed
source attestation or a substitute for live PostgreSQL validation. Even on a fully supported Node/Flutter
host, a clean local build will return `2` until the verifier is extended to
execute (and record) the separately owner-approved NearPill PostgreSQL app-role
RLS negative tests, migration/replay and data reconciliation, high-contention
inventory tests, and a genuine backup/restore drill. The presence of a ZIP,
preflight SQL, operator confirmation, or recording mocks is **not** acceptance.
Do not override this status or use an unrelated Supabase project to obtain a
passing result. Supabase remains the selected provider, not proof of a cutover.

### Packet 0 case-insensitive source-handoff guard (26 October 2026)

The existing SHA-256 source manifest verifier and source-artifact secret scanner
now reject different first-party file or directory names that would collide
when a Linux-created ZIP is extracted on a normally case-insensitive Windows
filesystem (for example, `README.md` and `readme.MD`). The secret scanner also
rejects `.ENV` and case-variant `.env.production` credential files while still
allowing the recognized `.env.example` template. Four disposable red-first
regressions establish the previous gaps and their correction. No application,
auth, Drizzle SQL migration, RLS, Supabase connection or product behavior was
changed. This local handoff safeguard does not substitute for signed source
provenance or the blocked live Supabase security/integrity/recovery gates.


### Packet 0 Windows-portable source names (26 October 2026)

The same reviewed source manifest verifier and source secret scanner now refuse
Windows-reserved device basenames (including `AUX.txt` and `COM¹.log`), forbidden
filename characters such as `:`, and trailing spaces or periods in source names.
These names are permitted on Linux but may be lost or misinterpreted when the
verified ZIP is extracted on Windows. Disposable red-first regressions test the
existing checks; normal generated build exclusions remain unchanged. This is
only a source-handoff integrity guard and does **not** establish that the
blocked Node/Flutter or live Supabase acceptance gates have passed.

### Packet 0 Windows CMD libpq environment credential guard (26 October 2026)

The existing source secret scanner now checks quoted `set` assignments and
`setx` commands in Windows CMD/batch deployment source for embedded PostgreSQL
passwords. `%MIGRATOR_DB_PASSWORD%` and delayed `!MIGRATOR_DB_PASSWORD!`
references remain allowed when supplied externally; literal values do not.
The regression demonstrated a scanner miss before the fix and passes after.
This is a source-package heuristic, not live Supabase privilege/RLS acceptance.

### Packet 0 executable script encoding gate (26 October 2026)

The existing source-artifact scanner now treats PowerShell (`.ps1`, `.psm1`,
`.psd1`), Windows CMD/batch (`.cmd`, `.bat`) and Python (`.py`) deployment
helpers as mandatory decodable text. Malformed UTF-8 or unexpected NUL bytes
can no longer cause one of these executable first-party files to be silently
skipped as an opaque asset. Valid UTF-8 and supported BOM-marked UTF-16 script
text remain allowed. This is a source-handoff safety check only: it does not
prove the scripts execute correctly or establish live PostgreSQL authorization.
No application business logic, schema or RLS policy changed; Packet 0 staging
and supported-toolchain acceptance remain blocked.

### Packet 0 fixture login identity preflight (26 October 2026)

The existing `assertApprovedFixtureTarget()` now fails before opening a database
connection if either explicitly configured fixture application or migrator login
contains internal whitespace, control characters, or invisible Unicode format
characters. This closes a source-only validation gap where ambiguous login
identities passed the operator approval check. Ordinary NearPill database roles
and Supabase session-pooler `<role>.<project-ref>` login forms remain supported.
The associated regression is in the existing
`backend/test/packet0-db-verification-preflight.test.mjs`.
This is **not** verification of live permissions, RLS, Supabase ownership or TLS.
Packet 0 acceptance remains blocked until those tests and the supported
Node/npm, lockfile and Flutter gates are available.

### Packet 0 direct-migrator login identity gate (26 October 2026)

The canonical PostgreSQL migration runner's existing `assertApprovedMigrationTarget()`
now rejects login identities containing internal Unicode whitespace, control
characters or invisible format characters before opening its direct migration
connection. This brings its operator preflight into line with the existing
fixture-write identity guard. Ordinary local migrator roles and the separately
approved, unqualified Supabase direct-migrator login remain supported. The
regression tests validate only the offline pre-connection policy; they do not
establish database grants, ownership, TLS, RLS isolation or migration safety on
an authorized NearPill staging database. The seven reviewed SQL migrations,
authentication and domain logic are unchanged, and Packet 0 acceptance remains
blocked by the required environment and live-database gates.

### Packet 0 raw PostgreSQL connection values (26 October 2026)

The existing reviewed-migration and fixture-writing preflights now reject
leading/trailing whitespace in connection host, database, port, application
login and migrator login settings (including the separate staging migrator
endpoint). Previously they approved `.trim()` copies while `pg.Pool` received
the original environment values. This is an offline, fail-closed target-identity
check with red-first regression coverage; ordinary direct and Supabase
session-mode settings are preserved. No live connection, SQL migration or
business behavior was changed. Actual Supabase owner approval, TLS, role/RLS,
restore, supported Node/npm/Flutter and stock/data-integrity gates remain
**NOT RUN/BLOCKED** until their required environment is available.

### Packet 0 local backup/restore raw-connection identity guard (26 October 2026)

The local disposable-test `pg_dump` and destructive `pg_restore` scripts pass
`DB_HOST`, `DB_NAME`, `DB_PORT` and `DB_USER` directly to PostgreSQL. Previously
their no-connect preflights approved **trimmed** values instead. Both preflights
now reject padding in those four fields and `MIGRATOR_DB_USER` before opening
an archive or running the database utilities. This matches the existing
migration/fixture verification boundary; valid loopback test configurations
retain their behavior. Synthetic tool fixtures demonstrate no `pg_dump` or
`pg_restore` invocation on rejected raw identities. These local source tests
are **not** an executed PostgreSQL restore drill, an approved Supabase staging
connection, or proof of data integrity / tenant RLS.

### Packet 0 standalone PostgreSQL operation preload guard (26 October 2026)

The existing disposable-local `backend/scripts/backup-postgres.sh` and
`backend/scripts/restore-postgres.sh` now reject inherited `NODE_OPTIONS` before
launching their Node-based target preflights. A `--require` or `--import`
preload would otherwise execute code before the backup or destructive-restore
authorization guard, so even an invalid destination could run unreviewed JS.
The shell scripts fail closed with status 2; operators should unset ambient
Node flags before invoking them. These are local-test utilities, not a managed
Supabase backup/restore workflow. The regression tests do not connect to a
real database, and staging RLS, backup/restore, and concurrency acceptance
remain blocked pending an explicitly approved NearPill staging project.


## 2026-10-26 — npm registry URL credential source gate

The existing `.npmrc` scanner already rejected inline `_authToken`, `_auth`
and `_password` values but did not catch credentials embedded in a registry
URL's HTTP userinfo. A synthetic regression confirmed that a literal
username/password in an npm registry endpoint could be included in the source
ZIP. The current scanner now rejects that form without exposing its value in
diagnostics. Environment-substituted passwords such as `${NPM_PASSWORD}` and
normal unauthenticated registry endpoints remain supported. The existing
lockfile URL guard also reuses the shared detection helper. This is an
offline source-handoff check only; it is not a dependency install, Supabase
security acceptance, or a production deployment. Packet 0 remains blocked.

### Packet 0 decoded npm lockfile metadata secret gate (26 October 2026)

The source-secret checker now applies its existing high-confidence token,
Supabase service-role JWT, and PostgreSQL URL detectors to **JSON-decoded** npm
lockfile strings, not just registry URLs. Escaped JSON code points can conceal
a token prefix from raw-text matching even though parsers reconstruct the
credential. Red-first synthetic tests cover the bypass, safe external
placeholders, and redacted diagnostics. This is source-handoff verification,
not evidence of a live NearPill Supabase role/RLS or a supported build.

### Packet 0 npm package manifest decoded-JSON credential gate (26 October 2026)

The source-handoff scanner now applies the same decoded-JSON secret and npm
registry URL validation to `package.json` as to npm lockfiles. Npm reads
`publishConfig.registry` from parsed JSON; Unicode escapes or escaped slash
characters must not allow credentials to cross the source-artifact boundary.
Literal auth fields and malformed package JSON are rejected; ordinary registry
URLs and runtime `${NPM_TOKEN}` references remain valid. A red-first fixture
confirmed the original bypass. This is a local source-artifact gate, not a
lockfile generation, dependency install, Supabase migration, or acceptance of
NP-031 RLS and other live staging gates.

### Packet 0 decoded npm JSON PostgreSQL connection credential gate (26 October 2026)

The existing source-handoff scanner also applies its libpq environment-assignment,
PostgreSQL JDBC short-URL and keyword/value conninfo credential checks to the
**decoded strings** in npm lockfiles and `package.json` files. JSON Unicode
escapes must not conceal database passwords in package scripts, configuration or
metadata. Password references supplied externally through environment variables
remain acceptable. Regression fixtures use synthetic values; findings contain
only category and filename, never the secret. This is an offline source-artifact
check, **not** a real Supabase permission test, supported-runtime build or
resolution of the existing RLS acceptance blockers.

## Opaque media credential checks (Packet 0, 26 October 2026)

The existing source handoff scanner checks readable plaintext inside otherwise
binary assets for embedded libpq environment-password assignments, PostgreSQL
JDBC/conninfo credentials and authenticated npm registry URLs, in addition to
its established high-confidence API-token, Supabase service-role JWT and
PostgreSQL URI checks. Harmless media assets continue to pass. Detection is
limited to uncompressed readable byte sequences; it cannot inspect encrypted
or compressed metadata and is not an audit of live Supabase role policies.

### Packet 0 JSON database-password source gate (26 October 2026)

The existing `scripts/secret-scan.mjs` checks decoded ordinary JSON configuration
for literal PostgreSQL password values, including explicit `PGPASSWORD`/`DB_PASSWORD`
keys and `password` entries under database-related objects or a database-named
configuration file. It rejects synthetic literal passwords while preserving the
existing `backend/database.json` `{ "ENV": "DB_PASSWORD" }` reference and
explicit environment placeholders. A regression failed before the correction
and passed after it. The check is a local source-artifact safeguard, **not**
a Supabase deployment credential audit or proof of database RLS acceptance.

### Packet 0 environment-template credential gate (26 October 2026)

The existing `scripts/secret-scan.mjs` rejects literal password, token,
API-key or secret values in distributable `.env.example` files, even when a
value is too short or opaque to match a provider token signature. It permits
empty values, explicit example placeholders (`replace-with-...`, `replace_me`,
`[YOUR_TOKEN]`), and external environment-variable references. A red-first
regression confirms the previous omission and the corrected check. Findings
report only the file path and category, not a credential. This is an offline
source-handoff safeguard, not an audit of Git history, secrets held outside the
repository, or live Supabase role/RLS acceptance.

### Packet 0 JSON byte-encoding gate (26 October 2026)

The dependency-free `scripts/check-json-syntax.mjs` rejects a leading UTF-8
byte-order mark (`EF BB BF`) before decoding first-party `.json` files.
Node's default `TextDecoder` would silently discard these bytes, allowing the
syntax gate to approve a file that `JSON.parse` of the original Node UTF-8
file contents rejects. The existing JSON regression suite now characterizes
this discrepancy and verifies ordinary nested JSON still works. This is a
source-reproducibility safeguard, not evidence of a successful Node 24 build,
Flutter build, database migration, Supabase RLS check, or production release.
