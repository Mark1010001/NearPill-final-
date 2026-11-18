> **Current persistence note (2026-10-17):** the foundation topology described below has been superseded by the in-place PostgreSQL/pgvector cutover. MySQL references are retained only as historical Packet 1 evidence.

# NearPill engineering foundation

NearPill remains one codebase. These files establish the engineering boundary required before backend extraction; they do not introduce a second backend, web application, mobile application, database authority, or business implementation.

## Toolchain

- Node runtime: `24.22.0` via `.nvmrc` and `.node-version`.
- Supported Node range: `>=24.7.0 <25`.
- New/migrated TypeScript: strict checking through `tsconfig.base.json` and `tsconfig.json`.
- ESLint and Prettier are root engineering tools; their exact versions are declared in `package.json`.
- Flutter remains the existing project and is pinned in CI to Flutter `3.44.4`.

## Root commands

```bash
npm run test:foundation
npm run check:syntax
npm run typecheck
npm run lint
npm run format:check
npm run secret:scan
npm run test:backend
npm run package:source
```

`npm run start:backend` delegates to the existing `backend/` application; application roots were not moved.

## Environment contract

`backend/src/config/env.ts` defines the typed environment contract for migrated backend code. It preserves current development defaults while rejecting malformed ports, wildcard CORS, non-HTTP origins, and non-HTTPS `PUBLIC_APP_URL` in production. It is intentionally not wired into the legacy Express bootstrap until the backend extraction packet moves startup/configuration behind the composition root.

## Container skeleton

`compose.yaml` wraps the existing MySQL backend and static web portal. It does not introduce PostgreSQL or a replacement application. The initial topology is:

```text
browser -> nginx:8080 -> existing web
                      -> existing Express API
                              -> existing MySQL
```

The database and API are internal services; only NGINX publishes a host port. `db-init` uses the existing `backend/init-db.js` before the API starts. PostgreSQL/Drizzle migration remains a later packet.

## Source artifacts

Use `npm run package:source`. The source archive excludes dependency caches, local secret files, build output, logs, Git metadata, and stale analyzer output. Dependencies are reconstructed from lockfiles instead of being shipped as source.

## Current execution limitation

The current audit sandbox cannot resolve the npm registry and does not provide Node 24, Flutter, or Docker. Therefore root tool dependencies cannot be lock-installed here and the Compose stack cannot be started here. CI is configured to run those gates on the declared toolchains. Do not mark the engineering-foundation packet complete until a root lockfile is generated and clean-install/lint/format/typecheck/backend/Flutter/container startup gates are executed successfully.

## Foundation readiness corrections

- `backend/init-db.js` now returns a failing process status when schema initialization or connection shutdown fails. This makes Compose's `service_completed_successfully` dependency meaningful instead of allowing API startup after a failed initialization.
- `api` now has a health check against the canonical `/api/v1/health` endpoint, and the gateway waits for API health rather than mere process start.
- `test/env-config.test.mjs` executes the typed environment parser to verify wildcard-CORS rejection, HTTPS production URL enforcement, paired mail configuration, and safe explicit test configuration.
- `scripts/check-runtime.mjs` provides a narrow runtime-policy gate for Node `>=24.7.0 <25`, the pinned Node 24 major, and npm 11 when invoked under npm.

## 2026-10-17 targeted continuation evidence

This continuation intentionally avoided broad regressions already categorized by Packet 0. The following Packet 1-specific checks were executed:

- foundation contracts: 8/8 PASS;
- typed environment runtime behavior: 4/4 PASS (Node 22 host used the type-stripping flag only for this test; Node 24.12+ supports stable built-in type stripping);
- strict TypeScript check using the available host compiler: PASS;
- first-party JavaScript syntax: PASS (27 files);
- high-confidence secret scan: PASS;
- Packet 0 adjacent characterization regression: 7/7 PASS;
- Compose YAML topology/exposure semantics: PASS;
- NGINX configuration syntax: PASS;
- runtime policy check: correctly returns environment-blocked on host Node 22.16.0;
- root lock generation remains blocked: an offline lock attempt returns `ENOTCACHED`, and container DNS cannot resolve `registry.npmjs.org`.

Additional foundation corrections in this continuation make database initialization fail closed for Compose orchestration and gate NGINX on a healthy existing API instead of process start alone. These are engineering-runtime changes only; no NearPill business rule was migrated or duplicated.

## Reproducible root install guard

The root toolchain now pins `npm@11.19.1` through `packageManager` and exposes `npm run check:lockfile`. The preflight returns exit `2` while the root lockfile is absent and exit `1` for a structurally inconsistent lockfile. CI no longer uses mutable `npm install` for engineering tooling; it requires the lock preflight followed by `npm ci --ignore-scripts`.

A real root `package-lock.json` is intentionally not fabricated offline. It must be generated by npm with registry access so the complete transitive dependency graph is authoritative and reviewable. Until that file exists and `npm ci` succeeds, the engineering foundation remains acceptance-blocked.


After the Hono transport cutover, the stale backend lockfile was removed as well. Both root and backend lockfiles must be generated from their current manifests before clean-install acceptance can be claimed.
