## 2026-11-03 — Packet 0 NP-050 interrupted JSON-body input characterization

**Active packet:** Packet 0 baseline characterization / acceptance continuation. The newest supplied source archive remains the single Hono/Drizzle/React/Flutter codebase; Supabase PostgreSQL is the approved hosting provider, not a verified live staging endpoint.

**Reproduced input failure:** `backend/src/http/transport.ts` `parseBody()` let `c.req.text()` reject on a prematurely failed JSON request stream. A red-first regression reproduced the thrown private stream error before request schema validation, which would reach the shared HTTP error handler rather than the existing generic JSON input error. This is not proof of an installed-Hono exploit.

**Minimal change:** The existing parser catches the request-body read failure and returns the same generic `{error: 'Invalid JSON request body.'}` / HTTP 400 contract already used for malformed JSON. Normal DTO parsing, byte-size 413 rejection, all authorization/tenant/RLS checks and the existing webhook-specific byte reader are unchanged. This does not authorize new payment behavior or live database modifications. No alternate HTTP parser is added.

**Observed local verification (2026-11-03):** Red-first parser test reproduced the thrown error (2/3 passed, 1 failed), and the corrected parser passed 3/3. Focused auth/transport/webhook tests passed 27/27. The complete independently attested Packet 0 test inventory passed **866/866 across 54 files** (three batches, zero skips). Source SHA-256 manifest **332/332**, secret scan and JavaScript/JSON/shell syntax **167/11/8 PASS**. Mobile source contracts **6/6 PASS**, with Flutter execution **BLOCKED**. Existing seven Drizzle/PostgreSQL migration SQL files were not changed or executed. Diagnostic host is Node 22.16.0/npm 10.9.2. The supported-runtime and live Supabase security/data gates are NOT RUN, not PASS.

**Acceptance gates:** Source-level regression and appropriate contract tests must pass, but Node 24/npm 11, authentic npm and Flutter lockfiles/toolchains, installed Hono/NGINX behavior, and an explicitly approved NearPill-owned Supabase staging project with a non-owner/non-`BYPASSRLS` application role remain necessary. Real RLS negatives, reservation contention, financial reconciliation, migration replay and restore are NOT RUN. Packet 1 is not started.

---

## 2026-11-03 — Packet 0 NP-048 signed webhook UTF-8 byte preservation (current continuation)

**Baseline:** Newest provided `NearPill_Packet0_2026-11-03_Loopback_TCP_Characterization.zip`, SHA-256 `d6bbecdeca91a274a5d256a0aff710f166712095ecd1cae991c980c52d91f67d`, ZIP CRC PASS and **1,235/1,235** eligible regular files matched the existing single source at intake. This is an archive, not a verified Git revision or live deployment. Packet 0 stays **ACTIVE / ACCEPTANCE BLOCKED**; Packet 1 NOT STARTED. Supabase PostgreSQL remains the selected provider, without a live connection change.

**Reproduced unsafe before-state:** `backend/src/http/webhook-ingress.js` previously used the default non-fatal `TextDecoder`, silently replacing malformed UTF-8 with U+FFFD and omitting an initial UTF-8 BOM. Both can change the signed request bytes before the existing payment-provider text signature-verification use case. Red-first Packet 0 regressions independently reproduced both transformations.

**Narrow in-place fix:** The existing bounded 64 KiB reader now decodes with `TextDecoder('utf-8', { fatal: true, ignoreBOM: true })`, returning a typed invalid-encoding failure without exposing raw bytes. The existing Hono API middleware maps invalid encoding to HTTP **400** before downstream payment processing, while retaining **413** for oversized bodies. The existing 64 KiB, trusted-proxy, auth, Drizzle/RLS, React/Flutter and order/inventory/payment-domain contracts remain intact. No second webhook path, database, provider, authorization system or project was introduced. NP-048 **SOURCE MITIGATED; installed-Hono/provider runtime NOT VERIFIED**.

**Diagnostic-host test evidence:** Red malformed UTF-8 regression failed as expected (**8/9 passed**); BOM red regression failed as expected (**9/10 passed**); corrected webhook regression **10/10 passed** and adjacent ingress/payment/NP-047 **20/20 passed**. Full 53-file Packet 0 TAP runner returned **exit 0, 862/862 passed**, no skips/failures, in three attested batches. `bash scripts/verify-packet0.sh` **INTERRUPTED in the supplemental Node phase**, with no final wrapper exit status; no PASS claimed. `bash scripts/verify-mobile.sh` **exit 2 BLOCKED** after 6/6 mobile source tests passed. Reviewed source fingerprint manifest, secret scan and JS/JSON/shell syntax checked separately (331/331, PASS, 166/11/8). Executed under diagnostic Node 22.16.0/npm 10.9.2, **not** the required Node24/npm11.

**Outstanding:** Authentic npm/Flutter lockfiles, Node24/npm11, Flutter SDK, owner-authorized NearPill Supabase staging app/non-`BYPASSRLS` roles and direct migrator, live provider signature/webhook ingress and NP-046/NP-047 runtime tests, NP-031–NP-042 and R04, actual RLS tenant negatives, 100-way stock contention, financial reconciliation, migration replay and restore remain **NOT RUN/BLOCKED**. All seven existing PostgreSQL migrations unchanged. **Next safe work is Packet 0 supported-runtime and staging acceptance; Packet 1 not started.**

---

## 2026-11-03 — Independent NP-047 post-mitigation Packet 0 acceptance recheck

**Baseline:** Latest supplied `NearPill_Packet0_2026-11-03_NP047_Trusted_Proxy_Mitigation.zip` (SHA-256 `68955daf888c80ecd93f18728e8036d5a12639fde3c68e707364e99fe755e4be`), ZIP integrity and **1,215/1,215** byte parity PASS at intake, with the sole existing Hono/Drizzle backend, React portal, Flutter mobile and seven reviewed migrations. Supabase PostgreSQL is the selected provider, but no live NearPill project or Git HEAD is verified.

**Packet decision:** Packet 0 ACTIVE / ACCEPTANCE BLOCKED; Packet 1 NOT STARTED. The source-mitigated NP-046 webhook and NP-047 trusted-proxy paths passed targeted **48/48** tests; no new production failure was reproduced, so production source remains unchanged.

**Execution:** `bash scripts/verify-packet0.sh` ran all **858/858 Packet 0 tests PASS** in three complete batches (**297 + 279 + 282**), with zero failures/skips, and supplemental Node **122 PASS / 1 SKIP**; the host interrupted the enclosing verifier during final integrity checks, so a final full-command PASS is **not** claimed. Separate post-interruption secret and source integrity checks PASS (reviewed manifest **331/331**, JS/JSON/shell syntax **166/11/8**); `bash scripts/verify-mobile.sh` exited **2 BLOCKED** after **6/6** mobile source contracts passed. The unsupported diagnostic runtime is Node 22.16.0/npm 10.9.2.

**Scope:** Updated this baseline record, its reviewed SHA-256 manifest entry, the existing master Implementation Ledger and added four dated execution-evidence files under `docs/`. No production modules, migrations, RLS, sessions, inventory, payments, client features or proxy configuration changed; no legacy path removed. All seven existing migration SQL files remain byte-identical.

**Blocked gates:** Node24/npm11 and authentic npm/Flutter locks, Flutter SDK, authorized NearPill Supabase staging non-bypass app role, installed-Hono/NGINX NP-046/NP-047 checks, NP-031–NP-042 and R04, application-role tenant RLS/pool isolation, 100-way inventory contention, migration replay, payment reconciliation and backup/restore all remain **NOT RUN/BLOCKED**. **Next safe packet: Packet 0 supported-toolchain and owner-authorized Supabase staging acceptance continuation.**

---

## 2026-11-03 — Packet 0 forwarded-IP rate-limit trust characterization (NP-047)

**Current baseline:** Latest supplied `NearPill_Packet0_2026-11-03_1536_Acceptance_Reconciliation.zip` (ZIP CRC PASS, 1,204/1,204 source-file byte parity before this change). One Hono/Drizzle backend, React portal, Flutter app and seven reviewed PostgreSQL SQL migrations remain canonical. Packet 0 is the first incomplete dependency-ready packet; Packet 1 is not started.

**Security before-state:** The real `clientIp()` implementation in `backend/src/http/transport.ts` selects the first `X-Forwarded-For` header value ahead of the socket's `remoteAddress`. That value is used by `limiter.allowIp(clientIp(c))` for login/recovery throttling. A single direct peer supplying two different forwarded headers obtains two distinct rate-limit keys; the header is not validated as an IP. **NP-047 is OPEN**, contingent on an untrusted/direct ingress. The reviewed `infra/nginx/nginx.conf` `/api/` proxy *overwrites* `X-Forwarded-For` with `$remote_addr`, and the reviewed Compose API service is `expose`-only without a public `ports:` mapping. These mitigate the issue in that topology; they do not prove that every deployed ingress or direct network path is trustworthy.

**Scope and acceptance:** Added an executable before-state and proxy-topology characterization in `backend/test/packet0-forwarded-ip-trust.test.mjs`. No production header parsing, authentication, rate limits, NGINX, SQL migrations, RLS, React, Flutter, orders or payments were modified. Require an owner-reviewed proxy trust/network policy and installed Hono/NGINX HTTP negative tests on every ingress path before marking NP-047 fixed. Do not call source tests a production rate-limit security PASS. The database provider remains Supabase PostgreSQL; stage RLS/tenant, contention, financial reconciliation, backup and restore gates remain blocked pending an authorized NearPill-owned target.

---

## 2026-11-03 — Latest current-source independent acceptance continuation (15:36 Asia/Manila)

**Baseline:** `NearPill_Packet0_2026-11-03_1522_Independent_Gate_Recheck.zip` (SHA-256 `2f39b7fd8cc3edcf895e81aaf326a274eb32ae8ff92ef6fe15e68e0a85998d1d`; 1,200/1,200 regular files byte-identical before editing; ZIP CRC PASS). The newest uploaded codebase is the only canonical project; no Git revision or approved live NearPill-owned Supabase endpoint is available. All seven canonical migrations are unchanged.

**Packet status:** Packet 0 **ACTIVE / ACCEPTANCE BLOCKED**, Packet 1 NOT STARTED. `bash scripts/verify-packet0.sh` verified the complete **853/853 PASS** source-level TAP across 52 files (307+294+252), but the host terminated the enclosing command during post-execution scanning, with no final verifier exit status. A PASS is **not claimed** for the overall command. Standalone manifest/secret checks passed. Focused gate/webhook contract **43/43 PASS**. `bash scripts/verify-mobile.sh` returned exit 2 BLOCKED after **6/6 source contracts PASS**. Source JS/JSON/shell syntax **165/11/8 PASS**. See `docs/packet0-verification-2026-11-03-1536-summary.txt` and three raw transcripts.

**Changes:** Only the current baseline document, its reviewed source hash, the master Implementation Ledger and dated evidence were updated. No production Hono/Drizzle/auth/RLS/React/Flutter/order/inventory/payment code or SQL migration was modified, and no obsolete code was removed without parity. Toolchain Node24/npm11, genuine dependency lockfiles, Flutter SDK and authorized NearPill Supabase non-owner/non-`BYPASSRLS` staging role remain unavailable. NP-031–NP-042, R04, NP-046 installed-Hono ingress, real RLS/tenant and 100-way concurrency, financial reconciliation, migration replay and restore remain **OPEN/NOT RUN/BLOCKED**. Next safe packet: Packet 0 acceptance continuation, not Packet 1.

## 2026-11-03 15:22 — Current archive, runnable characterization and blocked acceptance recheck

The latest supplied canonical NearPill source ZIP `NearPill_Packet0_2026-11-03_Current_Independent_Acceptance.zip` has SHA-256 `785d62933ed1095dce2a48e1b905f8eb8533d9a25dd225ceb8e797e3d5824297` and passes a 1,196-file CRC/path/symlink inventory. Packet 0 remains ACTIVE / ACCEPTANCE BLOCKED. On diagnostic Node22/npm10, the bounded runner completed 853/853 tests in three independently attested groups (307+294+252); 165 JavaScript, 11 JSON and 8 shell syntax files passed; the supplemental Node subset was 122 passed/1 skipped. The monolithic verification shell command was **interrupted after these tests**, during post-execution source scanning, without a final status. Subsequent independent 330/330 manifest and secret scans PASS. Mobile source contracts pass 6/6 but `verify-mobile.sh` exits 2 BLOCKED due to absent Flutter. See `docs/packet0-verification-2026-11-03-1522-summary.txt` and raw logs. No application or migration changes were made; original seven SQL migrations are preserved. Node24/npm11, original dependency lockfiles, Flutter SDK, owner-authorized NearPill Supabase app role and all live RLS/concurrency/migration/reconciliation/restore checks remain unverified. No live DB mutation, provider cutover, duplicate system or legacy removal. **Next safe packet: Packet 0 acceptance continuation, not Packet 1.**

---

## 2026-11-03 — Latest supplied archive, independent full Packet 0 recheck

**Canonical input:** `NearPill_Packet0_2026-11-03_Batch_Timeout_Verification.zip` (SHA-256 `9ce3ac0fb80e18b49be1c4660fe405953177806859b7eab7ae1eaba79005e635`), ZIP integrity PASS and **1,191/1,191** regular files matched the existing source tree at start. No Git checkout or deployed NearPill project was verified. Existing Hono/Drizzle/RLS auth and domain architecture, React portal, Flutter app and seven migrations preserved. Supabase PostgreSQL remains the selected database provider (not a live connection or migration).

**Packet status:** Packet 0 ACTIVE / ACCEPTANCE **BLOCKED**; Packet 1 NOT STARTED. `bash scripts/verify-packet0.sh` ran to completion on diagnostic Node v22.16.0/npm 10.9.2 (exit **2 BLOCKED**): **853/853 PASS** across 52 Packet 0 files in batches 307+294+252, zero failures/skips; supplemental Node **122/123 pass, 1 skip**; source manifest **330/330**, secret scans and first-party syntax checks **PASS**. `bash scripts/verify-mobile.sh` exits **2 BLOCKED** after **6/6** mobile source contracts pass; no Flutter execution. Separate webhook/acceptance test files pass **43/43**. Original seven SQL migrations matched input bytes exactly. Full test/verification records: `docs/packet0-verification-2026-11-03-current-acceptance-*.txt`.

**Change boundary:** Documentation, reviewed baseline hash and evidence only. No application, test logic, Drizzle migration, PostgreSQL role/grant, RLS, payment or production behavior changed; no legacy path removed without accepted parity. Real owner-approved Supabase staging app-role RLS, pool tenant negatives, 100-way inventory concurrency, payment reconciliation, migration replay, restore, installed-Hono signed-webhook tests, Node24/npm11 lockfile builds and Flutter tests remain NOT RUN/BLOCKED. NP-031–NP-042, R04 unresolved; NP-046 source mitigated, live integration unverified. **Next safe packet: Packet 0 acceptance continuation.**

---

## 2026-11-03 — Packet 0: fail-closed per-batch test deadline (latest continuation)

**Canonical baseline:** Most recent supplied `NearPill_Packet0_2026-11-03_Batched_TAP_Continuation.zip` (SHA-256 `b706c345da4927a7fc4f1edcb95dee0cd68d331b75a9ca90dfb47a2a09d0896f`), ZIP CRC PASS, 1,184/1,184 regular files byte-identical with the sole existing source tree before edits. The source is an archive, not an identified Git HEAD or live deployment. Existing Hono/Drizzle backend, React web portal, Flutter mobile app and seven canonical PostgreSQL migrations are retained. Supabase PostgreSQL is the chosen provider, not proof of staging ownership or production cutover.

**Packet decision:** Packet 0 is still **ACTIVE / ACCEPTANCE BLOCKED**, the first incomplete dependency-ready packet. Packet 1 NOT STARTED. Missing genuine npm/Flutter lockfiles, declared Node/npm and Flutter SDKs, and an owner-approved NearPill Supabase staging project/app role prevent final acceptance.

**In-place change:** Existing `scripts/run-packet0-tests.mjs` now enforces a 120,000 ms maximum on *each* attested TAP batch, terminates the Node test-runner process group (including worker descendants on POSIX) when stalled, and refuses any successful result after a timeout. The optional `NEARPILL_PACKET0_BATCH_TIMEOUT_MS` override is bounded to 250..120000 ms and can only shorten the deadline for test fixtures. The existing `backend/test/packet0-acceptance-gates.test.mjs` now contains a negative hanging-test fixture that reproduces the old indefinite wait, then proves the runner itself fails closed without claiming an aggregate PASS. This is **test infrastructure and characterization only**: no application routes, authentication, Drizzle/RLS migrations, business logic, React/Flutter, payments or production providers changed. Seven reviewed migration SQL files retain identical bytes. No legacy path removed without parity acceptance.

**Evidence boundary:** This runner watchdog makes the source-level suite reliably terminate and report failure when stalled, but cannot substitute for Node 24/npm 11 installed dependency execution, Flutter runtime analysis, a real NearPill Supabase non-bypass app-role RLS test, 100-way PostgreSQL stock contention, payment/provider reconciliation, migration replay or restore. NP-031–NP-042, R04 and NP-046 installed-Hono acceptance remain **OPEN / BLOCKED** until independently verified. Packet 0 completion is NOT claimed.

---

## 2026-11-03 — Packet 0: bounded TAP execution and independently attested coverage (latest continuation)

**Baseline:** Most recent user-provided complete source archive `NearPill_Packet0_2026-11-03_Attested_Acceptance_Continuation.zip` (SHA-256 `bf6980bca97850e3781557304987f3c79ff732ccd789eb94dab09c6372c52221`), ZIP CRC PASS, 1,177 ordinary files byte-identical to the existing single NearPill tree at intake; no Git HEAD or live NearPill-owned Supabase project verified. Prior ledger Packet 0 remains **ACTIVE / ACCEPTANCE BLOCKED**. Supabase PostgreSQL is the selected provider, not proof of a connection/cutover.

**Change (verification tooling only):** The existing `scripts/run-packet0-tests.mjs` now executes every discovered first-party test file in sequential bounded groups of at most 18, using the existing Node `--test` runner and `--test-concurrency=2`. Each group must independently exit successfully, produce a complete final TAP summary, execute nonempty test cases in every file, and have zero failures/skips/todo/cancellations (the previously defined unsupported-runtime partial baseline exception remains explicitly partial). The total is printed only after *all* groups pass. No user-supplied flag or environment variable can weaken the real staging acceptance requirements. This addresses prior intermittent monolithic-run interruptions without excluding any test file. The new red/green regression in the existing `backend/test/packet0-acceptance-gates.test.mjs` proves at least two batches run and that a skipped test in the final batch prevents an aggregate PASS.

**Initial executable evidence (diagnostic Node 22.16.0, npm 10.9.2; NOT supported-runtime acceptance):** Red-first new test failed on missing batch attestations; corrected test PASSED. Full acceptance-gate file **35/35 PASS**. Entire discovered Packet 0 suite **852/852 PASS across 52 files** in three batches: 306/306, 294/294, 252/252, all zero skipped/failed. Full verification/migration and mobile outcomes, manifest and syntax checks recorded in the dated handoff evidence; do not confuse local diagnostic test results with Node 24 or live database gates.

**Post-update canonical verification:** `bash scripts/verify-packet0.sh` completed with **exit 2 BLOCKED** after **852/852 PASS** across three independently attested batches, supplemental diagnostic Node **122 PASS/1 SKIP**, 330/330 reviewed-source manifest and secret checks, 165 JS/11 JSON/8 shell syntax checks. `bash scripts/verify-mobile.sh` completed **exit 2 BLOCKED** after **6/6 PASS** mobile source contracts. Flutter execution and real Supabase acceptance were not run.

**Preserved:** One Hono/Drizzle/backend-auth/RLS/order/inventory/payment authority, seven canonical PostgreSQL migrations, the existing React portal and Flutter application. No production JavaScript/TypeScript/Dart behavior, SQL, credentials, Supabase roles or provider endpoints modified; no legacy path deleted without parity evidence. The current source has no proof of an approved staging role/connection or backup, and no claim of live database migration is made.

**Outstanding:** Node >=24.7 <25 and npm 11 with authentic root/backend/web lockfiles, Flutter 3.44.4/Dart 3.12.2 and `pubspec.lock`, owner-approved NearPill Supabase staging non-owner/non-`BYPASSRLS` role and direct migrator, NP-031–NP-042 and R04, installed-Hono NP-046 acceptance, real tenant negative tests/100-way stock contention/payment reconciliation/migration replay/restore remain **BLOCKED/NOT RUN**. Packet 1 NOT STARTED; next safe work remains **Packet 0 acceptance continuation**.

---

## 2026-11-03 — Packet 0: independently completed current-source acceptance recheck (13:17 Asia/Manila)

**Canonical baseline:** Latest complete user-provided `NearPill_Packet0_2026-11-03_Webhook_Bounded_Ingress.zip`, SHA-256 `e65fe0cc8fd8b50135d5c89bb68fec428e2e27f823991667d56552d3b9887036`, ZIP CRC PASS, 1166 regular files; source extracted only into the existing NearPill working tree. No Git HEAD/branch or approved live Supabase target can be inferred from the archive. The canonical Hono/Drizzle backend, React/Vite portal, Flutter app and seven PostgreSQL migrations are preserved; Supabase-hosted PostgreSQL is the approved database provider, not proof of a connected project.

**Packet determination:** First incomplete dependency-ready packet **Packet 0 ACTIVE / ACCEPTANCE BLOCKED**. Packet 1 is blocked by Packet 0 acceptance. Source presence in later packets is not prior acceptance.

**Implementation in this continuation:** Reconciled the existing source-characterization record and ledger after a normal complete execution of the existing Packet 0 verifier; added the exact timestamped executable transcripts/summary and refreshed only the reviewed hash for the updated baseline document. **No production code, tests, scripts, SQL, RLS roles/grants, authentication, migration, web/mobile, order/inventory/payment business logic, or Supabase credentials were changed.** No old paths removed without parity evidence.

**Executed commands and outcomes on diagnostic host Node v22.16.0/npm v10.9.2:**
- `bash scripts/verify-packet0.sh` → **exit 2 BLOCKED**, normal completion; 52 discovered Packet 0 test files, **851/851 PASS**, 0 fail/skip; supplemental remaining Node subset **122 PASS / 1 SKIP**, not Node 24 runtime acceptance. Pre/post 330/330 source digest checks and secret scans PASS, JS/JSON/shell syntax checks PASS. Raw output: `docs/packet0-verification-2026-11-03-current-full.txt`.
- `bash scripts/verify-mobile.sh` → **exit 2 BLOCKED**; mobile source contracts **6/6 PASS**, real Flutter analyze/test/build **NOT RUN**; `docs/packet0-verification-2026-11-03-current-mobile.txt`.
- `node --test backend/test/packet0-webhook-ingress-beforestate.test.mjs` → **7/7 PASS**, Node Web Request/stream + mocked Hono callback; **not installed-Hono integration**.
- Reviewed canonical seven SQL migration checksums against input archive → **7/7 byte-identical**. No migration executed.

**Security/data and release blockers:** Node >=24.7 <25/npm 11 required; host Node 22/npm 10.9.2 and source lacks original root/backend/web `package-lock.json` plus Flutter `pubspec.lock`; Flutter SDK, `psql`, `pg_dump`, Docker absent. No approved NearPill-owned Supabase staging database, non-owner/non-`BYPASSRLS` app role, direct TLS migrator connection, grants inventory or backed-up data. NP-031–NP-042 and R04 remain OPEN/UNVERIFIED; NP-046 is SOURCE-MITIGATED but real Hono ingress/provider-signed events are NOT RUN. Real actor/tenant RLS, BOLA/BFLA, pooled context isolation, 100-way inventory contention, migration replay, financial reconciliation, backup/restore **NOT RUN/BLOCKED**, never PASS by bypass.

**Rollback/next safe work:** Revert this documentation/manifest/ledger update and remove dated evidence if needed; no runtime/database rollback. Continue **Packet 0 supported-runtime and authorized Supabase staging acceptance**, including installed-Hono webhook ingress tests and actual app-role/RLS/concurrency/reconciliation/restore verification. **Packet 1 NOT STARTED. Stop.**

---

## 2026-11-03 — Packet 0: bounded payment webhook ingress correction (source-level acceptance only)

**Canonical input:** Latest supplied `NearPill_Packet0_2026-11-03_Webhook_Ingress_Beforestate.zip`, SHA-256 `a1f5a176a5d8e322c04a954757645a037621482cf3e407d26e5686f80e73ed15`; CRC valid and **1,161/1,161** regular files byte-identical to the current canonical working tree before changes. No Git HEAD or live Supabase target confirmed.

**Current source inventory:** 53 backend source JS/TS files (one existing project; the small new webhook ingress utility is included), 61 Hono route contracts, 8 React TSX and 2 web TS files, 41 Flutter Dart files, and seven existing migrations. Earlier 52-file counts are historical before this amendment.

**Narrow security correction of NP-046:** In `backend/src/http/app.ts`, the existing Hono `bodyLimit` now runs *before* the webhook body is read. The webhook path additionally uses the new small pure helper `backend/src/http/webhook-ingress.js` to clone and read no more than 64 KiB of bytes; it rejects oversized streaming and misleading-`Content-Length` payloads with 413 **before** request context/business use cases, preserving the prior UTF-8 raw-text contract for accepted signed provider events. The helper is not a new provider, database, payment system, or route. No other production route, authorization, application/domain function, SQL, RLS policy, React or Flutter code was changed. An existing stale contract that required unbounded `.clone().text()` was updated to verify safe capture instead. No legacy code was deleted without parity.

**Evidence boundary:** The new Packet 0 tests use the actual middleware source callback with recording adapters, plus real Node `Request`/`ReadableStream` byte reads. They establish in-place source/wiring and helper behavior **not** full installed-Hono/Node-24/NGINX/provider-webhook integration. The earlier unsafe before-state was reproduced red-first; focused tests became green after the correction. Real HTTP chunking/signature acceptance on Node 24 and authorized staging remains NOT RUN/BLOCKED. NP-046 is **SOURCE-MITIGATED / RUNTIME-UNVERIFIED**, not CLOSED. Existing Supabase PostgreSQL provider, backend-owned authentication, Drizzle/RLS migration history and business logic retained. Packet 0 ACTIVE/BLOCKED; Packet 1 not started.

---

## 2026-11-03 — Shared Hono authentication short-circuit characterization (Packet 0 continuation)

**Latest canonical input:** `NearPill_Packet0_2026-11-03_Hono_Route_Auth_Contract.zip` (SHA-256 `9f0693bdcd8ff6570668cee5772a5248f595f4afd407ace1962b17aeb12f2671`); CRC passed and 1,156/1,156 regular source files matched the existing working tree before edits. This is the most recently supplied code archive, not a checked-out Git HEAD or proof of a live deployment.

**Before-state gap closed in source characterization:** The previously added 61-route `auth` metadata inventory could remain green if a shared `makeHandler` authentication or admin short-circuit was removed while the route declarations stayed unchanged. Two new tests in the **existing** `backend/test/packet0-baseline-characterization.test.mjs` now characterize that `authenticateContext` failure returns before invoking the use case, that `adminAccepted` rejects non-administrators with 403, and that each Hono registration uses the shared guarded handler. Five negative source mutations explicitly preserve all 61 metadata records but must fail the shared-enforcement assertion. This is test-only, textual contract protection; it does not prove installed Hono middleware, real bearer/cookie/session behavior, BOLA/BFLA, webhook verification, or real tenant RLS.

**Preserved:** The sole existing Hono backend, server-owned sessions/RBAC, Drizzle and all seven existing PostgreSQL migrations/RLS mechanisms, one React portal, one Flutter app, and Supabase-managed PostgreSQL provider target. No production routes, schemas, SQL, credentials, provider endpoints, migrations, business logic, or legacy code were changed or deleted.

**Not accepted:** Required Node 24/npm 11 and genuine root/backend/web lockfiles, Flutter SDK/lockfile, and authorized NearPill-owned Supabase staging/project role and restore evidence remain unavailable. NP-031–NP-042 and R04 are not closed by source-only characterization. All actual application-role RLS, pool-leak, 100-way stock, data reconciliation, migration replay and backup/restore gates remain NOT RUN/BLOCKED. Packet 0 remains active and blocked; Packet 1 not started.

---

## 2026-11-03 — Packet 0 Hono route authentication inventory characterization

**Baseline:** The most recent provided complete single source package is `NearPill_Packet0_2026-11-03_Independent_Acceptance_Recheck.zip`
(SHA-256 `2da1c9929aec6d5f2fe0db8abe984f7e62baca455779330a3ce04450f0c2735e`);
ZIP CRC and 1,154 regular-file parity held before these changes except the active
in-place test edit. It has no verifiable Git HEAD or live Supabase release target.

**In-place source-contract improvement:** The existing
`backend/test/packet0-baseline-characterization.test.mjs` now checks the exact
61 Hono operation IDs and each declared authentication mode: **15 reviewed
public**, **17 authenticated-user**, and **29 administrator** routes.
The previously count-only characterization would not detect a private route
losing `auth: 'user'` or an admin route weakening to `auth: 'user'`.
The new adversarial fixtures prove those mutations fail; webhook registration
also must retain `rawBody: true` for downstream signature verification.
The `adminUpdateOrderStatus` route remains admin-only despite its `/orders/`
path, and partner endpoints remain authenticated-user routes with authorization
and tenant policy delegated to existing application and PostgreSQL layers.
This is metadata/source characterization only: it does **not** prove actual
middleware enforcement, webhook signatures, live BOLA/BFLA or PostgreSQL RLS.

**Preserved and deferred:** There are no production route, business, Drizzle,
auth, React, Flutter, migration, payment or Supabase secret changes. Existing
seven PostgreSQL migrations are byte-identical to the input. Packet 0 remains
blocked on supported Node/npm and authentic lockfiles, Flutter SDK, and an
approved NearPill Supabase staging database with non-BYPASSRLS app role,
NP-031–NP-042 and R04 resolution, 100-way contention, reconciliation and
restore checks. Packet 1 is not started.

---

## 2026-11-03 — Independent current-source Packet 0 acceptance recheck (no runtime changes)

**Single canonical source:** Latest supplied `NearPill_Packet0_2026-11-03_Indirect_CommonJS_Loader_Source_Gate.zip` (SHA-256 `e91c8d4bc1b0e1cdb0106d10a016617972365dc25c496de6f323c049651f517d`), verified CRC and **1152/1152 byte-identical regular files** against the existing worktree before edits. No Git HEAD or live Supabase deployment verified. Actual source remains 52 backend JS/TS modules, 61 Hono route contracts, 8 React TSX + 2 web TS files, 41 Flutter Dart files, and the same seven Drizzle/PostgreSQL migrations; older Express/MySQL reports are historical, not a license to add a parallel implementation.

**Executed Packet 0 acceptance:** `bash scripts/verify-packet0.sh` **EXIT 2 BLOCKED** after normal completion; 51 Packet 0 test files, **840/840 PASS**, no failures/skips; supplemental unique Node contract subset **122 PASS / 1 SKIP**. The 328-file reviewed manifest, pre/post source secret scan and 163 JS/11 JSON/8 shell parse checks **PASS**. Separate `bash scripts/verify-mobile.sh` **EXIT 2 BLOCKED**; mobile source contracts **6/6 PASS**, real Flutter checks **NOT RUN**. Full raw transcripts and exact commands are in `docs/packet0-verification-2026-11-03-independent-recheck-full.txt`; concise outcome and unchanged migration checksums are in `docs/packet0-verification-2026-11-03-independent-recheck-summary.txt`.

**Acceptance gap and cleanup map:** Node v22.16.0/npm v10.9.2 on host versus pinned 24.22.0 and npm 11; genuine root/backend/web `package-lock.json` and `pubspec.lock` absent; Flutter/psql/Docker absent. Explicitly NearPill-owned Supabase staging target with TLS, non-owner/non-`BYPASSRLS` app role, separate authorized migrator/restore role and real app-role RLS/100-way stock/concurrency/reconciliation/restore tests unavailable. **NP-031–NP-042 and R04 remain open or unverified.** Preserve `backend/src/infrastructure/postgres`, seven reviewed migrations, Hono backend auth/session/RBAC, React and Flutter; retain inactive historical MySQL adapter until parity and rollback are accepted. No runtime/database/financial change, no Supabase Auth/Data API replacement and no legacy removal. **Packet 0 ACTIVE / BLOCKED; Packet 1 NOT STARTED.**

---

## 2026-11-03 — Optional and indirect CommonJS loader source-gate regression (Packet 0 only)

**Canonical baseline:** Latest user-supplied `NearPill_Packet0_2026-11-03_Escaped_ESM_Specifier_Source_Gate.zip` (SHA-256 `b2b29904fd7805b2b2d77de239250d1dd1e2b3e0d5e0b40fd7712a628e9ceccb`), valid ZIP CRC and 1,151/1,151 archived regular files identical to the existing single source workspace. Git HEAD and live deployment cannot be inferred from this archive.

**Red-first finding and scoped correction:** The existing Packet 0 `assertReviewedRuntimeLoaders` runtime source graph guard rejected `require(...)` but missed valid JavaScript optional/indirect function invocations such as `require?.("mysql2/promise")`, `require.call(null, ...)`, `require.apply(null, ...)`, and `createRequire?.(...)`. The new negative regression failed (10 pass/1 expected failure) before a narrowly scoped update to the **existing test-only source verifier**; afterwards all 11 verifier tests passed. No new resolver or second backend was created. The guard now conservatively rejects these CommonJS-compatible call forms; it remains a textual source characterization, **not** a complete JS/TS parser, dependency integrity proof, or live Node/Postgres security acceptance.

**Preservation/acceptance boundary:** Hono backend-owned identity, Drizzle, its seven reviewed PostgreSQL/RLS migrations, order/inventory/payment behavior, React, Flutter and the Supabase PostgreSQL provider decision remain unchanged. Source-only tests cannot close NP-031 (`users` RLS), R04 (persisted OTC eligibility), tenant negative isolation, 100-way inventory contention, migration replay or restore. Node 24/npm 11, authentic lockfiles, Flutter SDK, and an explicitly authorized NearPill Supabase staging database/least-privilege app role remain required. Packet 0 acceptance is BLOCKED; Packet 1 not started.

---

## 2026-11-03 — Escaped module-literal source-graph regression (Packet 0 only)

**Baseline:** Newest user-supplied `NearPill_Packet0_2026-11-03_Static_ESM_Import_Graph_Continuation.zip`, SHA-256 `50b47384fb9316548e5974fd36c42ac6d601380de938b5d78b8f1928a43c628a`, verified ZIP CRC and 1,149/1,149 working-tree byte parity. No Git HEAD, live deployment, or authorized Supabase staging is established.

**Red-first characterization:** The current Packet 0 Hono source graph extracts the source text of static ESM specifiers without interpreting JavaScript StringLiteral escapes. In valid ECMAScript, an import such as `import 'mysql\u0032/promise'` can resolve to a different module name than the raw text. A new adversarial test proved that escaped MySQL, scoped Supabase, and legacy relative imports were not consistently rejected (9 pass/1 expected fail). The *existing Packet 0 test-only verifier* now rejects any backslash in a discovered specifier before package classification or path traversal. Normal reviewed unescaped imports still work (10/10 test passes). This deliberately conservative textual gate is not an AST parser, complete execution-graph attestation, or replacement for supported Node 24 and staging PostgreSQL acceptance.

**Preserved:** One existing Hono/backend-owned authentication/Drizzle/RLS/order/inventory/payment authority; React and Flutter clients; seven PostgreSQL migrations; approved Supabase-managed PostgreSQL provider target; no production SQL, runtime modules, secrets, or data edits. **Outstanding:** NP-031 `users` RLS bootstrap/negative tests, R04 persisted OTC eligibility, and all live app-role tenant/concurrency/reconciliation/restore gates remain OPEN or NOT RUN. Genuine lockfiles and Node 24/npm 11/Flutter SDK are missing; Packet 0 acceptance is BLOCKED and Packet 1 not started.

---

## 2026-11-03 — Static ESM import/re-export trivia source-graph coverage (Packet 0 only)

**Canonical input:** The most recently supplied 1,147-file
`NearPill_Packet0_2026-11-03_Comment_Trivia_Source_Gate.zip` (SHA-256
`5a87d68ac2cf0967cb3e9dd12f4213eb0b2fb0d9bfcbe07e042929b32667429c`),
verified with ZIP CRC and 1,147/1,147 matching existing workspace files.
No Git branch/HEAD, live deployment or owned Supabase staging project is attested.

**Red-first finding:** The existing `literalModuleSpecifiers` collector followed
ordinary static `from 'module'` and side-effect `import 'module'` declarations,
but silently omitted executable declarations containing comment trivia before
the quoted specifier, including `import { x } from /* comment */ 'module'`,
`export { x } from /* comment */ 'module'`, and
`import /* comment */ 'module'`. These are valid ECMAScript syntax. The
adversarial negative test failed 8 PASS / 1 FAIL before repair. Updated only
the **existing Packet 0 source graph test** to recognize legal comment/space
trivia for static module specifiers, including transitive re-exports. The
focused tests then passed 9/9. The graph still fails closed on previously
characterized computed imports and CommonJS bridges; no production module
loader or authority was changed. This regular-expression characterization
is **not** a complete JS/TS parser, transpiled-graph proof or live security
acceptance.

**Scope and boundaries:** The existing Packet 0 test, this baseline document,
its two hash-manifest entries and the master Implementation Ledger are the
only reviewed-source changes. Hono backend authentication, Drizzle, seven
PostgreSQL/RLS migrations, React, Flutter, order/inventory/payment and OTC
business logic remain unchanged; the Supabase-managed PostgreSQL selection is
preserved. NP-031 real `users` RLS/pre-auth safety and R04 persisted OTC
eligibility remain OPEN. Node 24/npm 11 and authentic npm/Flutter lockfiles,
Flutter SDK, explicitly authorized NearPill-only staging roles/connections,
real tenant isolation, concurrency, reconciliation and restore acceptance
remain NOT RUN/BLOCKED; do not advance to Packet 1.

---

## 2026-11-03 — Hono source-loader comment-trivia regression (Packet 0 only)

**Baseline:** This dated continuation uses the latest user-supplied 1,144-file
`NearPill_Packet0_2026-11-02_Full_Source_Acceptance_Recheck.zip` (SHA-256
`d439090ea169c7b31a02da20937649c439b45f5f77d766cbe7c156683acc3d03`),
not an older Express/MySQL baseline or a verified Git checkout.

**Before-state/repair:** The reachable Hono runtime source graph already rejects
computed imports and CommonJS loaders, but the textual detector matched only
whitespace before `(`. Valid JavaScript such as
`import/*comment*/('unreviewed.js')` or `require/*comment*/('mysql2')`
was not detected by that gate. A red-first adversarial test reproduced the
blind spot; the existing `assertReviewedRuntimeLoaders` check now also
recognizes JavaScript block/line-comment trivia between loader names and `(`
and rejects those unreviewed forms. Existing normal quoted-literal dynamic
imports remain allowed and tracked. This is source characterization only:
comments, strings, transpilation and runtime dynamic evaluation are **not**
completely analyzed by this regex-based test, and this does not replace
actual Node 24 execution, dependency attestation, or app-role PostgreSQL RLS.

**Scope:** Only the existing Packet 0 test/graph-verifier file, this baseline
record, the corresponding two SHA-256 source-manifest entries and the master
Implementation Ledger changed. The single Hono/Drizzle backend, backend auth,
seven canonical PostgreSQL migrations, React, Flutter, stock, payment and
catalog behavior are unchanged. NP-031 `users` RLS and R04 persisted OTC
eligibility remain **open**, as do supported-toolchain/lockfile and approved
NearPill-owned Supabase staging gates. Do not advance to Packet 1.

---

## 2026-11-02 — Hono runtime loader-boundary characterization (Packet 0 continuation)

**Canonical input:** The latest supplied `NearPill_Packet0_2026-11-02_Nonrelative_ESM_Source_Gate.zip` is unchanged against this workspace before editing: 1,130/1,130 regular files match by SHA-256; ZIP CRC passed. This is an archive-based baseline, not an independently verified Git HEAD or a live Supabase connection.

**Source-only finding:** The existing transitive Hono import graph counted static and quoted dynamic ESM specifiers but did not detect computed `import()` or CommonJS `require()` / `createRequire()` loader calls. A computed loader could therefore introduce unreviewed runtime code without being traversed. The existing Packet 0 test now fails closed on these loader forms in the reachable Hono source graph while preserving already-characterized literal ESM imports. The red/green adversarial regression is local and does **not** claim JavaScript-parser completeness, integrity of installed packages, Node 24 build output, browser/mobile parity, or live Supabase role/RLS data correctness. Runtime modules and seven existing PostgreSQL migrations remain untouched.

**Acceptance remains blocked:** Supported Node 24/npm 11, authentic npm/Flutter locks, Flutter SDK, an owner-approved NearPill Supabase staging project, application-role users RLS (**NP-031**), persistent OTC eligibility (**R04**), real concurrency/reconciliation and restore gates are still required. No legacy or parallel implementation was added or removed.

---

## 2026-11-02 — Canonical Hono import-graph baseline (Packet 0 continuation)

**Source:** Latest supplied `NearPill_Packet0_2026-11-02_R04_Documentation_Parity.zip` (SHA-256 `740c56941fbdb6458ce3cbad9e...`; full digest in execution evidence), verified against the existing single workspace with ZIP CRC and byte parity before edits. No Git HEAD or live NearPill Supabase project is verified. Earlier snapshots below remain historical, not the active checkout.

The prior Packet 0 inventory checked only the bootstrap's **direct** imports for Express/MySQL. `backend/test/packet0-current-source-inventory.test.mjs` now also traverses string-literal static imports, re-exports, side-effect imports and literal dynamic imports reachable from the existing `backend/src/bootstrap/server.ts`. It checks that the transitive Hono graph does not import the retained legacy `backend/src/infrastructure/mysql/` adapters, Express/MySQL packages or parallel Supabase client/auth authority. It also exercises synthetic negative edges. This is a **source characterization**, not a claim about computed imports, build output, live deployment, database connectivity, or dependency graph equivalence under Node 24. The legacy source is retained until accepted parity/rollback evidence.

**Status:** Packet 0 remains **ACTIVE / ACCEPTANCE BLOCKED**. Supabase-managed PostgreSQL is the approved provider, preserving backend authentication, Drizzle and RLS. `users` RLS **NP-031**, persisted OTC classification **R04**, genuine dependency locks, supported Node/npm/Flutter, real app-role tenant tests, high-contention stock, financial reconciliation and restore remain blocked or unverified. See the current dated Implementation Ledger and Packet 0 evidence; Packet 1 not started.

---

## 2026-10-31 — Attached real-world audit revalidation (Packet 0 only)

Re-inspected the user-attached 17 October real-world audit against the newest 1,108-file October 31 source handoff. The historical recommendation to retain Express/MySQL is superseded by the master plan's approved Hono/Drizzle/**Supabase PostgreSQL** target; Chapter I business scope and R01–R15 remain reference requirements, not proof of running services. Updated `docs/real-world-roadmap-reconciliation-2026-10-29.md` with current source/roadmap fingerprints, unresolved R04 OTC eligibility, NP-031 private `users` RLS, unverified Android 8, one-day/three-day TTL conflict, live payment and legal gates; added a source-only traceability regression to the existing Packet 0 real-world roadmap contract suite. No source runtime, Drizzle schema, SQL migrations, frontend or mobile behavior was changed, and no unapproved clinical/payment choice was made.

**Gate status:** Node 22/npm 10 remain unsupported; original npm/Flutter locks, Flutter SDK, authorized NearPill-owned Supabase staging with least-privilege roles and all real DB/data/restore tests remain absent/NOT RUN. Packet 0 acceptance BLOCKED; Packet 1 NOT STARTED. The dated Implementation Ledger and attached execution transcript contain command evidence.

---

## 2026-10-31 — Independent latest handoff recheck (current source, no behavior change)

**Canonical input:** Most recent supplied archive `NearPill_Packet0_2026-10-31_YAML_Escaped_Postgres_URL_Security_Continuation.zip`, SHA-256 `5c3d11c42bdd06b8ed2e3b68ebd6be11461ebc7ffb77771241df8f915c0250e6`; 1,107 regular files; ZIP CRC and 1,107/1,107 source-tree parity **PASS**. Archive source, not a live Git checkout: branch/HEAD, deployment and NearPill-owned Supabase project **not verified**. Earlier dated inputs below remain historical. No older Express/MySQL repository was substituted.

**Observed structure:** 52 backend source files (`backend/src`: 12 application, 1 bootstrap, 1 config, 9 domain, 4 HTTP, 17 infrastructure, 8 ports); 67 backend `*.test.*` modules; 11 `web/src` files; 41 Flutter `lib/**/*.dart` files; 7 canonical `backend/migrations/postgres/0001`–`0007` SQL migrations (all byte-identical to incoming artifact). `backend/src/bootstrap/server.ts` assembles the existing Hono HTTP app, backend-owned authentication/application services, and PostgreSQL repository adapters; web and Flutter remain the same application roots. `backend/src/infrastructure/mysql/` remains historical, not silently treated as the current runtime provider. **Do not remove it without an accepted rollback/parity decision.**

**Actual execution (unsupported host Node 22.16.0/npm 10.9.2):** `bash scripts/verify-packet0.sh` **exit 2 BLOCKED** with 823/823 characterized tests PASS (zero skipped/failed/cancelled/todo); supplemental Node subset 122 pass / 1 skip (**PARTIAL**, not acceptance). `bash scripts/verify-mobile.sh` **exit 2 BLOCKED**, 6/6 mobile source contracts PASS but Flutter analyzer/widget/integration/build **NOT RUN**. Pre/post reviewed-source manifest 327/327 PASS; heuristic secret scan PASS; syntax checks PASS (163 JS, 11 JSON, 8 shell). This is an independent confirmation of the incoming characterization suite, **not** proof of live database safety, release readiness or a completed Packet 0.

**Dependency/cleanup map (no code changes):** First restore source-authentic npm lockfiles (root, backend, web), `pubspec.lock`, supported Node >=24.7 <25/npm 11 and Flutter 3.44.4/Dart 3.12.2. Then verify the reviewed migration lineage and app-role/owner/migrator grants against an explicitly authorized NearPill-only Supabase staging instance. Prioritize **NP-031 `users` forced RLS and its pre-auth/refresh/customer/admin contract**, real user/pharmacy negative tests, transaction-local actor isolation, 100-way stock contention, payment/order reconciliation and backup/restore. Preserve Hono/Drizzle/backend auth; no Supabase Auth/Data API authority or second database. All these live/security/build gates remain **NOT RUN/BLOCKED**. No migrations, external database, secret or production order/payment operation was touched. Packet 1 remains blocked.

**Evidence:** `docs/packet0-verification-2026-10-31-independent-acceptance-recheck.txt`. **Next safe packet: Packet 0 acceptance continuation**, not Packet 1.

---

## 2026-10-31 canonical source baseline — Packet 0 evidence (current)

**Source choice:** The most recent supplied complete handoff is `NearPill_Packet0_2026-10-31_Corrected_Baseline_Continuation.zip` (input SHA-256 `50afdfecd4a72cdc4abd2b776f95a0e10e56aee196114a5298a76b6a30887bfe`). All 1,099 regular ZIP members matched the extracted single working source byte-for-byte before this continuation. No `.git` branch/HEAD or deployed Supabase revision is asserted. This paragraph supersedes older dated archive inventory figures below, which are historical snapshots.

**Source inventory:** The current canonical tree contains **52 backend source JS/TS files**, **61 unique Hono route contracts**, **8 React TSX and 2 web TS files**, **41 Flutter Dart files**, 4 Dart test files, and **seven unchanged canonical PostgreSQL migrations** (`0001`–`0007`). Hono's bootstrap uses the existing PostgreSQL repository adapters and server-owned authentication. The backend's Drizzle schema, migration history, transaction-local actor/RLS context, existing React portal and single Flutter app remain authoritative; Supabase PostgreSQL is the approved hosting provider, *not* a second authentication/DB/client authority. Presence of code does not establish real database acceptance.

**In-place cleanup map and sequencing:** Preserve `backend/src/infrastructure/postgres/*` and `backend/migrations/postgres/*`; keep existing `backend/src/application/*`, `backend/src/http/*`, `web/src/*` and `lib/features/*`. `backend/src/infrastructure/mysql/` is historical migration/rollback material, not imported by the Hono bootstrap. **Do not remove legacy paths before verified parity** and rollback evidence. Avoid creating alternate backend, React or Flutter roots. Review any legacy MySQL deletion only after accepted Supabase role/grant/RLS, migration, data-integrity and rollback gates.

**Acceptance boundary:** Packet 0 remains **ACTIVE / ACCEPTANCE BLOCKED**. This diagnostic environment has Node v22.16.0/npm 10.9.2 instead of supported Node >=24.7.0 <25/npm 11, with no source-authentic root/backend/web `package-lock.json`, no `pubspec.lock`, no pinned Flutter SDK, and no explicitly approved NearPill-owned staging Supabase credentials. Real non-owner, non-`BYPASSRLS` application-role RLS allow/deny tests, migration replay, 100-way stock contention, order/payment reconciliation, and backup/restore are NOT RUN. Do not substitute synthetic contract tests for these gates and do not remove security requirements.

---

## 2026-10-29 Packet 0: identity security repository connection cleanup (current)

**Current source:** latest available `NearPill_Real_World_Roadmap_Packet0_2026-10-29.zip` (SHA-256 `e97652737cf7ab7edb69b8527a9164b080564700bd5acd9de6a01c32ac96a96c`), not a live Git checkout. Packet 0 remains **ACTIVE / ACCEPTANCE BLOCKED**. The current security repository transaction wrapper released a client for reuse after failed `BEGIN`, failed `ROLLBACK` or uncertain `COMMIT`; recording-client regressions reproduced all three cases. The in-place correction discards these potentially unsafe connections and preserves reusable connections after successful commit or confirmed rollback. This does not prove actual Supabase RLS/pool behavior. No migrations, auth policy, React, Flutter or order/payment business rules were changed. Real staging role/grants/RLS, concurrency and restore gates remain NOT RUN, as do supported Node 24 and Flutter acceptance. See Section 28 ledger and `docs/packet0-verification-2026-10-29-identity-pool-cleanup.txt`.

## 2026-10-29 Packet 0: real-world audit/roadmap reconciliation (current)

**Canonical source input:** `NearPill_Packet0_Acceptance_Gate_Recheck_2026-10-28.zip` SHA-256 `90e1ced86eb6f738eb3e0f58995f94d3b37381470ab98a71b3aa88c1b43fef33`; 1,057 distinct files, ZIP CRC verified. No Git HEAD or authorized NearPill Supabase staging is established. Older 17 October Express/MySQL audit is *historical* and does not supersede the approved Hono/Drizzle/Supabase architecture.

**Packet 0 scope:** Added `docs/real-world-roadmap-reconciliation-2026-10-29.md`, mapping 17 October R01–R15 to source evidence, keeping human/legal/product decisions separate from code status. Added four source-level characterization tests `backend/test/packet0-real-world-roadmap-contract.test.mjs` covering public published OTC queries, verified pharmacy, one-store checkout, server-scoped portal and partner route boundaries; not live acceptance tests. The existing Hono/Drizzle/RLS/auth/payment/inventory application implementation and all seven PostgreSQL migrations are unchanged. Retain existing NP-031–NP-041 authorization findings OPEN; no live regulatory or PSP claim. Gate results and rollback are in the Implementation Ledger 2026-10-29 entry.

**Next safe work:** Complete Packet 0 with supported Node 24/npm 11, authentic npm/Flutter locks and authorized NearPill Supabase staging app-role RLS, 100-way contention, reconciliation and restore. **Packet 0 ACTIVE / ACCEPTANCE BLOCKED; Packet 1 not started.**

## 2026-10-28 Packet 0: latest 1,056-file source acceptance checkpoint (current)

**Baseline:** `NearPill_Packet0_Independent_Recheck_2026-10-28.zip` (SHA-256 `d456f7833062db4f6b93ba202b204601a54f2f6ddada7e6dc645f9e43c316a19`), 1056 unique regular files, CRC and 1056/1056 byte parity PASS. This archive remains the sole canonical source candidate; no Git HEAD or authorized NearPill Supabase project was verified.

**Available evidence:** 64/64 targeted PostgreSQL/transaction contracts PASS; Packet 0 735/735 source-level tests PASS plus 122 PASS/1 SKIP supplemental; mobile architecture 6/6 PASS. An independent post-update Packet 0 verifier rerun exited 2 BLOCKED (all runnable source tests passed). Mobile verification independently exited 2 BLOCKED. The reviewed 313-file hash manifest, syntax and heuristic secret scans PASS. Current Node 22/npm 10, missing genuine npm/Flutter locks, Flutter SDK, and an owner-approved app-role Supabase staging/restore environment prevent acceptance. NP-031–NP-041 source security risks remain OPEN; real RLS/concurrency/reconciliation/restore NOT RUN. No application changes, migrations or database cutover. See `docs/packet0-verification-2026-10-28-1056-checkpoint.txt` and Section 28. **Packet 0 ACTIVE / ACCEPTANCE BLOCKED; Packet 1 NOT STARTED.**

## 2026-10-28 Packet 0: independent latest 1,054-file acceptance recheck (current run)

**Current source:** `NearPill_Packet0_Trailing_Insert_Contract_2026-10-28.zip` (SHA-256 `63eb2227d49379b50c472094e009c0cd64f7c738086f03055b5cd937bfad1882`), 1,054 distinct regular ZIP files, CRC PASS and 1,054/1,054 extracted byte parity PASS. Existing Hono, backend auth, Drizzle/PostgreSQL/RLS, React, Flutter, inventory/order/payment remain the one canonical implementation; no new application code edit was justified by current executable checks. The previous SQL-trailing-trivia fix remains covered by 64/64 targeted contracts.

**Acceptance results:** `bash scripts/verify-packet0.sh` exit **2 BLOCKED** despite 735/735 runnable characterization PASS, 122 supplemental Node PASS/1 SKIP, 313/313 reviewed hashes, JS/JSON/shell syntax and heuristic secret scans PASS. `bash scripts/verify-mobile.sh` exit **2 BLOCKED**, 6/6 architecture contracts PASS, real Flutter work NOT RUN. Unsupported Node 22/npm 10, missing authentic dependency locks/Flutter SDK and owner-approved NearPill-only Supabase staging (non-owner non-BYPASSRLS app role/direct migrator/restore) prevent acceptance. No live RLS, concurrency, reconciliation or restore tests were run. Details in `docs/packet0-verification-2026-10-28-1054-evidence.txt` and Section 28. Packet 0 remains ACTIVE / ACCEPTANCE BLOCKED; Packet 1 not started.

## 2026-10-28 Packet 0: trailing-SQL-trivia INSERT result contract (current run)

**Latest verified source:** `NearPill_Packet0_Result_Row_Integrity_2026-10-28.zip`, 1,053 distinct regular entries; CRC integrity verified. No Git revision or owner-authorized NearPill Supabase staging project is established. This is the sole current in-place codebase; Packet 0 remains ACTIVE / ACCEPTANCE BLOCKED, Packet 1 remains BLOCKED.

**Reproduced defect:** Two red-first recording-pool tests show that implicit `INSERT ... RETURNING id` can be appended *after* a trailing `--` comment, where it becomes a comment, or after a semicolon and block comment, where it becomes invalid second-statement syntax. The existing `compat-pool.js` now inserts that clause ahead of trailing SQL trivia, preserving the already-valid trailing-block-comment formatting and explicit RETURNING behavior. Three characterization tests added; canonical authentication, Hono, Drizzle/RLS, all seven SQL migrations, React/Flutter and business logic are untouched. Recording-pool SQL checks cannot establish live Supabase behavior.

**Remaining acceptance:** Supported Node 24/npm 11 and genuine lockfiles, Flutter/Dart, owner-approved NearPill Supabase staging with non-owner/non-BYPASSRLS app role and direct migrator, effective grants/RLS tests, real concurrency, data reconciliation and restore still required; no gate bypass or live SQL. **Next safe work: Packet 0 acceptance continuation only.**

## 2026-10-28 Packet 0: safe PostgreSQL result-row property mapping (current run)

**Current supplied source:** `NearPill_Packet0_SQL_Result_Shape_2026-10-28.zip`, 1,052 unique regular files; ZIP CRC and 1,052/1,052 extracted byte parity verified. The archive provides no verifiable Git HEAD or owner-approved NearPill Supabase staging connection. This source remains the sole in-place codebase.

**First incomplete dependency-ready packet:** Packet 0 — ACTIVE / ACCEPTANCE BLOCKED; Packet 1 remains BLOCKED. Two red-first recording-pool regression cases demonstrated that PostgreSQL result rows containing an own `__proto__` column could lose the value or have their prototype set to a database-returned object. A one-function correction in the existing `backend/src/infrastructure/postgres/compat-pool.js` now defines mapped fields as own data properties, preserving ordinary row shape and preventing that per-row prototype mutation. Existing characterization, Hono/session auth, Drizzle, RLS, seven SQL migrations, Supabase provider selection, React/Flutter and order/payment/inventory logic remain intact. A recording client does not prove live RLS or SQL behavior.

**Current verification:** targeted transaction, migration and pool tests **61/61 PASS** under unsupported Node 22; broader Packet 0 gate and supported-runtime/live staging requirements are separately recorded in the Implementation Ledger/evidence file. Node 24/npm 11, genuine lockfiles, Flutter/Dart, and owner-authorized Supabase application-role RLS, migration, 100-way contention, financial reconciliation and restore remain required. No production SQL or secrets were changed. **Next safe work: Packet 0 acceptance continuation**, not Packet 1.

## 2026-10-28 Packet 0: leading-comment SQL result shape and literal-safe alias characterization

**Current supplied archive:** `NearPill_Packet0_Async_Facade_Acceptance_2026-10-28.zip` (SHA-256 `ac98d48b5c4b74299c1fa3e75f3a97753639b49707117400b2c7146824435cbe`), 1,051 distinct regular files, CRC verified. No Git HEAD or live Supabase target can be inferred from the archive.

**Packet status:** Packet 0 ACTIVE / ACCEPTANCE BLOCKED. Three recording-pool regressions reproduced on the previous adapter (24 PASS / 3 FAIL): a leading SQL comment made SELECT return a mutation envelope, a leading INSERT comment suppressed implicit `RETURNING id`, and an `AS` token in a string/comment renamed a real result column. The existing SQL compatibility adapter now obtains statement type and unquoted aliases from the same SQL-code spans already used by placeholder rewriting. All original Hono auth/Drizzle/RLS, seven migration files, business rules, web/Flutter and provider choice are preserved. The local recording client is not an actual Supabase RLS or migration test.

**Acceptance dependencies:** supported Node 24/npm 11 with original root/backend/web npm locks, Flutter/Dart and its original pubspec lock, and the explicitly owner-approved NearPill Supabase project with least-privilege app role/direct migrator, actual tenant isolation, 100-way contention, reconciliation and restore. These are NOT RUN/BLOCKED, not PASS. Packet 1 remains blocked.

## 2026-10-28 Packet 0: asynchronous pooled-facade lifecycle characterization

**Source baseline:** Latest chat-supplied `NearPill_Packet0_SQL_Lexer_Acceptance_2026-10-28.zip` (`e824fbb804813919ce2ff0a5907f8e124657e394a1a0178454ca4917d6419984` SHA-256), 1,050 unique regular files, verified CRC and byte parity against the sole existing worktree before edits. No Git HEAD/branch or authorized NearPill Supabase project verified.

**Active packet:** Packet 0, ACTIVE / ACCEPTANCE BLOCKED. Prior SQL-lexer and facade cleanup changes preserved. Three red-first regression cases exposed a queued-query/early-release race: a caller could release a borrowed physical client while its SELECT or BEGIN was still unresolved, or concurrently commit/query/rollback on the same transaction facade. That could allow tenant-bound transaction state to overlap a subsequent borrower. Fixed only `backend/src/infrastructure/postgres/compat-pool.js` with a synchronous per-facade in-flight guard, applied to query/BEGIN/COMMIT/ROLLBACK/release. A rejected duplicate BEGIN still permits reuse after a clean rollback. Added three focused regression cases and a stronger reuse assertion to the existing Packet 0 transaction characterization tests.

**Preserved:** Existing Hono auth/session/RBAC, Drizzle, reviewed seven PostgreSQL/RLS migrations, Supabase-hosting decision, inventory/order/payment rules, React web and Flutter app. No live connection, SQL migration, role grant, credential, deployment or unverified legacy deletion changed. Recording-client tests are diagnostic, **not** proof of actual PostgreSQL RLS, concurrency or staging connection isolation.

**Unresolved acceptance:** Current runtime Node 22/npm 10 is unsupported (declared Node 24/npm 11); no verified npm/Flutter lockfiles or Flutter toolchain; no owner-approved NearPill-only Supabase staging direct TLS migrator and non-owner, non-BYPASSRLS app role. Live cross-tenant RLS negatives, migration replay, real 100-way stock test, payment centavo reconciliation and backup/restore remain NOT RUN/BLOCKED. Packet 1 not started.

## 2026-10-28 Packet 0: pooled connection facade lifecycle characterization

**Canonical input:** `NearPill_Packet0_Pool_Cleanup_Acceptance_2026-10-28.zip`, SHA-256 `32e4c39aeaac126687edae2d1ed6fe63e5382d31f532bf413e906e930990b0b3`. ZIP CRC and all **1,048/1,048** distinct regular members matched the current worktree before changes; no Git branch/HEAD or live NearPill Supabase staging credentials verified.

**Dependency-safe active packet:** Packet 0 remains ACTIVE / ACCEPTANCE BLOCKED. Reproduced four existing compatibility-pool contract failures (pre-fix 12 PASS / 4 FAIL): a released facade could issue SQL/transaction commands on a physical client after return to pool; double release called the physical release again; and a repeated BEGIN could reset transaction-local actor context. The single in-place PostgreSQL compatibility adapter now fails closed on use-after-release, rejects double release and nested BEGIN, preserving clean committed connection reuse and existing rollback/discard safety. Added source-level regression tests only; no live database proof is claimed.

**Targeted evidence:** `backend/test/packet0-transaction-characterization.test.mjs`, `postgres-migration-contract.test.mjs`, `packet0-inventory-pool-isolation.test.mjs`, `packet0-rls-pool-cleanup.test.mjs` -> 48 PASS / 0 FAIL / 0 SKIP after fix under **unsupported diagnostic Node 22**. Recording pool tests are not real Supabase RLS or physical connection-pool tests.

**Still blocked:** supported Node >=24.7 <25/npm 11, authentic root/backend/web package locks and Flutter lock, Flutter/Dart SDK, explicitly approved NearPill Supabase direct TLS staging, separate migrator/nonowner non-BYPASSRLS app role, effective policy negative tests, migration replay, 100-way stock contention, centavo/payment reconciliation and backup/restore drill. The current Drizzle history, authentication, Hono, React/Flutter, tenant RLS, money and inventory/order business rules remain unchanged. No production SQL/secret modifications, release bypasses or parallel systems.

## 2026-10-28 Packet 0: PostgreSQL pool-cleanup failure-path characterization and safe repair

**Canonical source before edits:** most recently uploaded `NearPill_Packet0_1046_Latest_Acceptance_2026-10-28.zip`, SHA-256 `2350ac4addc1baad452aba1410afc9710437e79398c84d0bbf05f3325c83a008`, 1,047 unique regular members; CRC and untouched-member parity checked independently. No Git HEAD or live Supabase project identity is provided.

**First dependency-ready incomplete packet:** Packet 0 — ACTIVE / ACCEPTANCE BLOCKED. Packet 1 remains dependency-blocked. Source-level checkout contains one Hono/backend/React/Flutter project and the existing seven reviewed PostgreSQL/Drizzle migrations. Supabase PostgreSQL remains the selected hosting provider; no deployment switch was attempted.

**Observed failure and corrective scope:** The existing PostgreSQL compatibility pool (`backend/src/infrastructure/postgres/compat-pool.js`) returned a connection to the pool without destruction after rollback failure, after release of an uncommitted explicit transaction, and after actor-context initialization or explicit rollback failed. Characterization first reproduced four failing cases against the unchanged adapter (9 tests: 5 pass, 4 fail). The in-place safety fix tracks open transaction/actor context and uncertain completion state, destroys unsafe clients (`release(true)`), and preserves normal reuse of clean committed connections. It does not change SQL/RLS policies, authenticated actor derivation, orders, inventory, payments, schema, or provider. This is **source-level mitigation only**, not proof of real PostgreSQL connection isolation.

**Tests / evidence:**
- `node --test backend/test/packet0-transaction-characterization.test.mjs` before the adapter change -> EXPECTED RED, 5 PASS / 4 FAIL (regression confirmed).
- `node --test backend/test/packet0-transaction-characterization.test.mjs backend/test/postgres-migration-contract.test.mjs backend/test/packet0-inventory-pool-isolation.test.mjs backend/test/packet0-rls-pool-cleanup.test.mjs` after the change -> 44 PASS / 0 FAIL / 0 SKIP.
- Earlier uploaded archive carries 708/708 Packet 0 test evidence but that historical transcript is **not claimed as a fresh complete run** after this edit. A full fresh run was started but interrupted before completion; its partial output is NOT an acceptance pass.
- Real app-role RLS, transaction pooling/connection destruction behavior on the approved Supabase target, 100-way contention, migration replay, reconciliation, backup/restore, Node 24/npm 11 clean install, Flutter analyzer/build/test -> NOT RUN / BLOCKED.

**Next safe packet:** Packet 0 acceptance continuation under the actual supported toolchains, authentic lockfiles and an owner-approved NearPill-only Supabase staging project. Do not advance to Packet 1 or Packet 11.

# NearPill Packet 0 — Current-source characterization and acceptance ledger

## 2026-10-28 Packet 0 latest-source verification — 1,046-file source

**Verified current input:** `NearPill_Packet0_1045_Verified_Acceptance_2026-10-28.zip` (SHA-256 `2049157ff63ea0bd0e4830709f9d0b42e2138c70f3c6fce29d78018f45ebcc86`), 1,046 unique regular source/evidence files, ZIP CRC and independent archive-to-working-tree byte parity PASS. No verified Git branch/HEAD or authorized live NearPill Supabase project identity. Earlier checkpoints below are historical and do not supersede this baseline.

**Fresh local evidence:** `bash scripts/verify-packet0.sh` exited **2 BLOCKED**; 708/708 Packet 0 tests PASS, zero skipped; supplemental Node 122 PASS / 1 SKIP (PARTIAL). `bash scripts/verify-mobile.sh` exited **2 BLOCKED**; 6/6 architecture contracts PASS, zero skipped. Reviewed source SHA-256 313/313, source syntax and pre/post heuristic secret checks PASS. Full transcripts and seven unchanged migration hashes: `docs/packet0-verification-2026-10-28-source-1046-evidence.txt`. No newly failing runnable application assertion.

**Remaining gates:** Node >=24.7 <25 and npm 11, genuine npm root/backend/web locks and Flutter application lockfile, Flutter 3.44.4/Dart 3.12.2, approved NearPill staging database with non-owner/non-`BYPASSRLS` app-role and separately privileged direct TLS migration/restore credentials. NP-031–NP-041 OPEN source-level; NP-042 SOURCE-MITIGATED/live-unverified. Actual RLS/grants, authorized order/inventory mutations, transaction-local actor isolation, migration replay, 100-way stock contention, money reconciliation and backup/restore NOT RUN. No live SQL/database change or bypass. **Packet 0 ACTIVE / ACCEPTANCE BLOCKED; Packet 1 NOT STARTED.**

### Current effective-RLS / authorization acceptance inventory (source-level only)

This section reconciles **all** database authorization concerns already characterized in this repository. Recent Packet 0 handoffs mentioned only NP-031–NP-035; that abbreviated list must **not** be read as closure of NP-036–NP-041. The status below is from checked-in SQL/test source, **not** the effective grants/policies of a connected Supabase project. `0004_identity_security.sql` changes the effective policy history, so use the seven migrations in their ordered sequence rather than inspecting `0002_rls.sql` in isolation.

| Finding | Existing risk / acceptance question | Existing source contract or probe | Current status |
|---|---|---|---|
| NP-031 | `users` FORCE RLS, own/foreign user isolation and self-escalation | `backend/test/packet0-order-rls-write-negatives.test.mjs`; `packet0-db-live-connection-preflight.test.mjs` | OPEN, live NOT RUN |
| NP-032 | Owned order authoritative `total_centavos` UPDATE | `backend/test/packet0-order-rls-write-negatives.test.mjs` | OPEN, live NOT RUN |
| NP-033 | Owned order direct status transition | `backend/test/packet0-order-rls-write-negatives.test.mjs` | OPEN, live NOT RUN |
| NP-034 | Owned pharmacy-order status UPDATE | `backend/test/packet0-order-rls-write-negatives.test.mjs` | OPEN, live NOT RUN |
| NP-035 | Order-item insert / immutable price snapshot update or deletion | `backend/test/packet0-order-rls-write-negatives.test.mjs` | OPEN, live NOT RUN |
| NP-036 | Pharmacy member UPDATE of admin-controlled inventory `price_centavos` | `backend/test/packet0-partner-inventory-price-negative.test.mjs` | OPEN, live NOT RUN |
| NP-037 | Pharmacy member DELETE of published inventory | `backend/test/packet0-partner-cross-pharmacy-inventory.test.mjs` | OPEN, live NOT RUN |
| NP-038 | Pharmacy member INSERT of inventory with arbitrary price / foreign tenant | `backend/test/packet0-partner-inventory-insert-negative.test.mjs` | OPEN, live NOT RUN |
| NP-039 | Pharmacy member direct `reserved_quantity` UPDATE | `backend/test/packet0-partner-reserved-quantity-negative.test.mjs` | OPEN, live NOT RUN |
| NP-040 | Pharmacy member direct active-reservation DELETE | `backend/test/packet0-partner-reservation-delete-negative.test.mjs` | OPEN, live NOT RUN |
| NP-041 | Customer direct DELETE of owned active reservation | `backend/test/packet0-customer-reservation-delete-negative.test.mjs` | OPEN, live NOT RUN |
| NP-042 | Owned pharmacy-order child DELETE after ordered policy history | `backend/test/packet0-migration-source-inventory.test.mjs`; `packet0-order-rls-write-negatives.test.mjs` | SOURCE-MITIGATED (0004 removed former ALL/DELETE), live NOT RUN |

**Acceptance boundary:** All live negatives and authorized positive controls require an explicitly owner-approved NearPill Supabase PostgreSQL **non-owner/non-`BYPASSRLS`** application role with verified grants/policies and transaction-local actor context, and a separately authorized direct-TLS migrator/restore target. The current recording-pool tests and migration-source checks do not establish these results. Do not change, replay, or apply migrations to an unidentified or production project. Fix a source finding through the same migration lineage only after compatibility, data, rollback and genuine app-role staging tests. Supabase remains a provider decision, not Supabase Auth/Data API authority.

---


## 2026-10-28 independent Packet 0 acceptance checkpoint — 1,033-file source

**Latest canonical archive:** `NearPill_Packet0_1031_Acceptance_2026-10-28.zip` (SHA-256 `798fd31369dd01b6ceea411c55fd0e6e4e3e8da14dc9d39adc5b4c180916252b`), 1,033 unique regular files; ZIP CRC and byte-for-byte extracted parity PASS. No verified Git HEAD, Supabase project, or deployed database is inferred.

**Verification:** Packet 0 708/708 PASS, supplemental Node 122 PASS/1 SKIP PARTIAL; mobile architecture 6/6 PASS; reviewed first-party SHA-256 manifest 313/313 PASS; pre/post secret and syntax checks PASS. Both canonical and mobile verifiers return BLOCKED (exit 2) for unavailable supported toolchains/lockfiles, Flutter runtime and real staging acceptance. Combined transcript: `docs/packet0-verification-2026-10-28-current-1033.txt`.

**Remaining acceptance:** NP-031–NP-035 source-level database authorization concerns OPEN; application-role RLS/tenant/order negatives, canonical migration replay, transaction context, 100-way contention, financial reconciliation and restore NOT RUN. Hono/authentication, Drizzle/RLS, React/Flutter, business rules and seven migration SQL files remain unchanged. **Next safe work:** Packet 0 acceptance continuation; no Packet 1 activity.

---


## 2026-10-28 latest-source acceptance review — 1,031-file source archive

**Canonical source:** `NearPill_Packet0_1029_Verification_2026-10-28.zip` (SHA-256 `11c3d332a52dfc6bf8653099c7e6c9754cc931bcfdb3a0cd5454d0a08ff28ee0`); 1,031 unique regular entries, CRC PASS and 1,031/1,031 source byte parity PASS before edits. No verified Git revision, deployed NearPill instance or NearPill Supabase project identity.

**Packet 0 decision:** ACTIVE / ACCEPTANCE BLOCKED. `bash scripts/verify-packet0.sh` exit 2: 708/708 Packet 0 PASS, 0 skipped, supplemental Node 122 PASS/1 SKIP (PARTIAL), 313/313 reviewed source hashes, syntax and heuristic secret checks PASS. `bash scripts/verify-mobile.sh` exit 2: 6/6 architecture contracts PASS, Flutter checks NOT RUN. Evidence: `docs/packet0-verification-2026-10-28-source-1031-summary.txt` and `docs/packet0-verification-2026-10-28-source-1031-full.txt`.

**Unmet gates:** Node 24/npm 11, authentic npm/Flutter lockfiles, Flutter/Dart SDK and owner-approved NearPill Supabase PostgreSQL staging with actual non-owner/non-`BYPASSRLS` role, migrator/direct TLS connectivity and restore target. NP-031–NP-035 source-level authorization findings remain OPEN. Real app-role RLS negatives, migration replay, 100-way stock contention, financial reconciliation and backup/restore NOT RUN. Existing backend auth, Hono/Drizzle/RLS, React/Flutter and seven SQL migrations preserved. **Next safe work: Packet 0 acceptance continuation; Packet 1 blocked.**

---

## 2026-10-28 latest-source acceptance review — 1,029-file source archive

**Canonical input:** `NearPill_Packet0_1027_Acceptance_2026-10-28.zip` (SHA-256 `3817838ca7fe28bcd0d404a78f224b14feb11028e0f4a5da720ec705f3a90fd6`); 1,029 unique regular ZIP files, CRC PASS and 1,029/1,029 exact file-byte parity PASS. This archive is the latest supplied source, not a proven Git revision or live Supabase deployment. All previous headings are historical.

**Packet 0 decision:** ACTIVE / ACCEPTANCE BLOCKED. `bash scripts/verify-packet0.sh` exit **2**: **708/708** Packet 0 characterization PASS, zero skipped; additional Node **122 PASS/1 SKIP** (PARTIAL); reviewed source **313/313**, syntax and heuristic secret checks PASS. `bash scripts/verify-mobile.sh` exit **2**: **6/6** mobile architecture contracts PASS, Flutter analyzer/tests/build NOT RUN. Full commands and evidence: `docs/packet0-verification-2026-10-28-source-1029-summary.txt` and `docs/packet0-verification-2026-10-28-source-1029-full.txt`.

**Open dependencies:** Supported Node 24/npm 11, genuine npm and Flutter lockfiles, Flutter/Dart SDK, and owner-approved NearPill Supabase PostgreSQL staging app/migration roles. NP-031–NP-035 remain OPEN source-level concerns; actual non-owner app-role RLS tenant/user/order isolation, order mutation authorization, migration replay, 100-way stock contention, payment reconciliation and backup/restore NOT RUN. Existing seven SQL migrations and application/auth/business behavior preserved. **Next safe work: Packet 0 acceptance continuation, not Packet 1.**

---

## 2026-10-28 latest-source acceptance review — 1,027-file archive

**Current source:** `NearPill_Packet0_Current_Verified_2026-10-28.zip` (SHA-256 `9cfbda7eb7a1ec10c8f11fa40ccf66f4282392f89fda985750260cf363b567be`); 1,027 unique regular members, CRC PASS and 1,027/1,027 archive-to-source byte comparison PASS. No verified Git HEAD/branch or owner-approved NearPill Supabase deployment. Earlier archive headings below are historical.

**Packet 0:** ACTIVE / ACCEPTANCE BLOCKED. `bash scripts/verify-packet0.sh` exit 2: 708/708 Packet 0 tests PASS, zero skips; additional Node contracts 122 PASS/1 SKIP (PARTIAL); first-party manifest 313/313 and syntax/heuristic secret checks PASS. `bash scripts/verify-mobile.sh` exit 2: 6/6 mobile architecture contracts PASS; Flutter analyzer/test/build NOT RUN. Evidence: `docs/packet0-verification-2026-10-28-source-1027-summary.txt` and `docs/packet0-verification-2026-10-28-source-1027-full.txt`.

**Blocked prerequisites:** Node 24/npm 11, genuine root/backend/web npm lockfiles, Flutter `pubspec.lock` and SDK, authorized NearPill-owned Supabase staging with non-owner/non-`BYPASSRLS` app and direct migrator TLS connections. NP-031–NP-035 remain OPEN source-level concerns; real tenant/user RLS negatives, order mutation authorization, migration replay, 100-way stock contention, reconciliation and restore NOT RUN. All seven existing SQL migrations and Hono/auth/Drizzle/React/Flutter/business code preserved. **Next safe packet: Packet 0 acceptance continuation; Packet 1 blocked.**

---

## 2026-10-28 latest-source acceptance review — 1,021-file archive

**Canonical source:** `NearPill_Packet0_1019_Acceptance_Reconciliation_2026-10-28.zip` (SHA-256 `4f07ed5f6a5853ff77d99487ea1051dd4a6b8321b7887e65cd2754f5e033ec5b`), unique ZIP members/CRC and extracted-source byte parity **1,021/1,021 PASS**. Source archive has no Git HEAD/branch; NearPill-owned live Supabase project and deployment state remain unverified.

**Packet decision:** Packet 0 **ACTIVE / LOCAL TESTS PASS / ACCEPTANCE BLOCKED**. `bash scripts/verify-packet0.sh` -> exit 2 (708/708 Packet 0 PASS; other Node tests 122 PASS/1 SKIP PARTIAL); `bash scripts/verify-mobile.sh` -> exit 2 (6/6 mobile architecture PASS). Reviewed SHA-256 313/313, syntax and heuristic secret pre/post checks PASS. Evidence: `docs/packet0-verification-2026-10-28-source-1021-summary.txt` and `docs/packet0-verification-2026-10-28-source-1021-full.txt`.

**Unmet gates:** Supported Node 24/npm 11, genuine npm/Flutter lockfiles and Flutter/Dart SDK absent. An owner-approved NearPill Supabase staging project with non-owner/non-`BYPASSRLS` app role and separate direct TLS migration credentials is not verified. NP-031–NP-035 are **open source-level** authorization findings; real app-role RLS and tenant negatives, order mutation authorization, SQL migration replay, 100-way stock contention, reconciliation and restore **NOT RUN / BLOCKED**. Existing backend authentication, Hono/Drizzle/RLS, React/Flutter, business rules, and all seven SQL migrations remain unchanged. **Next safe work: Packet 0 acceptance continuation; Packet 1 not started.**

---

## 2026-10-28 latest-source acceptance review — 1,019-file archive

**Canonical source:** `NearPill_Packet0_1017_Acceptance_Evidence_2026-10-28.zip` (SHA-256 `2aa427159b3f3196d2537166d92d6287f2295e548af6cf01841206932dd4900e`), 1,019 unique regular ZIP members, CRC PASS, extracted-source 1,019/1,019 byte parity PASS. No Git revision or verified deployed Supabase endpoint can be inferred.

**Active packet:** Packet 0 remains ACTIVE / ACCEPTANCE BLOCKED. `bash scripts/verify-packet0.sh` exit 2 (708/708 characterization PASS, supplementary 122 PASS/1 SKIP PARTIAL); `bash scripts/verify-mobile.sh` exit 2 (6/6 architecture PASS). 313/313 reviewed first-party hashes, source syntax and heuristic secret pre/post checks PASS. See `docs/packet0-verification-2026-10-28-source-1019-summary.txt` and `docs/packet0-verification-2026-10-28-source-1019-full.txt`.

**Blocked gates:** Supported Node 24/npm 11, authentic npm and Flutter lockfiles and Flutter/Dart tooling unavailable. No approved NearPill-owned Supabase staging roles/direct migrator connection; NP-031–NP-035 RLS/order mutation tests, migration replay, concurrency, reconciliation and restore NOT RUN. Existing Hono/auth/Drizzle/RLS, React/Flutter and seven SQL migrations unchanged. **Next safe work: Packet 0 acceptance continuation; Packet 1 not started.**

---

## 2026-10-28 latest-source acceptance review — 1,013-file archive

**Canonical current source:** `NearPill_Packet0_1011_Acceptance_Handoff_2026-10-28.zip` (SHA-256 `bd7075121bb3c1598dbaff05c7ae82b33c483fa1597d464b2b5d6f81e93f76e4`); 1,013 distinct regular ZIP members, CRC and extracted-source byte parity **PASS**. Source ZIP has no Git revision and proves no deployed NearPill Supabase endpoint.

**Packet 0:** `bash scripts/verify-packet0.sh` **exit 2 BLOCKED**, 708/708 Packet 0 characterization PASS with zero skipped, separate unsupported-runtime Node subset 122 PASS/1 SKIP (PARTIAL). `bash scripts/verify-mobile.sh` **exit 2 BLOCKED**, mobile architecture 6/6 PASS. Source 313/313, JS/JSON/shell syntax 152/11/8, heuristic secrets PASS. See `docs/packet0-verification-2026-10-28-source-1013-summary.txt` and `docs/packet0-verification-2026-10-28-source-1013-full.txt`.

**Still required:** Real Node 24/npm 11 + authentic npm lockfiles, reviewed `pubspec.lock`, Flutter/Dart toolchain and owner-approved NearPill Supabase PostgreSQL staging with separate least-privilege/non-`BYPASSRLS` app and direct migrator roles; RLS/order authority NP-031–NP-035, transaction-local context, migration replay, 100-way contention, reconciliation and restore **NOT RUN**. No application or SQL code touched. **Next safe packet: Packet 0 acceptance continuation; Packet 1 blocked.**

---

## 2026-10-28 latest-source acceptance review — 1009-file archive

**Input:** `NearPill_Packet0_Current_1007_Acceptance_2026-10-28.zip` (SHA-256 `83f44418ab05ff58d0fa1c16fdf42e7afb271b7978f265d79faae94b59839c17`); ZIP CRC, unique members and 1009/1009 byte-for-byte source parity PASS. Archive source only: Git revision and live deployment NOT VERIFIED.

**Packet 0 acceptance:** `bash scripts/verify-packet0.sh` => exit 2 BLOCKED; 708/708 Packet 0 characterization PASS, other Node 122 PASS/1 SKIP (PARTIAL), 313/313 source hashes, 152 JS/11 JSON/8 shell syntax and pre/post heuristic secret scan PASS. `bash scripts/verify-mobile.sh` => exit 2 BLOCKED; 6/6 architecture contracts PASS, Flutter analyze/test/build NOT RUN. Full evidence: `docs/packet0-verification-2026-10-28-1009-summary.txt` and `docs/packet0-verification-2026-10-28-1009-full.txt`.

**Next safe work:** Still Packet 0 acceptance continuation. Unsupported Node 22/npm 10, authentic npm/Flutter lockfiles and Flutter 3.44.4/Dart 3.12.2 absent. Supabase PostgreSQL remains the selected provider but NearPill-owned staging and real app-role RLS/authorization, migration replay, contention/reconciliation and restore NOT RUN. Source-level NP-031–NP-035 OPEN; no auth, Drizzle, application behavior or SQL migrations changed; Packet 1 blocked.

---

## 2026-10-28 current-source acceptance review — 1007-file ZIP

**Input baseline:** `NearPill_Packet0_Acceptance_Recheck_2026-10-28.zip` (SHA-256 `726cf793d5de4a55c5f48e8c0853c6210b79ecb9a23b0c3187ba7c338bfc689f`); ZIP CRC, unique regular members and 1007/1007 exact working-tree byte parity passed before changes. This is an archive, not evidence of a live Git HEAD, deployment, or NearPill-owned Supabase project.

**Packet:** Packet 0 remains ACTIVE / ACCEPTANCE BLOCKED. The fresh `bash scripts/verify-packet0.sh` finished exit 2 with 708/708 characterized tests passing, zero skipped; the additional Node contracts finished 122 passed, 1 skipped (PARTIAL). Source manifest 313/313 and syntax/heuristic secret checks passed before and after. `bash scripts/verify-mobile.sh` finished exit 2 with 6/6 mobile architecture contracts passing, but Flutter analyzer/tests/build NOT RUN. Full execution output: `docs/packet0-verification-2026-10-28-source-1007-full.txt`.

**Security/environment blockers:** Unsupported Node 22/npm 10; three authentic npm lockfiles plus application `pubspec.lock` missing; Flutter 3.44.4/Dart 3.12.2 and explicitly owner-approved NearPill Supabase PostgreSQL staging unavailable. NP-031–NP-035 remain OPEN source-level authorization findings. Real non-owner application-role RLS/isolation, migration replay, concurrency, reconciliation and restore remain NOT RUN. Seven current Drizzle SQL migrations preserved; no application/auth/SQL change or security bypass. **Next safe work: Packet 0 acceptance continuation, not Packet 1.**

---


## 2026-10-27 current authoritative source — 1001-file handoff (verification only)

**Baseline:** Latest `'NearPill_Packet0_Source_999_Acceptance_2026-10-27.zip'` (SHA-256 `a346e8a489a757bfc31dc6788de7dbd9be81164ffc7f554456f9baa292b9190a`), ZIP CRC/unique member and **1001/1001** actual source-byte comparisons PASS before modification. All prior dated entries below are historical. No Git HEAD or owner-approved Supabase deployment verified.

**Active dependency-safe work:** Packet 0 remains **ACTIVE / ACCEPTANCE BLOCKED**, not complete; Packet 1 remains blocked. Hono, backend-owned authentication, Drizzle/PostgreSQL, seven SQL migrations, React portal, Flutter app, and OTC business logic were preserved in place. No duplicate infrastructure or live Supabase cutover.

**Evidence:** `bash scripts/verify-packet0.sh` exit **2 BLOCKED**, with **708/708** Packet 0 PASS / zero skips; remaining runnable Node **122 PASS, 1 SKIP** (partial); pre/post source SHA-256 **313/313**, JS/JSON/shell syntax **152/11/8** and heuristic secrets PASS. `bash scripts/verify-mobile.sh` exit **2 BLOCKED**, **6/6** architecture tests PASS and postflight source/secret PASS. Current execution summary and full output: `docs/packet0-verification-2026-10-27-source-1001-summary.txt` and `docs/packet0-verification-2026-10-27-source-1001-full.txt`.

**Unmet acceptance gates:** Node >=24.7.0 <25 and npm 11 (this runtime Node 22/npm 10), authentic root/backend/web npm lockfiles, Flutter `pubspec.lock`, Flutter 3.44.4/Dart 3.12.2, and expressly owner-approved NearPill Supabase staging. NP-031–NP-035 remain OPEN source-level authorization findings. Real non-bypass application-role RLS negatives, checked migration replay, 100-way stock contention, financial reconciliation, transaction-local context and backup/restore remain **NOT RUN**. No source failure warranted an unreviewed SQL or application change. **Next safe work: continue Packet 0 acceptance**, not Packet 1.

---

## 2026-10-27 current source — 995-file Flutter lockfile reproducibility gate

**Baseline:** Latest handoff `NearPill_Packet0_Mobile_NPM11_Guard_2026-10-27.zip` (SHA-256 `892ab30ff2a3a08d2173ca8b79e73322c18e2515ef8d507c6c06676bb4897d43`), containing 995 regular ZIP files; CRC and all 995 source bytes matched the existing single NearPill working tree **before this Packet 0 change**. Earlier snapshots below are historical. No Git HEAD or live Supabase ownership is established by a source ZIP.

**Packet state:** Packet 0 remains ACTIVE / ACCEPTANCE BLOCKED. The canonical Hono backend, backend-owned authentication, Drizzle/PostgreSQL migration history, RLS, React portal, Flutter app, and OTC business behavior remain unchanged. The database provider decision is one owner-approved **Supabase-managed PostgreSQL** deployment, not a Supabase Auth/Data API cutover.

**Reproduced gap and correction:** The canonical and standalone mobile verifiers previously could run `flutter pub get` without a committed `pubspec.lock`, resolving unreviewed direct/transitive versions and potentially changing the source during acceptance. Both scripts now require a regular, non-symlinked reviewed `pubspec.lock` and execute `flutter pub get --enforce-lockfile` on the pinned Flutter 3.44.4/Dart 3.12.2 toolchain. A missing lockfile is NOT RUN/BLOCKED, never silently generated or accepted. Dart documents this production-oriented lockfile mode: https://dart.dev/tools/pub/cmd/pub-get . The original ZIP does **not** supply the lockfile; its provenance and integrity must be reviewed before adding it to the canonical manifest.

**Executable evidence:** Focused mobile/acceptance regressions 35/35 PASS (pre-fix red). `bash scripts/verify-packet0.sh` → EXIT 2 BLOCKED with 708/708 Packet 0 tests PASS, other Node baseline 122 PASS / 1 SKIP (PARTIAL); `bash scripts/verify-mobile.sh` → EXIT 2 BLOCKED, mobile architecture 6/6 PASS. Source 313/313 SHA-256 entries, syntax and heuristic secret checks PASS; the seven SQL migration files are unchanged. Complete command logs and blocker details are in this run's independent `docs/packet0-verification-2026-10-27-flutter-lockfile-*` evidence files.

**Outstanding environment/security:** Node >=24.7.0 <25 and npm 11 (current host Node 22/npm 10), authentic root/backend/web npm lockfiles, an authentic committed Flutter `pubspec.lock`, Flutter 3.44.4/Dart 3.12.2, and a separately owner-authorized NearPill Supabase staging project are missing. NP-031–NP-035 real application-role RLS/order-mutation negatives, reviewed migration replay, 100-way inventory contention, reconciliation, and backup/restore remain NOT RUN. Preserve all seven migrations; no unrelated project, bypass-role test or live SQL mutation is authorized. **Next safe packet: Packet 0 acceptance continuation; Packet 1 remains blocked.**

---

## 2026-10-27 latest Packet 0 acceptance — 969-file security-gate reconciliation

**Resolved current input:** `NearPill_Packet0_Node_Absence_Gate_2026-10-27.zip` (SHA-256 `524e246303c1732e2dfa483715cbbac20d4cc2f65e1d4a485f6c9b7b5e11364a`), the newest complete NearPill repository handoff supplied in this project. The ZIP passed CRC checks and **969/969 archived regular files matched the existing in-place working tree** before any change. No Git branch/HEAD or live deployed NearPill revision can be inferred from an archive. Earlier dated source inventories below are historical only.

**Active dependency-ready packet:** Packet 0 — **ACTIVE / ACCEPTANCE BLOCKED**. Fresh `bash scripts/verify-packet0.sh` returns **exit 2**: **699/699 Packet 0 tests pass (zero skipped)**; the other Node subset passes **122/123** with **one explicit skip (PARTIAL)**; reviewed source manifest 313/313, JavaScript/JSON/shell parsing 152/11/8 and heuristic secret scanning pass. This is characterization of the source and local test harness, **not** evidence that production RLS or payment/inventory invariants are satisfied. Refer to the current run's summary and full transcript in `docs/packet0-verification-2026-10-27-security-gate-*.txt`.

**Reconciled unresolved source-level PostgreSQL authorization findings** (all previously characterized elsewhere in this same baseline, none a claim about a connected Supabase deployment):

| Finding | Canonical source concern | Acceptance needed — not run |
|---|---|---|
| NP-031 | `0002_rls.sql` grants `nearpill_app` table privileges, but no reviewed migration enables and forces RLS on `users` | Auth-compatible `users` RLS/grants review; actual own/foreign user and role-escalation negatives under the non-bypass application role |
| NP-032 | `orders_update` in `0002_rls.sql` permits row-owner UPDATE without an explicit `total_centavos` column/capability boundary after `0006_order_inventory.sql` | Reject unauthorized owned-order amount changes under real PostgreSQL grants and policies |
| NP-033 | Same `orders_update` ownership condition does not independently enforce the allowed order lifecycle transitions | Reject unauthorized owned-order status advancement with no mutation capability |
| NP-034 | `order_drugstores_update` in `0004_identity_security.sql` allows customer-owned child-order UPDATE without a trusted order-mutation capability | Reject unauthorized child-order state mutation for ordinary customers |
| NP-035 | `order_items_insert` in `0004_identity_security.sql` can allow owner-scoped inserts without requiring order-mutation capability after authoritative `unit_price_centavos` migration | Reject unauthorized low-price line insert in a rollback-only fixture transaction |

These are **source-inferred design risks**. The existing recording-pool regressions exercise fail-closed test interpretation but **cannot establish real database behavior**. Do not alter the reviewed seven SQL migrations or Supabase roles as part of an unapproved Packet 0 audit, and do not use a different connected Supabase project by inference.

**Remaining gates:** supported Node >=24.7 <25/npm 11 plus all three authentic npm lockfiles for locked clean installs and web builds; Flutter 3.44.4/Dart 3.12.2; owner-approved dedicated NearPill Supabase staging endpoint with verified direct migrator and non-owner non-`BYPASSRLS` TLS app role; real RLS/transaction-local context negatives, migration replay, 100-way stock contention, financial reconciliation and backup/restore. All are **NOT RUN/BLOCKED**. Preserve Hono backend-owned authentication, Drizzle/SQL lineage, current React/Flutter, OTC use cases and single Supabase PostgreSQL provider target. No legacy path should be removed without parity evidence. **Next safe work: Packet 0 acceptance continuation**, not Packet 1.

---

## 2026-10-27 latest supplied source — 961-file baseline acceptance handoff

**Canonical source for this execution:** `NearPill_Packet0_Partial_TAP_Evidence_Guard_2026-10-27.zip` (SHA-256 `d8963967e1016eb797e3057a379603b1d9a50935b12addeaebb8b1333e4fc961`), the latest supplied complete NearPill project artifact, independently CRC-checked and compared to the *existing* repository: **961/961 regular archive members identical**. The one extra workspace `.log` is unshipped generated execution evidence, not a second application. No Git HEAD, active branch, deployed version or authorized NearPill Supabase project is established by this archive.

**Current reproducible command:** `bash scripts/verify-packet0.sh` with available Node **v22.16.0** / npm **10.9.2** → **exit 2 / BLOCKED**; the 698 Packet 0 characterization assertions pass with zero skips, while the remaining supported subset shows 122 passes and one skip. The first-party manifest covers 313 files, and source, JS/JSON/shell syntax and heuristic secret gates pass. See `docs/packet0-verification-2026-10-27-source-961-summary.txt` and `docs/packet0-verification-2026-10-27-source-961-full.txt` for this execution's exact raw evidence. These local contracts do not substitute for PostgreSQL integration tests.

**Safe acceptance sequence (none of the unavailable steps claimed executed):**

1. Obtain authentic reviewed lockfiles for root, backend and web **from the canonical NearPill repository**, plus supported Node 24/npm 11; then rerun `bash scripts/verify-packet0.sh`. Do not generate arbitrary replacement lockfiles and call their provenance verified. Confirm backend/web build and type gates only after a clean `npm ci` from those locks.
2. Provide Flutter **3.44.4** / Dart **3.12.2** and run the already configured analyzer, unit/widget and relevant release/contract gates.
3. Separately approve a **dedicated NearPill staging Supabase project** (identity, region, engine, extensions and owners). Review the seven existing Drizzle/PostgreSQL migrations **without reapplying or altering live schema** until compatibility, backup and rollback approval. Confirm independent least-privilege app and direct-connection migrator roles, TLS, grants and migration fingerprints.
4. Address source finding **NP-031** in the **existing migration lineage** only after reviewing backend identity queries; test actual `users` FORCE RLS and both allow/deny cases under a non-owner, non-`BYPASSRLS` application role. An unrelated Supabase project is never an implicit test target. Supabase Data API keys / Supabase Auth must not replace NearPill backend authentication.
5. On expressly authorized disposable/staging data, run existing real-Postgres verification workflows for cross-user/tenant RLS, session transaction context, 100-way stock contention, centavo/payment reconciliation and a restore drill. Operator approval and preflight in `backend/scripts/lib/verify-fixture-target.mjs` are required for writes; **do not** run the migrator or fixture scripts against production or unidentified hosts.

**Current status:** **Packet 0 ACTIVE / ACCEPTANCE BLOCKED**, no application code, auth, migrations or deployment change justified by this execution's local results. **Next safe work is Packet 0 acceptance continuation**, not Packet 1 or AI/Packet 11. Supabase remains the selected managed PostgreSQL provider, not a proven live cutover.

---

## 2026-10-27 current source provenance — 957-file input

**Canonical supplied source:** `NearPill_Packet0_Current_Provenance_Acceptance_2026-10-27.zip` (SHA-256 `1eb07dff6012f164867a50dbd5731c699f5131cccd4379c0324d2cfc4e70afe4`). The newest archive before this run has **957 verified files**, zero duplicate paths, successful ZIP CRC and exact 957/957 member-to-working-tree hash parity. No `.git` HEAD/branch or deployed Supabase revision is present; earlier baseline inventories are historical.

**Fresh actual Packet 0 gate:** `bash scripts/verify-packet0.sh` exited **2 / BLOCKED**, with **697/697** Packet 0 characterization tests passing without skips, **122** other runnable Node contracts passing and **1** unsupported-runtime skip, first-party SHA-256 manifest **313/313** passing before/after tests, JS/JSON/shell syntax **152/11/8** passing, and heuristic secret scanning passing. Evidence: `docs/packet0-verification-2026-10-27-supported-baseline-tap-summary.txt` and `docs/packet0-verification-2026-10-27-supported-baseline-tap-full.txt`. No application test assertion failed.

**Current audited architecture:** existing Hono backend and backend-owned authentication, Drizzle/PostgreSQL with seven canonical SQL migrations, React/Vite web and Flutter mobile. The selected managed provider remains **Supabase PostgreSQL**; no owner-approved NearPill project/least-privilege app-role live RLS result, migration replay, contention, reconciliation or restore evidence is available. Source finding **NP-031** (unaccepted `users` FORCE RLS) remains open. Node 22/npm 10, missing authentic root/backend/web npm lockfiles and missing Flutter SDK prevent supported build gates. These remain **NOT RUN/BLOCKED**, not PASS.

**Within-Packet-0 improvement:** Reused the reviewed TAP zero-skip attestation for the *supported-runtime remaining Node baseline* (`--baseline` mode) rather than trusting a zero `node --test` exit that could conceal skipped contract/security tests. Added a real fixture covering mixed skipped/passed Node tests and successful backend + CommonJS root contracts. No application or SQL behavior changed; all existing migrations remain unchanged.

**Packet decision:** Packet 0 is still the first incomplete dependency-ready packet. Its runnable local checks pass; full acceptance is blocked pending supported toolchain and authorized real database checks. Packet 1 was **not** started. Next safe work is **Packet 0 acceptance continuation**.

---

## 2026-10-27 earlier baseline reconciliation — historical 939-file input

**Selected baseline:** `NearPill_Packet0_Baseline_Reconciliation_2026-10-27.zip`, SHA-256 `d74990f8325d254a9fe76cc3331e2d3093f7c0e982f4c55e9bb0d76bdcf8c0a5`. This is the most recent complete archive supplied to this run, not a claimed Git HEAD or production deployment. Independent ZIP CRC and **939/939 complete regular archive-file byte comparisons** against this same in-place working tree succeeded before editing. Older October 27 entries below remain historical and are not newer baselines.

**Actual source surfaces:** one existing `backend/` (52 files in `backend/src`, Hono and server-owned authentication), `backend/migrations/postgres/` (seven existing numbered SQL migrations, PostgreSQL/Drizzle), one React/Vite `web/` (11 `web/src` files), and one Flutter `lib/` (41 Dart files). Source migration history and application/business logic remain unchanged. Supabase PostgreSQL is the approved sole production database provider, **not** a demonstrated staging connection or cutover.

**Dependency-ready decision:** Packet 0 is the only active incomplete packet (source verification passed; acceptance **BLOCKED**). Packet 1 and all dependent packets must remain unaccepted. The locally executable verifier returns **exit 2 by design** if prerequisites are missing, even when available tests pass. Do not infer that fixture-backed characterization proves database isolation or money/inventory integrity.

**Acceptance-gate handoff:**

| Gate | Reproducible evidence or command | 2026-10-27 status |
|---|---|---|
| Existing source and characterization | `bash scripts/verify-packet0.sh` with source-manifest and secret scans | 691 Packet 0 contracts and 122 other Node contracts passed; 1 skip; overall BLOCKED exit 2 |
| Supported web/backend build | Original, provenance-verified `package-lock.json` in root, `backend/` and `web/`; Node >=24.7 <25, npm 11; clean installs and type/build checks | NOT RUN: source lockfiles and supported runtime missing |
| Flutter client | Pinned Flutter 3.44.4, Dart 3.12.2; `flutter analyze`, `flutter test`, integration/release gates | NOT RUN: SDK missing |
| Dedicated staging database and app role | Explicitly approved NearPill-owned Supabase target; TLS direct/session-mode backend, distinct direct migrator; actual grants/role flags, PostgreSQL engine, reviewed migration history | NOT RUN: no approved target or connection credentials; never use unrelated projects |
| NP-031 `users` RLS and tenant boundaries | Review a new auth-compatible migration in **existing lineage**; actual non-owner, non-`BYPASSRLS` app-role negative/positive tests, including cross-user reads and privilege escalation | BLOCKED, known source finding: existing `0002_rls.sql` grants app table operations without a verified FORCE RLS policy for `users` |
| Transaction/data/recovery acceptance | Approved staging migration replay, transaction-local context isolation, 100-way stock contention, centavo/payment reconciliation, authorized backup and restore | NOT RUN: requires real authorized PostgreSQL and recovery setup |

**In-place scope:** Packet 0 ledger, baseline/cleanup map and verification evidence only. No new repository, backend, database, auth system, migration, runtime behavior, Supabase project, secrets or live data operations. No legacy implementation is deleted without verified parity. **Next safe work:** continue Packet 0 acceptance with legitimate toolchains, authentic dependency locks and explicitly approved staging infrastructure; stop before Packet 1.

---

## 2026-10-27 latest-source revalidation — Packet 0 continuation

**Source of truth:** `NearPill_Packet0_Independent_Verification_2026-10-27.zip` (SHA-256 `f6b51df774089d533ce5c70b79d3ede096ff5db23d35a5a23bea3997afe9cb48`), the most recent complete NearPill application archive in the current conversation. Independently checked ZIP CRC and **938/938 byte-for-byte file matches** against this single in-place working tree **before changes**. Archive source only: `.git`/HEAD, deployed build and database state cannot be asserted. **This section supersedes the 2026-10-20 file counts and test totals below; those remain historical baseline evidence.**

| Current observable surface | Independent 2026-10-27 inventory |
|---|---|
| Existing app tree | One `backend/`, `web/`, `lib/`, `android/` and `scripts/` project; no sibling V2 or duplicate app introduced |
| Backend modules | **52** first-party files under `backend/src/`; Hono `backend/src/http/app.ts`, `routes/v1/register.ts`, existing domain/application/ports/repositories, backend-owned authentication; 61 previously characterized HTTP route contracts (source contract, not a live HTTP response) |
| Database/migration lineage | **7** original numbered SQL migrations in `backend/migrations/postgres/` and the same `pg`/Drizzle adapter; 27 `CREATE TABLE IF NOT EXISTS` declarations in the reviewed SQL history; no migration was executed |
| Web portal | **11** first-party files under `web/src/`, React/TypeScript/Vite in the existing portal; two Playwright E2E test files; no live browser E2E result |
| Flutter | **41** Dart files under `lib/` and **4** Dart tests under `test/`; same Dio-based app, no Flutter SDK/tooling available on this host |
| Characterization inventory | **40** `backend/test/packet0-*.test.mjs` suites, **56** total backend `.test.mjs` suites, and root contract tests; fixture/in-memory checks are not equivalent to Supabase integration |
| Local toolchain | Node **v22.16.0** / npm **10.9.2** available but unsupported; declared minimum Node `>=24.7.0 <25` with npm 11; Flutter, Docker, `psql` absent; genuine root/backend/web npm lockfiles absent |
| Hosting status | **Supabase PostgreSQL selected, not connected/cut over**. No explicitly approved NearPill-owned staging project, direct TLS migrator, or real least-privilege application role verified |

**First incomplete dependency-ready packet:** Packet 0 is still **ACTIVE / ACCEPTANCE BLOCKED**, not complete. Later feature/module presence does not satisfy required operational, security or data acceptance. The reviewed `0002_rls.sql` grants broad table access to `nearpill_app`; **no original SQL migration enables and forces RLS on `users`** (NP-031). This is a static risk, not a claim about unknown live database state. Do not introduce or apply an unreviewed correction on an unidentified Supabase project; verify app-role RLS/tenant negatives on an authorized disposable/staging target first.

**In-place cleanup map:** Retain `backend/src/infrastructure/postgres/` and `backend/migrations/postgres/` as the one canonical Drizzle/SQL history. Retain the existing Hono, backend identity/tenant policy, React portal, Flutter client and OTC business use cases. Treat `backend/src/infrastructure/mysql/`, legacy schema/import helpers and local disposable Postgres as historical/rollback and test tooling—not evidence of a second live database. Do not remove them until the documented single-database cutover, migration/reconciliation and rollback acceptance are proven. Do not start AI/Packet 11 or Packet 1 while Packet 0 remains blocked.

**Required but unavailable gates (NOT RUN/BLOCKED):** supported Node 24/npm 11 clean-install, builds, web/typecheck/Playwright; Flutter analyze/widget/release; dedicated NearPill Supabase engine/extension/role/TLS inventory, tenant RLS negatives incl. NP-031, migration replay/checksum, pooled tenant-context isolation, 100-way stock contention, money/payment reconciliation and restore drill. Missing controls must not be marked PASS.

---

**Audit date:** 2026-10-20 (Asia/Manila)  
**Source selection:** The newest NearPill source supplied in this chat, the uploaded Flutter/Hono/React ZIP, extracted **once** into the existing application directory for in-place changes. Older `NearPill-main.zip` and October 17 Packet 0 reports are historical comparisons, not the active source.  
**Input artifact SHA-256:** `1a1e58a20c17d10322ef95ef41e45e1948efdf5446a6387c52a11a9fcb475f93`  
**Git revision:** **Unverifiable**: the uploaded archive has no `.git` directory; therefore no branch, HEAD, or dirty-tree claim is made.  
**Packet state:** **ACTIVE, PARTIALLY IMPLEMENTED / ACCEPTANCE BLOCKED**. The code archive is now available. Supported runtime, dependency, and Flutter acceptance gates cannot be completed on this host.

## Current source inventory (recomputed from the uploaded archive)

| Surface | Observed baseline |
|---|---|
| Source | 349 ZIP entries including directories; 250 files on extraction, excluding no hidden Git checkout |
| Backend | Node ESM + TypeScript Hono bootstrap/HTTP adapter, JS application/domain/services and PostgreSQL repository adapters |
| Authentication | backend-owned login/session and refresh services, stored credential hashes, CSRF/session contracts and permissions |
| PostgreSQL | Drizzle schema at `backend/src/infrastructure/postgres/schema.ts`; **7 existing reviewed SQL migrations** (`0001`–`0007`); `pg` runtime driver; 27 CREATE TABLE statements in those migrations |
| API | **61 unique Hono v1 method/path contracts**, grouped as auth 11, admin 28, medicines 2, stores 4, inventory 1, orders 7, partner 6, payments 2 |
| Web | React + TypeScript + Vite under the existing `web/` directory, 8 TSX and 2 TS source files; no `web/js/` legacy globals found |
| Flutter | Same mobile application, 41 Dart files under `lib/` and 4 Dart test files, Dio client, feature repositories/view models, user-scoped cart and map flow |
| Infra | Compose + NGINX + PostgreSQL/pgvector local service, CI declarations, release-signing gate, Node/Flutter verification scripts |
| Legacy evidence | MySQL adapters and scripts retained for one-time migration/rollback; **not** imported by the production Hono bootstrap |
| Missing release provenance | No `.git`, no `package-lock.json` at root/backend/web; no deployed NearPill Supabase project could be verified from this archive |

**Historical discrepancy:** Earlier text in the master plan and October 17 audit calls Express/MySQL/vanilla web the “current” application. That is **historical** and must not be used to reintroduce those paths. Current code has newer Hono/PostgreSQL/React/Flutter work; static presence alone does not prove its live deploy or prior packet acceptance.

## Current behavior characterized without application changes

- Backend authentication has distinct access, refresh and web session contracts with server-side credential hashing; actual live persistent session behavior and replay rejection remain unverified here.
- `/api/v1` Hono route table is 61 unique contracts, with OpenAPI route and removed old unversioned compatibility routes.
- The order service enforces one pharmacy, idempotency key and authoritative centavos. The PostgreSQL repository uses row locks/reservation and stock-movement ledgers. High-contention correctness requires **real** PostgreSQL.
- Payment tests exercise server-side policy/provider evidence, webhook de-duplication and quarantine using fixtures. Sandbox/provider and database reconciliation are separate, blocked gates.
- Web same-origin session/CSRF and admin/partner screens reference backend APIs rather than local fixture authority.
- Flutter cart scope, rotated credentials, map fallback and release-signing controls are statically characterized, **not** Dart-analyzed or built.
- OTC catalog/security tests inspect the **current** React portal and Flutter cart modules; obsolete `web/js/*` and `lib/services/*` references were removed from those tests only.

## Packet 0 changes (no production behavior change)

1. `backend/test/catalog-discovery-security.test.mjs` — redirect assertions to `web/src/*` and the active Flutter cart module; replace the deleted legacy fixture-data assertion with a negative test for retired browser fixture scripts.
2. `backend/test/order-inventory-integrity.test.mjs` — redirect cart/session read paths to `lib/features/cart/presentation/cart_view_model.dart` and `lib/core/auth/session_manager.dart` without weakening invariant assertions.
3. `docs/packet-0-baseline-characterization.md` — replace the stale Express/MySQL Packet 0 inventory with this audit of the actual uploaded code.
4. Master engineering plan, §28 Implementation Ledger — reconcile source availability, packet status, Supabase provider gap, exact tests, and next safe gate.

No auth, business rules, migrations, DB roles, API contracts, portal functionality, Flutter functionality or production runtime dependencies were changed. No obsolete application runtime code was re-added or deleted on unproven parity. No live database was accessed or mutated.

## Executed tests and environment gates

| Command/gate | Observed result | Classification |
|---|---|---|
| `node --test backend/test/catalog-discovery-security.test.mjs backend/test/order-inventory-integrity.test.mjs` | **12 passed, 0 failed** after updating obsolete test references | PASS (static/source contract) |
| `node --test backend/test/packet0-baseline-characterization.test.mjs` | **6 passed, 0 failed** | PASS (static/source contract) |
| `node --test <all backend tests except password-migration> test/*.test.mjs test/web_service_information.test.cjs` | **128 passed, 1 skipped, 0 failed** | PASS only for runnable Node subset; not full test acceptance |
| `node --test backend/test/*.test.mjs test/*.test.mjs test/web_service_information.test.cjs` | **130 counted: 128 passed, 1 failed to load, 1 skipped** | BLOCKED: `mysql2` dependency not installed for `audit-passwords.js`, Node 22 also lacks supported `crypto.argon2` |
| `bash scripts/verify-packet0.sh` | Exit **2**, Packet 0 6/6 PASS, JS parse PASS, Node 24/Flutter gates unavailable | ENVIRONMENT BLOCKED |
| `npm run check:syntax` | **80 JS/MJS/CJS files parsed** | PASS |
| `npm run secret:scan` | No high-confidence committed secret patterns found | PASS heuristic only; not a production secret audit |
| `node --test test/mobile-architecture.test.mjs` | **6 passed** | PASS static; no Flutter analyze/build |
| `npm run check:lockfile` | Exit **2**; root `package-lock.json` absent | SOURCE ARTIFACT / reproducible-install blocker |
| `flutter analyze`, `flutter test` | Flutter/Dart absent | NOT RUN / BLOCKED |
| Node >=24.7, npm >=11, clean install, backend/web build/typecheck | Host Node **v22.16.0** and npm **10.9.2**, no npm lockfiles/dependencies or external DNS | NOT RUN / BLOCKED |
| Live app-role RLS, migration checksum replay, stock concurrency, provider webhook, backup/restore | No approved NearPill-owned Supabase project/credentials/DB test runtime | NOT RUN / BLOCKED |

The unavailable environment gates are **not PASS**. Legacy/canned tests and static source checks do not prove live data integrity or production security.

## Supabase provider reconciliation (approved direction, not deployed)

The **selected** managed database provider is Supabase PostgreSQL. The existing backend already has a PostgreSQL/Drizzle adapter, SQL migration lineage, transaction-local RLS actor context and server-owned authentication. **Do not repeat the MySQL migration or add Supabase Auth/client Data API authority.**

Current source still uses `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` and `DB_SSL` in `backend/src/config/env.ts`; `backend/src/infrastructure/postgres/client.js` creates an ordinary `pg.Pool`; `backend/scripts/migrate-postgres.mjs` uses those settings, and `compose.yaml` starts a local Postgres service. No NearPill Supabase project identity, direct/session TLS endpoint, owner-approved application role or migration connection has been verified. Treat this as **Packet 3 provider-adoption work requiring prerequisite acceptance**, not an excuse to create another production DB in Packet 0.

Official provider behavior: Supabase recommends direct connection for a persistent backend when IPv6 is available, session pooler for a persistent IPv4-only backend, and a direct connection for migrations/backup. Transaction pooling does not support prepared statements. Database grants plus tested row-level policies must protect private data. See [Supabase database connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), and [Drizzle Supabase connection](https://orm.drizzle.team/docs/connect-supabase).

## Safe cleanup/cutover mapping

| Existing path | Present state | Remove/change only after |
|---|---|---|
| `backend/src/infrastructure/mysql/`, `backend/init-db.js`, legacy MySQL migrations | Historical adapter/import/rollback evidence; not active Hono runtime | Packet 3 data conversion/replay/RLS and rollback window accepted |
| `backend/postgres/bootstrap/001-roles.sh`, local `compose.yaml` PostgreSQL service | Local integration/provisioning topology; not a deployed Supabase endpoint | Packet 3 adapts actual NearPill staging connection/roles; local disposable tests may stay |
| `backend/src/infrastructure/postgres/*`, `backend/migrations/postgres/*` | Canonical current persistence and reviewed history | **Preserve**, adapt hosting only; no parallel schema/migration history |
| `backend/src/application/*`, `backend/src/domain/*`, `backend/src/http/*` | Canonical backend rules/API/auth | Preserve and prove on live test DB before cuts |
| `web/src/*` | Canonical React portal, old `web/js/*` absent | Preserve; run web build/Playwright tenant test when dependencies available |
| `lib/core/*`, `lib/features/*`, existing Flutter `lib/screens/*` | Single Flutter app; old direct-service files absent | Preserve; run Flutter test/analyze/release gate on supported SDK |
| Missing root/backend/web lockfiles | Artifact packaging/build provenance gap | Restore/recreate **in Packet 1 only after Packet 0 acceptance**; do not claim `npm ci` succeeded |

## Acceptance decision and next safe packet

**Packet 0 remains ACTIVE / BLOCKED.** It now has a real source inventory, an updated cleanup map, fixed stale test paths and reproducible static characterization. It does **not** have clean supported-runtime baseline or Flutter gates; source packaging also lacks lockfiles. **Do not mark earlier packets or Supabase cutover accepted from their mere presence.**

**Next safe action:** Continue **Packet 0 acceptance** in the canonical repo with pinned Node 24/npm 11 and Flutter SDK; obtain the real repository lockfiles/dependencies, run full backend/web/Flutter baseline and classify failures without weakening controls. Once accepted, reconcile whether the next genuinely incomplete packet is the narrow Supabase provider adaptation under Packet 3 (if Packets 1–2/earlier code pass) or an earlier dependency packet. Stop; do not start Packet 11 or a parallel project.


## 2026-10-20 continuation — executable transaction characterization and baseline gate hardening

**Newer working input:** the previous in-place reconciled NearPill source ZIP, SHA-256 `b5e1e1c875d81f0c9bb6b32beace87d85be827a7ea4fc732e7e3ead16357a986`, derived from the latest user-uploaded mobile/Hono/React source noted above. This is the same canonical application, **not** another project. Neither archive contains a Git checkout; no HEAD/branch inference was made.

**Scope:** Packet 0 only. Added recording-transport tests around the **existing** `createPostgresCompatPool` and `AsyncLocalStorage` actor context. The suite characterizes (a) `BEGIN` before transaction-local actor context, (b) query parameterization, (c) rollback and release on query error, (d) repository-supplied scoped capability, (e) explicit transaction facade ordering, and (f) concurrent request actor-context separation. The recording client cannot reproduce server-side RLS policies, privileged-role bypass, pooler behavior, or Supabase transaction contention.

**Exact files changed in this continuation:**

- `backend/test/packet0-transaction-characterization.test.mjs` — **new test only**, five dynamic characterization cases, no new production code/module.
- `scripts/verify-packet0.sh` — detects unsupported Node/npm majors and absent root/backend/web npm locks; includes the new transaction tests and runs the supported Node subset on Node 22 while still blocking full acceptance.
- `docs/packet-0-baseline-characterization.md` — appended actual execution evidence and blockers.
- `NearPill_Master_In_Place_Whole_Codebase_Refactor_Engineering_Plan_2026-10-17.md` — updated Packet 0 state/evidence and appended implementation ledger entry, preserving historical records.

**Behavior preserved:** All production behavior. Hono auth/RBAC, PostgreSQL/Drizzle/RLS, schema/migration checksums, order/inventory, payments, portal, Flutter and provider configuration are unchanged. **Legacy paths removed:** none; no verified parity/cutover authorizes deletion. No database/secret/provider endpoint was accessed or changed.

**Commands and observed results (this run, local host Node `v22.16.0`, npm `10.9.2`):**

| Command or gate | Evidence | Classification |
|---|---|---|
| `node --test backend/test/packet0-baseline-characterization.test.mjs backend/test/packet0-transaction-characterization.test.mjs` | **11 passed**, 0 failed | PASS source/executable mocked transport contract; not Supabase integration |
| `node --test backend/test/packet0-transaction-characterization.test.mjs` | **5 passed**, 0 failed | PASS transaction sequencing under recording transport |
| Targeted `node --test` of Packet 0, identity-security, postgres-migration-contract, order-inventory-integrity, payment-reconciliation-integrity and http-transport-contract suites | **62 passed**, 0 failed | PASS mixed dynamic and static contract tests; no live DB |
| `bash scripts/verify-packet0.sh` | **Exit 2**: required 11 Packet 0 tests pass; runnable Node subset **133 passed, 1 skipped, 0 failed**; JS parse PASS; runtime/source gates blocked | BLOCKED, **not** PASS |
| `npm run check:syntax` | **81** first-party JS-family files parsed | PASS |
| `npm run secret:scan` | No high-confidence patterns detected | PASS heuristic only |
| `node scripts/check-lockfile.mjs` | Exit **2**; root npm lockfile absent | SOURCE BLOCKER |
| `node scripts/check-backend-lockfile.mjs` | Exit **2**; backend lockfile absent | SOURCE BLOCKER |
| Web lockfile inventory | `web/package-lock.json` absent | SOURCE BLOCKER |
| Experimental Node 22 TS-loader supplemental env assertions | **4 passed**, with explicit test-only values | Supplemental only; unsupported runtime, **not** production/typecheck proof |
| Supported Node 24/npm 11 dependency install, builds/typecheck, full password-migration tests | Runtime, npm major, lockfiles and dependency packages unavailable; sandbox DNS cannot resolve package registries | NOT RUN/BLOCKED |
| `flutter analyze`, `flutter test`, Android build, Docker Compose | Flutter and Docker absent | NOT RUN/BLOCKED |
| NearPill-owned Supabase RLS, app/migrator least-privilege role, TLS, migrations, data integrity, stock concurrency, restore, live payment sandbox | No verified NearPill Supabase project/staging credentials; no psql/Docker runtime | NOT RUN/BLOCKED |

**Security/configuration audit note:** Current `backend/src/config/env.ts` allows `DB_SSL=false` unless enabled, and runtime/migrator pools take SSL from that option. This is **not proof of a deployed plaintext connection**, but the later Supabase provider-adoption packet must enforce TLS for staging/production and prove the app role is non-owner/non-`BYPASSRLS`. The 5 recording-transport tests cannot prove these provider security gates. Supabase official connection documentation recommends direct mode for persistent backends (session pooler for IPv4-only environments), direct mode for migrations, and explicit RLS/grant review.

**Acceptance decision:** Packet 0 **remains active / blocked**. There is no code/test regression from this continuation, but no supported-runtime or real-database acceptance evidence. Do **not** mark downstream source-present packets complete or start Packet 3/11 on the basis of these tests. No live Supabase provider cutover occurred.

**Rollback/forward-fix:** Revert the new test, verifier changes and audit/ledger append if necessary. No database, behavior or production deployment rollback is required. On a supported, owner-controlled build environment, restore/review lockfiles, run Node 24/npm 11 clean install/full tests, Flutter and web checks; then run real app-role tenant-RLS/stock/reconciliation tests on the owner-approved NearPill Supabase staging project before provider cutover.

**Next safe packet:** Packet 0 acceptance continuation. Only after acceptance, select the earliest actually incomplete dependency-ready packet (not automatically Packet 11).

---

## 2026-10-20 — Continuation: fixture-verification fail-closed preflight

The latest continuation ZIP (`SHA-256 0eaf72f7c8b30ea3378e2e53c332ceae4bcaa09e8f4587bb9bc8daa4b0e79403`) matched the working tree file-for-file before changes. The in-place modification affects only live **database verification tooling**, guard tests, test-runner wiring, and documentation; Hono/auth/Drizzle/RLS/SQL migrations/web/Flutter runtime remain unchanged.

The preflight `backend/scripts/lib/verify-fixture-target.mjs` now blocks the three fixture-writing verification scripts before they create pools unless the operator selects `local-test` or owner-approved `staging`, supplies an explicit expected host and database, distinct roles, confirmation and (for staging) TLS/credentials/project-reference/approval flags. The two verification scripts that previously omitted pool SSL configuration now explicitly propagate `DB_SSL` to both pools with certificate checking. The guard still cannot prove actual ownership or security; a real NearPill Supabase connection and app-role RLS tests remain required. See `docs/packet-0-db-fixture-safety.md`.

**Actual test evidence:** guard test **9/9 PASS**; targeted Packet 0/identity/Postgres/order/payment/HTTP suites **71/71 PASS**; `bash scripts/verify-packet0.sh` exit **2 / BLOCKED** with Packet 0 **20/20 PASS** and runnable Node subset **142 passed, 1 skipped, 0 failed**; `npm run check:syntax` **83 parsed PASS**; `npm run secret:scan` heuristic PASS. Host is Node `v22.16.0`, npm `10.9.2`; missing supported Node 24/npm 11, root/backend/web lockfiles and Flutter. No Flutter, clean-install, build/typecheck or real Supabase RLS/data tests were run. The full packet **is not accepted**; next safe work remains Packet 0 acceptance continuation.


## 2026-10-20 continuation — live connection identity safety

Source ZIP `NearPill_Current_Codebase_Packet0_Fixture_Safety_2026-10-20.zip` (`SHA-256 c573d1cede46e449dd915ef561590468a927ce7a5afbf2f2bf2267f752f745db`) matched all 255 existing working-tree files before edits; no Git HEAD is represented by the archive.

Added a read-only live PostgreSQL preflight shared by the three existing fixture-writing verification commands. It checks actual `current_user`, `current_database()`, role `rolsuper`/`rolbypassrls`, RLS + FORCE on protected tables, table ownership, staging TLS and migration-role separation before fixture INSERTs. Only verifier scripts, supporting test/docs and Packet 0 verification runner changed; business runtime, Drizzle and SQL migration checksums remain unchanged.

Recorded evidence on unsupported Node v22.16.0/npm 10.9.2: **29/29 Packet 0 characterizations PASS**, **56/56 targeted API/security/inventory/payment/Postgres-source tests PASS**, **151 passed/1 skipped/0 failed** runnable Node tests, **85 JS parse PASS**, heuristic secret scan PASS; `bash scripts/verify-packet0.sh` exits **2/BLOCKED**. Root/backend/web npm lockfiles are absent; Node 24/npm 11, Flutter, Docker/psql and a confirmed NearPill Supabase staging database are unavailable. These gaps are not passing acceptance gates; source-only role assertions cannot replace real app-role RLS/data tests.

## 2026-10-20 continuation — prevent refresh replay checks from touching existing user accounts

**Latest baseline:** `NearPill_Packet0_Live_Connection_Safety_2026-10-20.zip` (SHA-256 `4e3ca2172639516858a50c8385bd779f3c9f7c49a0d5b7ea85bd5ddd24e3433d`), 257 files, matches this in-place working tree byte-for-byte before changes. No `.git`/HEAD supplied.

**Confirmed risk:** `backend/scripts/verify-identity-security.mjs` selected the lowest-ID existing `users` record for a refresh-token replay test. The replay path intentionally revokes an auth token family and creates sessions, so using a real account is unsafe even on an environment labeled staging. The branch creating a synthetic account only when users was empty did not prevent this. No evidence says such a test was actually executed against a customer account.

**Packet 0 fix:** verification tooling now always uses a separate migration-role connection to insert a UUID-marked, disposable user and deletes it by ID + unique synthetic email in a `finally` cleanup. Failure to clean up fails verification. The live role preflight checks both connections. The staging guard also verifies that a declared Supabase project reference matches the direct hostname or session-pooler login roles. This does **not** authorize a real staging target or validate ownership.

**Local tests:** targeted characterization `35/35 PASS`, adjacent identity/PostgreSQL/order/payment/HTTP test subset `51/51 PASS`, broad unsupported-Node runnable tests `157 PASS / 1 SKIP / 0 FAIL`, first-party JavaScript syntax `87 PASS`, heuristic secret scan `PASS`. `bash scripts/verify-packet0.sh` exits `2`/BLOCKED as designed. Local Node `v22.16.0` / npm `10.9.2`; Node 24/npm 11, three npm lockfiles, Flutter SDK, full web/backend installs/builds/typechecks, and a verified NearPill-owned Supabase staging DB with live RLS/data/stock/restore gates remain unavailable. Do not promote Packet 0 or earlier code-present packets to accepted.

**No app behavior, migration, database, production secret, or provider endpoint was changed.** No legacy production path was removed; no parity-based deletions were justified.


## 2026-10-20 continuation — order verifier staging isolation gate

After further review, `backend/scripts/verify-order-inventory.mjs` was found to invoke the unscoped canonical `expireOldOrders()` use case, which can update any eligible expired order in the connected database. Packet 0 now rejects staging and production at the **order-verification command's pre-connect guard**; only an explicitly approved, truly disposable loopback test database can run that script. No production order lifecycle implementation changed. The additional preflight tests pass without a database. Live Supabase validation and the broader acceptance/toolchain prerequisites remain blocked and are not inferred from source tests.

## 2026-10-20 Packet 0 continuation — effective role membership preflight

The current source archive's live fixture-readiness check now rejects not just direct superuser/BYPASSRLS attributes, but also role creation, database creation, replication and direct/indirect membership in privileged PostgreSQL/Supabase roles. Both the application and migrator pools are checked; unknown status is a refusal. This is a safety check on the existing verification tooling, **not** a Supabase provider migration or an RLS proof. See `docs/packet-0-db-fixture-safety.md`.

Local Node 22 evidence: Packet 0 characterization **39 PASS**; five adjacent backend contract suites **51 PASS**; full runnable Node subset **161 PASS, 1 SKIP**; syntax **87 files PASS**; heuristic secret-pattern check **PASS**. `bash scripts/verify-packet0.sh` exits **2 (BLOCKED)** because the declared Node 24/npm 11 toolchain, root/backend/web npm lockfiles, Flutter SDK and NearPill-approved Supabase staging project are unavailable. Live role/RLS/grants, migration replay, 100-way PostgreSQL contention and restore tests remain **NOT RUN**. No fixtures or SQL were applied.

## 2026-10-20 — Additional Packet 0 acceptance-runner correction

The most recent source archive (before edits) had 259 matching files and lacked all three npm lockfiles. The original `scripts/verify-packet0.sh` could emit an executable-baseline PASS when a supported Node/npm and Flutter environment existed without first proving clean npm installs or portal/root TypeScript and web production builds. This continuation changes **verification tooling only**: the runner now gates the full supported-runtime baseline on clean root/backend/web installs from genuine lockfiles, requires root/web typechecks and the actual web build when dependencies are available, checks pinned Flutter/Dart versions, and resolves Flutter dependencies before analysis/tests. Five new `backend/test/packet0-acceptance-gates.test.mjs` tests enforce the documented acceptance-path contracts.

On this host, targeted Packet 0 tests **64/64 PASS**, adjacent contracts **51/51 PASS**, runnable Node subset **186 PASS, 1 SKIP**, JavaScript syntax **88 files PASS**, and heuristic secret scan **PASS**. `bash scripts/verify-packet0.sh` remains **exit 2 / BLOCKED** because actual Node 24/npm 11, verified lockfiles, Flutter and a NearPill-owned Supabase test target are unavailable. No successful `npm ci`, TypeScript build, Flutter build or real PostgreSQL security/integrity test is claimed. The `users` table RLS exception (NP-031) remains unresolved. Source and test evidence are in §28 of the master ledger.


## 2026-10-20 continuation — executable auth credential boundary (active Packet 0)

The latest supplied 260-file archive was verified byte-for-byte against the single in-place source tree before edits. A new *test-only* suite at `backend/test/packet0-auth-credential-boundary.test.mjs` now exercises the actual `createAuthService` and records separation of mobile bearer access, refresh, and web-session credentials; session-bound CSRF decisions; production cookie flags; hashed storage; and user-specific session revocation. `scripts/verify-packet0.sh` includes the suite. No live DB, new auth system or source migration was introduced. Recording repository tests are **not** proof of real PostgreSQL expiry, RLS or cross-tenant isolation.

Actual local results: `node --test backend/test/packet0-*.test.mjs` **68/68 pass**; five adjacent API/security/data contract files **51/51 pass**; runnable Node subset **190 pass, 1 skip, 0 fail**; first-party JS syntax **89 pass**; heuristic secret-pattern scan **pass**. Full Packet 0 runner exits **2 / BLOCKED** because this host has Node 22/npm 10 rather than Node 24/npm 11; original archive has no root/backend/web lockfiles; Flutter and owner-verified NearPill Supabase staging are unavailable. Real app-role RLS, migrations, 100-way inventory contention, backup/restore and NP-031 `users` RLS resolution remain outstanding; no gate is bypassed or treated as passed. Next safe packet is **Packet 0 acceptance continuation**.

## 2026-10-20 continuation — AI-conditional vector-extension reconciliation

The current seven reviewed SQL migrations (`0001`–`0007`) do not create or require a pgvector extension for OTC catalog/order/payment correctness; the local disposable PostgreSQL bootstrap does provide pgvector. The master plan gates vector search behind **Packet 11 (AI)**. The previous read-only reconciler treated an absent `vector` extension as a database-integrity failure even while AI was disabled.

`backend/scripts/reconcile-postgres.mjs` now **always queries** `pg_extension`, but reports the result as **DEFERRED** (not PASS) when the extension is absent and no AI/vector requirement is enabled. If `NEARPILL_AI_ENABLED=true` or `NEARPILL_REQUIRE_PGVECTOR=true`, missing pgvector still **FAILS**. Invalid/missing catalog response shape or invalid environment flag values fail closed, never becoming a deferral. Installed extension versions remain reported as PASS. This is a verification-only change; no schemas, migrations, auth, business rules or production connection configuration changed.

This does not waive independent Supabase version/extension inventory, RLS, role/grant, migration history, tenant isolation, centavo/stock, reconciliation or restore requirements. A future AI packet must explicitly enable the extension requirement and prove it against the NearPill-owned Supabase staging database before acceptance.

Local test: `node --test backend/test/packet0-reconciliation-extension-readiness.test.mjs`. No database was contacted, and no extension was installed.


## 2026-10-20 — Supported-runtime contract coverage acceptance correction

The Packet 0 verification runner previously invoked `node --test backend/test/*.test.mjs test/web_service_information.test.cjs` in its **supported Node 24** path, but invoked `test/*.test.mjs` as well in its unsupported-runtime subset. This could omit root-level foundation, web, environment and mobile architecture contract checks precisely when the runner was eligible to attempt full acceptance. The supported path now includes `test/*.test.mjs`, matching the fallback coverage (except for its intentionally excluded Node 24-only password test). This changes verification coverage, not application behavior.

A mismatched Flutter/Dart SDK previously recorded an environment blocker but still ran `flutter pub get` and possibly analyzer/tests. The runner now skips dependency resolution and Flutter tests entirely when the pinned 3.44.4/3.12.2 SDK versions do not match. It retains the strict environment blocker; neither a wrong SDK nor absent SDK is a PASS. Two new focused executable source-contract tests prevent both regressions. They cannot prove a Node 24 build, a Flutter build, a real PostgreSQL test, or production readiness.

**Evidence:** `node --test backend/test/packet0-acceptance-gates.test.mjs` PASS 9/9; the actual current `bash scripts/verify-packet0.sh` exits 2 (blocked) with 106 Packet 0 characterization tests passing and its Node 22 runnable subset reporting 237 passed, 1 skipped, 0 failed. Adjacent real-code/source contracts 51/51 passed, JS syntax 100 files and heuristic secret scan passed. Missing Node 24/npm 11, root/backend/web npm lockfiles, Flutter/Dart and verified NearPill-owned Supabase staging remain blockers; NP-031 `users` RLS design gap remains unresolved. No DB connection or production business logic change was made.


## 2026-10-20 — Packet 0 continuation: complete PostgreSQL migration-journal prefix verification

The canonical migration runner now validates the **entire** persisted migration journal against the same ordered, SHA-256-checked SQL batch loaded by its existing source-inventory helper. The journal must be a contiguous prefix of reviewed migrations. An unexpected/renamed migration, a missing predecessor, an altered checksum (including in a *later* migration), or a future journal entry from a different checkout fails closed **inside the migration advisory-lock transaction before executing DDL**. The executor continues to use its single canonical history, lock timeout, transaction/rollback behavior, and separate migrator-role connection; no SQL migrations or application paths changed.

Executable recording-client tests cover unexpected entries, ordering gaps, downstream checksum drift, predecessor enforcement, valid prefix application, and rejection of malformed source manifests before any query. They are **not** live PostgreSQL concurrency or RLS evidence. The approved NearPill Supabase target, Node 24/npm 11, root/backend/web lockfiles, Flutter tooling, RLS/stock/data-integrity and restore acceptance remain blocked, as recorded in the master ledger. No Supabase project was accessed or modified.


## 2026-10-20 acceptance coverage correction

`bash scripts/verify-packet0.sh` now discovers every existing `backend/test/packet0-*.test.mjs` file instead of maintaining an error-prone list. This run discovered 17 files, including the previously omitted `packet0-acceptance-gates.test.mjs`; 164/164 Packet 0 tests passed on the available unsupported Node 22 runtime. The runner rejects an empty test inventory. Adjacent contracts passed 51/51, JavaScript syntax and source secret scan passed, and the runnable Node subset passed 286 with one skipped test. The full runner exited **2 (BLOCKED)**; these passes cannot substitute for Node 24/npm 11 clean installs, authentic source lockfiles, Flutter, NP-031 remediation, real Supabase app-role RLS and tenant-negative checks, 100-way inventory contention or backup/restore evidence. No live database was accessed.

## 2026-10-21 — Latest repeat-expiry-guard archive acceptance re-audit

The latest user-supplied archive is `NearPill_Packet0_Repeat_Expiry_Guard_2026-10-21.zip` (SHA-256 `0da1899fea5df0ba21f831d62160f0c386b57f88dda61a76d887c8d733538fc7`). It contains 293 files; there is no Git HEAD. This run changed documentation/ledger only; the canonical application and tests remain intact.

On Node v22.16.0/npm 10.9.2, `node --test backend/test/packet0-*.test.mjs` yielded 247 passed/0 failed. `bash scripts/verify-packet0.sh` exited 2 (BLOCKED), despite 247 Packet 0 passes, 369 runnable Node fallback passes/1 skip/0 fails, first-party JavaScript syntax and heuristic secret scan passes. All three npm lockfiles, supported Node 24/npm 11, Flutter SDK and real owner-approved NearPill Supabase acceptance target remain absent. No RLS/DB integrity/restore test or live DB modification occurred. Packet 0 remains active, with NP-031 unresolved; no downstream packet is accepted by implication. See the 2026-10-21 Implementation Ledger entry for the complete gate classification.

### 2026-10-21 — Failure-mode characterization follow-up

Added two tests to `backend/test/packet0-order-expiry-scope.test.mjs` verifying SQL read failures propagate and local-only guard ordering before `new Pool` and fixture INSERT. Tests: Packet 0 249/249 PASS, runnable Node subset 371 PASS / 1 SKIP / 0 FAIL, JavaScript parse and heuristic secret scan PASS. The canonical `bash scripts/verify-packet0.sh` still returns 2/BLOCKED because Node 24/npm 11, source npm lockfiles, Flutter SDK and real NearPill-owned Supabase app-role database/data-integrity acceptance remain missing. No production behavior or schema was changed.

### 21 October 2026 — Complete first-party source fingerprint

Packet 0's canonical checksum inventory is `docs/packet0-source-manifest-2026-10-21.sha256`.
Run `node scripts/verify-source-manifest.mjs` from the existing repository (also invoked
by `bash scripts/verify-packet0.sh`). Unlike `sha256sum -c`, this check rejects
**added/unlisted**, **missing**, and **modified** first-party files; it also refuses
symbolic links in tracked source and duplicate or unsafe manifest entries. Known
rolling ledger and Packet 0 execution logs, and generated/cache directories, are
excluded intentionally. A reviewed first-party code change requires a deliberate
manifest refresh and inspection of the change list, not removal or bypass of this gate.

This fingerprint is an **archive consistency control**, not an independently signed
provenance record and not evidence of live Supabase grants, RLS, PostgreSQL migration
integrity, data reconciliation, or production deployment acceptance.


### 21 October 2026 — Source packaging enforces the reviewed baseline

`bash scripts/package-source.sh <output.zip>` now runs **both** the source-artifact
secret scan and `node scripts/verify-source-manifest.mjs` before replacing an
existing archive. If a newly added, missing, symlinked or modified first-party
file is not accounted for in the reviewed manifest, packaging fails closed.
The previous output is not deleted on a failed check. This does **not** sign the
archive or validate its deployment origin. Regenerate/review the existing
manifest after every intentional first-party modification; do not suppress
unreviewed changes by disabling the manifest guard.


### 21 October 2026 — Atomic, verified source-archive replacement

The canonical `scripts/package-source.sh` now stages each ZIP in a private
subdirectory beside the requested output, checks the archive using
`unzip -tq`, then replaces the destination via a same-filesystem `mv` only
after the source secret scan, complete manifest and archive-integrity gates
pass. Failure while running `zip` or `unzip` leaves the previously published
ZIP unchanged and cleans up the staging directory. Outputs inside the source
tree are rejected so old and in-progress archives cannot be included in the
new archive. Negative/positive executable tests run with disposable fixture
archives and do not exercise database or payment operations. The source
manifest is an integrity baseline, not cryptographically signed provenance.
The supported-toolchain, Flutter and real NearPill Supabase staging acceptance
gates remain blocked.

### 21 October 2026 — Staged ZIP payload parity check

The existing `scripts/package-source.sh` continues to run the first-party secret
scanner and complete manifest verifier before packaging, and to stage/CRC-check
ZIPs before atomic replacement. It now **extracts the staged ZIP into its
private temporary directory**, runs the same canonical source-manifest verifier
on the extracted payload, and scans that payload for secrets before publishing.
This closes the gap where a source file could change after preflight or where a
packaging tool could add unexpected bytes while producing a CRC-valid archive.
Regression tests inject both an unlisted file and a modified listed file into a
staged, otherwise readable ZIP; both must leave the prior published artifact
untouched and remove the staging directory. This is source-archive parity
verification, **not** a Git attestation or Supabase RLS/data-integrity gate.


## 2026-10-21 — Generated artifact/source package scope parity (Packet 0)

The canonical first-party source manifest, the source-artifact secret scan, and the
existing atomic source packager now agree on generated caches (`node_modules`,
`.dart_tool`, `.gradle`, `.idea`, `.next`, `.turbo`, `.vercel`, `dist`,
`build`, `coverage`, and `.git`) and the three web browser-test paths
(`web/playwright-report`, `web/test-results`, `web/playwright/.auth`). These
are **not included** in the distributable source ZIP; real first-party source
outside the exclusions remains fully hashed and scanned. This is particularly
important after a Flutter/React build or Playwright run. A new checked-in source
file still invalidates the manifest. An unexpected symlink in reviewable source
still fails closed. The scanner is a heuristic source-artifact check, **not** a
secret-history or live deployment security audit.

New regression tests exercise built artifact directories and verify they are
not packaged, while secrets in normal `web/src` code remain rejected. The
pre-existing foundation test now asserts the generic nested exclusion list
rather than outdated literal `backend/node_modules/*` patterns. No API, auth,
order/payment, DB migration/RLS, React or Flutter runtime behavior was changed.
Local Node 22 tests do not replace supported Node 24/npm 11, Flutter, or
NearPill-owned Supabase app-role RLS, migration, contention and restore gates.

## 2026-10-21 — Deployment-source secret scan coverage characterization

Packet 0's existing heuristic source-secret scanner previously inspected common JS/TS/Dart/text extensions but did not inspect `.sql` migrations, `.conf` reverse-proxy files, Android Kotlin/Gradle `.kt`/`.kts`, or extensionless `Dockerfile`/`Containerfile` files. These are genuine first-party sources distributed in the NearPill archive. This gap could let a recognizable embedded key escape the local secret-pattern acceptance gate even though the complete SHA-256 manifest included the file.

The **same** scanner now includes `.sql`, `.conf`, `.kt`, `.kts`, `.toml`, `.ini`, `.tf`, `.tfvars` and the extensionless `Dockerfile`, `Containerfile`, `Makefile`, `.gitignore`, `.dockerignore`. A Packet 0 regression test deliberately injects a synthetic high-confidence token into six representative deployment/database/mobile paths and asserts scanner rejection without printing the token. The existing generated-directory exclusions remain intact; no production code, credential values, deployment or database permissions were modified.

This scan is heuristic and limited to the documented detectors. It does **not** prove that every secret is absent, that the Git history is clean, or that Supabase RLS, grants, connectivity and data integrity are correct. Actual Node 24/npm 11 clean installs, authentic npm lockfiles, Flutter, and the owner-approved NearPill Supabase app-role integration gates remain required for Packet 0 acceptance. Evidence is recorded in the updated master Implementation Ledger and this run's local verification transcript.

## 2026-10-21 — Supabase elevated-key source boundary (Packet 0)

The canonical `scripts/secret-scan.mjs` now rejects the new Supabase `sb_secret_` API key format and legacy JWT-formatted `service_role` keys in first-party text files, including SQL/deployment, backend, web and Flutter source. Elevated keys bypass RLS, so their presence in a source handoff must fail closed. Unlike elevated keys, Supabase `sb_publishable_` and legacy `anon` JWTs are public-role credentials and are not automatically rejected by these two detectors. Existing `.env`, signing-material and other secret detectors remain in force. The scanner reports only the finding type and file path, never the actual key/JWT. Focused negative fixtures use synthetic, locally constructed values; no Supabase credentials were obtained or used.

This is **heuristic artifact scanning**, not a Git-history/secret-management audit, and does not test RLS privileges or real database connections. Keep Packet 0 acceptance BLOCKED until the supported toolchain and explicitly approved NearPill Supabase staging verification gates pass.


## 2026-10-21 — npm registry credential source-artifact guard

Packet 0 secret scanning now rejects literal npm registry `_authToken`, `_auth` and `_password` assignments in any first-party `.npmrc`, including registry-scoped credentials whose literal values lack vendor-specific token prefixes. Environment-variable references `${NPM_TOKEN}` / `${NPM_PASSWORD?}` remain permitted, consistent with npm configuration documentation. Findings print classifications and paths rather than credential values; normal settings such as `engine-strict=true` remain accepted. This is a source-artifact/packaging guard, **not** a registry-token validity audit or a claim of production security. Production Hono authentication, Drizzle migrations, tenant RLS and business functionality are unchanged. Real Supabase tests, supported runtime and Flutter acceptance remain blocked.


## 2026-10-22 — npm lockfile credential source-artifact coverage

The canonical source scanner previously skipped `package-lock.json` entirely.
Reviewed npm lockfiles are distributable source, so this could omit embedded
high-confidence tokens or authenticated `resolved` tarball URLs. Packet 0 now
scans both `package-lock.json` and `npm-shrinkwrap.json` as first-party JSON,
and flags HTTP(S) URL userinfo in these npm lockfiles without logging tokens
or URLs. Tests confirm failure with synthetic credentials at root, backend and
web locations and allowance of a normal public registry URL. The new regression
was red before the scanner change and green afterward. This does not create
a lockfile, install dependencies, validate remote credentials or alter live
Supabase PostgreSQL. The genuine three source lockfiles, Node 24/npm 11, Flutter
and all real app-role PostgreSQL acceptance gates remain blocked.

### 2026-10-22 — Drizzle connection fallback and PostgreSQL URL source guard

Packet 0 found a hard-coded, credential-bearing local `postgresql:` URL in
`backend/drizzle.config.ts`. The Drizzle configuration now omits `dbCredentials`
when `DATABASE_URL` is not set, allowing offline schema generation without
silently supplying a database connection for DB-touching commands. Real
migration/push/connection commands still require an explicit owner-approved
connection; this is a verification/tooling fix, not a Supabase migration.

The canonical source scanner also rejects credential-bearing PostgreSQL URIs in
reviewed first-party text/config files, while permitting clear template/env
references. Only the path and finding category appear in diagnostics. The rule
is heuristic and does not prove credential validity, secret-history safety,
PostgreSQL TLS, grants or RLS. Both pre-change negative regression tests failed
and pass after the change. Full Packet 0 acceptance remains gated on supported
Node/npm and Flutter tooling, genuine lockfiles, and authorized NearPill-owned
Supabase staging data/security/restore tests, including NP-031.

## 2026-10-22 Packet 0 continuation — NP-031 user-row tenant characterization

The reviewed PostgreSQL migration sources still lack `ALTER TABLE users ENABLE/FORCE ROW LEVEL SECURITY`; this is the existing NP-031 acceptance blocker, **not fixed by this Packet 0 verification change**. The prior live app-role negative verifier checked customer orders but did not independently assert user-row privacy. An incorrectly permissive `users` policy could therefore have passed order-row checks even after the `users` migration gap was otherwise repaired.

The **existing** `assertCustomerOrderRlsNegatives` verifier now uses synthetic user A/B IDs to require own-profile row visibility and reject foreign-profile reads and no-op foreign-user updates for both customers. Each query uses the verified app-role pool, transaction-local `app.user_id`/role/capability, mandatory `ROLLBACK`, and connection-state reset checks; any anomalous row or query failure fails acceptance. No live users are selected or changed without the original approved-target preflight. Three new recording-pool regressions cover cross-user read leakage, vacuous all-deny user reads, and foreign-user update leakage; the successful connection cleanup test now covers twelve isolated transactions. This is a local characterization improvement, **not** evidence that live Supabase RLS is correct. Existing Hono identity/Drizzle SQL migrations and production code are unchanged.

Real staging validation remains NOT RUN/BLOCKED until an explicitly owner-approved NearPill Supabase project, non-owner/non-BYPASSRLS app role, tested reviewed migration repair for NP-031, and all other Packet 0 toolchain/data security prerequisites are available.

## 2026-10-22 Packet 0 continuation — NP-031 foreign-user DELETE characterization

The existing approved-target live app-role RLS verifier now attempts a foreign
`DELETE FROM users ... RETURNING id` for **each** of two distinct synthetic
customers, in addition to own-user reads, foreign-user reads and updates, and
existing order negatives. A returned deletion is an explicit failure. Every
attempt runs inside the same transaction-local actor context, `ROLLBACK`, and
connection-state inspection; a failed cleanup discards the connection. This
characterizes an important cascade-deletion privacy boundary but does **not**
change the PostgreSQL policies or validate their live behavior on Supabase.
The NP-031 `users` forced-RLS finding remains OPEN until a reviewed migration,
actual app-role tests, and the rest of the Packet 0 acceptance gates pass.

## 2026-10-22 Packet 0 continuation — NP-031 self-role privilege escalation characterization

The existing live RLS verifier checked private user-row visibility and foreign-user writes, but did **not** check whether a customer could update their **own** `users.role` to `admin`. The reviewed `users` schema permits `admin` as a role value. Isolation between rows is not sufficient evidence that an ordinary app-role session cannot make a self-service privileged-role change.

The single existing `assertCustomerOrderRlsNegatives` verifier now issues `UPDATE users SET role = 'admin' WHERE id = $1 RETURNING id` against **each of the two synthetic customers** in a separate transaction with transaction-local verified actor context. Success or malformed results fail the check. The verifier accepts only zero affected rows or an explicit SQLSTATE `42501` permission/RLS rejection; constraint, connectivity, or unrelated errors fail instead of being counted as denials. Every attempt is unconditionally rolled back, and the connection is reused only after transaction-local identity has cleared. Recording-pool tests cover a falsely permitted promotion, permission denial, and unrelated database errors. No real users are selected for these probes.

This is **characterization of the verification command**, not proof of application-role permissions or policy behavior on Supabase. NP-031 users FORCE RLS, least-privilege column grants, real app-role tenant negatives and other Packet 0 acceptance gates remain OPEN / NOT RUN until an explicitly approved NearPill-owned staging project and supported toolchain are available. No schema, runtime business logic or production database changed.

## 2026-10-22 Packet 0 continuation — forged privileged-user INSERT characterization

The existing least-privilege PostgreSQL verification now also probes `INSERT INTO users` with an `admin` role under each of two synthetic customer contexts. A unique `@example.test` email is generated per attempt, and each attempt runs inside the same mandatory rollback and connection-reset checks used for cross-customer reads, writes and self-role promotion. Only an explicit SQLSTATE `42501` users-table grant denial or row-level-security denial qualifies as a rejection; successful insertion, unexpected errors and ambiguous denials fail verification. The probe is authorized only behind the existing live-fixture target, project and role preflight. **It has not been run against real Supabase PostgreSQL.**

This characterization does not modify an RLS policy, migration, role grant or application logic. PostgreSQL identity sequence values are not transactionally rolled back if an unexpectedly permitted INSERT reaches identity generation; for that reason, the command must be run only on an explicitly approved synthetic staging/disposable test database. NP-031 remains **OPEN**, and local recording-pool tests alone do not prove user-row protection.

## 2026-10-22 Packet 0 continuation — explicit access-denial semantics for foreign-row writes

The canonical synthetic, rollback-only app-role verifier formerly treated an explicit
PostgreSQL permission denial (`42501`) for foreign-order or foreign-user `UPDATE`
/ `DELETE` as a failed negative test, although preventing the operation with
least-privilege table/column grants is a legitimate security boundary alongside
RLS row filtering. The existing verifier now accepts **only** zero affected rows
or an explicitly relevant SQLSTATE `42501` table/column/RLS denial for those
four foreign-row mutation probes. Unrelated permission errors, constraints,
connection errors, nonzero affected rows and malformed responses still fail.

The order `INSERT` negative remains deliberately **RLS-specific** (no relaxation
of its `WITH CHECK` probe); own-user and own-order SELECT positive requirements,
self-role/privileged-user creation negatives, mandatory rollback and pooled
connection-state reset remain unchanged. Local recording-pool regression tests
prove the verifier accepts explicit denial and rejects wrong-table/generic
errors, but **do not prove** real Supabase grants or tenant isolation. NP-031
(`users` FORCE RLS), real app-role acceptance, and all unsupported runtime,
Flutter, migration, stock contention and restore gates remain **OPEN/BLOCKED**.

## 2026-10-22 Packet 0 continuation — exact object scope for privilege-denial probes

The existing live tenant-negative verifier already checks customer self-role updates and synthetic privileged-user inserts. Its initial `42501` exception handling matched generic `permission denied` / `row-level security` text, which could mistake a privilege denial on an unrelated table or column for proof that `users.role` is protected. Two regression tests reproduced this false-positive before the correction. The existing strict relation/column-specific denial predicate now handles both role-escalation probes, accepting only relevant `users` or `role` grant denials or `users` RLS denials. Other SQLSTATEs and unrelated `42501` messages still fail closed. The probes retain transaction-local customer identity, unconditional rollback, post-rollback actor-context checks, and discard-on-unsafe-cleanup behavior.

This is a characterization-tooling change, **not** a PostgreSQL policy or application-auth fix. It has been tested using local recording pools only; an approved NearPill Supabase staging connection, a non-owner non-`BYPASSRLS` application role, live NP-031 `users` FORCE RLS/remediation, real tenant negatives, concurrency and restore evidence remain **NOT RUN/BLOCKED**. It creates no new backend or database authority and does not authorize live SQL or production cutover.

## 2026-10-22 Packet 0 continuation — order INSERT RLS denial object scope

The approved-target cross-customer order INSERT verifier previously treated any
SQLSTATE `42501` message mentioning row-level security as proof that the `orders`
WITH CHECK policy rejected a foreign-user order. An unrelated table's RLS error
could therefore mask a broken `orders` policy. The existing verifier now
requires the canonical PostgreSQL denial for the **orders** relation, accepting
quoted or unquoted relation names, and does not accept generic `42501`, missing
table grants, or unrelated-table RLS errors. A new recording-pool negative test
reproduced the false pass before the correction and passes after it, including
rollback and pooled-connection release assertions. This is verification-tooling
characterization only: it does **not** establish live Supabase policy enforcement.
The existing Hono backend, authentication, Drizzle migrations and RLS policies,
other database invariants, and client behavior remain unchanged. Packet 0 and
NP-031 remain blocked pending the supported toolchain and owner-approved staging
integration tests with a least-privilege application role.

## 2026-10-22 Packet 0 continuation — customer-to-partner privilege escalation characterization

The reviewed `users.role` CHECK constraint allows both `admin` and `partner` alongside `customer`. The existing NP-031 rollback-only live verifier had tested customer self-promotion and privileged-account creation only for `admin`, leaving the distinct `partner` role uncharacterized. The **existing** `backend/scripts/lib/verify-order-tenant-isolation.mjs` now probes both privileged values for each synthetic customer in separate transactions, using parameterized role values, unconditional ROLLBACK, post-rollback session-context checks, and connection discard on uncertain cleanup. An allowed UPDATE or INSERT for either value fails verification; only an object-specific SQLSTATE `42501` denial or the specified zero-row UPDATE result is accepted. The new partner regression tests fail against the old verifier and pass against the extended verifier.

**Scope:** This is Packet 0 test characterization, not a production authorization change. It does not alter the approved migrations, role grants, Hono authentication, Supabase provider or business logic. Real Supabase NP-031 `users` FORCE RLS/column grants/partner membership, app-role tenant negatives and transaction/restore gates remain **NOT RUN/BLOCKED**, and no live database connection or fixture write took place. Identity sequences may advance even on rollback; live execution remains strictly restricted to explicitly approved synthetic staging/disposable test targets by the existing guarded preflight.


## 2026-10-22 Packet 0 continuation — orders.user_id ownership-transfer negative test

The approved `orders_update` policy in the existing `0002_rls.sql` migration has a `WITH CHECK` owner predicate, but the live Packet 0 RLS verifier previously exercised foreign-order reads/writes and foreign-user `INSERT` without attempting to move an **owned** order to another user's account by updating `orders.user_id`. The canonical `verify-order-tenant-isolation.mjs` now attempts that transfer in both customer directions, using parameterized IDs and independent rollback-only transactions. Any successful UPDATE fails verification. Only zero affected rows or a relation-specific SQLSTATE `42501` `orders` row-policy denial are accepted; missing grants, unrelated-table policy failures, and connection/constraint errors are not accepted as evidence of the `orders` WITH CHECK guard. The two test cases cover unexpected successful ownership transfer and valid/invalid denial classification.

This is **verifier characterization**, not a production order/RLS migration or Supabase cutover. Recording-pool tests do not establish live authorization. Live execution requires the existing approved-target preflight, least-privilege actual NearPill-owned Supabase staging role, and complete transaction cleanup. NP-031, Node 24/npm 11 lockfiles, Flutter, real migration/stock/reconciliation/restore checks remain **NOT RUN/BLOCKED**.


## 2026-10-22 Packet 0 continuation — authoritative owned-order total negative probe

The existing RLS characterization now tries a **rollback-only** `UPDATE orders SET total_centavos = 1` on each customer's own synthetic order while the transaction-local actor is an ordinary `customer` without an application capability. A returned row is a verification failure. A denial is accepted only when PostgreSQL reports an `orders` table / `total_centavos` column-specific SQLSTATE `42501`, or the operation affects zero rows. Other errors cannot stand in for a security proof. Every attempt is rolled back and the same pooled connection is checked for leftover actor/capability state before reuse.

**Static policy concern NP-032:** `backend/migrations/postgres/0002_rls.sql` grants `nearpill_app` UPDATE privileges on the `orders` table and defines an `orders_update` policy based on row ownership rather than the changed column or a trusted mutation capability. `0006_order_inventory.sql` introduces authoritative `total_centavos`. The reviewed migration lineage contains no explicit ordinary-customer amount-column restriction. This is a **source-confirmed database-policy design concern**, not proof of a public API exploit or a successfully exercised staging database privilege. Supabase live policy/grant behavior remains **NOT RUN / BLOCKED**; no schema or production policy was altered in Packet 0. Remediation must preserve legitimate backend order use cases, reviewed Drizzle migration lineage and SQL authorization under a dedicated staging role, and belongs in a dependency-approved persistence/order packet.

Local recording-pool regression tests characterize fail-closed response interpretation, mandatory ROLLBACK and no actor-context leak. They cannot establish actual PostgreSQL RLS/column-grant correctness. No live customer or payment data was connected or modified.

## 2026-10-22 — Packet 0 owned-order lifecycle integrity negative (NP-033)

The reviewed `orders_update` RLS policy in `backend/migrations/postgres/0002_rls.sql` allows an ordinary application-role customer context to update an owned order by row ownership alone, while `0006_order_inventory.sql` permits `completed` as a status. The prior verifier checked a *foreign* order's no-op status UPDATE but did not attempt a customer's own `reserved` → `completed` transition. This is a source-confirmed column/state authorization concern, **not** proof that live Supabase is exploitable.

The existing approved-target-only, rollback-only `assertCustomerOrderRlsNegatives` now tries that schema-valid status mutation for both synthetic customers with no `app.capability`. It fails if any owned row is changed, and accepts only zero-row results or a relation/column-specific SQLSTATE `42501`; unrelated authorization, schema, constraint or network errors cannot appear as security passes. Every probe rolls back and verifies transaction-local actor/capability cleanup. Unit tests verify both a deliberately successful unauthorized update is rejected and unrelated database denials fail closed. No runtime order/domain logic, PostgreSQL migration, privilege grant or production database is changed.

Acceptance remains **NOT RUN / BLOCKED** for a real least-privilege NearPill Supabase staging role, and NP-031, NP-032 and NP-033 still need reviewed remediation and the same mandatory transaction/data/security gates.


## 2026-10-22 — Packet 0 pharmacy-order lifecycle RLS characterization (NP-034)

**Source-confirmed design concern:** `backend/migrations/postgres/0002_rls.sql` grants `nearpill_app` table UPDATE privileges, and `0004_identity_security.sql`'s `order_drugstores_update` policy allows UPDATE of rows belonging to the customer's own order without requiring the trusted `order_mutation` capability. `0006_order_inventory.sql` includes `completed` as a schema-valid child-order status. If the reviewed grants and policies are active, a direct ordinary customer SQL context could bypass the canonical order state machine for `order_drugstores.status`. This is not a verified public HTTP exploit and actual NearPill Supabase deployment/access is **unverified**.

**Scoped Packet 0 implementation:** The existing approved-target-only PostgreSQL verifier now inserts exactly one synthetic `order_drugstores` child for each synthetic order under the migration-role fixture transaction. For both ordinary customer contexts, the app-role verifier first requires exactly one visible own child row and zero foreign children, then attempts a rollback-only `UPDATE order_drugstores SET status='completed'`. A positive write fails; only an empty result or a relevant SQLSTATE `42501` authorization denial counts as rejection. Unrelated SQL/policy errors and missing fixtures fail closed, and transaction-local actor/capability state is inspected after rollback. Local recording-pool tests verify this logic but **do not demonstrate that PostgreSQL policies pass**. The existing cleanup deletes synthetic orders (and their FK-cascaded child records) and checks for cleanup errors.

The current migration lineage, Hono/backend authentication, Drizzle, RLS policies, inventory/orders/payment domain logic, React and Flutter are preserved. Review NP-034 with NP-031/NP-032/NP-033 in the approved persistence/order packet; use only a dedicated owner-authorized NearPill Supabase staging project, real non-owner/non-BYPASSRLS application role, an independently reviewed migration, contract parity, real grant/RLS negatives and rollback tests before acceptance. Packet 0 acceptance remains **BLOCKED** pending supported Node/npm/Flutter toolchains, three genuine lockfiles, and live data/security gates.


## 2026-10-22 — Packet 0 order-line INSERT authorization characterization (NP-035)

**Static source risk, not a confirmed Supabase exploit:** The existing `0002_rls.sql` grants INSERT on `order_items` to `nearpill_app`. The `order_items_insert` policy in `0004_identity_security.sql` tests parent-order ownership, but does not require `nearpill.current_capability() = 'order_mutation'`. Migration `0006_order_inventory.sql` adds authoritative `unit_price_centavos`, so a direct ordinary customer-context INSERT of a low-priced order item could bypass the checkout price snapshot if these exact source grants and policies were deployed. Server-owned Hono identity and checkout logic were not changed.

The existing approved-target-only, rollback-only `assertCustomerOrderRlsNegatives` now requires a valid synthetic medicine ID and a customer-visible owned `order_drugstores` fixture before attempting a parameterized `INSERT INTO order_items` with a 1-centavos price. For each customer, an accepted INSERT fails the verifier; only an `order_items`-specific SQLSTATE `42501` row-security policy denial is accepted. A missing/invalid fixture, unrelated-table denial, missing table grant, constraint error or connection failure never counts as a secure result. Each attempt is rolled back and the pooled connection must prove transaction-local context cleanup. Local recording-pool tests characterize verifier correctness only; actual NearPill Supabase RLS/data tests remain **NOT RUN/BLOCKED**.

NP-035 must be reviewed alongside NP-031–NP-034 in the appropriate dependency-approved persistence/order change, preserving the single Hono/Drizzle order use cases and using the actual non-owner/non-`BYPASSRLS` app role on an expressly authorized staging database. No production schema, grant, payment, customer, or inventory data is changed by Packet 0.


## 2026-10-22 — Packet 0 NP-035 probe final-schema compatibility correction

The NP-035 live RLS verifier referenced the legacy `order_items.price` column
although migration `backend/migrations/postgres/0006_order_inventory.sql` drops
that column in favor of `unit_price_centavos`. A fully migrated PostgreSQL
database would raise an undefined-column error (SQLSTATE 42703) before the
INSERT could exercise the intended `order_items_insert` security policy.
Recording-pool tests did not parse the SQL and missed this defect.

The existing `verify-order-tenant-isolation.mjs` now uses only
`order_drugstore_id`, `medicine_id`, `quantity`, and `unit_price_centavos`.
Its synthetic one-centavo unauthorized insertion, rollback-only transactions,
actor/capability reset, connection discard, and object-specific `42501`
requirements are preserved. A regression test reads migration 0006 and the
live verifier to reject references to the dropped `price` column.
**This is a verifier/schema-compatibility correction, not proof of live RLS
enforcement or a remediation of NP-035.** All authorized Supabase staging,
release, and data-integrity acceptance gates remain NOT RUN / BLOCKED.

## 2026-10-22 — Packet 0 NP-035 follow-through: existing order-line price immutability

The canonical migrations create `unit_price_centavos` in `0006_order_inventory.sql` and replace the prior `order_items_access` ALL policy with SELECT and INSERT policies in `0004_identity_security.sql`; there is no reviewed customer UPDATE policy for `order_items`. To characterize and protect that boundary against migration/grant drift, the existing rollback-only RLS verifier now checks each customer can see exactly one *actual* synthetic owned order line but cannot UPDATE that line's `unit_price_centavos` to 1. The fixture writer creates two legitimate 1000-centavo order lines using the migrator only after the owner-approved staging/local-test preflight, returning and validating their actual IDs. Deleting the synthetic parent orders via the existing checked cleanup cascades to these lines. The verifier rejects missing/foreign lines, allowed writes, malformed SQL responses, unrelated SQLSTATE errors and connections with uncleared actor state. It does not treat a recording-pool PASS as proof of a real Supabase policy.

This extends **NP-035 characterization only**. No new production migrations, grants, role changes, payment/order use cases, authentication system, or database were introduced. Full Packet 0 and real Supabase staging RLS acceptance remain **BLOCKED / NOT RUN** until authorized infrastructure and supported toolchains are available.

## 2026-10-22 — NP-035 existing order-line DELETE negative characterization

The reviewed `0004_identity_security.sql` migrations define `order_items_select` and `order_items_insert` policies but no customer DELETE policy. An existing checkout line must remain immutable to a customer database context; a future unintended broad policy/grant must not make direct deletion possible. Added a **rollback-only** `DELETE FROM order_items WHERE id = $1 RETURNING id` probe for each customer after verifying exactly one visible owned line and no foreign line. A returned deletion fails, and only a zero-row response or `order_items`-specific SQLSTATE `42501` permission/RLS denial is accepted; unrelated errors are failures. A broken or permissive policy cannot commit the attempted delete.

This change extends existing Packet 0 characterization, not application authorization or migration code. Mock/recording-pool test success is not evidence of a real NearPill Supabase policy passing. NP-031–NP-035 and real application-role staging negative tests remain OPEN/BLOCKED; no production SQL, credentials, or data were touched. The acceptance gate requires the supported Node/Flutter toolchain, genuine dependency locks, reviewed migration replay, app-role RLS, concurrency and restore evidence.

## 2026-10-22 — Packet 0 payment-row RLS characterization (not live acceptance)

The reviewed `0007_payment_reconciliation.sql` migration requires a trusted `payment_mutation` capability for customer-context payment UPDATEs. The existing Packet 0 RLS verifier did not exercise this boundary. The canonical test fixture now inserts two synthetic `pending` PHP payment rows (1,000 centavos), maps their returned IDs to the recorded parent orders, and requires each customer-context SELECT to return exactly the customer's own payment row. Two independent rollback-only customer probes attempt `payment_status='confirmed'` and `amount_centavos=1` without a payment capability. A successful write, hidden/missing owned row, visible foreign row, unexpected SQL/constraint error, malformed response, failed rollback, or leaked tenant context fails verification. Object-specific SQLSTATE `42501` access denials or zero-row updates count as blocked; unchanged parent-order cleanup cascades synthetic payments.

Local recording-pool regressions demonstrate verifier behavior **only**; no NearPill-owned Supabase connection, migration, customer data, money movement, or real PostgreSQL RLS/grant check was performed. Existing payment policies, backend/provider business rules, Hono auth, Drizzle, React, and Flutter remain unchanged. Real payment-status/amount authorization under the actual non-owner/non-BYPASSRLS app role remains **NOT RUN / BLOCKED**, alongside NP-031–NP-035 and the other Packet 0 environment/data gates.

## 2026-10-22 — Packet 0 payment INSERT policy characterization (not live acceptance)

The reviewed `0007_payment_reconciliation.sql` migration requires the backend-owned `payment_mutation` capability for a customer-context `payments_insert` (with a matching order owner). The previous Packet 0 verifier checked existing payment visibility and payment status/amount UPDATE denial, but did not check whether a customer could fabricate a new, one-centavo `confirmed` payment for their *own* existing order. The existing guarded, migrator-created pending payment fixtures establish legitimate owned payment visibility first. The verifier now additionally attempts `INSERT INTO payments (order_id,amount_centavos,payment_status,currency) VALUES (own_order,1,'confirmed','PHP')` under each synthetic customer's transaction-local context with no capability. Each insert is a rollback-only operation and **must** receive an explicit `payments`-specific SQLSTATE `42501` RLS `WITH CHECK` denial: a successful insert, missing table grant, unrelated-table RLS error, constraint failure, network failure, rollback error, or uncleared pooled identity fails the check. This is an executable negative-test contract, not evidence of the live database's permission behavior.

The change is confined to the existing security verifier and its recording-pool/cleanup regression tests; canonical Hono authentication, Drizzle migrations, PostgreSQL RLS policy definitions, order/payment provider logic, React and Flutter are unchanged. NP-031–NP-035 and actual payment authorization on an approved NearPill-owned Supabase database remain NOT RUN/BLOCKED. No production SQL, credentials, payments, or customer data were accessed.

## 2026-10-22 — Packet 0 payment DELETE authorization characterization

The reviewed payment reconciliation migration `0007_payment_reconciliation.sql` grants
`SELECT, INSERT, UPDATE` on `payments` to `nearpill_app`, but no `DELETE`; deleting
confirmed/pending payment records directly could erase provider reconciliation
history. Packet 0's existing RLS verifier already checks own/foreign payment
visibility, unauthorized status and amount UPDATEs, and fabricated confirmed
payment INSERTs. It now also attempts `DELETE FROM payments WHERE id = $1
RETURNING id` under each synthetic customer's transaction-local context with an
empty capability, **after** checking own-payment visibility. A returned row or
malformed result is a failed negative; a zero-row result or payments-specific
SQLSTATE `42501` permission denial counts as blocked, while unrelated SQL and
constraint errors cannot be accepted. The transaction always rolls back and
rechecks the pooled connection's actor/capability state before reuse.

This is new **local characterization coverage only**, not evidence of deployed
Supabase grants/RLS. No migration, payment-provider integration, business logic,
customer/payment data or actual database was changed. Node 24/npm 11, authentic
lockfiles, Flutter, owner-approved Supabase staging application-role tests,
NP-031–NP-035 and required migration/concurrency/restore checks remain
NOT RUN/BLOCKED until genuinely executed.

## 2026-10-22 — Packet 0 payment-to-order ownership immutability characterization

The post-`0007_payment_reconciliation.sql` payment authorization boundary must protect
not only `payment_status` and `amount_centavos`, but also the persisted
`payments.order_id` association. A customer's ability to read an existing
payment is **not** permission to transfer its recorded relationship to another
customer's valid order. The existing Packet 0 verifier now attempts
`UPDATE payments SET order_id = $2 WHERE id = $1 RETURNING id` with each
synthetic customer's own verified payment ID and the *other* synthetic customer's
valid order ID. Every attempt has a transaction-local customer actor, an empty
`payment_mutation` capability, unconditional rollback and connection-reset
verification. A returned UPDATE is a failure; only zero affected rows or a
payments/order_id-scoped SQLSTATE 42501 denial may count as blocked.
Unrelated 42501 errors, foreign-key/constraint failures, malformed results and
unsettled pooled state fail the check. The recording-pool regression tests cover
both directions and do **not** constitute live Supabase RLS evidence.

No production SQL, grants, RLS policies, payment-provider logic, order-state
machine, Hono authentication, Drizzle migrations, Flutter or React were altered.
NP-031–NP-035 and real payment ownership/grant negative tests are still
**NOT RUN/BLOCKED** on an expressly approved NearPill-owned staging Supabase
database with its actual least-privilege application role. Supported Node/Flutter
and backup, migration, reconciliation and inventory-concurrency gates are
also still required.

## 2026-10-22 — Packet 0 pharmacy-membership self-enrollment characterization

The reviewed `0002_rls.sql` defines `memberships_write` for `pharmacy_memberships` as admin/system-only, while granting broad table privileges to the application role. Memberships govern access to pharmacy-private order and inventory data, so an ordinary customer must not be able to grant themself a `manager` membership merely by knowing a pharmacy ID. The existing live RLS verifier did not test this boundary.

The *same* Packet 0 verifier now attempts `INSERT INTO pharmacy_memberships (user_id,drugstore_id,membership_role,is_active) VALUES (actor, synthetic_store, 'manager', 1)` for both synthetic customer identities. The store exists in the guarded fixture and the insert uses parameterized SQL, an empty capability, a transaction-local actor, unconditional rollback and a pooled-connection reset check. Only a matching SQLSTATE `42501` **pharmacy_memberships-specific** RLS denial is accepted; an unexpectedly successful insert, a table-grant denial, an unrelated policy/constraint error, and an unsafe connection all fail closed.

This is **offline security-test coverage**, not confirmation that a Supabase deployment enforces it. No new migration, table, role, auth module, business logic or production system was added. Real app-role tenant/permission negatives require an explicitly approved NearPill-owned staging Supabase database; NP-031–NP-035 and Packet 0 environment/concurrency/restore blockers remain open.


## 2026-10-22 — Packet 0 verified-pharmacy write-denial characterization

The canonical migrations (`0002_rls.sql` and `0005_catalog_discovery.sql`) define
admin/system-only pharmacy writes while allowing the approved, published public
pharmacy to be read by customers. The existing rollback-only verifier did not
check the corresponding customer-context `drugstores` UPDATE or DELETE boundary.
The existing live verifier now requires each synthetic customer to see the
same verified, published test pharmacy and independently attempts to set
`verification_status='rejected'` and to delete the pharmacy. Only zero changed
rows or a `drugstores`/`verification_status`-scoped SQLSTATE `42501` denial
counts as blocked; missing fixtures, foreign-table denials, FK/connection
errors, successful writes and leaked transaction context fail verification.
All SQL mutations remain rollback-only after the approved-target and actual
app-role preflight. This characterizes a source policy boundary rather than
establishing a live Supabase database PASS. No production schema or RLS policy
was modified. The current Packet 0 environment, NP-031–NP-035, inventory,
reconciliation and restore gates remain NOT RUN/BLOCKED where unavailable.


## 2026-10-22 — Packet 0 published OTC catalog authorization characterization

The reviewed `0002_rls.sql` restricts medicine catalog writes to admin/system
actors; `0005_catalog_discovery.sql` permits customer reads only for published
OTC medicines. The existing live RLS verifier checked pharmacy publication,
membership, orders and payments, but did not verify that an ordinary customer
SQL context cannot retire the globally published medicine.

The existing `assertCustomerOrderRlsNegatives` now requires exactly one
customer-visible synthetic `medicines` row before separately attempting a
parameterized `publication_status='retired'` UPDATE. Both synthetic customers
are tested, with their verified transaction-local identity and empty capability.
Only zero affected rows or a `medicines`/`publication_status`-specific SQLSTATE
`42501` denial are acceptable; missing fixtures, a successful mutation,
unrelated-table grants/RLS failures, invalid schema responses, and unsafe pool
cleanup fail closed. Each transaction is rolled back before connection reuse.
The local recording-pool regressions do **not** establish live PostgreSQL or
Supabase RLS behavior. No production SQL policy, schema, catalog publication
logic, authentication system, or client was changed. Packet 0 acceptance and
NP-031–NP-035 remain blocked pending the approved target and real tests.

## 2026-10-22 — Packet 0 OTC catalog INSERT/DELETE boundary characterization

The existing medicine publication test prevented customer `publication_status`
changes, but did not characterize two independent catalog-write paths: deleting
the published master medicine (which can cascade to inventory), and inserting a
new falsely published medicine. The existing rollback-only RLS verifier now
probes both synthetic customers using the reviewed `medicines` table schema.
DELETE accepts only zero affected rows or a medicine-scoped SQLSTATE `42501`
permission denial; INSERT accepts only a medicine-specific `WITH CHECK` RLS
denial, not missing grants or unrelated database errors. Synthetic visible
medicine fixtures and pool actor cleanup remain required. Local mocked tests
are **not** real Supabase app-role evidence. No catalog policies, database
schema, authentication or runtime flows were changed; Packet 0 acceptance
remains blocked pending approved staging and supported builds.

## 2026-10-22 — Packet 0 inventory-price authorization characterization

The authoritative pharmacy inventory price is persisted as integer
`inventory.price_centavos` (reviewed migration `0006_order_inventory.sql`),
independent of client-visible price formatting. The existing rollback-only
app-role RLS verifier covered `stock_on_hand` and `reserved_quantity` but did
not probe customer SQL attempts to change that authoritative price. The same
verifier now checks that both synthetic customer identities can see the
synthetic pharmacy's inventory fixture but cannot change `price_centavos`
from 1000 to schema-valid 1 centavo. The probe requires zero affected rows
or an inventory/price-column-specific SQLSTATE `42501` denial. Unauthorized
success, missing fixture, unrelated permission/constraint errors, failed
ROLLBACK or uncleared pooled actor state fail the verification.

This is local test coverage of the existing RLS/grants boundary, **not**
production RLS remediation or real Supabase authorization evidence. Packet 0
and NP-031–NP-035 remain NOT ACCEPTED/BLOCKED until real least-privilege
application-role tests, supported toolchain, Flutter, migration, concurrency,
reconciliation and restore gates succeed on the approved target.

## 2026-10-22 — Packet 0 published-inventory deletion boundary

The existing rollback-only application-role verifier already characterizes
unauthorized customer changes to `inventory.stock_on_hand`,
`reserved_quantity`, and `price_centavos`. It now additionally probes
`DELETE FROM inventory WHERE id = $1 RETURNING id` with each synthetic
customer identity, but only after proving that the published synthetic
inventory row exists and belongs to the expected pharmacy and medicine.
Deleting the row would remove an authoritative pharmacy catalog/availability
record. The assertion permits only zero returned/affected rows or a SQLSTATE
`42501` denial explicitly scoped to `inventory`; an unexpectedly deleted row,
an unrelated authorization or FK error, malformed response, failed ROLLBACK,
or leaked connection state fails closed. All attempts run in separate
rollback-only transactions and do not modify production data.

This expands **Packet 0 characterization**, not actual production policy,
backend inventory mutations, or Supabase provider configuration. The live
least-privilege `nearpill_app` result is **NOT RUN/BLOCKED** without an
owner-approved NearPill Supabase staging target; NP-031 through NP-035 and
the stock-concurrency/data-integrity acceptance gates remain unresolved.

## 2026-10-22 — Packet 0 inventory listing availability denial

The existing inventory authorization verifier checks stock, reservations, pricing
and deletion but did not probe the separate `inventory.availability` flag. The
reviewed 0001 schema permits `availability` values 0 and 1; customers must not
directly hide a public OTC inventory record by changing the flag to 0. The
existing verifier now independently attempts that UPDATE under each synthetic
customer identity after proving the known published fixture is visible. Only
zero affected rows or an inventory/availability-specific SQLSTATE 42501 denial
counts as blocked. Successful writes, unrelated SQL/constraint failures and
unsafe rollback or connection reuse fail verification. This is a rollback-only
local characterization guard; the actual Supabase application-role result
remains NOT RUN, and Packet 0 acceptance remains blocked. No production SQL
policy or inventory business logic has changed.


### 2026-10-22 — Packet 0 approved-evidence forgery characterization

The reviewed `0005_catalog_discovery.sql` migration establishes admin/system-only writes to `medicine_evidence` and `pharmacy_verifications`; approved medicine evidence and verified pharmacy evidence influence OTC publication trust. The existing synthetic-customer RLS verifier already requires the published medicine and pharmacy to be visible but did not test attempted forgery of their approval evidence. Added rollback-only `INSERT` probes into both *existing* verification surfaces, referencing those existing fixture IDs; they accept only relation-specific SQLSTATE `42501` RLS WITH CHECK denials. Permission/grant errors, constraint failures, successful writes, failed rollbacks, or leaked actor context cannot yield acceptance. Two regression tests first failed against the old verifier, then passed. These are tests of verification logic only, not execution or acceptance against Supabase. No production schema, grants, RLS policies or runtime business rules were changed. Full Packet 0 acceptance remains blocked on the supported toolchains/lockfiles, Flutter, and authorized NearPill Supabase staging security/data-integrity verification.

## 2026-10-22 Packet 0 continuation — audit-event attribution RLS negative

The reviewed `backend/migrations/postgres/0002_rls.sql` grants the ordinary backend application role an `audit_logs_insert` policy allowing `user_id = nearpill.current_actor_id()` (or trusted admin/system context). The existing live RLS characterization did not test cross-user attribution. The existing `assertCustomerOrderRlsNegatives` now attempts a parameterized, rollback-only `audit_logs` INSERT attributed to the *other* verified synthetic user, in both directions, under an ordinary customer actor with empty mutation capability. Successful INSERT, wrong-table 42501, missing grants, constraint failures, aborted rollback and context leakage are failures; only the `audit_logs`-specific RLS `WITH CHECK` denial is accepted. The synthetic action is `RLS_FOREIGN_ATTRIBUTION_PROBE`; the test never commits.

This verifies **test-harness completeness only** on recording pools until an explicitly authorized, non-owner/non-BYPASSRLS Supabase staging PostgreSQL app role runs the live test. The same source policy permits customer-attributed audit inserts generally; whether action names require further immutability/authoritative-event controls is a separate security design review, not a finding proven by this negative test. No production auth, business rules, migrations, RLS, Flutter, or React logic changed. Packet 0 remains NOT ACCEPTED until supported toolchains, source lockfiles, real database security, data-integrity and restore gates succeed.

## 2026-10-22 — Packet 0 audit-evidence immutability characterization

The reviewed `0002_rls.sql` permits ordinary customers to insert audit events
attributed to their own identity, while its `audit_logs` SELECT policy is
admin/system-only and it defines no customer UPDATE or DELETE policies. The
existing Packet 0 verifier checked cross-user audit INSERT attribution but not
post-insert tampering. The canonical verifier now creates a transaction-unique,
actor-attributed audit event inside each rollback-only probe, checks that the
INSERT actually affected one row, and attempts UPDATE and DELETE against the
unique event under each customer context. The INSERT intentionally does **not**
request `RETURNING` because that would require audit SELECT policy access.
Only zero affected rows or audit-log-scoped SQLSTATE 42501 denials count as a
protected mutation. Unexpected writes, absent fixtures, unrelated SQL errors,
failed rollback or leaked tenant context fail closed.

These are recording-pool regression tests of the verifier's guard, **not** live
Supabase RLS evidence or a production policy change. NP-031 through NP-035 and
Packet 0 acceptance remain blocked pending approved least-privilege staging
verification, the supported toolchain and required integrity/restore gates.

## 2026-10-22 — Packet 0 continuation: NP-036 partner price-column authority mismatch

**Active baseline:** The most recent uploaded in-place Packet 0 source archive, `NearPill_Packet0_Audit_Immutability_2026-10-22.zip` (SHA-256 `ad5c27a45e10301c91e8906c108d24ec02b2487c422893a15061f0f1bbcb63`), without Git HEAD/branch metadata. The source is the same Hono/Drizzle/PostgreSQL backend, React portal, and Flutter application; previous ZIPs are comparison evidence only.

**New static characterization / NP-036 (potential security boundary defect, live impact unverified):** The canonical HTTP route `PUT /admin/inventory/:id/price` is admin-authenticated, and the `inventory` table contains authoritative integer `price_centavos`. However `0002_rls.sql` grants table-wide `UPDATE` to `nearpill_app` and defines `inventory_write FOR ALL` with an active-pharmacy-membership branch in both `USING` and `WITH CHECK`. The later `0005_catalog_discovery.sql` and `0007_payment_reconciliation.sql` do not remove the price-column update privilege. Because RLS filters *rows*, not individual columns, the reviewed SQL alone does not establish the intended **admin-only price-column authority** for a direct SQL request made in an authenticated pharmacy-member actor context. This is a source-supported defense-in-depth concern, **not** proof that the published HTTP API permits partner price edits, or that a live Supabase instance is vulnerable. Confirm deployed roles/grants, exact effective policies and privilege ancestry before classifying live impact. No DB endpoint or secrets were used.

**Change:** Added `backend/test/packet0-inventory-price-rbac-gap.test.mjs` with two explicit **current-risk characterization tests**. They preserve evidence of the HTTP-admin/DB-member mismatch and state that a test PASS observes risky source, **not** successful authorization. The test is automatically discovered by `scripts/verify-packet0.sh`; no second verifier, schema history, production policy, authentication, business logic, Flutter or React implementation was created. No legacy code removed without parity proof.

**Required follow-up acceptance test (NOT RUN):** On an owner-approved disposable/restorable NearPill Supabase staging target, use the *actual non-owner/non-BYPASSRLS application role*, verified pharmacy membership and transaction-local actor context. Confirm a pharmacy member cannot update `inventory.price_centavos` (including another pharmacy), while legitimate stock operations and admin price updates retain parity. Confirm column privileges and effective policies under that role, rollback every negative probe, verify connection context cleanup and reconcile immutable order price snapshots. If the DB policy permits price changes, remediate using a reviewed privilege/policy design in the relevant later dependency packet, not an unreviewed Packet 0 production migration. Current test deliberately cannot count toward the live RLS security PASS.

**Local results:** `node --test backend/test/packet0-inventory-price-rbac-gap.test.mjs` → **2 PASS / 0 FAIL**; these are static source characterizations only. The complete Packet 0 runner remains acceptance-blocked by the pinned Node 24/npm 11 toolchain, missing root/backend/web npm lockfiles, unavailable Flutter SDK and approved real Supabase connection/security/data/restore gates. The 22 October local rerun evidence and full numbers are recorded in the master Implementation Ledger. **Rollback:** Restore this source-test/doc/manifest/ledger delta from the uploaded source archive; no deployed database rollback needed. **Next safe packet:** Packet 0 acceptance continuation only.

## 2026-10-22 — Packet 0 NP-036 active-pharmacy-member DB price negative

The preceding NP-036 source inspection found an authorization mismatch between
admin-only HTTP price mutation and active-member row-wide inventory UPDATE
rights in reviewed PostgreSQL migration `0002_rls.sql`. Source shape alone did
not establish which rights a deployed Supabase application role actually has.
The **existing** `verify-postgres-security.mjs` rollback-only app-role verifier
now provisions a third synthetic `partner` user with a recorded active manager
membership at the synthetic pharmacy, in the existing migration-role fixture
transaction (after the usual approved-target and app-role preflight). The
synthetic partner is distinct from the two cross-customer identities.

The new `assertPartnerInventoryPriceDenied` check in the existing
`verify-order-tenant-isolation.mjs` helper uses `app.user_id`, `app.role='partner'`
and an **empty transaction-local capability** under the actual app connection.
It first requires the matching active membership, published priced inventory
(1000 centavos), and a one-row update of the permitted `availability` field as
an *anti-vacuity positive control*. Then, in a **separate rolled-back
transaction**, it attempts to set `inventory.price_centavos` to 1. Only zero
returned/affected rows or an inventory/price-column-specific SQLSTATE `42501`
denial passes. An allowed price UPDATE, missing/mismatched fixture, absent
partner write authority, unrelated SQL failure or leaked/uncertain pooled
session fails closed. The partner membership and user are recorded for the
existing exact-ID fixture cleanup, which runs even on verification failure.

The offline recording-pool tests cover successful denial, successful illicit
price mutation, wrong/inactive membership, invalid price-denial reasons,
positive-control failure, rollback failure and actor-context leakage. **These
are tests of the verifier, not proof that the reviewed database is secure.**
With the currently reviewed broad 0002 inventory policy, the intended live
negative may actually fail until an appropriately reviewed authorization
remediation is applied; do not weaken the test to obtain a green result.
No production SQL, RLS/grants, database endpoint, backend authentication,
Drizzle migration, React, Flutter, money or business logic was changed.
Real Supabase app-role execution, migration/concurrency/reconciliation, restore,
Node 24/npm 11 genuine lockfile builds and Flutter gates remain NOT RUN/BLOCKED.


## 2026-10-22 — Superseded NP-036 legacy-price probe (historical, corrected below)

The initial real-role partner inventory price probe only tested the authoritative
`inventory.price_centavos`. Current reviewed PostgreSQL history retains a second
numeric `inventory.price` column: `0001_core.sql` creates it, and
`0006_order_inventory.sql` adds `price_centavos` without removing the earlier
column. Hono's admin-only price endpoint and backend-owned pricing authority
should not be undermined by granting a normal pharmacy member direct UPDATE
privileges to **either** pricing column. This is a current-source finding,
not a conclusion about the deployed Supabase project.

The existing `assertPartnerInventoryPriceDenied()` verifier now uses a real,
active synthetic member's allowed same-value availability UPDATE as positive
control, followed by **independent rollback-only transactions** for
`price_centavos = 1` and `price = '0.01'`. Each price mutation must return
zero rows or an inventory/price-column-specific SQLSTATE 42501. An affected
row, unrelated SQL error, malformed response, unsafe rollback, or leaked
actor/capability context fails closed. A revoked table UPDATE grant that
also removes permitted availability updates cannot masquerade as a PASS.
No new fixture, service, database, role, RLS policy or migration was created.

Two new recording-pool characterization cases verify the legacy-column
path, including successful unauthorized UPDATE, scoped denial, unrelated
SQLSTATE, rollback and safe connection-release behavior. Such mocked tests
**do not** prove actual app-role grants, SQL constraints, or Supabase tenant
isolation. The real approved-target verifier and all supported-toolchain,
migration/reconciliation, restore, and concurrency acceptance gates remain
NOT RUN/BLOCKED until available. Do not patch or bypass production privileges
as part of baseline Packet 0; remediation belongs in a reviewed, dependency-
safe security/persistence packet after staging evidence is obtained.

Official grant/column guidance: https://supabase.com/docs/guides/database/postgres/column-level-security


## 2026-10-22 — Packet 0 correction: migration 0006 drops `inventory.price`

**Source reconciliation:** The earlier statement that `0006_order_inventory.sql`
retained `inventory.price` is **incorrect**. The actual migration includes
`ALTER TABLE inventory DROP COLUMN IF EXISTS price;` after migrating values
to the authoritative `price_centavos`. The previous two-column negative probe
would issue an UPDATE against a nonexistent column and receive SQLSTATE 42703;
that is neither permission denial nor evidence of unsafe member price access.
The immediately preceding legacy-column characterization is historical and
**superseded**, not an acceptance requirement.

**Scoped verification fix:** The existing NP-036 verifier first checks the
`pg_catalog` inventory column layout under the ordinary app-role session.
If an undeleted legacy `price` column or malformed introspection appears, the
probe fails closed as migration/schema drift. It then requires genuine active
membership, a permitted rollback-only availability UPDATE, and an independent
rollback-only **`price_centavos`** UPDATE denial. Unexpected SQL errors,
unauthorized successful UPDATE, rollback or context cleanup failure remain FAIL.
No catalog, inventory, auth, Drizzle, migration SQL, RLS grant, API contract,
web or Flutter production code was changed. Database security is NOT PROVEN
by recording-pool tests; a real approved staging app-role test remains required.


## 2026-10-22 — Packet 0 NP-036 centavo schema-type preflight

The real-database NP-036 price-permission probe now verifies that the target
`public.inventory.price_centavos` is **exactly one live `BIGINT NOT NULL`
column** through `pg_catalog` before making either its allowed pharmacy
availability write or its rollback-only forbidden price write. This extends
the previous probe that only rejected the already-dropped `inventory.price`.
A missing, malformed, nullable or wrong-typed centavo column is **schema drift**
and cannot count as an RLS denial or a positive security result. The source
migration `0006_order_inventory.sql` is also characterized for its required
`BIGINT`, `SET NOT NULL`, nonnegative CHECK and legacy-column drop.

This check does not read live customer data, change the app/SQL migrations, or
establish that the deployed Supabase schema is safe. The authorized staging
application-role test, migration checksum/replay, real stock contention,
reconciliation and restore evidence remain **NOT RUN/BLOCKED**.

## 2026-10-22 — Packet 0 NP-036 live nonnegative-centavo constraint preflight

The existing rollback-only partner price-denial probe now also reads
`pg_catalog.pg_constraint` for the exact `public.inventory` relation. It
requires the canonical `inventory_price_centavos_nonnegative` to be a
**validated CHECK (`price_centavos >= 0`)**, not an absent, `NOT VALID`,
mis-typed, or weakened/renamed constraint. This complements the existing
legacy-column removal and `BIGINT NOT NULL` preflight: a renamed/weakening
constraint is **schema drift**, not evidence of secure RLS.

Recording-pool regression cases cover absent, malformed, unvalidated,
wrong-type, and weakened checks, requiring a rollback and refusal **before**
any price mutation. The source-authoritative migration history, RLS, backend
sessions, inventory domain, catalog and client functionality are unchanged.
The catalog check alone does **not** prove arbitrary financial constraints,
actual database-level member pricing authorization or release acceptance.
Real owner-approved Supabase application-role and data-integrity tests remain
**NOT RUN/BLOCKED**.


## 2026-10-22 Packet 0 / NP-036 admin price-update positive control

The previous rollback-only app-role verifier checked that a genuine pharmacy member cannot modify `inventory.price_centavos`, but did not prove that authorized admins retain the ability to update the same column. A blanket `UPDATE` revoke or overly restrictive RLS change could therefore pass the negative test and break the admin pricing contract.

The same canonical `verify-postgres-security.mjs` synthetic fixture now includes a distinct real `admin` account, checked under the ordinary non-bypass application role with transaction-local `app.role=admin`. The NP-036 probe applies an actual 1000-to-1001-centavo UPDATE, requires the changed value in `RETURNING`, and ALWAYS rolls the transaction back. The existing member price-write negative, availability positive control and schema preflight remain. The privileged synthetic record has a randomly generated non-Argon2, non-login password placeholder, not a reusable fixture credential. Fixture cleanup validates and removes the recorded synthetic admin ID. A real NearPill staging Supabase app-role connection is still mandatory; recording-pool tests do not establish live RLS or pricing parity.


## 2026-10-22 Packet 0 / NP-036 partner availability change parity

The pre-existing pharmacy-member positive control in `assertPartnerInventoryPriceDenied`
used `UPDATE inventory SET availability = availability`, which returned a row
without demonstrating an actual permitted availability change. A regression
could therefore pass this control while preventing partner availability edits.

The same in-place, rollback-only app-role verifier now requires the synthetic
member's source row to start with `availability = 1`, executes a parameterized
`UPDATE inventory SET availability = 0`, and checks the returned effective
value is `0` while `price_centavos` remains `1000`. Both the transaction and
its actor context must be rolled back and cleared. The unchanged partner
`price_centavos` denial and administrator 1000-to-1001-centavo positive control
continue to run in distinct transactions. Recording-pool tests reject a
non-effective update, a stale initially-unavailable fixture, and an update
that changes price.

This is Packet 0 characterization of the **existing** availability/price
security contract; it does not alter production SQL, grants, policies,
backend business logic, web, Flutter, or provider connections. Recording
transport cannot prove actual Supabase RLS or triggers. The dedicated,
owner-approved NearPill staging application-role, tooling, migration,
concurrency, reconciliation, and restore acceptance gates remain BLOCKED.

## 2026-10-22 — Packet 0 cross-pharmacy inventory tenant isolation

The source-backed NP-036 verifier had a positive test for a pharmacy member's **own** availability update and a negative test for that member's own admin-controlled price column, but did not demonstrate that an authorized member cannot edit another pharmacy's published inventory. The canonical live fixture writer now inserts a second independently identified published pharmacy and a second inventory row for the same synthetic OTC medicine, without adding a second partner membership. `assertPartnerCrossPharmacyInventoryDenied` confirms the active **first-pharmacy** membership, verifies the foreign public row is visible and priced (to avoid a vacuous zero-row negative), and performs separate rollback-only `availability` and `price_centavos` UPDATE attempts against the **other pharmacy**. Successful writes, unrelated SQL errors, leaked transaction-local identities, and failed rollbacks are never treated as security passes. The existing least-privilege staging preflight remains mandatory before fixtures are written.

The exact recorded synthetic inventory and pharmacy IDs are deleted by the original migration-role cleanup mechanism in dependency order, including after partial setup. The new `backend/test/packet0-partner-cross-pharmacy-inventory.test.mjs` is a **recording-pool contract**, not live RLS proof. No backend route, Drizzle adapter, RLS migration, authentication, React, Flutter, existing orders/payments or database connection was changed. Real Supabase tenant isolation and financial/stock acceptance remain **NOT RUN / BLOCKED** until an owner-authorized NearPill staging role and reproducible toolchains are available.

## 2026-10-22 — Packet 0 NP-037 partner inventory deletion boundary

Source review of `backend/migrations/postgres/0002_rls.sql` found that the
`inventory_write` policy uses `FOR ALL` with active pharmacy membership and
table-level privileges. Those rules may authorize pharmacy staff to DELETE
their *own* inventory listing, although approved partner actions are scoped to
delegated availability/stock updates. This is a source-backed **potential**
policy gap; effective staging role privileges and deployed policy behavior are
not yet verified. Deleting another pharmacy's publicly visible row must also
be denied.

The existing `assertPartnerCrossPharmacyInventoryDenied` function now probes
DELETE against a visible own-pharmacy inventory row and a published second
pharmacy's inventory in **separate ROLLBACK-only app-role transactions**. It
accepts only a zero-row result or inventory-specific SQLSTATE 42501; successful
DELETE, unrelated constraint/FK errors, hidden fixture rows, leaked transaction
context, and rollback failure all fail closed. Regressions use a recording pool
and are not live PostgreSQL or Supabase acceptance evidence. No production
SQL, role grants, RLS policy, backend logic, React or Flutter code was changed.


## 2026-10-22 — Packet 0 NP-038 partner inventory INSERT / price-creation contract

The reviewed `0002_rls.sql` grants the ordinary app role table-wide INSERT
and defines `inventory_write FOR ALL` with an active pharmacy membership
condition. Because the member's allowed listing-level availability change
does **not** delegate administrator-owned catalog pricing or publication,
a member's ability to create an inventory listing with arbitrary
`price_centavos` is a source-backed potential authorization gap (NP-038).
The deployed NearPill Supabase grants/RLS are not available; this is **not**
confirmation of effective production exposure.

The existing live `verify-postgres-security.mjs` now creates an extra published
synthetic medicine without an inventory listing, in the same fixture transaction.
`assertPartnerInventoryInsertDenied` first proves an authorized synthetic
administrator can insert its valid 1,000-centavo listing, in a transaction
that is rolled back. It then requires an explicit inventory-specific
`42501` RLS WITH CHECK denial when a genuinely affiliated pharmacy member
attempts to INSERT the same otherwise-valid listing at one centavo; no
unique-key, foreign-key, generic permission or SQL error qualifies as proof.
A successful member INSERT fails the verifier. This avoids vacuous negative
proof from conflicting existing inventory IDs and enforces administrator
positive-path parity. Cleanup removes only the recorded synthetic medicine ID
after any recorded inventory and before pharmacy/user deletion. All actor
contexts are transaction-local with rollback and connection discard on failure.

Recording-pool regression tests validate probe execution, false-positive
rejection, admin parity, fixture order, cleanup and rollback only. They
**do not** establish live Supabase RLS or provider connection acceptance.
The existing Hono auth, Drizzle migrations, inventory/order/payments business
logic, React and Flutter behavior are unchanged. Packet 0 remains blocked
until supported build tools, reviewed lockfiles and a dedicated owner-approved
NearPill Supabase staging app role permit real database security and data tests.

## 2026-10-22 — Packet 0 NP-038 cross-pharmacy INSERT denial characterization

The same source-backed `inventory_write FOR ALL` risk extends beyond creation
of partner-priced listings in the member's own pharmacy. Packet 0 now also
requires a pharmacy member to be denied a correctly priced INSERT into a
**different** published pharmacy. A distinct synthetic second pharmacy is
already present in the canonical RLS fixture. The verifier first confirms a
legitimate app-role administrator can insert the same published synthetic
medicine there at 1,000 centavos; that write rolls back. It then proves the
partner has **no active membership** in that pharmacy and can see its valid
published profile before attempting the otherwise-valid 1,000-centavo INSERT.
Only an inventory-specific PostgreSQL `42501` RLS new-row denial can satisfy
the negative. A successful cross-pharmacy insert, unrelated error, missing
pharmacy, accidental membership, nonfunctional admin control, failed rollback
or leaked transaction-local identity fails closed. All probes are rollback-only.

This adds **characterization**, not a permission migration. The active Hono,
Drizzle and RLS code remains unchanged; recording-pool regressions are not
proof of deployed Supabase grants or tenant isolation. Re-run on a separately
approved NearPill staging app role as part of the still-blocked Packet 0
acceptance, then review and fix confirmed SQL permissions in the canonical
migration lineage in a separately accepted dependency-safe packet.

## 2026-10-22 — Packet 0 NP-039 reservation-quantity authority characterization

The reviewed `0002_rls.sql` inventory `FOR ALL` policy admits an active
pharmacy member to the same row-update rule used by backend order reservation
transactions. Even when `0 <= reserved_quantity <= stock_on_hand` is enforced,
a member-directed `reserved_quantity` UPDATE could bypass the order-owned
reservation/movement ledger. The live outcome is **unverified**.

The existing `verify-postgres-security.mjs` now invokes
`assertPartnerReservedQuantityDenied` before the concurrent reservation probe.
The helper uses the existing approved staging app pool and transaction-local
actor context. An admin positive control requires a genuine synthetic admin
and an effective, schema-valid `3/0 -> 3/1` change; rollback occurs before the
active member's *identical* attempted mutation. Only zero rows or precisely
classified inventory/column SQLSTATE `42501` count as denial. Unrelated
constraints, missing grants on the admin path, incorrect membership, malformed
results, actor leakage, and failed rollback fail closed. All changes roll back.
Eight recording-pool and source-contract tests characterize this verifier;
they do **not** prove deployed RLS authorization. No schema, auth, inventory
operation or business logic was changed. Run with the *actual non-owner
NearPill Supabase staging app role* and independently authorized migrator
before acceptance. If the member update succeeds, repair it in a separately
reviewed canonical migration without invalidating authorized checkout
reservation/release, member availability, or pricing controls.


## 2026-10-22 — Packet 0 NP-040 active-reservation DELETE authorization characterization

**Source-backed potential defect (live exposure NOT verified):** Reviewed migration `backend/migrations/postgres/0006_order_inventory.sql` grants the ordinary `nearpill_app` role table-wide DELETE on `reservations`. Its `reservations_app FOR ALL` policy has a `USING` condition that permits active pharmacy members to access their pharmacy's inventory-linked reservations. In PostgreSQL, `WITH CHECK` constrains INSERT/UPDATE, **not DELETE**; a member who can view a reservation may therefore be able to DELETE it without the order-domain release transition and matching stock movement. This is a proposed staging test, **not proof of a deployed vulnerability**.

**Packet 0-only change:** Extend the single existing `backend/scripts/verify-postgres-security.mjs` verifier, using `assertPartnerReservationDeleteDenied` in the existing `verify-order-tenant-isolation.mjs` utility and new recording-pool regressions. Create a separate synthetic published medicine/inventory (`stock_on_hand=3`, `reserved_quantity=1`), a real active reservation on user B's matching order line, and a corresponding `reserve` stock movement. A valid synthetic administrator must delete this reservation successfully in a rolled-back transaction. An active pharmacy member must still read the same real reservation but **must not DELETE it** in a separate rolled-back transaction. Only a reservation-scoped SQLSTATE 42501 or zero deleted rows counts as denial; unrelated errors, missing fixtures, RLS invisible rows, ineffective admin operations and tenant context leaks fail closed. The separate inventory avoids altering the 100-way contention fixture.

**Cleanup/parity:** Order deletion cascades the synthetic reservation; the independent matching inventory deletion cascades its movement; both the reservation inventory and published medicine are removed through verified, recorded-ID-only migrator cleanup. No new project, adapter, production route, migration, RLS policy or payment operation is created. Existing Hono, Drizzle, Supabase hosting choice, JWT/session model, orders/inventory and React/Flutter are unchanged. The actual result of the negative test under a NearPill-owned Supabase non-owner app role remains **NOT RUN/BLOCKED** pending authorized staging and runtime gates. If the member DELETE is allowed, fix only through a separately reviewed canonical grant/RLS migration that preserves partner reservation reads and authorized server-owned order cancellation/release, then rerun true DB reconciliation/concurrency and tenant tests.


## 2026-10-22 — NP-041 customer-owned reservation DELETE authority (Packet 0)

**Source-backed risk, NOT verified on live Supabase:** `backend/migrations/postgres/0006_order_inventory.sql` gives `nearpill_app` DELETE on `reservations` and defines `reservations_app FOR ALL` with an ordinary customer's owned-order predicate in `USING`. The `WITH CHECK` clause only restricts INSERT/UPDATE, not DELETE. A database session with backend-verified customer context but no `order_mutation` capability could delete its own active reservation without the order service performing stock release, audit/outbox, or reservation reconciliation. This is an SQL design inference, not evidence of deployed exploitation.

**One-packet improvement:** `backend/scripts/lib/verify-order-tenant-isolation.mjs` adds `assertCustomerReservationDeleteDenied` and the existing `backend/scripts/verify-postgres-security.mjs` invokes it after NP-040, reusing the existing userA/userB, orders, reservation, stock and matching movement fixtures. The probe proves a legitimate customer owner can read the active reservation, requires DELETE denied (zero affected rows or reservations-scoped SQLSTATE 42501), checks a foreign customer cannot read/delete it, enforces transaction-local `app.user_id`/empty capability, and rolls back/discards connections on unsafe cleanup. The new `backend/test/packet0-customer-reservation-delete-negative.test.mjs` covers local recording-pool cases only. No production migrations, roles, server auth, business logic, or frontend/mobile behavior changes.

**Required acceptance:** An explicitly approved NearPill-owned Supabase PostgreSQL staging database, actual non-owner non-BYPASSRLS application role, and real committed synthetic order/reservation fixtures; test owner visibility and owner/foreign deletion rejection and legitimate trusted order release workflow. Fix confirmed privilege/policy exposure only through a separately reviewed migration after dependency gates. Local test mocks are not live RLS acceptance.


## 2026-10-23 — NP-042 effective-migration attribution correction

The 2026-10-22 NP-042 paragraph immediately below is retained as historical audit
reasoning but **is superseded**. It attributed a customer DELETE path to
`0002_rls.sql` alone. In the actual seven-file chronological migration history,
`0004_identity_security.sql` executes `DROP POLICY IF EXISTS
order_drugstores_access ON order_drugstores`, followed by SELECT/INSERT/UPDATE
policies only. Later reviewed migration files do not restore a DELETE or ALL
policy for `nearpill_app` on `order_drugstores`. PostgreSQL grants by themselves
are insufficient to allow DELETE when FORCE RLS is applied and no qualifying
DELETE policy remains. **NP-042 is therefore SOURCE-MITIGATED / LIVE UNVERIFIED**,
not a source-confirmed vulnerability. The separately identified NP-034 owner
UPDATE/status policy concern is not resolved by this correction.

The existing two-customer, rollback-only deletion-negative test is intentionally
retained as defense-in-depth. A source-order regression now checks the complete
canonical migration history and prevents future DELETE/ALL reintroduction.
Only tests against the actual approved NearPill Supabase non-bypass app role,
with real migration history and grants, can prove staging behavior. No production
SQL or live database was changed for this Packet 0 audit correction.

## 2026-10-22 — NP-042 customer-owned pharmacy-order child DELETE characterization (Packet 0)

**Source-backed risk, live Supabase result NOT RUN:** `backend/migrations/postgres/0002_rls.sql`
uses `order_drugstores_access FOR ALL` with a customer-owned order predicate in `USING`
and grants the ordinary application role broad table privileges. A customer-context SQL
`DELETE FROM order_drugstores` could remove a customer-visible pharmacy order child,
possibly cascading order-item snapshots (the existing foreign key uses `ON DELETE CASCADE`),
without the backend-owned order lifecycle or related inventory/audit transitions.
`WITH CHECK` does not constrain DELETE. The risk is inferred from SQL; it is not a
confirmed deployment exploit.

**Packet 0-only work:** Added a rollback-only owned-child DELETE negative to the already
running `assertCustomerOrderRlsNegatives`. The check reuses both users' visible committed
pharmacy-order rows, requires zero affected rows or an `order_drugstores`-scoped PostgreSQL
SQLSTATE `42501`, rejects unrelated SQL/constraint errors, and fails if the DELETE returns
any row. Extended the existing recording-pool regression and cleanup tests to prove
both owner probes run under transaction-local customer actor and that rollback is verified.
No new module, migration, fixture, application code, Supabase project or auth path exists.

**Acceptance still blocked:** Run the existing verifier on explicitly authorized NearPill
Supabase staging with a real non-owner, non-`BYPASSRLS` application role, actual migration
lineage and separate migrator. If the owned-child DELETE succeeds, design a reviewed
canonical grant/policy amendment preserving legitimate trusted order mutation and the
customer's read access. Validate real checkout/stock/order parity, tenant negatives and
backup/restore before accepting Packet 0. Local recording-pool tests are not RLS evidence.

## 2026-10-23 — Packet 0 effective policy lineage across four critical tables

The previous NP-042 attribution was corrected after reviewing the **ordered**
PostgreSQL migrations rather than treating `0002_rls.sql` as the effective
schema. The existing migration source inventory test now replays the literal
CREATE/DROP policy headers for `order_drugstores`, `order_items`, `inventory`,
and `reservations` in canonical source order. It verifies that `0004` retires
the former broad order-child policies (there are no reviewed app-role DELETE
policies on those two tables), while `inventory_write` and
`reservations_app` remain explicit `FOR ALL` policies in `0002` and `0006`
respectively. The test also rejects unexpected ALTER, unsupported policy
roles/suffixes, duplicate active names, and a later reintroduced DELETE.

This limited static replay is **not** a general SQL parser or a live policy
introspection. It does not evaluate `USING`/`WITH CHECK`, `DO`-generated
policies, grants, role inheritance, bypass/ownership, or the actual applied
Supabase migration journal. These remain mandatory real PostgreSQL acceptance
gates under an expressly authorized NearPill staging application role.
No production policies, migrations, backend auth, Drizzle, React, Flutter, or
business logic were modified.

## 2026-10-23 — Packet 0 policy-lineage SQL lexical regression

The previous four-table source-lineage helper read only leading policy DDL on
individual lines. This could misread a line-commented policy as active, miss
additional policy DDL after a semicolon on the same line, or mishandle a
semicolon within a predicate. The existing test-local helper now splits SQL
statements with comment, single/double-quote, nested block-comment, and dollar-
quote awareness. It replays literal CREATE/DROP statements in file and statement
order, including multiline SQL. Regression cases cover commented-out policies,
DO $$ procedural literals, same-line create/drop/recreate, predicates with quoted
semicolons, and malformed unterminated comments. A source-only test therefore
cannot silently produce an effective-policy verdict from those lexer mistakes.

The four reviewed table conclusions are unchanged: broad `FOR ALL` policies
remain for inventory and reservations; the earlier broad order-child policies
are retired by `0004`. This **does not verify** dynamically executed SQL, grants,
policy expressions, role inheritance, applied migration checksums, or actual RLS
under the NearPill-owned staging app role. The existing static verifier and live
security acceptance gates remain separate. No SQL or production code changed.

## 2026-10-23 — Packet 0 effective RLS enablement/FORCE source-order guard

The reviewed SQL policy-lineage check identified an additional **false-positive
acceptance risk**: a later migration could leave policy definitions in place
while executing `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` or `ALTER TABLE ...
NO FORCE ROW LEVEL SECURITY`. Earlier source-level CREATE POLICY statements
would still appear valid, but PostgreSQL could ignore policies or allow table
owners to bypass them. The existing `packet0-migration-source-inventory.test.mjs`
now replays **literal** ENABLE, DISABLE, FORCE and NO FORCE commands across the
seven canonical migration files, using the same comment/dollar-quote-aware
statement splitter as the policy audit. It requires final ENABLE **and** FORCE
for `inventory`, `reservations`, `order_drugstores` and `order_items`.

Regressions exercise later weakening, explicit restoration, same-line/multiline
DDL, commented and procedural literals, unsupported RLS syntax and quoted
identifiers. This remains a **source characterization**, not an effective role,
real `pg_class.relrowsecurity`/`relforcerowsecurity`, or granted-privilege
verification. Dynamically executed SQL, other tables, migration deployment
state, database ownership and BYPASSRLS require independently authenticated,
owner-approved NearPill Supabase staging acceptance. No production migration,
role, policy, user data, auth, order flow or client behavior was changed.

## 2026-10-23 — Packet 0 protected-table identity/source-lineage guard

A final `ENABLE/FORCE ROW LEVEL SECURITY` result computed from literal migration
statements can be falsely trusted if a later migration drops a protected table
or moves it from its expected `public` schema/name. The existing source-only
policy-lineage test now clears prior posture after a literal `DROP TABLE` of
`inventory`, `reservations`, `order_drugstores` or `order_items` (including
`IF EXISTS`/schema-qualified forms); a replacement must explicitly enable
and force RLS again. `ALTER TABLE ... RENAME TO` and `... SET SCHEMA` on those
protected relations fail closed pending manual review. Regressions also reject
quoted target DROP syntax and distinguish executable statements from comments
and procedural strings.

The seven reviewed migrations retain the same effective source-level RLS
posture, and no production SQL or application code was modified. This limited
literal scanner does not interpret dynamic SQL, prove that the tables exist
on a deployed database, identify inherited privileges, or replace actual
`pg_class`, grant, row-security and cross-tenant negative tests under the
approved NearPill-owned Supabase staging application role. All those live
checks remain NOT RUN/BLOCKED until the required environment is available.


## 2026-10-23 continuation — policy inventory respects protected table identity

**Source-backed audit gap:** The canonical `packet0-migration-source-inventory` test already reset `ENABLE` and `FORCE` flags when a later `DROP TABLE` destroyed a protected relation, but its *separate* effective-policy replay retained `CREATE POLICY` records from that removed relation. A subsequent same-name `CREATE TABLE` and `ENABLE/FORCE ROW LEVEL SECURITY` could therefore be mischaracterized as retaining authorization policies that PostgreSQL actually dropped with the old relation. The reviewed seven migrations have not been altered, and this describes a **test-model defect**, not a confirmed migration or live Supabase fault.

**Packet 0 test-only repair:** Both replayers now share one strict literal DROP TABLE detector; the policy inventory clears policies when the inspected relation is dropped, and only new policy statements on a recreated table count. Regression tests cover removal, re-creation without policy resurrection, explicit policy re-creation, multiple DROP targets, misleading comments, and refusal of unfamiliar quoted DROP syntax. No backend, auth, schema, role, migration, Flutter or web production behavior changed. Source-level characterization is distinct from approved staging application-role RLS, migration journal, contention and restore acceptance.


## 2026-10-23 continuation — shared executable-SQL scanner for live RLS policy preflight

**Confirmed local verification defect:** `backend/scripts/lib/verify-live-fixture-connection.mjs` previously derived its reviewed *live* policy inventory with a global `CREATE/DROP POLICY` regular expression over entire migration source files. That expression could count comment-only policy text or quoted/procedural `DO $$` statements as literal DDL, or miss unsupported policy syntax. The more recent Packet 0 migration-source characterization already had an SQL statement scanner, but the preflight did not use it. No live Supabase policy defect is inferred from this source-parser issue.

**In-place Packet 0 correction:** Move the single existing `literalSqlStatements()` scanner into the canonical reviewed-migration-source helper, import it in the existing source-lineage tests and live fixture preflight, and apply strict top-level literal CREATE/DROP POLICY matching to the preflight inventory. Known dynamic migrator/identity policy loops remain separately documented and checked; the seven reviewed migration files and expected policy inventory are unchanged. Add local regressions for comments, quoted statements, `DO` bodies, and unsupported top-level policy DDL. The verifier remains read-only until the explicit approved-target preflight succeeds; no application path or SQL migration was changed.

**Boundary:** Source parse and recording-pool tests are not proof of applied PostgreSQL RLS predicates, table/column grants, tenant-denial behavior or restored data integrity. All staging Supabase app-role, migration replay, contention, reconciliation, backup/restore and supported Node/Flutter gates remain blocked until the actual approved test environment is available.

### 2026-10-23 — Live policy inventory follows DROP TABLE relation identity

The source migration-policy characterization and the fixture-writing live preflight
now share the same top-level DROP TABLE target recognizer in the existing
`backend/scripts/lib/reviewed-migration-sources.mjs`. Before this change, the
live preflight replayed CREATE/DROP POLICY but retained obsolete policies after
a later DROP TABLE. A newly created relation with the same name cannot inherit
its dropped predecessor's policy evidence. The preflight now clears all literal
policies for dropped relations, handles reviewed multi-table drops, and rejects
unsupported quoted/schema-qualified DROP syntax without treating comments or
procedural SQL as executable top-level statements. Characterization is
source-only and does not establish actual Supabase grants or RLS enforcement.

The earlier dynamic migrator policy source checks are retained. The actual
least-privilege app-role RLS tests, migration replay and restore drill remain
mandatory before Packet 0 acceptance. No production SQL, domain, or client
implementation changed.

## 2026-10-23 — Dynamic RLS policy lifecycle in migration order

Packet 0 previously replayed literal `CREATE/DROP POLICY` and `DROP TABLE` statements in order but **added both reviewed `DO/FOREACH`-generated policy groups only after the entire migration sequence**. A later reviewed migration dropping `migrator_all` or dropping/recreating an identity table would therefore cause the preflight's expected policy inventory to revive policies that PostgreSQL had actually removed.

The existing `verify-live-fixture-connection.mjs` now replays literal policy changes and the **two specifically reviewed dynamic policy loops at their actual statement positions**. The loop's protected table list and expected dynamic `EXECUTE format('CREATE POLICY ...')` declarations must match the approved migrations, or the preflight refuses verification. Reused the shared SQL statement scanner; no new database source, migration, policy, role or authorization path was introduced.

Two added regression scenarios check a later `DROP POLICY migrator_all ON inventory` and a later drop/recreation of `auth_sessions` with a different new policy. Both must omit stale dynamically created policies. This is **source-based preflight correctness only**. It cannot certify the actual Supabase PostgreSQL grants, RLS predicates, role attributes, migration journal, tenant isolation or transactional inventory behavior; all live acceptance gates remain blocked until an approved NearPill staging project and supported runtime are available.

## 2026-10-23 — Dynamic-policy target array is fully validated

Packet 0's live read-only Supabase policy preflight previously extracted only
`'lowercase_name'` matches from the reviewed `DO/FOREACH` migration array.
A syntactically valid extra SQL string such as `'shadow_table_123'` could be
silently **omitted** from that parsed inventory because the matcher excluded
digits. Unexpected casts or NULLs could likewise be ignored instead of causing
a source-level verification failure.

The same existing `reviewedRlsPolicyInventoryFromSources()` now splits the
literal array into **every** comma-delimited member, validates each complete
quoted identifier (letters, digits and underscore after the first character),
and compares the complete ordered sequence with the two reviewed policy loops.
The new regression inserts extra/malformed tokens into both canonical loops:
`0002_rls.sql` and `0004_identity_security.sql`. Before the fix, an added
`'shadow_table_123'` was accepted; afterward every injected token is rejected.
The seven real migration sources and production policy behavior are unchanged.

This is a characterization/preflight safety check only. It cannot establish
that a live NearPill Supabase project actually applied the reviewed migrations
or enforces role, RLS, and tenant restrictions. The genuine app-role database
negatives, Node/Flutter builds, concurrency and restore gates remain blocked
pending the supported environment and authorized Supabase staging project.


## 2026-10-23 — Reviewed dynamic RLS loops reject unapproved EXECUTE operations

A source-level gap remained in the existing `verify-live-fixture-connection.mjs`
expected-policy model: it validated the reviewed policy target array and matched
familiar `CREATE POLICY ... FOR ALL` fragments, but did not inventory **all**
executable `EXECUTE` commands in those `DO/FOREACH` loops. An additional dynamic
`CREATE POLICY ... FOR DELETE` or a standalone dynamic `DROP POLICY` could
therefore be omitted from the expected policy set. A modification to the
predicate text of an otherwise familiar dynamically generated policy could
also pass the old source check. Both failure cases were reproduced by two
new tests before the preflight was corrected.

The existing preflight now requires the complete ordered set of reviewed
`EXECUTE format(...)` SQL templates and rejects extra executable statements,
including non-format `EXECUTE`. This is a fail-closed *source characterization*
for the two existing loops in `0002_rls.sql` and `0004_identity_security.sql`,
not a general-purpose PL/pgSQL parser. No migration SQL or backend business
logic is changed. Even perfect source-template matching cannot prove the
actual Supabase role grants, policy predicates, tenant isolation, migration
journal, or data integrity. Those remain unrun acceptance gates.

## 2026-10-23 — Reviewed dynamic RLS loops reject procedural side effects

The previous Packet 0 live preflight verified the approved count and exact
contents of each `EXECUTE format(...)` in the two canonical `DO/FOREACH` RLS
loops. That check still accepted additional **non-EXECUTE** procedural commands
within the same loop, such as `PERFORM set_config(...)`, a static `DELETE`, or
`CALL`. A new regression first demonstrated the false acceptance (56 passed,
1 failed in the focused file before the fix).

The existing preflight now validates the complete, tightly scoped structure of
each reviewed loop: declared iterator, ordered target array, loop body, and
exactly its 2/6 reviewed `EXECUTE format(...)` statements. Extra procedural
commands fail closed while the existing canonical migration source passes.
The loop matcher is intentionally *not* a general PL/pgSQL interpreter and
requires explicit review if those two migration bodies legitimately change.
This is a test/preflight correction only; the seven SQL migrations, API auth,
Drizzle, RLS policy definitions, order/inventory/payment rules and clients are
unchanged. Real Supabase role/RLS enforcement, supported builds, 100-way stock
contention, reconciliation and restore acceptance are still NOT RUN/BLOCKED.


## 2026-10-23 — Column-level grants included in live privilege preflight

The Packet 0 read-only live preflight previously examined table-level ACLs (`pg_class.relacl` and `has_table_privilege`) but not column-specific grants (`pg_attribute.attacl`). A Supabase `anon`/`authenticated` role could receive private-column SELECT/INSERT/UPDATE/REFERENCES authority without a matching table-level grant, leaving the earlier preflight unable to identify that independent boundary. A migration journal could likewise expose an individual column to the ordinary app role. This is a *source-proven verifier omission*, **not** a confirmed deployed NearPill vulnerability.

The existing `TABLE_PROBE_SQL` now explicitly checks effective column access for Supabase client roles with `has_any_column_privilege`, grants reachable only by `SET ROLE` through each column ACL, PUBLIC column ACLs, and the application role's column access to the migrator-owned journal. Each result must be exactly false for the relevant protected tables; unknown/null results fail closed before fixture writes. The existing table-level ACL, schema, role, migration-checksum and RLS tests are preserved. A new recording-pool regression first failed, then passed after correction. This is **not** live SQL execution evidence: actual role membership/grants and Supabase security still require an approved staging connection, along with Node 24/npm 11, authentic lockfiles, Flutter and data-integrity/restore gates. No SQL migration, application functionality or Supabase resource changed.

## 2026-10-23 — Internal NearPill schema privileges included in live RLS preflight

The reviewed PostgreSQL history creates the `nearpill` schema for session/actor
context helpers and `nearpill_extensions` for `cube`/`earthdistance` extensions.
The existing Packet 0 read-only database preflight checked `public` schema
CREATE grants, but did **not** inspect creation, visibility, or owner/role
escalation on these two internal schemas. That is a verifiable coverage gap,
not proof that the actual Supabase staging instance has unsafe privileges.

The existing preflight now queries `pg_namespace`, `has_schema_privilege`,
`pg_has_role(..., 'SET')`, and effective schema ACLs for these exact two
schemas. It refuses missing/duplicate schemas, app-role ownership or creation
(including SET-ROLE-reachable grants), and Supabase `anon`/`authenticated` or
PUBLIC USAGE/CREATE grants. The query runs before migrator journal reads and
before any synthetic fixture writes. Recording-pool regressions establish
that every explicitly unsafe or unknown flag fails closed, and that the
queries are read-only. The tests were red before the check was added.

No existing Hono authentication, Drizzle migration SQL, RLS policy, pricing,
order/payment logic, React portal or Flutter client was changed. Real staging
privileges, function EXECUTE grants, tenant negative tests, supported
builds, migration replay, concurrency, reconciliation and restore remain
independent NOT RUN/BLOCKED acceptance requirements.

## 2026-10-23 — Packet 0 internal helper-function EXECUTE boundary (read-only preflight)

**Source audit:** The seven canonical PostgreSQL migrations define four helper
functions inside `nearpill`: `current_actor_id()`, `current_actor_role()`,
`current_capability()`, and `touch_updated_at()`. The existing live preflight
checked the internal schemas' ownership/CREATE/USAGE permissions but did not
enumerate function EXECUTE grants, definer execution, overloads, or helper
search paths. PostgreSQL grants EXECUTE on newly created functions to PUBLIC by
default unless a reviewed migration revokes it; the current migration files
have no explicit helper-function EXECUTE revocation. This is a confirmed
**source configuration gap**, not a verified Supabase exploit: current private
schema USAGE grants are a separate barrier.

**Packet 0-only implementation:** The existing read-only preflight now queries
`pg_proc`, `pg_namespace`, role membership, and effective/explicit EXECUTE
privileges for the exact four reviewed routines. It refuses missing/extra or
overloaded routines, wrong return types, SECURITY DEFINER, unsafe ownership,
search_path drift, PUBLIC or Supabase Data API EXECUTE grants (including SET
ROLE-reachable grants), and an application role unable to execute the three
RLS actor/capability helpers. Every query occurs **before** migrator journal
reads and **before any synthetic fixture writes**. Recording-pool regressions
exercise positive metadata and fail-closed cases; they do **not** demonstrate
live PostgreSQL security. The current migrations are untouched, so the first
real staging check may identify the expected default PUBLIC EXECUTE grant and
must remain FAIL/BLOCKED until a separately reviewed in-place privilege
migration and real tenant/authentication parity tests succeed.

**Preserved:** Hono backend authentication, Drizzle and its migration history,
RLS policies, order/inventory/payment logic, React and Flutter. No parallel
systems, production SQL, credentials, data, or legacy paths changed.

## 2026-10-23 — Ordinary app-role SET ROLE CREATE boundary (read-only preflight)

Packet 0's public-schema CREATE probe previously checked the application
login's inherited/current grants and schema-owner membership, but missed a
non-inherited CREATE grant accessible by `SET ROLE` into a third-party role.
The existing read-only probe now examines the public schema ACL for any CREATE
grant whose grantee is reachable by `pg_has_role(current_user, grantee, 'SET')`.
An exposed path refuses fixture writes before the migration-journal read.
Two recording-pool regression tests cover the SQL predicate and fail-closed
reaction; the first test failed against the prior source, then passed after
remediation. This does **not** prove real Supabase grants or tenant isolation.
All production migration, Hono auth, Drizzle, RLS, order/inventory, React and
Flutter sources remain unchanged. Roll back by restoring the verifier and
its tests and this characterization document from the preceding ZIP and
reconciling their SHA-256 manifest entries.

## 2026-10-23 — Migration-journal privileges via non-inherited SET ROLE

The read-only Packet 0 staging preflight formerly checked the ordinary
application role's currently effective table and column privileges on
`public.nearpill_schema_migrations`, but not a non-inherited grant it could
reach with PostgreSQL `SET ROLE`. That omission could incorrectly classify a
migration-journal access path as absent without testing the actual role graph.
The existing `TABLE_PROBE_SQL` now inventories both table and column ACL
privileges that `nearpill_app` could obtain by assuming a grantee role. The
migration-journal gate requires both booleans to be exactly false; unknown
results and unexpected grants fail closed before any migrator journal read or
fixture-writing verification. Regression tests cover SQL probe presence and
negative table/column cases, including null or missing metadata. They use a
recording pool, **not** a live NearPill Supabase role. No application behavior,
reviewed migration or live permission was changed. Supported Node/npm, actual
lockfiles, Flutter, live RLS and data-integrity gates remain blocked pending
an approved environment. Rollback: revert the preflight and test edits, this
paragraph, and regenerate the three first-party source manifest hashes.


## 2026-10-23 — Explicit default grants across reviewed internal schemas

**Source-backed gap:** The existing read-only PostgreSQL security preflight
examined global and `public`-schema `pg_default_acl` entries but excluded
entries specific to the `nearpill` and `nearpill_extensions` schemas. An
explicit default EXECUTE grant scoped to either internal schema could expose
newly created helper functions to PUBLIC or the Supabase `anon`/`authenticated`
roles even when all currently reviewed routines pass their individual ACL
checks. This is a coverage gap, **not** evidence of an unsafe live Supabase
grant; PostgreSQL's implicit function-EXECUTE defaults remain a separate
review and are not falsely marked as verified.

**Packet 0-only correction:** The same read-only default-ACL catalog query now
includes `nearpill` and `nearpill_extensions` alongside the global and
`public` scopes. Explicit PUBLIC/Supabase-client default grants on future
relations, sequences, functions, schemas and types fail closed before any
migrator journal reads or security fixture writes. An added regression failed
on the previous query and now passes. The test uses a recording pool; no live
PostgreSQL privileges or database data were modified or tested. No changes
were made to Hono sessions/authentication, Drizzle migrations, RLS policies,
orders/inventory/payments, React or Flutter.

**Rollback:** Restore the two verifier/test files and this characterization
section from the immediately prior canonical archive and refresh the three
first-party SHA-256 entries. The full suite, real application-role permissions,
Supabase staging integrity, supported Node/Flutter builds and backup/restore
remain independent acceptance gates.


## 2026-10-23 continuation — database-level CREATE privilege boundary

**Baseline:** The latest `NearPill_Packet0_Internal_Default_ACL_2026-10-23.zip` has 385 first-party/archive files, byte-identical to the active `nearpill_current` source at the start of this run (SHA-256 `df95d4abba41a17e4788ed21a6f96771079aa09aaa7e8fccc38b0ec39985272f`). Packet 0 remains unaccepted.

**Scoped test-only change:** Extend `backend/scripts/lib/verify-live-fixture-connection.mjs` with an independent, read-only `pg_database` privilege probe. It now rejects database ownership/membership and database-level CREATE rights for the application role, Supabase `anon`/`authenticated` roles, PUBLIC, and non-inherited grants reachable through `SET ROLE`, before any migrator journal read or fixture mutation. Database-level CREATE can permit new schemas and trusted extensions even when reviewed schema CREATE grants are restricted; ordinary CONNECT/TEMP defaults are unaffected. Add two tests in `backend/test/packet0-db-live-connection-preflight.test.mjs`. The previous code fails these tests (68 PASS / 2 FAIL); the corrected focused suite passes (70/70). The recording-pool test selector was updated to distinguish the new database probe from the preexisting public-schema probe. No production behavior, migration, RLS policy or Supabase database object was changed.

**Acceptance:** Local source/recording-pool checks only. Real PostgreSQL grants and any environment-specific exceptions must be established using approved NearPill staging roles. Supported Node 24/npm 11, three authentic npm lockfiles, Flutter, live app-role RLS, migration replay, inventory contention, reconciliation and backup/restore remain blocked. Packet 1 and later packets do not start.

## 2026-10-23 — Public sequence ownership boundary in Packet 0 live preflight

The existing read-only public surface check denied direct/PUBLIC and Supabase Data API sequence grants, but did not inspect whether the ordinary `nearpill_app` login **owned** a public sequence, or was a member of the owning role. Sequence ownership can authorize `ALTER SEQUENCE`, including restart/cycling changes, without the ordinary USAGE/SELECT grants that application repositories need. This is a **potential privilege drift in an unverified staging database**, not evidence of an actual NearPill production exploit.

`backend/scripts/lib/verify-live-fixture-connection.mjs` now includes a `sequence-owner` row in the existing public-surface read-only query for any `public` sequence whose owner role is a membership of `current_user` (including itself). This conservative check is aligned with the other owner checks: membership is rejected even if later role-option review could establish that a particular membership cannot be exercised. The existing application sequence usage grants are intentionally preserved. A flagged role requires owner-approved inspection and role-specific testing; never weaken security checks to unblock fixture writes.

`backend/test/packet0-db-live-connection-preflight.test.mjs` adds two regressions: verify the exact catalog coverage, and refuse the ownership result before migrator journal access. The new regressions failed before the correction and passed afterward using recording pools. This test does not connect to PostgreSQL, so actual role privileges, RLS negatives, migration replay, stock contention and restore remain **NOT RUN/BLOCKED** until an explicitly approved NearPill Supabase staging connection and supported toolchain are available. The production migration history and business logic are unchanged; rollback is to revert this query/test/documentation change and regenerate the source manifest.

## 2026-10-23 — Public-sequence UPDATE and `setval()` authorization characterization

The existing read-only live security preflight already refused application-role ownership of public sequences and exposed client/PUBLIC sequence grants. It did not independently reject `UPDATE` on sequences for the ordinary backend application role. PostgreSQL requires `UPDATE` to call `setval()`; normal application ID allocation uses only `USAGE` for `nextval()` and may use `SELECT` for `currval()`. The canonical migration history currently grants `USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nearpill_app`, without intentionally granting `UPDATE`.

The single existing `PUBLIC_SURFACE_PROBE_SQL` now rejects effective application-role sequence `UPDATE` privileges and ACL grants reachable through `SET ROLE`, using a separate `sequence-app-update` result before accessing the migration journal or writing any fixtures. Two targeted regressions cover SQL catalog evidence and fail-closed preflight behavior. Both are mock/recording-transport checks, not live Supabase authorization acceptance. A regression failed before the fix; focused tests passed afterward. The source finding does not establish that a deployed NearPill database currently grants UPDATE.

Preserved: one Hono backend with backend-owned identity, existing Drizzle repositories and seven reviewed migrations, RLS, pharmacy/order/payment logic, React and Flutter. No production SQL, secrets, credentials, data or deployment were modified. To roll back, restore the preflight and regression file from the canonical input ZIP, remove this characterization paragraph and the corresponding master-ledger entry, and refresh the two/three source-manifest hashes; no database rollback applies.


### 2026-10-23 — Packet 0: public PostgreSQL routine-kind coverage

The existing read-only public-surface preflight inspected `pg_proc` kinds `f` (function) and `p` (procedure), but omitted `a` (aggregate) and `w` (window function). PostgreSQL records all four as routines; the prior catalog query would miss unreviewed public aggregate/window objects. The same preflight now considers all four kinds. Its reviewed `pg_trgm` exemption remains restricted to non-SECURITY-DEFINER ordinary functions with actual extension membership (`pg_depend`), not names or untrusted routines.

A new test first failed against the old query and then passed after the correction. The test also checks simulated unreviewed aggregate/window results are rejected before the migrator's journal read, with only read-only catalog queries executed. This is **local recording-pool/source characterization only**, not a claim about a real Supabase staging database, PostgreSQL row authorization or Data API exposure. No Hono/Drizzle/RLS migrations, production database, React, Flutter or business logic changed. Rollback by restoring the verifier, test and this paragraph from the previous single canonical archive, then refreshing the source manifest.

### 2026-10-23 — Authorization-schema relation inventory (Packet 0 continuation)

The live fixture security preflight previously inventoried the four reviewed `nearpill` helper routines, but did not inventory relation-like objects in that same authorization schema. The seven reviewed PostgreSQL migrations do not create tables, views, materialized views, sequences or foreign tables in `nearpill`. A new relation there could constitute an unreviewed database surface while routine and schema grant checks still succeed.

Within the existing `backend/scripts/lib/verify-live-fixture-connection.mjs`, a new read-only `pg_class`/`pg_namespace` check rejects any table, partitioned table, foreign table, view, materialized view or sequence in `nearpill`; missing or malformed query results also fail closed before migrator journal reads and test-fixture writes. The separate `nearpill_extensions` schema is intentionally not treated as empty because it hosts the approved PostgreSQL extensions `cube` and `earthdistance`. This is **Packet 0 preflight characterization only**, not a production policy or schema change, and does not prove live Supabase RLS security.

Two regression tests exercise the expected empty inventory and fail-closed results for unexpected objects or unreadable data. Rollback is to restore the changed preflight, its test file, and this characterization entry from the baseline archive; no production database rollback applies. Actual application-role database integrity remains **NOT RUN** until an explicitly authorized NearPill Supabase staging connection exists.


## 2026-10-23 Packet 0 continuation — reviewed authorization-helper body attestation

The current live fixture preflight already verified the four `nearpill` helpers' signatures, search paths, ownership, security-definer flags, and grants, but not their executable function bodies. A database-side replacement of `nearpill.current_actor_id`, `current_actor_role`, or `current_capability` could alter authorization policy behavior while passing those metadata checks. This is an **unverified drift scenario**, not a demonstrated compromise of a deployed database.

The same existing live preflight now reads `pg_proc.prosrc` and the implementation language, compares the body of every reviewed SQL/PLpgSQL string-literal function with the bodies extracted in order from the **existing seven canonical migrations**, and rejects missing, changed, unexpected or unverifiable definitions before migrator journal access or fixture writes. Source bodies are not duplicated as alternative production implementations. Three recording-pool regressions cover changed, missing and language-mismatched bodies as well as source inventory errors; they do **not** replace a live staging test.

Only `backend/scripts/lib/verify-live-fixture-connection.mjs`, `backend/test/packet0-db-live-connection-preflight.test.mjs`, this baseline record, the SHA-256 source manifest and the master Implementation Ledger were changed. The Hono backend, existing authentication, Drizzle, RLS migrations, business logic, React, Flutter, and Supabase provider selection remain unchanged. No obsolete runtime path was deleted before parity; no production DB, SQL, secrets, payment or deployment was touched.

The local red-to-green check removed only the new body-comparison assertion temporarily: **78/79** tests passed with one failing regression; restoring the assertion and language protection gave **80/80** passing. PostgreSQL `pg_proc.prosrc` contains the source text for string-literal SQL and PL/pgSQL functions; direct catalog comparison still requires confirmation on actual NearPill-owned staging. The Node 24/npm 11, authentic lockfile, Flutter and live Supabase requirements remain acceptance blockers. Roll back by restoring these source/test/documentation files from the immediately preceding source archive and regenerating the canonical source manifest.


## 2026-10-23 — Packet 0: public application-trigger integrity preflight

**Baseline:** The newest supplied `NearPill_Packet0_Helper_Body_Attestation_2026-10-23.zip` has 391 members, all byte-identical to the existing canonical `nearpill_current` source before edits (SHA-256 `4359d9b4d34a645947769f2057d230b76a7c12b99bf5112b0b13e1776e3554b2`). No Git HEAD or approved NearPill Supabase database endpoint is attested. Packet 0 remains the earliest unaccepted packet.

**Source-backed verification gap:** The read-only staging preflight attested the actual SQL/PLpgSQL helper bodies, but not the trigger bindings that invoke them. An added or disabled application trigger could affect inventory/order behavior without changing the reviewed function bodies. The seven canonical PostgreSQL migrations currently create one user-defined application trigger: `inventory_touch_updated_at`, a row-level BEFORE UPDATE trigger executing `nearpill.touch_updated_at()`.

**Scoped implementation:** In the existing `backend/scripts/lib/verify-live-fixture-connection.mjs`, inspect `pg_trigger`/`pg_proc` metadata for every non-internal public trigger. Require the reviewed inventory trigger, enabled for ordinary writes with exact function target, row/event/timing bitmask, zero arguments, and no column/WHEN/transition/constraint/clone alterations; reject missing, extra and malformed results before migrator access or fixtures. PostgreSQL-internal FK/constraint triggers are intentionally excluded from this particular application-trigger inventory, not attested here. The companion recording-pool tests in `backend/test/packet0-db-live-connection-preflight.test.mjs` reproduce missing/extra/disabled/retargeted trigger cases and verify that the canonical migration source still declares the expected trigger lifecycle. **This is source/recording-transport verification only, not proof of live Supabase trigger security or inventory integrity.**

**Preservation/rollback:** Existing Hono/backend-owned auth, Drizzle repositories, all seven PostgreSQL migrations, RLS, inventory/order/payment use cases, React and Flutter remain unchanged. No production object, credential, data, payment or deployment was modified; no legacy path was retired without parity. Rollback by reverting this preflight, test, and documentation entry to the preceding verified archive, refreshing the source manifest; no database rollback is involved. Supported builds, actual app-role tenant/RLS negatives, migration replay, 100-way inventory contention, reconciliation and restore remain separate acceptance blockers.


## 2026-10-23 — Packet 0: internal constraint-trigger enablement

**Baseline:** The latest supplied `NearPill_Packet0_Application_Trigger_Inventory_2026-10-23.zip` has 392 files, matching the single canonical working tree byte-for-byte before modifications. Packet 0 is still the first unaccepted packet. No Git HEAD or approved NearPill Supabase staging deployment was verified.

**Finding and scoped implementation:** The existing live preflight verified the user-defined `inventory_touch_updated_at` trigger but deliberately excluded PostgreSQL-generated FK/constraint triggers. Disabled (`D`) or replica-only (`R`) internal constraint triggers could therefore escape a pre-fixture integrity check. The single existing `backend/scripts/lib/verify-live-fixture-connection.mjs` now performs a read-only `pg_trigger` inspection for *internal public-schema constraint triggers* (`tgisinternal`, nonzero `tgconstraint`) whose enabled mode is not `O` or `A`, rejecting any such row or unreadable result before migrator access or fixture writes. It does not claim to prove that all expected constraints exist: migration replay, FK presence, validation, RLS and real concurrency remain independent live gates.

**Tests:** The existing recording-pool suite now includes two regression tests for disabled, replica-only and unreadable constraint-trigger results and updates the expected count of read-only queries. The red run with only the regressions added returned 84 PASS/2 FAIL; the corrected focused run returned 86 PASS/0 FAIL. This is *not* evidence of live Supabase enforcement.

**Preservation/rollback:** No production migrations, grants, RLS policies, backend auth, Drizzle, inventory/order/payment logic, React or Flutter changed. Roll back the preflight/test/docs changes to the immediately preceding verified ZIP and regenerate the canonical source manifest; no database rollback is needed. Supported Node/npm, authentic lockfiles, Flutter and owner-approved NearPill Supabase staging tests remain blocked.


## 2026-10-23 — Packet 0: source-backed foreign-key integrity preflight

**Baseline:** The latest supplied NearPill archive `NearPill_Packet0_Internal_Constraint_Trigger_Guard_2026-10-23.zip` is the current single codebase. Its 393 files matched the working tree before this scoped edit. The master ledger still marks Packet 0 incomplete; no subsequent packet is dependency-ready for acceptance. The provider decision remains Supabase PostgreSQL, not a claim of live deployment.

**Finding:** The prior `pg_trigger` negative check could pass with no disabled internal triggers even if a required foreign-key constraint was dropped or marked NOT VALID. This was not proof that any deployed NearPill database lacked those constraints.

**Change:** The existing read-only preflight now derives **34 single-column foreign-key relationships** from the *same seven reviewed SQL migration files*, using the shared SQL statement scanner. It reads live `pg_constraint`, source/target attributes and namespace metadata under the least-privilege application role, and requires a complete one-for-one match of referenced table/column pairs, `ON DELETE` actions, validation state and ordinary nondeferrable defaults. Missing, unexpected, duplicate, changed or unvalidated FKs block before the separate migrator-journal read and all synthetic fixture writes. The review baseline is intentionally locked to 34; unsupported future FK DDL requires review instead of silently adjusting accepted relationships. The query uses PostgreSQL 17/18-compatible catalog fields and does not infer PG18 availability from provider selection.

**Verification:** `node --test backend/test/packet0-db-live-connection-preflight.test.mjs` passes **89/89** recording-pool tests. New regressions reject missing, unvalidated, retargeted, additional and changed-`ON DELETE` FKs, plus unexpected ALTER TABLE FK DDL. They are not live Supabase results. See the canonical verifier transcript and §28 ledger entry for the full run and exact environment blockers.

**Preservation/rollback:** No runtime Hono, backend authentication, Drizzle schema/migration, RLS policy, React or Flutter source was modified. No SQL, secret, deployment, customer data or payment state was changed. Roll back the existing verifier/test, this note and ledger entry to the previous canonical ZIP and regenerate the source manifest. A real authorized Supabase staging run, migration replay, 100-way inventory contention and restore are still required; Packet 0 remains blocked.

## 2026-10-23 — Packet 0: PostgreSQL 18 foreign-key enforcement preflight

**Baseline:** The newest user-supplied archive is `NearPill_Packet0_Foreign_Key_Catalog_Preflight_2026-10-23.zip` (394 files; SHA-256 `3c866f9b8cab6a4896a5a34b1f00903c8cdd80137b02c06bbb3837149a107972`), all matching the existing single working tree before edits. Packet 0 remains active/unaccepted, and there is no verified NearPill Supabase staging target or Git HEAD.

**Finding:** The existing PostgreSQL foreign-key preflight checks all 34 expected constraints for presence, columns, validation state, delete/update actions and deferrability. PostgreSQL 18 additionally permits `NOT ENFORCED` foreign keys, which can be `convalidated = true` without enforcing integrity. PostgreSQL 17 has no `pg_constraint.conenforced` field. The previous preflight could therefore accept such a disabled constraint on PostgreSQL 18.

**In-place verification change:** The same read-only `backend/scripts/lib/verify-live-fixture-connection.mjs` probe now selects `fk_enforced`, reading the `conenforced` catalog attribute through `to_jsonb(k)` on server versions >= 18 and using PostgreSQL 17's implicitly enforced behavior below 18. Missing/unreadable PG18 enforcement metadata, or explicit `false`, fail closed against the reviewed canonical expected inventory. This adds no SQL mutation, migration or parallel subsystem. The existing recording-pool test adds two regressions: rejection of false/null/missing enforcement and verification of the guarded cross-version catalog query. The pre-fix RED focused run had 89 pass/2 fail; the corrected GREEN run had 91 pass/0 fail. This does **not** establish actual staged/database FK enforcement until run with the approved least-privilege app role.

**Preservation and rollback:** Hono/auth, Drizzle repositories, all seven existing PostgreSQL migrations, RLS, order/inventory/payment rules, React portal and Flutter remain unchanged. No production SQL, secrets, customer records, payments, endpoint or schema was touched. To roll back, restore the verifier, focused test and this characterization entry from the verified input ZIP, revert the related master-ledger entry and regenerate the source manifest. Node 24/npm 11, genuine npm lockfiles, Flutter, real Supabase role/RLS/constraint checks, 100-way contention, migration replay, reconciliation and backup/restore remain mandatory blocked gates.


## 2026-10-23 — Packet 0 stock-reservation CHECK characterization

**Baseline:** The latest supplied `NearPill_Packet0_FK_Enforcement_2026-10-23.zip` matched the canonical worktree for all 395 ZIP members before editing (archive SHA-256 `1476bad492bb65db6c8b7ba9402eddb914ca87dc6b7541f9db8f73f7bb48ecbb`). The Implementation Ledger still marks Packet 0 as the first unaccepted packet. Supabase PostgreSQL is the selected provider, not a verified live connection.

**Finding and in-place change:** Existing NP-036 rollback-only authorization characterization validated a nonnegative `inventory.price_centavos` CHECK but did not verify `inventory.stock_on_hand`, `reserved_quantity`, or `inventory_stock_invariant` before writing the synthetic inventory row. A missing, `NOT VALID`, `NOT ENFORCED` (on PostgreSQL 18), or weakened reservation constraint could leave the stock ledger unprotected while the price authorization test still ran. The existing `backend/scripts/lib/verify-order-tenant-isolation.mjs` now checks both stock columns are `INTEGER NOT NULL` and the exact reviewed nonnegative/reserved<=on-hand expression is a validated, enforced CHECK. It uses PostgreSQL 17/18-compatible `pg_constraint` JSONB metadata, fails closed, and runs before any UPDATE. No new adapter, migration, test framework or production behavior was introduced.

**Test and limits:** Two new recording-pool tests reject absent, malformed, nullable or incorrect stock columns, and missing, unvalidated, unenforced or altered reservation constraints. The focused suite was RED with 13 pass/2 fail before implementation and GREEN with 15 pass/0 fail after correction. The recording pool simulates PostgreSQL metadata and does **not** prove live staging integrity or concurrency. Separate 100-way inventory contention, reconciliation and restore gates remain mandatory and blocked. Production Hono/auth, existing Drizzle migrations/RLS, React, Flutter and business logic remain unchanged.

**Rollback:** Restore `backend/scripts/lib/verify-order-tenant-isolation.mjs`, `backend/test/packet0-partner-inventory-price-negative.test.mjs`, and this note from the baseline ZIP, regenerate their source-manifest hashes, and revert the corresponding master-ledger entry. No SQL/credential/data rollback is needed.


## 2026-10-23 Packet 0 continuation — PostgreSQL 18 money CHECK enforcement preflight

The existing NP-036 rollback-only inventory-price authorization probe validated `inventory_price_centavos_nonnegative` by constraint type, validation status and its nonnegative definition, but unlike the adjacent `inventory_stock_invariant` check, did not verify PostgreSQL 18 `conenforced`. A `NOT ENFORCED` money CHECK could pass the catalog metadata check if its rendered definition remains otherwise accepted. This is a **test-preflight coverage gap**, not evidence that a live NearPill database contains an unenforced constraint.

Updated the existing `backend/scripts/lib/verify-order-tenant-isolation.mjs` price constraint query to select a PostgreSQL 17/18-compatible `enforced` flag (PG18's `pg_constraint.conenforced` through `to_jsonb`, PG17's enforced-only constraint semantics) and require strictly `true` before any fixture price write. `backend/test/packet0-partner-inventory-price-negative.test.mjs` now exercises unenforced and unreadable enforcement metadata with rollback/discard checks. The new test was red against the previous verifier and passes after correction. No production migration, RLS, user/authentication, order, inventory, payment, React, Flutter, or provider wiring changed.

The tests exercise a synthetic recording-pool contract, not a live Supabase staging database; the real PostgreSQL 17/18 behavior, application-role RLS, stock contention, migration replay, financial reconciliation and restore remain acceptance gates. Rollback consists of restoring the two verifier/test files plus this paragraph and regenerating the source manifest; no database rollback is necessary.

## 2026-10-23 Packet 0 continuation — order idempotency UNIQUE index integrity

The seven reviewed PostgreSQL migrations include `0006_order_inventory.sql`, which defines
`orders_user_idempotency_unique` as a partial unique index on `(user_id, idempotency_key)`
where `idempotency_key IS NOT NULL`. The live read-only preflight previously verified RLS,
foreign keys, inventory price/stock constraints and roles but did not inspect that index.
A missing, invalid, not-ready, nonunique, retargeted or predicate-altered index could weaken
checkout retry/idempotency guarantees even with source migrations unchanged.

The existing `backend/scripts/lib/verify-live-fixture-connection.mjs` now checks the index
using PostgreSQL 17/18-compatible `pg_index`, `pg_class`, `pg_attribute` and `pg_get_expr`
metadata, **before** migrator access or synthetic writes. The read-only assertion rejects
missing/duplicate rows, incorrect table, B-tree method, nonunique/immediate-invalid/invalid/
not-ready/not-live flags, wrong number/order of key columns, extra INCLUDE columns,
expression keys and altered or missing partial predicates. No migration or application
business logic was changed. The implementation is a metadata contract, not proof of a real
Supabase index or a replacement for real concurrency/idempotency tests.

Focused red/green evidence: `node --test backend/test/packet0-db-live-connection-preflight.test.mjs`
returned **exit 1 (90 pass, 3 fail)** with the new assertion temporarily disabled, then
**exit 0 (93 pass, 0 fail)** when restored. The broader Packet 0 verifier and live gates
are recorded in the latest master Implementation Ledger entry.

**Rollback:** Restore the verifier, its focused test file, this characterization document,
source manifest and ledger from the verified previous source archive. No production SQL or
credential rollback is needed. **Next safe packet:** Packet 0 acceptance continuation under
Node 24/npm 11, authentic lockfiles, Flutter and an explicitly approved NearPill Supabase
staging database with real app-role index, tenant RLS, 100-way concurrency and restore evidence.


## 2026-10-23 Packet 0 continuation — idempotency index equality semantics

**Baseline and scope:** The latest user-supplied `NearPill_Packet0_Order_Idempotency_Index_2026-10-23.zip` (SHA-256 `b2d6b311d73a366299ac27be52e02b95a6fcc1300cb50f7e347dbaeabd4a5272`) matched the 398 existing first-party/archive files byte-for-byte before edits. The first unaccepted packet remains Packet 0. Supabase PostgreSQL is an approved provider, not a verified deployment.

**Finding:** The existing read-only `orders_user_idempotency_unique` preflight asserted a unique, ready, valid B-tree index on `(user_id, idempotency_key)` with the reviewed partial predicate. It did not inspect `pg_index.indclass` or `pg_index.indcollation`. An index with a custom operator class or an explicit collation override could have different comparison semantics while retaining the index's name and columns. This is a **source-level verification coverage gap**, not evidence of deployed index drift.

**In-place correction:** Extend only `backend/scripts/lib/verify-live-fixture-connection.mjs` to check every indexed key uses its default B-tree operator class (`pg_opclass.opcdefault` and access-method match) and the corresponding column's declared collation (`pg_attribute.attcollation`). These constraints follow canonical migration `0006_order_inventory.sql`, which specifies neither a custom operator class nor a COLLATE override. Unknown/null/false values fail closed before migrator journal access or fixture writes. Two focused regressions in the existing `backend/test/packet0-db-live-connection-preflight.test.mjs` require the catalog query and reject altered/unreadable semantics; RED 93 pass / 2 fail before implementation and GREEN 95 pass / 0 fail after.

**Safety and limits:** All SQL remains read-only and scoped to the current verification preflight. No new migration, application logic, role grants, auth, RLS, React or Flutter changed. No live Supabase app-role catalog check or concurrent idempotency test was run. Restore the verifier/test and this note from the input ZIP, refresh the source manifest, and revert the matching ledger entry to roll back; no DB rollback is required. Packet 0 acceptance still requires Node 24/npm 11, genuine npm lockfiles, Flutter and owner-approved NearPill Supabase staging evidence.

## 2026-10-23 Packet 0 continuation — Drizzle partial-index declaration parity

**Baseline and finding:** The latest supplied `NearPill_Packet0_Index_Equality_Semantics_2026-10-23.zip` (399 source archive members; SHA-256 `2ea9a419206e4f5b479784e8f6cea36da36661154a7314a8289cd6b6877bf91d`) matched the existing source tree before edits. Reviewed `backend/migrations/postgres/0006_order_inventory.sql` defines `orders_user_idempotency_unique` with `WHERE idempotency_key IS NOT NULL`, while `backend/src/infrastructure/postgres/schema.ts` previously declared a non-partial `uniqueIndex` of the same name. This is a confirmed source metadata/migration drift risk; it is **not** evidence of changed deployed index behavior or of a previously run Drizzle-generated migration.

**In-place correction:** Align only the existing Drizzle schema declaration by importing `sql` from `drizzle-orm` and appending `.where(sql\`\${table.idempotencyKey} IS NOT NULL\`)` to the existing index builder. The original seven reviewed SQL migrations remain immutable. The existing `backend/test/packet0-db-live-connection-preflight.test.mjs` adds one source-contract regression verifying the canonical SQL predicate and the matching Drizzle declaration and import. It failed before the schema correction (95 PASS / 1 FAIL) and passes afterward (96 PASS / 0 FAIL). This does not introduce a second index, database adapter, migration history, or application behavior change.

**Limitations and safety:** This source/contract test cannot establish a supported Node 24/Drizzle TypeScript build, migration generation parity, live Supabase index catalog integrity, or real checkout contention. Those gates remain blocked until authentic npm lockfiles, supported SDKs, and an explicitly approved NearPill staging database are available. Hono identity, transactional order and inventory logic, RLS, React, Flutter, and Supabase hosting decision remain unchanged. Rollback: restore the two changed code/test files and this entry from the verified input ZIP, regenerate the source manifest, and revert the corresponding ledger entry. No production database rollback is required.

## 2026-10-23 Packet 0 continuation — payment and entitlement partial-index parity

**Baseline:** The latest supplied `NearPill_Packet0_Drizzle_Partial_Index_Parity_2026-10-23.zip` (400 files, SHA-256 `c35e97201e0191f9103bbc8df6e9d9cd03ee1b7be65f27f01d2b0ac8048de017`) was unpacked into the same canonical NearPill project tree. Its master ledger and README matched the existing mounted copies. Packet 0 remains active and unaccepted; the Supabase PostgreSQL provider decision is not evidence of a cutover.

**Source-confirmed drift:** Canonical migration `backend/migrations/postgres/0007_payment_reconciliation.sql` defines three partial UNIQUE indexes, but the already-existing Drizzle schema omitted `payments_order_idempotency_unique` and `subscription_entitlements_active_unique`, and declared `payments_provider_external_unique` without its reviewed predicate. This is a source-model/migration mismatch, **not** a confirmed deployed PostgreSQL defect. The provider/external-id non-null predicate mirrors the SQL even though default PostgreSQL NULL-distinct uniqueness often produces the same logical effect; explicit parity prevents schema-diff churn.

**In-place Packet 0 correction:** Only the existing `backend/src/infrastructure/postgres/schema.ts` declarations are reconciled with the reviewed predicates and column order. The single existing `backend/test/packet0-db-live-connection-preflight.test.mjs` now reads migration 0007 and asserts all three source contracts and exactly one Drizzle declaration per index. No SQL migrations, database connection, authorization policies, business calculations, application routes, React, or Flutter were modified. No migration generation or real database operation was performed.

**Acceptance limitation:** The new regression failed before the source metadata change and passed after it; focused Node contract tests can run on the available Node 22 host but supported Drizzle/TypeScript builds, real Supabase index catalogs, payment idempotency/entitlement behavior, financial reconciliation, RLS negatives, concurrency and database restore remain **NOT RUN/BLOCKED** until the specified toolchain, genuine lockfiles and approved NearPill Supabase staging project exist. Rollback: restore the Drizzle schema/test and this note from the verified input archive and refresh the source manifest. No database rollback is needed. **Next safe packet: Packet 0 acceptance continuation**.


## 2026-10-23 Packet 0 continuation — password-reset active-challenge Drizzle parity

**Verified input:** `NearPill_Packet0_Payment_Entitlement_Partial_Index_Parity_2026-10-23.zip` matched the existing NearPill worktree byte-for-byte (401 regular ZIP members). Packet 0 remains the first unaccepted packet; the original Hono/Drizzle/RLS/auth implementation remains authoritative and Supabase PostgreSQL remains the approved provider, not an established live connection.

**Confirmed source drift:** Canonical `backend/migrations/postgres/0004_identity_security.sql` already creates `password_reset_active_user_idx`, a unique index on `password_reset_challenges(user_id)` **WHERE `consumed_at IS NULL`**. The Drizzle `passwordResetChallenges` table previously omitted this partial unique index. A later unreviewed Drizzle schema diff could discard an important one-active-reset-challenge-per-user invariant. This is a *source metadata mismatch*, not evidence that the existing SQL migration is absent from a running Supabase database.

**Correction:** In the **existing** `backend/src/infrastructure/postgres/schema.ts`, add the reviewed index to the existing `passwordResetChallenges` table using `uniqueIndex(...).on(table.userId).where(sql`${table.consumedAt} IS NULL`)`. Preserve its existing token hash unique declaration. Add one source-backed red/green contract test to the **existing** `backend/test/packet0-db-live-connection-preflight.test.mjs`, comparing the reviewed SQL migration with the Drizzle name/columns/predicate and rejecting duplicate schema declarations. The SQL migration files, backend authentication/session behavior, database grants/RLS, React and Flutter code are untouched.

**Evidence/limits:** The new targeted regression was **RED (exit 1, 1 fail)** before the Drizzle correction and **GREEN (exit 0, 1 pass)** afterward; the combined focused migration/contract suite passed **113/113**. The canonical Packet 0 verifier returned **exit 2 / BLOCKED** (492/492 characterization PASS; 614 Node PASS, 1 SKIP, 0 FAIL); 301 first-party files matched the canonical SHA-256 manifest (hash recorded in the master ledger); 140 JavaScript files parsed and the heuristic secret scan passed. The exact commands and unavailable gates are in the master Implementation Ledger and full transcript. This source check is *not* a Drizzle TypeScript compilation or migration-generation test, nor a live Supabase uniqueness/idempotency proof; those remain blocked by the unsupported Node/npm host, missing authentic lockfiles/Flutter SDK, and missing owner-approved NearPill staging connection.

**Rollback:** Restore the original Drizzle schema, test and this note from the byte-verified input ZIP; revert the matching ledger entry and regenerate the canonical source manifest. No SQL/database rollback is needed. **Next safe packet:** Packet 0 acceptance continuation; do not advance to Packet 1.

## 2026-10-23 Packet 0 continuation — live partial UNIQUE index inventory

**Selected source:** The latest uploaded `NearPill_Packet0_Password_Reset_Index_Parity_2026-10-23.zip` (502 archive entries, SHA-256 `0ba9fb75349554aa0af34c13a42cc66c89e51fb069460454085880df13dc13b4`) is the single active source snapshot; there is no `.git` HEAD in the archive or verified NearPill-owned Supabase endpoint. Packet 0 remains unaccepted.

**Source-confirmed verification gap:** The existing least-privilege, read-only live preflight in `backend/scripts/lib/verify-live-fixture-connection.mjs` checked only migration 0006's `orders_user_idempotency_unique` index. Migrations 0004 and 0007 also define four security/data-critical partial UNIQUE indexes: `password_reset_active_user_idx`, `payments_provider_external_unique`, `payments_order_idempotency_unique`, and `subscription_entitlements_active_unique`. Source-model parity tests alone cannot verify whether any of these constraints is actually present and usable on the deployed database.

**In-place correction:** Expand the existing PostgreSQL catalog query and the existing `assertSafeLiveFixtureConnections` validation to check all five indexes using the **ordinary application pool** before reading the migration journal or writing fixture rows. For each, require the exact reviewed table, index name, ordered key columns and WHERE predicate, valid/ready/live/immediate UNIQUE B-tree state, no unexpected INCLUDE keys, default equality operator classes and declared collations. Missing, duplicated, malformed or altered catalog rows fail closed. Extend the existing `backend/test/packet0-db-live-connection-preflight.test.mjs` recording-pool characterization with one red/green discovery regression and table-driven negative cases for each newly attested index. No SQL migrations, live database records, credential/auth flows, payment domain rules, React or Flutter files were changed.

**Verification limitation:** The recording pools exercise preflight decisions, not real PostgreSQL catalog inspection. Actual non-bypass app-role tests, index catalog parity on a NearPill-owned Supabase staging database, migration replay, 100-way stock contention, financial reconciliation, backup/restore, and supported Node/npm/Flutter builds remain unavailable or unexecuted; the user-selected Supabase provider remains a deployment target, not a completed cutover. Rollback: restore the two source files and this note from the SHA-256-verified input archive, revert the matching master ledger addition and refresh the source manifest. No production SQL rollback is required. **Next safe packet: Packet 0 acceptance continuation.**

## 2026-10-23 Packet 0 continuation — provider-event and refund UNIQUE constraint attestation

**Source:** The newest user-supplied `NearPill_Packet0_Five_Partial_Unique_Index_Preflight_2026-10-23.zip` (SHA-256 `c18212846ade131ab7082eb309c1b0f876ac78ad7a31562eee523abe8a024e1b`) was byte-matched across **403 regular source archive members** against this one working tree. No Git branch/HEAD, NearPill-owned Supabase staging connection, or live migration state was supplied. Supabase PostgreSQL remains the approved managed provider, not a verified cutover. Packet 0 remains active, not accepted.

**Source-confirmed verification omission:** Canonical `backend/migrations/postgres/0007_payment_reconciliation.sql` declares three ordinary PostgreSQL named UNIQUE constraints: `payment_events_provider_event_unique` on `(provider, event_id)`, `refunds_provider_external_unique` on `(provider, provider_refund_id)`, and `refunds_provider_idempotency_unique` on `(provider, idempotency_key)`. The read-only app-role preflight checked five *partial unique indexes* but not these three nonpartial constraints. A missing/altered live webhook or refund uniqueness constraint could therefore pass the old catalog preflight before fixture writes. This is a **source verification gap**, not evidence of a deployed database defect.

**In-place correction:** Extend only `backend/scripts/lib/verify-live-fixture-connection.mjs` with a distinct PostgreSQL `pg_constraint`/backing `pg_index` read-only probe. Fail closed before migrator journal access or fixture writes unless all three exact constraint names, table targets, ordered non-NULL key columns, nondeferrable validated UNIQUE constraints, valid/ready/live/immediate plain B-tree indexes, default operator class/column collation, default NULL-distinct semantics, and absence of a partial predicate/INCLUDE keys are attested. The existing `backend/test/packet0-db-live-connection-preflight.test.mjs` tests source migration parity, discovery, and table-driven negative scenarios using recording pools (not a real database). The discovery test was deliberately **RED (exit 1)** against the previous preflight and **GREEN** after implementation. No reviewed migrations, runtime API/auth, Drizzle repositories, RLS policies, customer data, React/Flutter app, or credentials were altered; no legacy path has parity approval for removal.

**Acceptance limitations and rollback:** Recording transports are not real PostgreSQL index/constraint enforcement. Supported Node/npm/Flutter dependency builds, a separate real app/migrator Supabase staging connection, tenant-negative RLS tests, webhook/refund duplicate insert tests, real stock contention, reconciliation, and restore remain blocked/not run as recorded in the master ledger. Roll back by restoring the two edited verifier/test files and this characterization from the verified source ZIP, regenerating its source manifest and reverting the matching ledger entry. No database rollback is necessary. **Next safe work remains Packet 0 acceptance**, not Packet 1 or AI.

## 2026-10-23 Packet 0 continuation — reservation UNIQUE physical constraint preflight

**Baseline:** The newest supplied `NearPill_Packet0_Payment_Event_Refund_Unique_Constraint_Preflight_2026-10-23.zip` contains 405 regular archive files and exactly matches the existing worktree by SHA-256 before this continuation. There is no `.git` HEAD, owner-approved NearPill Supabase connection or verified deployed migration history. Packet 0 is still **ACTIVE / ACCEPTANCE BLOCKED**.

**Gap and change:** Migration `0006_order_inventory.sql` requires a named `reservations_order_inventory_unique` PostgreSQL UNIQUE constraint over two NOT NULL columns `(order_id, inventory_id)`. The existing read-only catalog check verified provider-event/refund named constraints (migration 0007) and five partial UNIQUE indexes, but did not verify deployed reservation-key enforcement. Extend that **same existing app-role `pg_constraint`/`pg_index` probe** to require reservation identity, constraint status, index state, key order, NOT NULL columns, default btree equality, NULL semantics, and no predicate/INCLUDE. Keep read-only checks **before migrator-journal access and fixture writes**. The recording transport's new reservation discovery regression failed before correction and passes afterward; source-parity and negative-mutation cases cover all four constraints. No Drizzle schema, SQL migrations, app logic, web/Flutter clients, auth, RLS, provider endpoint or real database rows changed. No legacy code is deleted without parity.

**Evidence boundary:** Recording-pool contract tests are not actual PostgreSQL or Supabase enforcement. Node 24/npm 11, authentic npm lockfiles, Flutter, and dedicated owner-approved NearPill Supabase staging remain required. Real app-role RLS, real duplicate reservation attempts, 100-way stock contention, migration replay and restore remain NOT RUN/BLOCKED. Roll back only the existing preflight/test/docs/manifest updates, not a database migration. Next safe packet remains **Packet 0 acceptance continuation**.


## 2026-10-23 Packet 0 continuation — live stock/centavo CHECK catalog preflight

**Source finding:** The canonical `backend/migrations/postgres/0006_order_inventory.sql` declares five named nonnegative money and inventory CHECK constraints, including `inventory_stock_invariant` (`stock_on_hand >= 0`, `reserved_quantity >= 0`, `reserved_quantity <= stock_on_hand`). The existing fixture-write preflight attested unique constraints, foreign keys, and tenant grants but not these five physical CHECK constraints. A staging database with a dropped, relaxed, `NOT VALID`, or PostgreSQL 18 `NOT ENFORCED` invariant could progress to fixture tests without this schema-drift signal. This is a missing verification step; it is **not** evidence that a live NearPill Supabase constraint is absent.

**Scoped correction:** In the existing `backend/scripts/lib/verify-live-fixture-connection.mjs`, add one app-role, SELECT-only `pg_constraint` query covering those five explicit migration names and exact normalized `pg_get_constraintdef()` comparison. Require expected table, CHECK type, validated and enforced state (PostgreSQL 17/18 compatible), local/no-inherit/no-parent metadata and exact comparison/conjunction semantics. Fail closed before any migrator journal read or fixture write. The existing recording-pool tests add a deliberately RED discovery test, a source-migration parity test and table-driven negative scenarios for missing, weakened, duplicate, unvalidated, unenforced or malformed constraints. They are mock contracts, **not physical database evidence**.

**Preserved:** One Hono service and application auth, Drizzle PostgreSQL schema and seven reviewed SQL migrations, RLS, React/Flutter, centavo/order/inventory/payment logic and Supabase as the intended managed provider. No application behavior, production secret, schema, actual database, or account was modified. No legacy paths were deleted without parity. The existing local database/provider/Node/Flutter release acceptance gates remain blocked, not waived. To undo this source-only addition, restore the preflight/test and characterization files from the preceding verified source ZIP, regenerate manifest hashes, and revert the associated Implementation Ledger entry; no database rollback is required.


## 2026-10-23 Packet 0 continuation — critical stock/centavo NOT NULL and integer type attestation

**Verified baseline and finding:** Latest received `NearPill_Packet0_Stock_Centavo_Check_Constraint_Preflight_2026-10-23.zip` passed ZIP CRC and all 411 regular members matched the existing single `/mnt/data/nearpill_work` code tree before edits. The master ledger retains Packet 0 as active/unaccepted. Migration `0006_order_inventory.sql` requires `BIGINT` for price/order/payment centavos and `INTEGER` for on-hand/reserved stock; migrations `0006` and `0007` require `NOT NULL` integer reservation quantities and positive refund centavos. The prior preflight checked the five named CHECK constraints but did not attest column type or `attnotnull`. PostgreSQL permits NULL under a CHECK predicate when it evaluates to UNKNOWN; such drift would undermine the intended storage contract despite an intact CHECK constraint.

**In-place improvement:** The existing `backend/scripts/lib/verify-live-fixture-connection.mjs` now makes one read-only app-role `pg_attribute`/`pg_type` catalog query before migrator history reads or fixture writes. It requires exact public table, column, storage type (`int4`/`int8`), `attnotnull = true`, ordinary (non-generated, non-identity) column form for eight reviewed stock/monetary fields across inventory, orders, order items, payments, reservations, and refunds. Missing, duplicate, nullable, wrong-type, generated, identity, and unreadable metadata fail closed. Existing recording-pool contracts in `backend/test/packet0-db-live-connection-preflight.test.mjs` add a RED-to-GREEN discovery test and table-driven negative cases. This *does not* claim to validate every CHECK in migration 0007, actual deployed schema, or real app-role constraints.

**Preservation and rollback:** No new modules, migrations, database roles, Supabase Auth, backend business logic, RLS, portal, Flutter, or legacy path removal. Supabase-managed PostgreSQL remains the approved target. Changes are limited to the existing preflight, its existing focused test, this characterization, the source manifest, and the master ledger. Roll back by restoring those source/test/docs files from the input ZIP and reverting ledger/manifest entries; no database rollback is needed. Real Supabase staging RLS/constraint and inventory contention checks, full Node 24/npm 11 installs/builds, Flutter, migration replay and restore remain required and **NOT RUN/BLOCKED**. Next safe step: **continue Packet 0 acceptance**.

**Executed local test evidence:** `node --test backend/test/packet0-db-live-connection-preflight.test.mjs backend/test/postgres-migration-contract.test.mjs` → **124/124 PASS**; `bash scripts/verify-packet0.sh` → **exit 2 / BLOCKED**, **503/503 Packet 0 characterization PASS**, **625 PASS / 1 SKIP / 0 FAIL** runnable Node subset, **140/140 JavaScript syntax PASS**, **301/301 first-party source hashes PASS** and heuristic secret scan PASS. The discovery and negative tests intentionally failed on the pre-change code (2 expected failures). Host Node **22.16.0**, npm **10.9.2**; three authentic lockfiles and Flutter absent. These are **local source/recording-pool checks**, not real PostgreSQL verification.


## 2026-10-23 Packet 0 continuation — inline reservation/refund/payment event CHECK parity

**Source finding:** The reviewed migration `0006_order_inventory.sql` defines an unnamed
column CHECK requiring `reservations.quantity > 0`; migration
`0007_payment_reconciliation.sql` also defines unnamed CHECKs requiring
`refunds.amount_centavos > 0` and either NULL or nonnegative
`payment_events.amount_centavos`. PostgreSQL gives these inline declarations
`table_column_check` names. Previously the live, read-only preflight checked five
named stock/centavo CHECK constraints and eight critical integer/NOT NULL
columns, but not these three predicates. A database with a missing or weakened
inline constraint could satisfy that limited preflight. No deployed defect is
claimed.

**Scoped change:** Add the three existing-migration inline CHECK names, table
identities and exact normalized predicates to the single app-role
`pg_constraint` read-only preflight. Require validated/enforced and local
constraints and reject dropped, duplicated, altered or unreadable results
*before* migrator-journal access/fixture writes. Extend the existing recording
transport test fixture and negative-mutation coverage; compare inline source
clauses to reviewed migrations. The new catalog-discovery test first failed
on previous code and passed after correction.

**Evidence boundary:** These are local source/recording-pool contracts, not
physical PostgreSQL, Supabase RLS or contention proof. No reviewed SQL
migration, database grant/RLS rule, backend auth/domain flow, Drizzle schema,
web/Flutter runtime, or production database was changed. Rollback restores the
existing verifier/test/characterization from the prior verified source ZIP
and recomputes corresponding source-manifest hashes. Live staging and
supported-runtime acceptance gates remain **NOT RUN/BLOCKED**.

## 2026-10-23 Packet 0 continuation — order quantity, movement deltas and nullable event amount

**Baseline/source:** Latest user-supplied archive `NearPill_Packet0_Inline_Quantity_Refund_Check_Preflight_2026-10-23.zip` (SHA-256 `da980aefccd9eab4c24c00c78254635ebae8b2468ef029d408753fdad228f922`) contains 418 regular files. All 418 matched the single existing `nearpill_work` tree byte-for-byte before changes. No Git checkout/HEAD or NearPill Supabase staging identity was available. The master ledger leaves Packet 0 unaccepted.

**Source-derived finding:** `0001_core.sql` requires positive, NOT NULL integer `order_items.quantity`; `0006_order_inventory.sql` requires NOT NULL integer `stock_movements.stock_on_hand_delta` and `stock_movements.reserved_delta`; `0007_payment_reconciliation.sql` permits NULL but otherwise requires nonnegative BIGINT `payment_events.amount_centavos`. The current read-only catalog preflight checked eight stock/centavo columns but not these four. A changed type or altered/nullability rule on a staging database could pass that narrow check before fixture-writing tests; this is a source-level audit finding, not evidence of a live defect.

**In-place correction:** Reuse the same SELECT-only `pg_attribute`/`pg_type` probe and assertion logic, expanded from 8 to 12 reviewed columns. The four additional entries require exact type, table/column identity, non-generated/non-identity form, and **per-column expected nullability** (payment event amount must be nullable; other three must be NOT NULL). Existing recording-pool tests include deliberately RED-then-GREEN discovery/nullability tests and source-migration parity tests, plus missing/type/nullability/duplicate negatives. Every rejection occurs before access to the migrator journal; all catalog operations remain SELECT-only. No schema migration, app role/RLS, payment/order/stock logic, web/mobile app or live database changed.

**Evidence limits/rollback:** Local recording-pool checks do not prove physical PostgreSQL enforcement. Supabase staging app-role checks, RLS negatives, real quantity/payment-event enforcement, 100-way inventory contention, migration replay, reconciliation, restore, supported Node/npm/Flutter builds remain NOT RUN/BLOCKED. Restore the two preflight/test files and this characterization note from the verified input archive, restore the ledger entry and recalculate the manifest hashes to roll back; no DB rollback. **Next safe packet remains Packet 0 acceptance continuation.**

**Executed results:** Discovery/nullability regression was intentionally RED (2/2 selected failures before implementation), then GREEN after correction. `node --test backend/test/packet0-db-live-connection-preflight.test.mjs backend/test/postgres-migration-contract.test.mjs` → **129/129 PASS**. `bash scripts/verify-packet0.sh` → **BLOCKED, exit 2**: **508/508 Packet 0 characterizations PASS**, broader runnable Node tests **630 PASS, 1 SKIP, 0 FAIL**, JavaScript parse **140 PASS**, source fingerprints **301/301 PASS**, heuristic secret scan **PASS**. Host Node `v22.16.0`, npm `10.9.2`; Node 24/npm 11 and genuine npm lockfiles, Flutter and NearPill Supabase staging are unavailable. Tests are local/source-level, not real Postgres evidence.

## 2026-10-23 — Packet 0 continuation: core pharmacy membership and inventory uniqueness preflight

**Baseline:** The latest user-supplied `NearPill_Packet0_Order_Quantity_Movement_Event_Column_Preflight_2026-10-23.zip` was CRC-readable; its 421 regular files matched the existing single `nearpill_work` source tree byte-for-byte before editing. The artifact has no Git HEAD. Packet 0 remains ACTIVE / ACCEPTANCE BLOCKED; Supabase-managed PostgreSQL is approved as the provider, but no owner-verified NearPill staging database is available.

**Source finding and scope:** Migration `0001_core.sql` contains `pharmacy_memberships_user_store_unique` on `(user_id, drugstore_id)` and `inventory_store_medicine_unique` on `(drugstore_id, medicine_id)`. The read-only app-role live preflight already checked four unrelated UNIQUE constraints, but it did not attest these two foundational tenant/inventory invariants. Extend the same `pg_constraint` + backing `pg_index` probe to check all six, including the exact two-column order, NOT NULL keys, default btree operator classes, validation/index readiness/uniqueness and no partial predicate. The check fails closed before any migrator-journal access or fixture mutation. **This is only preflight coverage, not deployed-constraint evidence.**

**Changes:** `backend/scripts/lib/verify-live-fixture-connection.mjs` (reuse existing SELECT-only constraint probe); `backend/test/packet0-db-live-connection-preflight.test.mjs` (recording rows, red/green discovery, canonical migration/Drizzle parity and inherited negative-case coverage); this characterization note; the existing SHA-256 first-party manifest and master plan Implementation Ledger. No production API, auth, RLS, SQL migrations, Drizzle schema, inventory/order/payment logic, web or mobile changes; no duplicated projects or databases. No legacy path removed without acceptance.

**Local test evidence:** Before implementation, the targeted regression exited 1 with `live catalog probe must cover pharmacy_memberships_user_store_unique`. After implementation the targeted regression passed, and `node --test backend/test/packet0-db-live-connection-preflight.test.mjs backend/test/postgres-migration-contract.test.mjs` passed **130/130**. The negative contract matrix also rejects missing, duplicate, altered, invalid/nonunique or reordered indexes before migrator access. These use recording pools and do not prove physical Supabase enforcement. Full local Packet 0 verification outcome is captured in `docs/packet0-verification-2026-10-23-core-unique-full.txt` and the ledger.

**Blocked environment gates / rollback:** The host runs Node 22/npm 10 rather than declared Node 24/npm 11; original root/backend/web lockfiles and Flutter are unavailable. No owner-approved NearPill Supabase staging project, least-privilege non-`BYPASSRLS` app connection, direct TLS migrator, or real PostgreSQL restore surface has been verified. Live RLS negatives, unique-conflict attempts, 100-way stock concurrency, migration replay/checksums, money reconciliation, supported builds and restore remain NOT RUN/BLOCKED. To roll back, restore the two edited verifier/test files and this note from the 421-member source archive, revert the ledger entry and regenerate the source manifest. No database rollback. **Next safe packet: Packet 0 acceptance continuation**; do not advance to Packet 1.

## 2026-10-23 — Packet 0: separate direct Supabase staging migrator verification endpoint

**Source-level finding:** The operator preflight allowed Supabase's session-mode app
pooler, but `verify-postgres-security.mjs`, `verify-identity-security.mjs`,
`verify-order-inventory.mjs` and `reconcile-postgres.mjs` reused its `DB_HOST`
and `DB_PORT` for migrator connections. For Supabase staging, this could send
migrator journal and fixture writes through the application's pooler instead
of the approved separate direct connection. No live database was connected.

**Correction, in place:** Extend the existing `assertApprovedFixtureTarget()` staging
operator guard to require `MIGRATOR_DB_HOST`, `MIGRATOR_DB_PORT=5432`, and the
independently supplied `NEARPILL_VERIFICATION_EXPECTED_MIGRATOR_HOST`.
Require exactly `db.<approved-project-ref>.supabase.co` as the direct migrator
host and an unqualified, distinct migrator PostgreSQL login. The app may still
use an approved direct or session-mode connection. Both roles retain TLS
certificate verification; localhost `local-test` retains its previous defaults.
Make the four existing verification/reconciliation scripts honor the distinct
migrator host/port. Retain all pre-fixture privilege/RLS/migration checks and
the local-test-only order-expiry guard.

**Evidence:** `backend/test/packet0-db-verification-preflight.test.mjs`
introduced tests that first failed on the old code (5 failures / 11 passes
from the focused 16-test run), then passed (16/16) after the correction.
The focused preflight/migration suites passed 139/139. Recording and source
checks cannot prove actual Supabase ownership, DNS, TLS, database state,
replay, high-contention correctness or backup/restore. They remain BLOCKED
until a distinct approved NearPill staging target and supported runtime exist.
No application business behavior, Drizzle migration, RLS policy or Supabase
production object changed; no legacy path removed.

## 2026-10-23 — Packet 0 Supabase staging application login-format parity

The existing pre-connect verification guard now denies ambiguous Supabase staging
application usernames: direct endpoints require an **unqualified** PostgreSQL
role, and session-mode pooler endpoints require **exactly** `<role>.<approved-ref>`.
The prior guard incorrectly accepted both an app-role suffix on a direct host and
additional qualifiers before the pooler project-ref suffix. Added a regression
that failed on the prior source and passes after correcting the existing guard.
Existing direct migrator endpoint/role enforcement, local test configuration,
authentication, Drizzle schema, RLS, and application behavior are preserved.
Source/recording checks do not prove live Supabase project identity or data safety.

## 2026-10-23 — Packet 0 direct Supabase migrator username contract

The existing `backend/scripts/lib/verify-migration-target.mjs` operator
preflight previously required a staging direct Supabase endpoint but could
accept a session-pooler-form login (`nearpill_migrator.<project-ref>`) on
that endpoint. The canonical migration runner uses the direct connection, so
this ambiguous configuration should be rejected **before any pool is built**.
The staging-only preflight now requires an unqualified migrator role and keeps
its explicit approval, direct endpoint, port 5432, TLS and distinct verification
of the connected role. Disposable local migrations retain their behavior.
The regression test failed before correction and passed afterward; no SQL,
Drizzle, auth, RLS, inventory, payment, portal, Flutter or live database changed.
Recording/source tests cannot verify a real Supabase project or deployment;
these and supported build/RLS/concurrency/restore gates remain BLOCKED.


## 2026-10-23 — Packet 0 read-only payment ledger reconciliation coverage

The existing `backend/scripts/reconcile-postgres.mjs` migration-role read-only
reconciliation previously scanned order/inventory/payment centavos but omitted
refund centavos and the optional amount on persisted provider events. It also
did not detect a `refunds.status='confirmed'` row whose `confirmed_at` was
missing, although the existing payment repository records that timestamp on
provider-confirmed completion. Under an unvalidated or altered database
constraint, an apparently successful reconciliation could overlook these rows.

The in-place SELECT-only reconciler now additionally counts: (1) refunds with
missing/nonpositive centavos, (2) payment events with a negative present amount
(`NULL` remains legal for informational events), and (3) confirmed refunds
without `confirmed_at`. These checks use the same authorized migrator session,
repeatable-read snapshot, `COUNT(*)` result validation, and fail-closed
transaction as existing checks. They do not mutate or remove any data,
redefine provider refund rules, or claim provider-backed payment evidence.
`backend/test/packet0-reconciliation-completeness.test.mjs` adds the regression
and verifies nonzero/inconclusive counts reject. No SQL/Drizzle migration,
backend auth/RLS, Hono/React/Flutter flow, or production endpoint was changed.

**Acceptance limitation:** Static contracts and a recording client prove the
new query path and result validation, not execution against PostgreSQL or
external payment providers. Real data integrity, app-role RLS, signed-event
reconciliation, concurrency and restore remain unverified without a dedicated
approved NearPill staging Supabase project and required runtime.

## 2026-10-23 — Packet 0 unresolved provider-incident reconciliation gate

The single canonical read-only `backend/scripts/reconcile-postgres.mjs` now checks
three additional payment-integrity conditions against the **same verified
migrator-role, repeatable-read snapshot**: (1) any `payment_reconciliation`
case still `open`, (2) any persisted provider event explicitly marked
`reconciliation_required`, and (3) any provider event marked `processed` with
no `processed_at` timestamp. These are independent of a payment row's own
`reconciliation_required` state. Provider events merely `received` are not
classified as anomalies because an event may still be processing.

The reviewed `0007_payment_reconciliation.sql` schema and the existing payment
repository's `markProviderEvent` timestamp write are unchanged. A new regression
in `backend/test/packet0-reconciliation-completeness.test.mjs` first failed
against the prior source and passed after the SELECT-only checks were added.
The verifier stops on any nonzero/malformed result before emitting success;
this is *not* live Supabase evidence or provider resolution proof. Supported
build, real app-role RLS, migrator, provider-event, contention, reconciliation
and backup/restore gates remain NOT RUN/BLOCKED until an approved staging
project and toolchain are available.

## 2026-10-23 — Packet 0: active-reservation/stock-hold read-only reconciliation

The existing `backend/scripts/reconcile-postgres.mjs` checked nonnegative stock and valid reservation statuses separately, but did not reconcile `inventory.reserved_quantity` against the **sum of active `reservations.quantity`**. A stranded hold or unmatched active reservation can satisfy the per-row CHECK constraints while violating the inventory model. Its old checks also did not detect active reservations on terminal (`cancelled`, `expired`, `completed`) orders or missing timestamps on reservations transitioned to `released`/`fulfilled` by the canonical order repository.

The existing migrator-role, read-only, repeatable-read reconciliation now counts those three categories as invalid rows. It fails closed before emitting any PASS summaries and does not mutate stock, orders, reservations or migration history. Tests in the existing Packet 0 reconciliation suite characterize the reviewed schema and repository transitions, the SQL presence, zero-result acceptance, malformed-result rejection and positive-result failure. **These are local/source tests, not real PostgreSQL test execution**; the owner-approved NearPill Supabase staging target and least-privilege app-role/RLS/concurrency/restore gates remain NOT RUN/BLOCKED. No application behavior, backend authentication, Drizzle schema, existing RLS policy, React or Flutter surface changed. Rollback: restore the reconciliation source/test/docs and manifest from the immediately preceding verified source archive, and revert the corresponding ledger entry. Do not advance to Packet 1 before Packet 0 acceptance.

## 2026-10-23 — Packet 0: reservation stock-movement journal reconciliation

The reviewed `0006_order_inventory.sql` migration stores reservation state and an
append-only `stock_movements` record for each reserve/release/fulfill transition.
The preceding Packet 0 reconciler proved that the stock held in `inventory`
matched active reservation quantities, but it did **not** verify the actual
movement evidence. Matching current stock can coexist with a missing reserve
movement or an incorrect release/fulfillment journal entry.

The existing migrator-role, read-only `reconcile-postgres.mjs` now checks every
reservation's order/inventory movement journal under the same repeatable-read
snapshot. Exactly one reserve movement with `+quantity` reserved and zero
on-hand delta is required. A released reservation requires one matching
release with `-quantity` reserved and no on-hand change; a fulfilled
reservation requires one fulfillment with both deltas `-quantity`. Active
reservations must have neither a release nor a fulfillment movement. Duplicated,
missing or mismatched movement evidence is counted as a reconciliation failure;
no repair or writes are attempted. Source-level regression tests confirm the
query remains in the existing fail-closed snapshot. This does **not** attest a
live database or retroactively validate provider events.

The PostgreSQL migration history, authentication, Drizzle, RLS, canonical order
and payment repositories, and web/Flutter app are unchanged. A real NearPill-
owned Supabase staging database and supported Node/npm/Flutter toolchain are
still required for Packet 0 acceptance and for proving RLS, concurrency,
reconciliation, migration replay and backup/restore gates.

## 2026-10-23 — Packet 0: immutable order total and one-pharmacy reconciliation

The existing order service calculates each persisted `orders.total_centavos`
from authoritative `order_items.quantity × unit_price_centavos` at checkout,
and requires one pharmacy and at least one item per order. Nonnegative SQL
CHECK constraints do not prove those *cross-row* invariants. Before this
Packet 0 change, `backend/scripts/reconcile-postgres.mjs` did not detect an
order with an altered total, a lost order item, or extra/missing pharmacy
association records.

Two SELECT-only `COUNT(*)` checks now run in the **existing reviewed migrator
role, read-only, repeatable-read reconciliation snapshot**: (1) each order's
persisted centavo total equals the sum of its immutable line snapshots,
calculated with PostgreSQL `numeric` multiplication to avoid floating-point
rounding or `BIGINT` multiplication overflow; and (2) each order has exactly
one `order_drugstores` association and at least one `order_items` record.
The association check counts distinct association-row IDs so several order
items do not inflate the pharmacy count. A nonzero, missing, or malformed
count fails closed before any PASS summary. No rows are modified or repaired.

The new regression in the existing
`backend/test/packet0-reconciliation-completeness.test.mjs` failed on the
prior reconciler and passed after this addition. This is **source-level and
mock-result characterization**, **NOT** proof against live PostgreSQL. The
approved NearPill Supabase staging database, genuine app-role RLS checks,
real integrity reconciliation, migration/restore, stock contention, Node 24,
lockfiles and Flutter build gates remain unavailable. No changes were made
to checkout/payment business logic, backend authentication, Drizzle migrations,
RLS, React or Flutter. Rollback: restore the reconciler, test, this document,
manifest and master ledger entry from the immediately preceding verified
source ZIP; remove only the three new evidence transcripts. Packet 1 remains
gated until full Packet 0 acceptance.

## 2026-10-23 — Packet 0: reservation-to-order-line pharmacy and medicine reconciliation

The existing read-only reconciliation checked active stock holds, reservation
lifecycle timestamps, movement journal deltas, one-pharmacy order contents and
immutable order totals, but the independent `reservations.order_id` and
`reservations.inventory_id` foreign keys did not verify that the inventory row
was the *same pharmacy and medicine* ordered by the customer. A reservation
attached to stock at another pharmacy could otherwise satisfy those separate
constraints. The canonical checkout service builds the order item and reservation
from the same locked `inventory` row.

The existing `backend/scripts/reconcile-postgres.mjs` now adds one SELECT-only
snapshot check requiring **exactly one** corresponding `order_items` row for
every reservation, where the order, pharmacy, medicine and quantity agree with
its `inventory` record. It checks reservations regardless of lifecycle status;
it does not require every historical order line to have a reservation (legacy
migration data may predate the reservation model). The new source-level contract
in `backend/test/packet0-reconciliation-completeness.test.mjs` first failed
against the previous script, then passed. The query remains under the current
authorized migrator-role, read-only repeatable-read transaction and rejects
nonzero or malformed counts before printing success. No migration, RLS policy,
auth, order service, React, Flutter or live database was changed.

**Evidence boundary:** These local source contracts are *not* proof that the SQL
passes on actual NearPill-owned Supabase PostgreSQL or that historical rows are
clean. Supported builds, non-bypass app-role tenant-negative tests, migration
replay, concurrency and restore drills remain NOT RUN/BLOCKED until a verified
staging project and supported runtime are provided. Rollback is restoration
of the reconciler, test, characterization document, manifest entries and ledger
from the verified 451-file input artifact; no SQL rollback is required.

## 2026-10-23 — Packet 0: reverse reservation stock-movement journal reconciliation

The existing read-only reconciliation began from each reservation and verified
its expected `reserve`, `release` and `fulfill` movement count and signed delta.
That check cannot find an **extra** lifecycle movement that has no reservation
row for its `(order_id, inventory_id)` pair. Migration
`backend/migrations/postgres/0006_order_inventory.sql` permits this situation at
the per-row constraint level: `stock_movements.order_id` is nullable, and there
is no foreign key from the movement pair to the reservation pair.

The existing `backend/scripts/reconcile-postgres.mjs` now additionally examines
`stock_movements` for `reserve`, `release` and `fulfill` rows with a **non-null**
`order_id`, and rejects any without a matching reservation for the same order
and inventory. It stays inside the existing approved-migrator **READ ONLY,
REPEATABLE READ** transaction, after live role/migration preflight and before
reporting any successes. It never changes business or DB state.

The reviewed migration deliberately uses `ON DELETE SET NULL` for movement
`order_id`, retaining movement history if an order is removed. Those historical
rows are exempt from the new reverse check, rather than falsely reported as
corruption. As a result, the check does **not** prove provenance for historical
null-order movements; this limitation remains documented. The prior
reservation-rooted check continues to validate normal live-order movements.

The new regression in the existing
`backend/test/packet0-reconciliation-completeness.test.mjs` failed on the
previous source (missing reverse check) and passed after the change, including
negative/absent count rejection and the `ON DELETE SET NULL` exception.
This is local source/contract evidence, **not** live database verification.
The approved NearPill Supabase staging project, actual RLS role tests, physical
data reconciliation, supported builds and restore/concurrency gates still need
to be executed before Packet 0 can be accepted. No migration, RLS policy,
backend auth/business path, React or Flutter code changed.

## 2026-10-23 — Packet 0: refund provider identity and cumulative confirmed amount reconciliation

The existing read-only PostgreSQL reconciliation verified positive refund amounts,
provider-event amounts, and confirmation timestamps, but it did **not** compare
`refunds.provider` with the linked `payments.provider` or detect a payment whose
**sum of confirmed refund amounts** exceeded its recorded payment amount. The
reviewed `0007_payment_reconciliation.sql` migration has a payment foreign key
and positive refund amounts, not these cross-row financial invariants. The
canonical payment use case sets the refund's provider to the locked payment's
provider and uses provider-confirmed callbacks as the authority for refunded
money, so these are characterization checks of intended behavior, not a new
payment or refund policy.

`backend/scripts/reconcile-postgres.mjs` now has two read-only detection gates:
(1) mismatched/null originating payment provider using `IS DISTINCT FROM`, and
(2) cumulative **confirmed** refunds greater than the linked payment amount,
using exact PostgreSQL `numeric` arithmetic rather than JavaScript floating
point. Pending/failed refund requests are excluded from returned-money sums;
a partial confirmed refund by itself is not rejected because existing policy
routes mismatch/partial cases through reconciliation. These checks execute after
the existing approved-role, migration and TLS preflight in the same read-only
repeatable-read migrator transaction, and no individual PASS is emitted before
all checks commit. The new regression failed against the preceding source and
passes after the change; tests do not establish that live staging data satisfy
these invariants.

**Preservation and limitations:** No reviewed migration, Drizzle repository,
Hono/backend authentication, RLS policy, payment service, React/Flutter,
provider credential, production SQL or data was changed. No historical refund
records were modified and no legacy path was retired. Restore the existing
reconciliation source/test and this note from the immediately preceding
byte-verified ZIP, revert its ledger entry, and regenerate the source manifest
to roll back. The supported Node 24/npm 11 build, genuine lockfiles, Flutter,
real NearPill-owned Supabase application-role isolation, migration replay,
100-way inventory contention, payment data reconciliation, and restore remain
**NOT RUN/BLOCKED** acceptance requirements. Next safe packet: **Packet 0
acceptance continuation**.


## 2026-10-23 — Packet 0: processed refund webhook ownership reconciliation

The reviewed `0007_payment_reconciliation.sql` schema records both the original
provider payment reference and provider refund reference on `payment_events`,
and `refunds.payment_id` identifies the originating payment. The signed webhook
handler resolves those identifiers independently, so a processed refund event
could otherwise be attributed to a refund belonging to a different payment.
The existing reconciliation checked refund provider and cumulative confirmed
amount, but not the **event-to-payment-to-refund** relationship.

The existing read-only `backend/scripts/reconcile-postgres.mjs` now counts
processed `refund.confirmed` and `refund.failed` events for which no refund
belongs to the exact payment named by that same event, comparing both provider
identity and external IDs. Missing IDs fail by `NOT EXISTS`; received or
quarantined events are assessed separately by existing preflight/reconciliation
checks and are not falsely claimed as processed. The check runs inside the
existing authorized, read-only, repeatable-read snapshot; any nonzero or
inconclusive result aborts PASS reporting. The contract regression failed
before this verification improvement and passed after it.

**Important remaining risk:** This is detection of inconsistent persisted
evidence, **not runtime prevention** of cross-payment refund webhook handling.
The payment-service handler must be specifically reviewed for ownership
matching before production payment acceptance; no business logic, migrations,
RLS policies, Hono authentication, React or Flutter behavior was changed
in Packet 0. Live authorized Supabase reconciliation, real webhook/RLS
negative tests, supported Node/Flutter builds, contention and restore remain
NOT RUN/BLOCKED. Next safe packet: Packet 0 acceptance continuation.

## 2026-10-23 — Packet 0: processed payment webhook identity/amount/currency reconciliation

The signed provider webhook handler looks up `payments` using the verified
`(provider, providerPaymentId)` pair and rejects an event with a present
amount/currency that differs from the locked payment. The reviewed
`0007_payment_reconciliation.sql` `payment_events` schema permits optional
`amount_centavos` and `currency`; absence of either is not by itself evidence
of payment corruption. Prior read-only reconciliation checked processed refund
event ownership but did not independently attest processed `payment.confirmed`
and `payment.failed` event identities or their supplied monetary metadata.

The existing `backend/scripts/reconcile-postgres.mjs` now counts processed
payment events for which **no** matching payment exists with the same provider
and external payment ID, and where present the same exact centavo amount and
currency. It uses `NOT EXISTS` so missing identifiers fail closed, and exact
PostgreSQL numeric comparisons rather than JavaScript floats. A legitimately
omitted optional amount or currency is accepted **only when the payment
identity matches**. Received/quarantined events are not incorrectly claimed
as processed. All checks execute inside the existing authorized migrator-role,
READ ONLY, REPEATABLE READ snapshot after the live role/migration preflight;
nonzero or inconclusive counts prevent any PASS from being emitted.

The Packet 0 regression in `backend/test/packet0-reconciliation-completeness.test.mjs`
failed against the preceding source (missing check), then passed. This adds
**detection**, not new payment processing behavior or a proof of live data
correctness. Hono/backend-owned authentication, Drizzle, the seven PostgreSQL
migrations, RLS, payment/refund business logic, React and Flutter are unchanged.
The previously documented unresolved runtime refund webhook ownership guard
remains an open security issue. No live database, migration or credential was
modified. Supported Node/Flutter builds, app-role RLS negative tests, real
Supabase reconciliation, 100-way contention, migration replay and backup/restore
remain NOT RUN/BLOCKED. Next safe packet: Packet 0 acceptance continuation.

## 2026-10-23 — Packet 0: processed refund event amount/currency attestation

The reviewed `0007_payment_reconciliation.sql` permits nullable provider-event
`amount_centavos` and `currency` fields. The prior reconciliation verified that
each *processed* `refund.confirmed` / `refund.failed` event belonged to the
specific provider refund and originating payment, but it did not compare the
event's **supplied amount** to `refunds.amount_centavos` or its **supplied
currency** to `payments.currency`. A misattributed or incorrectly valued
processed event could therefore escape the independent staging audit.

The existing read-only reconciliation query now requires matching values when
present, comparing centavos with exact PostgreSQL numeric arithmetic. Null
optional event metadata does not by itself fail the audit, but missing payment
or refund identity and contradictory provided values do. Only `processed`
events are claimed as completed, and `assertZeroInvalidRows` fails closed on
nonzero or inconclusive results. The check runs in the existing, approved
migrator-role `REPEATABLE READ READ ONLY` snapshot after the role/TLS/migration
preflight. A new regression failed against the preceding source and passed
after the targeted query change; no SQL migration, application business logic,
RLS, credentials, or production database was changed.

**Important remaining risk:** This is *detection*, not preventive validation
inside the live webhook handler. The independently identified cross-payment
refund ownership flaw remains OPEN; partial-refund amount handling also needs
provider-specific integration verification. Supported Node/Flutter builds,
authorized NearPill Supabase application-role RLS negatives, real database
reconciliation, contention tests, migration replay and restore remain NOT RUN
until the mandatory environment gates are satisfied. Next safe work: Packet 0
acceptance continuation only.


## 2026-10-23 — Packet 0: payment-plan quote versus authoritative order snapshot

The existing server-side payment policy computes a `full` payment intent from the
immutable `orders.total_centavos` value and offers the `deposit` plan only when
an approved policy enables it. The prior read-only reconciliation validated the
order's item-price snapshot and the refund/provider event amounts, but did not
compare persisted payment intent amounts with their order totals. A persisted
underpriced/overpriced `full` payment could therefore escape this audit.

Within the **existing** `backend/scripts/reconcile-postgres.mjs` verified migrator
role / `REPEATABLE READ READ ONLY` snapshot, added two fail-closed integrity
counts: `full` intents must equal their originating order's centavo total;
`deposit` intents may be smaller but must never exceed it. Both comparisons
use PostgreSQL `numeric`, not floating-point amounts. Legacy records with no
`payment_plan` are not retroactively classified. The audit does **not** infer
a deposit percentage or payment provider approval; their release gates remain
blocked. The same Packet 0 regression checks the existing domain quote policy
and the read-only query shape, including missing/invalid query result handling.

This is a detection-only staging audit, not live Supabase or payment-provider
proof. No application payment logic, schema, Drizzle history, RLS, authorization,
React, Flutter or database rows were changed. The previously documented
cross-payment refund webhook ownership vulnerability remains open and requires
separately scoped runtime prevention plus integration tests before release.

## 2026-10-23 — Packet 0: cross-pharmacy subscription ownership attestation

The reviewed `0007_payment_reconciliation.sql` schema stores both `drugstore_id`
and `subscription_id` in subscription entitlements and billing events. Each
field has its own foreign key, but neither FK independently proves the linked
subscription belongs to the same pharmacy. The canonical repository writes
both identifiers; incorrect or corrupted combinations could misattribute
premium reporting access or billing audit evidence without violating either FK.

The existing read-only `backend/scripts/reconcile-postgres.mjs` now compares
`subscription_entitlements.drugstore_id` and `billing_events.drugstore_id`
to the referenced `subscriptions.drugstore_id`. Any cross-pharmacy match
causes a nonzero integrity count and aborts acceptance through the existing
`assertZeroInvalidRows` fail-closed path. The check includes revoked and
historical entitlements; billing events with a nullable subscription reference
cleared by `ON DELETE SET NULL` are not incorrectly reported as mismatches.
Both checks execute in the already authorized migrator-role `REPEATABLE READ
READ ONLY` transaction after preflight validation. The added characterization
regression failed against the preceding reconciler (missing check), then passed.
These are structural/query-contract tests only, not executed against a real
NearPill Supabase staging database.

No application data, SQL migration, backend authentication, RLS policy,
subscription business behavior, React or Flutter source changed. The runtime
cross-payment refund webhook ownership risk reported previously remains open.
Supported Node/npm builds, Flutter, least-privilege live RLS negatives,
real data reconciliation, contention, migration replay and restore remain
NOT RUN/BLOCKED until the approved staging/toolchain prerequisites exist.
**Next safe work: Packet 0 acceptance continuation only.**

## 2026-10-23 — Packet 0: stale premium entitlement attestation

The existing `listEntitlementsForDrugstore` backend repository returns any
unrevoked `subscription_entitlements` row without re-checking its linked
subscription tier, status or `end_date`. The reviewed `0007` migration backfills
`reports:view:premium` only for `Premium`/`active` subscriptions whose end date
has not passed. A subsequent subscription change or expiration without a
matching revocation can leave a stale premium entitlement that the current
permission check still returns. This is an observed **runtime authorization
risk**, not proof that an affected row exists in a live database.

Within the existing read-only migrator reconciliation, a single fail-closed
count now detects unrevoked `reports:view:premium` entitlements whose linked
subscription is not `Premium`, not `active`, or has an `end_date` before
`CURRENT_DATE`. The check uses the same reviewed eligibility criteria rather
than inventing a new future-start-date policy. The characterization regression
failed against the original verifier and passed after adding the query; it is
a source-level test only. No entitlement writes, backend authorization,
PostgreSQL migrations, RLS, web/mobile behavior, or live database data changed.

**Release caveat:** This staging audit detects persisted stale grants but does
not make the runtime entitlement lookup itself fail closed. That preventive
change, including affected-client permission tests and end-date policy, needs
separate authorization/characterization within the appropriate identity or
subscription packet. The previously reported refund-webhook cross-payment
ownership finding remains open. Supported Node/Flutter builds and approved
NearPill-owned Supabase RLS, reconciliation, migration, stock contention, and
restore acceptance gates remain NOT RUN/BLOCKED.

## 2026-10-23 — Packet 0: exact-subscription premium entitlement audit

The existing staging integrity query `active premium subscriptions without entitlement`
checked an unrevoked `reports:view:premium` grant by pharmacy only. But the
reviewed `0007_payment_reconciliation.sql` schema permits multiple historical
subscription rows for one pharmacy, and the active entitlement's
`subscription_id` is independent of its `drugstore_id`. A grant belonging to
subscription A could therefore hide a missing entitlement for eligible
subscription B from the source-level reconciliation. The partial unique index
limits active grants by pharmacy and key, not by subscription ID; it does not
justify treating another subscription's grant as equivalent.

The **same existing read-only reconciliation query** now additionally requires
`e.subscription_id = s.id` in the `NOT EXISTS` predicate. A regression test
failed before the query change and passed afterward. It continues to use the
existing transaction-scoped migrator role, repeatable-read snapshot, and
fail-closed count validation. This may surface overlapping eligible Premium
subscriptions that need operator review rather than silently accepting them.
No subscription/entitlement writes, provider flows, Drizzle migrations, RLS
policies, authentication, web/mobile code or runtime authorization behavior
changed. Real staging reconciliation and release authorization gates remain
**NOT RUN/BLOCKED**. Previously identified stale-entitlement runtime access
and cross-payment refund webhook risks remain open.

## 2026-10-23 — Packet 0: payment incident provider ownership audit

The reviewed `0007_payment_reconciliation.sql` permits a nullable `payment_id`
on `payment_reconciliation` while independently requiring its `provider`. The
canonical payment repository writes these fields separately. A reconciliation
incident referring to an existing payment can therefore name a different
provider without violating the two individually valid attributes; the existing
read-only reconciliation checked open cases but did not attest this linkage.

A new SELECT-only count inside the **existing** approved migrator-role
`REPEATABLE READ READ ONLY` snapshot now rejects linked incident/provider
mismatches, both open and resolved. Unlinked incidents are intentionally
allowed via an inner join because the reviewed schema permits them. The
regression failed against the previous verifier and passed after the update.
This is **detection**, not prevention of misattribution in the live webhook
handler, and it does not assert that any live NearPill data is affected.

No migration, Hono/auth/RLS business flow, payments, React/Flutter client,
or live Supabase database was changed. Runtime refund-event cross-payment
ownership and stale Premium access risks remain open. Node/Flutter builds and
authorized live Supabase RLS, data/concurrency, provider and restore gates
remain **NOT RUN/BLOCKED**, not passed through the query-shape test.

## 2026-10-23 — Reconciliation incident provider-event provenance

The reviewed `0007_payment_reconciliation.sql` schema stores an optional
`payment_reconciliation.event_id` independently from its required `provider`.
Provider webhook handling writes `payment_events(provider, event_id)` before
creating an incident in the same repository transaction, and uniqueness for
those events is **composite** `(provider, event_id)`, not global to `event_id`.
The previous read-only reconciliation checked an incident's *linked payment*
provider but did not check its referenced event. A cross-provider or
missing-event incident could therefore be reported as correctly attributed.

The existing migrator-role `REPEATABLE READ READ ONLY` reconciliation now
counts every open or resolved incident with a non-null `event_id` that has no
matching `payment_events` row for **both** its provider and event ID.
Incidents generated from manual provider snapshots legitimately have no
`event_id` and remain permitted. A missing/malformed count or any nonzero
count fails closed before any PASS is printed. A new source-level negative
regression reproduced the missing query before the edit; it passes afterward.

This check is detection of persisted audit-record inconsistency, not
prevention of forged webhooks, runtime refund ownership repair, or evidence
that live staging records have been reconciled. No migrations, Hono auth,
Drizzle/RLS policies, payment business rules, React, Flutter, or live Supabase
records were changed. Node 24/npm 11 locked builds, Flutter, live staging
RLS, stock contention, provider tests and backup/restore remain required.

## 2026-10-23 — Packet 0: incident event-to-payment ownership reconciliation

The existing read-only reconciler verified that a `payment_reconciliation`
incident named the same provider as its linked `payments` row and that any
recorded `(provider, event_id)` existed in `payment_events`. Those independent
checks did **not** prove that the matched event referred to the payment linked
by the incident. The reviewed `0007_payment_reconciliation.sql` migration
stores the nullable incident `payment_id` and `event_id` independently; the
canonical provider-event repository stores `provider_payment_id` on events.

Within the **existing** approved migrator-role, `REPEATABLE READ READ ONLY`
reconciliation snapshot, a new fail-closed count now checks incidents with
**both** identifiers present. The event matching `(provider, event_id)` must
have a non-null external payment ID equal to the one on the incident-linked
`payments` record. Incidents without a linked payment or without an event ID
remain valid (as with unmatched events and manually initiated provider checks).
The previous source-level reconciliation failed this regression; it passes
when the additional check is present, with strict nonzero/missing-count failure
semantics. This is detection of inconsistent persisted evidence, **not** a
fix for the identified cross-payment refund webhook runtime vulnerability.

No migrations, auth, Hono, business-state transitions, Drizzle/RLS, React,
Flutter or live Supabase records changed. Supported builds, actual non-bypass
Supabase RLS and reconciliation, inventory contention, provider integration,
reviewed migration replay and restore remain **NOT RUN/BLOCKED** pending an
approved staging environment and supported toolchain.

## 2026-10-23 — Packet 0 reconciliation rollback pool safety

The read-only PostgreSQL snapshot wrapper previously issued a best-effort `ROLLBACK` after a failed query/commit/BEGIN, but would return the client to the pool without marking it unusable if rollback itself failed. A failed rollback leaves transaction/connection state unknown and must not be reused by subsequent preflight or reconciliation queries. The **existing** snapshot wrapper now invokes `client.release(true)` only in that case, requesting node-postgres to destroy the connection; an ordinary failed integrity query followed by a successful rollback still returns a clean client normally. The original application/query error is preserved as the reported failure.

Regression tests characterize failed `ROLLBACK` after an inspection error and after a failed `BEGIN`, successful rollback reuse, commit failure cleanup and no premature PASS. This is a Packet 0 verification-harness hardening change, **not** a live PostgreSQL test or change to runtime order/payment transactions. Supabase application/migrator separation, reviewed Drizzle migrations and RLS policy remain intact. Node 24/npm 11, Flutter, approved NearPill staging RLS/data integrity, 100-way inventory contention, payment/webhook security and restore still require independent acceptance.


## 2026-10-23 — Packet 0 reconciliation cleanup failure provenance

The existing read-only repeatable-read PostgreSQL reconciliation wrapper correctly destroyed
a pooled connection after failed `ROLLBACK`, but a subsequent synchronous exception
from `client.release(...)` replaced the original integrity/query failure. This could
mislead operators diagnosing why a staging reconciliation failed. The wrapper now
tracks whether the inspection/transaction already failed, preserves that original
error if releasing or destroying the client also throws, and still rejects a
cleanup failure after otherwise successful verification. Failed rollback continues
to call `release(true)`; successful rollback continues to release a reusable client.

Regression tests first failed twice against the previous wrapper and then passed
after this Packet 0-only change. This is read-only verification-tool behavior;
it does not modify the Hono backend's order/payment transactions, Drizzle,
seven reviewed PostgreSQL migrations, RLS, authentication, React, Flutter or a
live database. No superseded runtime path was deleted. Roll back by restoring
the verification helper, its tests and this note from the verified 495-file
baseline archive, then restore the manifest hashes and ledger entry. Real
Supabase RLS, migration replay, inventory contention, provider integration,
backup/restore and supported Node/npm/Flutter builds remain NOT RUN/BLOCKED.

## 2026-10-23 — Packet 0: read-only reconciliation pool-shutdown acceptance

The staging reconciliation previously printed `PASS` lines **inside** its
verification `try` block and then called `Promise.allSettled` on the two
PostgreSQL pools in `finally` **without inspecting rejected shutdowns**. A
failed app/migrator pool shutdown could therefore be reported as successful
reconciliation. This was a verified source-level detection/diagnostic flaw;
it is not evidence of an observed live Supabase connection failure.

The existing reconciliation script now defers **all** success reporting until
both pools have completed shutdown. Its existing snapshot helper module now
contains a narrow `closeReconciliationPools` routine that inspects synchronous
and asynchronous `end()` errors from **both** pools and throws a single
`AggregateError` after otherwise valid reconciliation. When an earlier
preflight/integrity/transaction error already exists, pool cleanup cannot mask
that primary error. This change does **not** alter Hono runtime database pool
handling, Drizzle migration logic, transactions, RLS or payment behavior.

Four new recording-pool regressions check healthy shutdown, multiple rejected
shutdowns, original-error precedence and the ordering of final PASS output.
They failed to load against the previous implementation (missing helper
export), then passed after correction. Real network failure, TLS, app-role RLS,
100-way contention and backup/restore require approved NearPill staging.

## 2026-10-24 — Packet 0 active session-family ownership reconciliation

The reviewed identity migration (`backend/migrations/postgres/0004_identity_security.sql`)
links `auth_sessions.user_id` and `auth_session_families.user_id` independently.
Its `family_id` foreign key does **not** establish that the two user IDs match.
The canonical security repository creates access/refresh credentials using one
user/family pair, but `findActiveSession` and refresh rotation do not verify
matching family ownership on every lookup. This is an **open runtime
security/data-integrity risk**, not proof of an observed exploit.

The existing read-only, migrator-role, repeatable-read reconciliation now counts
**unrevoked, unconsumed, unexpired** access/refresh sessions missing a family or
linked to a family owned by another user. It fails closed if the count is nonzero
or inconclusive. Standalone `web` sessions are intentionally outside this rule.
It never rewrites/revokes tokens; the runtime path still requires separately
scoped preventive security remediation and a live application-role negative test.

A focused negative contract was added to the existing Packet 0 reconciliation
suite; it failed before this check and passes after it. The normal available
Packet 0 local tests may pass, but the acceptance gate remains **BLOCKED** until
Node 24/npm 11 and genuine lockfiles, Flutter, and explicitly approved NearPill
Supabase staging RLS, reconciliation, migration, concurrency and restore tests
can be run. No SQL migrations, auth code, production data or secrets changed.

## 2026-10-24 — Packet 0 revoked-family active-session reconciliation

The reviewed security repository revokes a refresh-token family and its member
sessions together on refresh replay, refresh-token logout, account-wide logout
and password reset. The migration stores revocation timestamps independently,
so a partial or unauthorized update can leave an apparently live access/refresh
session under an already revoked family. This discrepancy is not covered by
checking only session-user/family-user equality.

The canonical **read-only**, migrator-role, repeatable-read reconciliation now
rejects unrevoked, unconsumed, unexpired `access`/`refresh` sessions whose joined
family has `revoked_at IS NOT NULL`. A standalone `web` session is deliberately
excluded, as is a consumed, expired or already revoked bearer session. This is
staging integrity **detection only**: no session is revoked, no identity runtime
lookup is modified, and no new SQL migration or auth model is introduced. No
claim is made about actual NearPill Supabase rows until the approved staging
connection and non-bypass app-role verification can run.

A negative contract was first run against the prior verifier (expected failure),
then rerun green after the check was added. Local acceptance remains blocked on
the supported Node/npm toolchain, genuine npm lockfiles, Flutter, and approved
Supabase live RLS/migration/data-integrity/concurrency/restore evidence.

## 2026-10-24 — Packet 0 active password-reset email/owner integrity

The reviewed `0004_identity_security.sql` stores `password_reset_challenges.user_id`
(as a foreign key) and `password_reset_challenges.email` (as independent text).
The existing consuming path updates `users.password` by the **user ID**, not the
recorded email. Thus a still-redeemable challenge with an email that identifies
another account can persist without violating the reviewed foreign key. Packet 0
now **detects** that inconsistency as an invalid row in the canonical
migrator-role, read-only, repeatable-read reconciliation. It joins the owning
`users` row, limits the check to `consumed_at IS NULL` and unexpired records,
and compares trimmed, case-folded email values. Already expired or consumed
challenges are retained as historical records and are not marked as usable.

A new test first reproduced the missing check (23/24 passing, 1 failing); after
adding the query the focused suite passed 24/24. A nonzero or missing count
fails closed. No reset tokens, identities, passwords, SQL migrations, API
behavior, RLS policy, or production records were changed. The real staging
Supabase role/RLS and database-row verification, supported build toolchain,
Flutter and restore gates remain **NOT RUN/BLOCKED**. This is a detection-only
Packet 0 improvement; if a mismatch is found, remediate it through the
separately authorized identity/security packet after characterization and
negative tests. To roll back, restore the script, test, this note and source
manifest from the immediately preceding verified NearPill archive, and revert
the corresponding master-ledger entry; no DB rollback is needed.


## 2026-10-24 — Packet 0 email-verification attempt-limit audit

Migration `0004_identity_security.sql` constrains `email_verification_challenges.attempt_count`
to be nonnegative but imposes no maximum. The canonical `verifyEmailCode` repository deletes a
challenge when the fifth incorrect code is submitted. Packet 0 now checks, without modifying
data, for an **unverified and unexpired** challenge that remains at five or more attempts.
The check runs with the same approved migrator role in the read-only repeatable-read
reconciliation transaction; malformed/missing counts and nonzero findings fail closed.
Expired challenges and already verified challenges are not represented as currently
redeemable unverified codes. This is **detection, not prevention or live verification**.
A regression failed before the additional query and passed afterward. No auth runtime,
SQL migration, RLS policy, or customer data was changed. Any real finding requires a
separate authorized investigation; do not silently delete or rewrite challenge rows.
Packet 0 still requires supported Node/npm, authentic lockfiles, Flutter and approved
NearPill Supabase staging RLS/concurrency/reconciliation/restore evidence before acceptance.
Rollback is a source-only revert of the query, contract, note, manifest, and ledger entry.

## 2026-10-24 — Single-live-refresh-token family reconciliation

Packet 0 staging reconciliation now detects refresh-token families that hold more
than one simultaneously redeemable refresh credential. The reviewed identity
repository serializes refresh-token rotation with `FOR UPDATE OF s, f`, consumes
its predecessor in the same transaction, then inserts a successor. The reviewed
schema's unique token hash does not by itself enforce a unique *active* refresh
per family. This read-only snapshot check counts families with multiple
`token_kind='refresh'` rows that are unconsumed, unrevoked and unexpired under
an unrevoked family. Independent web sessions and historical/expired tokens
are intentionally excluded. No runtime authentication, schema, migration,
RLS policy, secrets or client behavior changed.

The new Packet 0 contract test first failed against the existing reconciler,
then passed after adding the query. This characterizes intended persistence
invariants, **not** actual live PostgreSQL enforcement. Supabase staging
readiness, the non-bypass app role, tenant negative tests, successful data
reconciliation, 100-way stock contention and restore remain separate mandatory
acceptance gates. The original auth/session-family, refund-webhook and stale
Premium authorization runtime risks remain open.

## 2026-10-24 — Bounded read-only reconciliation statements and lock waits

The Packet 0 live database reconciliation previously opened a read-only,
repeatable-read transaction with no per-query `statement_timeout` or
`lock_timeout`. On busy staging PostgreSQL, a blocked SELECT could therefore
leave its snapshot open indefinitely, delaying cleanup and potentially
interfering with vacuum. The existing transaction wrapper now executes
`SET LOCAL statement_timeout = '120s'` and `SET LOCAL lock_timeout = '5s'`
after BEGIN and before *any* integrity SELECT. Both settings are scoped to the
current transaction and expire at COMMIT/ROLLBACK; they do not alter role,
connection defaults, migration files, RLS, or business operations. If either
setting is rejected, inspection does not run and the wrapper rolls back; a
failed rollback still discards the pooled client. Query timeouts fail
reconciliation closed, rather than counting as acceptable database integrity.

Recording-client contract tests first reproduced the missing commands and
passed after the change, including setup failure and rollback paths. These
are **not** live Supabase timeout/concurrency tests. Node 24/npm 11, genuine
lockfiles, Flutter, NearPill-owned staging RLS/data tests, restore, and
100-way inventory contention remain blocked or not run. Rollback: revert the
transaction wrapper, its snapshot tests, this note, manifest hashes and
master-ledger entry; remove the added evidence transcripts. No SQL migration
or production database rollback is needed.

## 2026-10-24 — Packet 0 reconciliation idle-transaction protection

The canonical migrator-role reconciliation already used one `REPEATABLE READ READ ONLY`
transaction and transaction-local `statement_timeout = '120s'` and
`lock_timeout = '5s'` settings. Neither statement nor lock timeouts limits time
spent **idle between SQL statements** while a client holds a transaction
snapshot. This can happen if an asynchronous inspection step stalls between
queries and can retain an old snapshot and delay cleanup.

The existing `withReadOnlyReconciliationSnapshot` wrapper now applies
`SET LOCAL idle_in_transaction_session_timeout = '30s'` before executing any
integrity check. This setting is bounded to the *same transaction* and does not
modify any production application connection, PostgreSQL role, global
parameter, migration, or business rule. An error applying it aborts inspection
and rolls back. If PostgreSQL closes an idle connection and rollback fails, the
existing failed-rollback safeguard discards the client rather than reusing it.

Two recording-client regressions reproduced the missing setting and missing
fail-closed setup guard before implementation. Existing success/failure-path
expectations now cover all three `SET LOCAL` statements. These tests prove
**source-level behavior only**; actual termination of idle transactions on an
approved NearPill-owned staging database remains **NOT RUN/BLOCKED**, as do the
non-bypass app-role RLS, supported Node/npm builds, authentic lockfiles,
Flutter, migration/stock contention, reconciliation and restore acceptance
checks. Rollback: revert the wrapper, tests, this note, manifest and ledger
entry to the verified input archive; no database rollback is necessary.

## 2026-10-24 — Packet 0 bounded reconciliation pool acquisition

The existing read-only PostgreSQL reconciliation had transaction-local 120-second
statement, 5-second lock, and 30-second idle-transaction timeouts, but those
settings cannot take effect until a client successfully connects and starts a
transaction. Its two `pg.Pool` instances previously used the driver default
`connectionTimeoutMillis = 0`, leaving initial connection establishment and
queued pool acquisition unbounded if the NearPill staging endpoint or network
was unavailable. This is a verification-tooling availability and fail-closed
issue, not an observed incident on the unverified Supabase project.

The canonical `backend/scripts/reconcile-postgres.mjs` now uses one shared
`connectionTimeoutMillis: 10_000` setting for both the ordinary application-role
preflight pool and the separate direct migrator-role pool. Approval still
precedes pool creation; existing role, TLS, migration, RLS and financial checks
remain mandatory. A connection/acquisition timeout prevents reporting PASS and
the existing two-pool cleanup path still applies. No application DB pool,
Drizzle query, migration, runtime authorization, RLS policy, or business logic
was changed. The node-postgres pool documents zero as the unbounded default:
https://node-postgres.com/apis/pool .

A new source/configuration regression reproduced the missing timeout before
implementation and passes after. It verifies the setting is shared by both
pools and neither overrides it. This is **not** live connectivity validation;
Node 24/npm 11, authentic lockfiles, Flutter, approved NearPill Supabase
staging roles, real RLS/integrity/concurrency/migrations and backup/restore
remain acceptance blockers. Rollback: restore the reconciler and test, this
characterization, manifest and master-ledger changes from the verified prior
ZIP and remove this run's evidence transcripts; no DB rollback is required.


## 2026-10-24 — Packet 0 effective read-only snapshot attestation

The canonical reconciliation wrapper requests `BEGIN TRANSACTION ISOLATION LEVEL
REPEATABLE READ READ ONLY`, but previously did not independently check the
effective settings reported by PostgreSQL before inspecting protected tenant,
inventory or financial rows. Packet 0 now checks
`current_setting('transaction_read_only')` equals `on` and
`current_setting('transaction_isolation')` equals `repeatable read` on the **same
checked-out connection after transaction-local timeout setup**. Missing,
malformed, writable or weaker/different isolation responses fail closed and
roll back before invoking the integrity inspection. Both successful and failed
existing connection-release/rollback paths are preserved.

Two new regressions reproduced this gap (2 expected failures before changing
the wrapper) and pass after the fix; existing recording clients were updated
to model the PostgreSQL settings response. This is a verification-harness
change only, not proof that the selected Supabase staging project's real
connections behave this way. No Hono/business/RLS/Drizzle/migration/Flutter/
React logic changed. Live connection behavior, non-bypass tenant negatives,
supported builds and actual reconciliation remain **NOT RUN/BLOCKED**.
Rollback: restore the transaction wrapper, tests, characterization, manifest
and master ledger from the verified 525-file input archive and remove this
run's evidence transcripts. No SQL or database rollback is required.

## 2026-10-24 — Same-transaction reconciliation principal and RLS attestation

**Finding:** The live connection preflight checks the approved application and migrator roles via pooled `pool.query()` calls; the integrity reconciliation subsequently checks out a different connection. Transaction read-only/isolation attestation alone cannot establish that *this* connection retains the approved migrator login, has `row_security` enabled, and is neither superuser nor `BYPASSRLS`. A connection/role discrepancy could otherwise make a successful data count untrustworthy.

**Scoped Packet 0 fix:** Before reading protected records, `backend/scripts/reconcile-postgres.mjs` now probes `current_user`, `session_user`, `current_setting('row_security')`, `rolsuper`, `rolbypassrls`, and `pg_stat_ssl` on the **same checked-out, read-only, repeatable-read transaction client**. The existing `backend/scripts/lib/read-only-reconciliation-snapshot.mjs` exports a small fail-closed result validator requiring exactly one expected migrator role, active row security, non-bypass privileges and, for approved staging, live TLS evidence. The role name is compared as data, not interpolated into SQL. Invalid/missing/ambiguous states roll back before inspecting tenant, order, inventory or payment rows. The earlier live preflight, migration checksum/ACL/RLS catalog tests, and all application behavior remain in place.

**Evidence and limits:** A new negative/positive test reproduced the missing boundary assertion before implementation and passed afterward. This verifies **source/recording-contract behavior**, not actual Supabase role/connection behavior or a production data scan. The local Node 22/npm 10 host still cannot meet Node 24/npm 11 or clean-install gates, and genuine root/backend/web lockfiles, Flutter SDK and an explicitly approved NearPill-owned staging database remain absent. Live RLS tenant negatives, role/TLS verification, migrations, 100-way inventory contention and restore are **NOT RUN/BLOCKED**. Prior recorded cross-payment refund webhook, stale Premium authorization, and refresh-family ownership runtime risks remain open; this is not a fix for those paths.

**Rollback:** Restore the verifier, helper, test, source-manifest, characterization document and master ledger from the verified 528-file input archive and remove this run's manifest-excluded transcripts. No SQL migration or database rollback is necessary.

### 2026-10-24 — Effective reconciliation timeout attestation (Packet 0 continuation)

The existing read-only PostgreSQL reconciliation wrapper used `SET LOCAL` to request a 120s statement timeout, 5s lock timeout, and 30s idle-in-transaction timeout, but only independently checked the transaction's isolation and read-only flags. The request alone was not evidence of the effective live connection timeouts. Packet 0 now attests all three values using `pg_settings.setting::bigint` guarded by `unit = 'ms'` **on the same checked-out transaction**, before calling the data-inspection callback. Missing, relaxed, disabled, or malformed values fail closed, roll back, and do not report success. Local test recordings prove the inspection callback does not run on a bad attestation. This is not a new database policy, migration, authentication path or production runtime change.

Evidence: `node --test backend/test/packet0-reconciliation-snapshot.test.mjs backend/test/packet0-reconciliation-completeness.test.mjs` → **50/50 PASS**; two new regressions failed against the previous wrapper and now pass. The full Packet 0 run remains **BLOCKED** for unsupported Node/npm, absent authentic lockfiles, Flutter and approved NearPill Supabase staging credentials, not due to the new source-level tests. See the newest §28 Implementation Ledger entry and `docs/packet0-verification-2026-10-24-effective-timeouts-*.txt` for exact commands/outcomes. Production acceptance still requires real session-state, RLS, stock contention, data reconciliation, migration replay and restore checks.


## 2026-10-24 — Same-transaction `users` forced-RLS attestation (Packet 0)

The application-role fixture preflight already rejects a `users` table without
forced RLS (NP-031), but the subsequent read-only reconciliation transaction
rechecked only the original 25 other protected tables. Packet 0 now includes
`users` in its **26-table** transaction-local catalog check and requires an
exact, nonduplicated set of ordinary/partitioned relations with both
`relrowsecurity` and `relforcerowsecurity` true. Missing, swapped, repeated,
view-like, non-forced or unprotected catalog results fail before a reconciliation
PASS. This is defense in depth on the existing migrator-role read-only
snapshot; it is not a migration, RLS policy installation or permission bypass.

The reviewed migration history still does **not** enable/force users RLS or
prove backend authentication compatibility under that policy. NP-031 therefore
remains a **release and Packet 0 staging-acceptance blocker**, not a passing
security check. Recording-result tests provide only local verifier evidence.
Real role/grant, cross-tenant and authentication negative tests require an
approved NearPill-owned Supabase staging database; do not use an unrelated
project. Preserve Hono, backend sessions, Drizzle, RLS and business logic.

## 2026-10-24 — Packet 0: same-snapshot RLS policy and role boundary

The latest 537-file NearPill archive preserved the existing reviewed SQL migration history and source-backed application-role RLS policy inventory. A separate application-pool preflight compared `pg_policies` against that inventory, but the subsequent read-only reconciliation used a different checked-out migrator connection. It checked effective role and forced-RLS flags but **did not independently attest policies on that transaction's snapshot**; permission-broadening policy drift could therefore evade its second gate.

The existing verifier now **reuses** `POLICY_INVENTORY_PROBE_SQL`, `reviewedRlsPolicyInventory` and `assertActualRlsPolicyInventory` from the canonical live preflight, rather than defining new policies. It queries the actual reconciliation transaction before any private integrity SELECT, including the `users` and `nearpill_schema_migrations` exceptions to detect unreviewed new policies. The same-connection forced-RLS catalog check (26 protected tables, including `users`) and ordinary application-role non-bypass check were also moved ahead of private reconciliation queries. Both test suites now enforce this fail-closed ordering.

This is **source-level/test-double evidence only**, not a live RLS/security proof. The reviewed seven migrations still lack `users` forced RLS and its safe policy (NP-031), and live application-role tenant negatives, migrations, 100-way contention, backup/restore, provider verification, Flutter and supported builds remain **NOT RUN/BLOCKED**. No SQL migrations, PostgreSQL roles/grants, backend authentication, Hono, order/payment/inventory rules, React or Flutter code were changed. No legacy runtime deletion was authorized. Supabase PostgreSQL remains the selected provider, with separate direct migrator access and backend-owned authentication.

## 2026-10-24 — Migrator RLS visibility attestation (Packet 0 continuation)

The canonical PostgreSQL `migrator_all` policies grant the separately
approved non-owner, non-`BYPASSRLS` migrator full-row visibility for
read-only integrity reconciliation (`USING true WITH CHECK true`). The
existing catalog inventory validator checked policy identity/role/command,
but only validated predicate *restrictions* for the application role. An
unreviewed change to `migrator_all USING (tenant_id = ...)` could silently
hide bad tenant rows and produce a false zero-invalid-count result.

The same source-backed `assertActualRlsPolicyInventory` now requires
unconditional TRUE `USING` and `WITH CHECK` for the migration-authored
`migrator_all` policies. This check is executed both during preflight and
inside the reconciliation snapshot, before integrity SELECTs. Negative tests
cover absent, FALSE and filtered predicates; positive tests cover normalized
TRUE formatting. This **does not broaden** the ordinary `nearpill_app` role,
create a new policy, or replace live application-role isolation tests. A
separately approved staging migrator role is required; the current seven
migrations still lack the mandatory `users` forced-RLS policy (NP-031).

The local tests characterize and verify the assertion logic only, not actual
Supabase catalog values or all-row visibility on a deployed database.

## 2026-10-24 — App-role RLS tautological OR fail-closed characterization (Packet 0)

The reviewed policy catalog verifier already rejected a missing or standalone
`TRUE` application-role `USING`/`WITH CHECK` clause, but accepted a policy
retaining the approved name/role/command with an unconditional `OR true`
branch. Such a predicate can make an ostensibly restricted application policy
unrestricted without changing the tuple inventory. The existing shared
`assertActualRlsPolicyInventory` check now recognizes obvious tautological
boolean OR/AND combinations after removing whole-expression parentheses,
while respecting nested parentheses and SQL-quoted text. Recording tests prove
that SELECT/INSERT/UPDATE preflight rejects these expressions before the
migrator journal is accessed, and does not reject quoted `OR true` text or
conditional AND expressions. Both pooled preflight and same-transaction
reconciliation use this one validator; no duplicate policy authority exists.

This remains a **partial structural safety floor**, not complete SQL predicate
expression parity, static proof of tenant isolation, or live PostgreSQL/RLS
security evidence. The `users` forced-RLS and policy gap NP-031 remains OPEN.
No migration, runtime authorization, backend credentials, live database, web,
or Flutter files were modified. Supported Node 24/npm 11 builds, authentic
lockfiles, Flutter, and authorized NearPill Supabase staging RLS, data,
concurrency and restore gates remain NOT RUN/BLOCKED until independently
verified.

## 2026-10-24 — Numeric constant-true RLS predicate characterization (Packet 0)

The canonical live preflight/policy-reconciliation validator previously rejected
literal `OR true` bypasses but accepted a policy retaining its approved name,
role and command while appending `OR (1 = 1)`. PostgreSQL evaluates this
constant equality to true, so the application policy would no longer constrain
rows. The existing validator now recognizes exactly equal **integer literals**
within its existing parenthesis-aware AND/OR safety check. It rejects such
branches in application-role SELECT/INSERT/UPDATE policy predicates before
migrator-journal access or fixture writes. Quoted text, unequal constants,
and `AND`-guarded equalities remain permitted by this targeted assertion.
Both initial preflight and same-transaction reconciliation reuse the same
canonical validator; no new policy system, migration or runtime authority exists.

The check is intentionally not a general SQL expression prover or evidence of
actual Supabase RLS isolation. The unresolved NP-031 `users` forced-RLS/policy
migration, actual non-bypass application-role negative tests, Node 24/npm 11,
genuine lockfiles, Flutter and approved NearPill staging data, concurrency and
restore gates remain **NOT RUN/BLOCKED**. No production database connection,
policy change, or application business-logic change occurred in this packet.

## 2026-10-24 — Constant-ordering and inequality RLS safety floor (Packet 0)

The previously added policy guard recognized `OR true` and `OR (1 = 1)`,
but could accept equivalent constant-true comparisons such as `OR (0 < 1)`,
`OR (1 <> 2)`, or `OR (2 >= 1)` without changing the policy name, command,
role or permissiveness. The existing canonical PostgreSQL policy validator
now recognizes constant-true comparisons over **two integer literals only**,
using exact `BigInt` comparison. The checks cover equality, inequality and
ordering operators (`=`, `<>`, `!=`, `<`, `<=`, `>`, `>=`). A new test first
reproduced the bypass against the old validator, then passed with the change;
negative cases confirm non-true comparisons, row-dependent values, and quoted
SQL remain allowed by this intentionally narrow structural check.

The same validator is reused by both preflight and same-transaction
reconciliation. **This does not prove policy-expression equivalence or live
tenant isolation.** NP-031 (missing `users` forced-RLS/policy), real
application-role RLS negatives, approved NearPill Supabase staging, supported
Node/npm build, genuine lockfiles, Flutter and data/restore/concurrency tests
remain **NOT RUN/BLOCKED**. No database migrations, runtime identity/business
logic, production data, or deployment configuration changed.

## 2026-10-24 — Literal NULL tautology protection (Packet 0)

The shared policy-catalog preflight already rejected obvious unconditional
`OR TRUE` branches and true integer comparisons, but could accept a
`nearpill_app` RLS `USING` or `WITH CHECK` expression containing
`OR (NULL IS NULL)` or `OR (1 IS NOT NULL)`. These expressions are always
TRUE and can defeat otherwise valid actor/tenant guards under permissive
PostgreSQL RLS. The existing validator now detects **only** the constant
`IS [NOT] NULL` truth values for literal `NULL`, signed integers, and
`TRUE`/`FALSE`. It does not evaluate table columns, function calls, or
quoted SQL strings. This one canonical validator serves both preflight and
same-transaction reconciliation. A new regression reproduced acceptance of
the unsafe condition before the change and passed after the correction.

This is source-level, detection-only coverage, **not** SQL semantic parity
or live tenant-isolation evidence. The missing `users` forced-RLS policy
(NP-031), genuine lockfiles, Node 24/npm 11, Flutter and an approved
NearPill-owned Supabase staging project, plus real RLS/concurrency/restore
checks, remain blocked. No SQL migration or application behavior changed.

## 2026-10-24 — Constant boolean truth/negation RLS preflight (Packet 0)

The reviewed PostgreSQL policy-catalog verification rejected literal `OR TRUE`, true
integer comparisons and literal `IS [NOT] NULL` checks, but it did not reject
constant-true boolean alternatives such as `OR NOT FALSE`, `OR (TRUE IS TRUE)`,
`OR (FALSE IS NOT TRUE)` and `OR (NULL IS UNKNOWN)`. These expressions can
bypass an otherwise correctly named application-role `USING` or `WITH CHECK`
policy under PostgreSQL's permissive `OR` semantics. The same existing canonical
preflight/reconciliation validator now evaluates **only** negated literal `FALSE`
and literal `TRUE`/`FALSE`/`NULL` `IS [NOT] TRUE/FALSE/UNKNOWN` checks. It does not
evaluate functions, row-dependent expressions, or arbitrary SQL. Regression
coverage exercises SELECT, INSERT and UPDATE policies and confirms that
legitimate conditional and quoted-text examples remain accepted.

This is detection-only source characterization, not proof of RLS expression
parity or real tenant isolation. NP-031 (`users` forced RLS/policy), supported
Node 24/npm 11 and genuine lockfiles, Flutter, verified NearPill-owned Supabase
staging credentials, live app-role RLS negatives, data reconciliation,
concurrency and restore tests remain blocked. No SQL migration, runtime
business rule, credential or production data was modified.

## 2026-10-24 — Negated constant-FALSE RLS preflight (Packet 0)

The reviewed PostgreSQL app-policy catalog validator already rejects literal
`OR TRUE`, constant-true numeric comparisons, literal NULL tests, and simple
boolean truth tests. However, a logically identical condition such as
`USING (nearpill.current_actor_id() IS NOT NULL OR NOT (1 = 2))` was
accepted because negation was handled only for the literal `FALSE`.
The existing canonical validator now evaluates **only** negated, provably
false literal integer comparisons, literal NULL checks, and literal truth
checks. It leaves row-dependent expressions, SQL functions, casts, quoted
strings and unknown expressions untouched. SELECT, INSERT, and UPDATE
`USING`/`WITH CHECK` regressions exercise rejection before the migrator journal
is accessed. This shared validator already serves both the initial preflight
and same-transaction reconciliation; there is no second policy authority.

**Evidence limit:** Local mock-catalog contracts are not real PostgreSQL RLS
negative tests and cannot prove policy equivalence. NP-031 (`users` forced
RLS/policy) and the recorded authentication/payment/entitlement runtime
security risks remain open. Node 24/npm 11, genuine lockfiles, Flutter,
and a dedicated, owner-approved NearPill Supabase staging environment are
required for Packet 0 acceptance. No migration, live data or runtime business
logic was changed in this scoped verification packet.

## 2026-10-24 — Conservative nested boolean RLS policy checks (Packet 0)

The existing shared `pg_policies` verifier detected constant-TRUE OR arms and
simple negated literals, but missed nested expressions such as
`actor_is_verified OR NOT (actor_is_verified AND FALSE)` (which grants every
row regardless of the actor). Packet 0 now uses conservative three-state
constant folding for literal comparisons and boolean `OR`, `AND`, `NOT`:
`true`, `false`, or **indeterminate** for row-dependent/unsupported expressions.
An AND with a provably FALSE arm is FALSE; an OR with a provably TRUE arm is
TRUE; negation only reverses determinate constants. This is the same existing
preflight/reconciliation validator, not a new authorization system.

New SELECT/INSERT/UPDATE negative contracts verify that nested unconditional
branches fail before migrator-journal inspection. Control cases verify that
row-dependent predicates, indeterminate expressions, and quoted text are not
rejected as tautologies. Test evidence remains mock-catalog characterization,
**not real PostgreSQL tenant-isolation proof**. NP-031 (`users` RLS), runtime
security findings, supported Node/npm/Flutter builds, a verified NearPill-owned
Supabase staging project, real app-role/RLS negative tests, migration replay,
concurrency, reconciliation and restore remain acceptance blockers. No SQL
migration, runtime auth/business behavior, provider secret or live data changed.

### 2026-10-24 — Packet 0: constant-true COALESCE policy characterization

The reviewed RLS policy preflight and same-snapshot reconciler share a conservative boolean-expression safety floor. Previously, an application-role `USING`/`WITH CHECK` condition such as `actor_guard OR COALESCE(NULL, TRUE)` could appear restricted to this verifier even though the constant function arm makes it universally true. A red regression now characterizes that gap across SELECT/INSERT/UPDATE predicates. The existing evaluator now reads only comma-delimited, provably constant COALESCE inputs with nesting/SQL quote awareness; it refuses the unconditional fallback and preserves row-dependent `COALESCE(actor_guard, TRUE)` as indeterminate. It is **not** a SQL-equivalence proof and cannot replace real non-bypass RLS negative tests.

No source migrations, live RLS policies, auth, app/domain logic, React or Flutter were changed. `users` RLS NP-031 remains open. The final 0005 catalog policy does restrict public medicine reads to published rows, replacing the earlier temporary `USING (true)` from 0002; this review does not authorize broadening public catalog visibility. Node 24/npm 11 clean builds, authentic three npm lockfiles, Flutter and approved NearPill-owned Supabase staging/security/integrity/restore gates remain unavailable and **NOT RUN/BLOCKED**. See the 2026-10-24 COALESCE ledger entry in the master engineering plan for exact commands and evidence.

### 2026-10-24 — Packet 0: searched CASE unconditional-branch RLS policy characterization

The shared read-only application-role policy preflight previously treated even a simple
`CASE WHEN TRUE THEN TRUE ELSE FALSE END` as opaque. An app RLS predicate with
`actor_guard OR (CASE WHEN actor_guard THEN TRUE ELSE TRUE END)` can allow every
row despite appearing scoped by actor. This run adds a conservative recognizer
for **one searched CASE with an explicit ELSE** and evaluates only provable
boolean outcomes. Row-dependent branches and unsupported nested/multi-branch
CASE syntax remain indeterminate. The top-level boolean splitter also respects
CASE/END nesting, so a CASE-local `OR TRUE` in a condition selecting FALSE
cannot be mistaken for an unconditional outer OR grant.

Regression covers SELECT/INSERT/UPDATE USING and WITH CHECK and checks that
no migrator journal is read after a rejected policy. Positive controls preserve
row-dependent policy expressions and quoted SQL text. This same evaluator is
used by the preflight and the same-transaction reconciliation assertion; it is
**not** a PostgreSQL SQL-equivalence engine or proof of runtime tenant isolation.
No application routes, real RLS policies/migrations, Supabase settings, auth,
business logic, web, Flutter, or live database were changed. The existing
`users` forced-RLS finding NP-031 and all real Supabase/Node 24/npm 11/Flutter
acceptance gates remain open. See the October 24 CASE ledger entry and local
red/green/focused/full verification transcripts for exact evidence.

### 2026-10-24 — Packet 0: multi-arm searched CASE policy verification

The existing shared `pg_policies` preflight recognized only single-WHEN searched
`CASE`. A policy such as `actor_guard OR (CASE WHEN FALSE THEN FALSE
WHEN TRUE THEN TRUE ELSE FALSE END)` was therefore treated as indeterminate
and not flagged even though it permits all rows. A red-first characterization
proved that missing rejection. The existing conservative boolean evaluator now
recognizes explicit-ELSE searched `CASE` with multiple WHEN/THEN arms, computes
only provably constant reachable outcomes, and leaves row-dependent, nested
unsupported, or quoted expressions indeterminate. A CASE-local OR remains
within the CASE, not an outer policy grant. SELECT/INSERT/UPDATE `USING` and
`WITH CHECK` contracts verify rejection before migrator-journal reads; safe
controls protect against obvious false-positive denials.

This is **source-level fail-closed verification**, not PostgreSQL predicate
parity or real app-role RLS isolation. No runtime backend permissions, SQL
policies/migrations, authentication, business logic, React, Flutter, secrets,
or live Supabase data changed. NP-031 users-table forced-RLS and the Node 24,
npm 11, authentic lockfile, Flutter, owner-approved staging and real negative
RLS/reconciliation/concurrency/restore acceptance gates remain blocked. See
this date's multi-CASE ledger entry and local red/green/focused/full transcripts.

### 2026-10-24 — Packet 0: implicit-ELSE searched CASE RLS preflight

PostgreSQL treats a searched `CASE` without `ELSE` as having an implicit
`ELSE NULL`. The existing reviewed `pg_policies` boolean-shell verifier
previously parsed searched CASE only with an explicit ELSE. This allowed a
provably universal TRUE branch like `actor_guard OR (CASE WHEN TRUE THEN TRUE
END)` to escape its conservative unconditional-grant check. An executable
regression first demonstrated failure on a simulated SELECT USING predicate.
The **existing** preflight evaluator now accepts implicit-ELSE searched CASE
syntax and considers the implicit NULL only when a reachable fallback exists.
No row-dependent arm is assumed TRUE or FALSE. The regression covers SELECT,
INSERT and UPDATE USING/WITH CHECK, multi-WHEN, quoted text, and safe NULL/
row-dependent fallbacks; attempted universal predicates must be rejected
before the migrator journal is read.

This is a source-level recording-catalog negative test **not live Supabase RLS
proof**. No application auth, actual RLS SQL/migrations, Drizzle behavior,
orders, inventory, payments, web or Flutter were modified; no obsolete runtime
path was removed. The owner-approved staging project and real non-bypass
role/tenant tests, NP-031 users RLS, supported builds, concurrency and restore
remain acceptance blockers. See the newest Master Plan ledger entry and the
`docs/packet0-verification-2026-10-24-implicit-case-*.txt` transcripts.


### 2026-10-24 — Packet 0: application-role privileges that bypass row security

PostgreSQL row-level security covers ordinary row reads/changes, **not**
whole-table `TRUNCATE` or `REFERENCES`. The current read-only catalog preflight
already checked effective table and column grants for Supabase Data API roles,
but did not separately refuse these privileges for the *ordinary NearPill
application role*. Similarly, `TRIGGER` is not governed by a row predicate and
must remain privileged migration/operator work, not runtime app authority.
An incorrectly granted app login could therefore pass the former RLS preflight
without being tenant-safe. This is a finding about the **verification gate**,
not evidence any NearPill live database had the unsafe grants.

The existing `assertSafeLiveFixtureConnections` table probe now returns
explicit fail-closed booleans for app role `TRUNCATE,REFERENCES,TRIGGER` on
all reviewed public tables, `REFERENCES` at column level, and both permissions
reachable through `SET ROLE` even without inherited rights. This includes
`users` (NP-031 remains open) and the migrator-only migration journal. Every
flag must be exactly false before reading the migration journal or allowing
fixture writes. The preflight remains read-only; no migrations or live grants
were edited. The new recording-catalog regression covers all four failure
paths, true/null/unavailable values, protected order/inventory/identity tables,
and positive clean-grant controls. It was red before and green after the fix;
adjacent reconciliation contracts passed. This static/recorded evidence **is
not** a real PostgreSQL privilege, tenant-negative or production-ready proof.

### 2026-10-24 — Packet 0: PostgreSQL MAINTAIN privilege preflight (source-only)

PostgreSQL 17+ exposes per-table `MAINTAIN` and predefined `pg_maintain` role
permissions (including REINDEX, CLUSTER, LOCK TABLE, VACUUM and ANALYZE),
independent of ordinary row-level predicates. The existing read-only
`assertSafeLiveFixtureConnections` guard already denied `TRUNCATE`, `REFERENCES`
and `TRIGGER` privileges but omitted MAINTAIN and role inheritance through
`pg_maintain`. An ordinary application role with such access must not be
accepted as least-privilege merely because its RLS policies are forced.

The existing PostgreSQL catalog preflight now rejects `pg_maintain` role
membership and MAINTAIN table rights for app/Data API roles (effective,
PUBLIC, SET ROLE-reachable and explicit future-object default ACL paths).
The migrator is also rejected for unreviewed `pg_maintain` membership.
The new source/recording-probe regression failed against the prior verifier
and passes with this change, without any live SQL grants/migrations/fixtures.
**This is not a real PostgreSQL role/tenant test**: NP-031 `users` forced RLS,
approved NearPill Supabase staging app-role negative tests, supported Node/npm
and Flutter builds, migration/stock contention and restore gates remain blocked.
See the final master plan ledger entry and
`docs/packet0-verification-2026-10-24-maintain-{red,green,focused,full}.txt`.

### 2026-10-24 — Packet 0: global PostgreSQL role membership preflight (source-only)

Official PostgreSQL 18 role documentation identifies `pg_read_all_data` and
`pg_write_all_data` as global object privileges **that do not themselves bypass
RLS**, but that defeat an intended least-privilege object-grant boundary.
It also describes `pg_read_server_files`, `pg_write_server_files` and
`pg_execute_server_program` as server access privileges which bypass database
permission checks and can permit superuser-level escalation. The previous
read-only NearPill preflight rejected superuser/BYPASSRLS/pg_maintain role paths,
but omitted these global roles, including transitive membership via SET ROLE.
This is a *verification gap*, not evidence that a live NearPill environment
actually grants any of these roles.

The existing role probe now checks those five prohibited predefined roles for
both the backend application login and the Supabase `anon`/`authenticated`
roles, via transitive `pg_has_role(..., 'MEMBER')` checks. Both app and migrator
preflights require the Data API result to be exactly false, including for
unknown/missing catalog responses, before touching the migrator journal or
writing synthetic fixtures. No database/role grants, migrations, production
authorization, React/Flutter or business logic were changed. The regression
was intentionally red before the verifier fix; it passes after the fix.

Official reference: https://www.postgresql.org/docs/18/predefined-roles.html .
Recording SQL-mock checks are **not** actual PostgreSQL role isolation proof;
NP-031 and all live/staging acceptance gates remain BLOCKED/NOT RUN until
owner-approved NearPill Supabase infrastructure and supported build tools exist.

**Verification evidence:** Red-first regression exit 1, green rerun 1/1; focused RLS/reconciliation 153/153 PASS. Full `bash scripts/verify-packet0.sh` exit 2 (BLOCKED), with 572/572 characterization PASS and runnable Node baseline 694 PASS / 1 SKIP. Source integrity 301/301, syntax 140 files, and heuristic secret scan passed. Live Supabase app-role, migration/reconciliation, contention and restore tests remain NOT RUN. See `docs/packet0-verification-2026-10-24-global-roles-{red,green,focused,full}.txt`.

### 2026-10-24 — Packet 0: application-role default ACL escalation preflight

The existing read-only `pg_default_acl` preflight rejected global and
schema-specific future-object grants to `PUBLIC` and Supabase Data API
`anon`/`authenticated` roles, but did not inspect explicit grants to the
ordinary NearPill application role. A future table, routine, or sequence
could therefore acquire permissions as soon as an approved migrator created
it, independently of the current 27-table ACL/RLS inventory. Under the
approved least-privilege model, application access to new objects must come
from a reviewed migration's explicit object grants, never an unreviewed
`ALTER DEFAULT PRIVILEGES` side effect.

The existing catalog query now conservatively rejects explicit future-object
default ACL grants reachable by `current_user`, through either inherited
`USAGE` rights or `SET ROLE` (even if not inherited), in addition to its
existing `PUBLIC`/Data API checks. Its returned rows remain read-only and
fail closed *before* migrator journal access or fixture writes. The new
red-first recording-contract regression verifies both PostgreSQL membership
paths in the actual query and rejects simulated future TABLE, SEQUENCE, and
FUNCTION grants. No SQL migration, runtime DB grants, authentication,
Drizzle model, business behavior or live Supabase target was modified.

Official basis: https://www.postgresql.org/docs/18/sql-alterdefaultprivileges.html
and https://www.postgresql.org/docs/18/role-membership.html . This is a
source-level/catalog-query contract, **not** proof of live application-role
RLS isolation or successful migration/restore. NP-031 users forced-RLS,
supported runtime builds and all approved Supabase staging gates remain
BLOCKED or NOT RUN. Evidence is in this run's ledger entry and the
`docs/packet0-verification-2026-10-24-app-default-acl-{red,green,focused,full}.txt`
transcripts.

### 2026-10-24 — Packet 0: PostgreSQL monitoring and operational roles (source-only)

The live-read-only role preflight already rejected global table and server-file
privileges, but did not explicitly reject the predefined `pg_monitor`,
`pg_read_all_settings`, `pg_read_all_stats`, `pg_stat_scan_tables`,
`pg_signal_backend`, or `pg_checkpoint` roles. These can reveal otherwise
restricted PostgreSQL configuration or session statistics, acquire table locks,
or disrupt backend sessions/operations; their membership is not appropriate for
the ordinary NearPill app, migrator-verification identity, or Supabase exposed
`anon`/`authenticated` logins. PostgreSQL 18 role reference:
https://www.postgresql.org/docs/18/predefined-roles.html .

The **existing** read-only `ROLE_PROBE_SQL` now includes these six operational
and monitoring roles in both application and client membership inventory via
transitive `pg_has_role(..., 'MEMBER')` checks. Existing preflight evaluation
rejects true or unknown elevation results before accessing the migration
journal or performing fixture writes. A red-first regression checks that both
role queries contain the exact role names and remain read-only; recording pools
cannot establish real Postgres membership or RLS behavior. No production SQL,
authorization, migration, application, or staging database was changed.

**Environment limitation:** the supported Node/Flutter/dependency toolchain,
NearPill-owned Supabase staging database, NP-031 forced-RLS resolution, and
real RLS/concurrency/reconciliation/restore gates remain blocked or not run.
See this run's Implementation Ledger and corresponding verification transcripts.

### 2026-10-24 — Packet 0: PostgreSQL URI query-password source-artifact characterization

PostgreSQL's `libpq` supports database credentials supplied through URI query
parameters (`password`, with percent-encoded parameter names permitted) in
addition to `user:password@host` userinfo. The canonical source scanner only
covered the userinfo form, so a usable database password in a query string
could pass the Packet 0 secret/artifact scan. This is a source-package
verification gap, **not evidence of a leaked real credential**.

The existing `scripts/secret-scan.mjs` now scans `postgres://` and
`postgresql://` query parameters for `password` and `sslpassword`, decoding
parameter names with URL parsing. It retains the existing narrow placeholder
exception (`[YOUR-PASSWORD]` and `${DATABASE_PASSWORD}`), never prints values,
and remains part of both the Packet 0 verifier and the atomic package-source
preflight. A red-first fixture test in `backend/test/packet0-secret-scan-gate.test.mjs`
proves detection of normal, percent-encoded, and host-query URI variants plus
placeholder acceptance. No connection settings, credentials, Drizzle models,
RLS policy, SQL migrations, or application behavior were changed.

Official source: https://www.postgresql.org/docs/18/libpq-connect.html .
All approved Supabase staging, NP-031 users FORCE RLS, Node 24/npm 11,
Flutter, real tenant-negative, migration, 100-way stock and restore acceptance
gates remain **NOT RUN/BLOCKED**, regardless of passing scanner contracts.
See the corresponding dated Implementation Ledger entry and
`docs/packet0-verification-2026-10-24-query-password-{red,green,focused,full}.txt`.

### 2026-10-24 — Packet 0: libpq keyword/value connection-string password scanning

PostgreSQL also accepts `libpq` keyword/value connection strings, independently
of URI userinfo/query syntax. The existing canonical source-artifact scanner
could accept a literal password embedded in a recognizable keyword/value
connection string. A red-first fixture reproduced the missed credential;
this is a **scanner coverage gap, not evidence of an actual leaked secret**.

The **existing** `scripts/secret-scan.mjs` now checks same-line, recognizable
connection contexts (`host`, `hostaddr`, `dbname`, `service`, `user`) for
non-placeholder `password` or `sslpassword` values. It handles ordinary and
quoted values, uses the existing narrow environment/documentation-placeholder
exception, and emits only the file path, never the secret. The negative
regression and placeholder controls live in the existing
`backend/test/packet0-secret-scan-gate.test.mjs`; no second scanner was added.
This conservative pattern check is **not** a complete libpq grammar parser or
an attestation of repository history/production credentials.

Official syntax: https://www.postgresql.org/docs/18/libpq-connect.html .
The verification is source-only; it changes no application DB connections,
backend authentication, Drizzle migrations, PostgreSQL RLS, business logic,
React, Flutter, or live Supabase state. Supported runtime, genuine dependency
lockfiles, the approved NearPill-owned Supabase staging target, NP-031 forced
RLS, live tenant negatives, 100-way stock tests and backup/restore acceptance
remain **NOT RUN/BLOCKED**. See the ledger and
`docs/packet0-verification-2026-10-24-conninfo-{red,green,focused,full}.txt`.

## 2026-10-24 — libpq password files and service profile source-artifact characterization

The existing first-party scanner recognized PostgreSQL URI and keyword/value
credentials, but did not refuse libpq's dedicated `.pgpass` / Windows
`pgpass.conf` files (not in its inspected text-extension set). PostgreSQL also
supports multi-line INI-style `.pg_service.conf` / `pg_service.conf` profiles:
a literal password on a separate line from the host evaded the scanner's
same-line conninfo check. A source-only regression first reproduced the gap.

The in-place `scripts/secret-scan.mjs` now fails closed on actual libpq
password-file names even without recognizable token prefixes, and inspects
PostgreSQL service-profile files for literal `password` / `sslpassword`
settings across lines. It allows explicit `${ENV_VAR}` or bracketed
placeholder settings in otherwise non-secret service profiles. Diagnostics
identify only the source file, never a credential value. The existing scanner
remains the sole packaging and Packet 0 secret-scan gate; this is a heuristic
first-party package check, **not** Git history scanning or real database
credential validation. PostgreSQL documentation:
https://www.postgresql.org/docs/18/libpq-pgpass.html and
https://www.postgresql.org/docs/18/libpq-pgservice.html .

No Hono/auth, Drizzle schema or SQL migration, RLS policy, React, Flutter,
Supabase endpoint or live database state was changed. Supported toolchain,
source lockfiles and real app-role/staging security/integrity/restore gates
remain blocked pending external prerequisites.


## 2026-10-24 — fail-closed pre-destructive restore catalog check

Baseline finding: `backend/scripts/restore-postgres.sh` validated the isolated
local test database and the presence of a `.dump` file, but executed
`pg_restore --clean` without checking whether the archive catalog was readable.
A new fake-`pg_restore` regression first reproduced the omission (expected
**RED**); the existing restore entry point now checks `pg_restore --list` in
an empty environment before destructive invocation, and returns **BLOCKED**
for an unreadable archive. Backup publication already performed the same
catalog-only inspection; this does not create another adapter or database.

No live restore was run. Catalog readability is **not** full archive or data
integrity, and no live tenant/RLS, concurrency, migration or recovery gate can
be accepted without the owner-approved NearPill staging environment and tools.
Full evidence and rollback are in the 2026-10-24 master Implementation Ledger.


### 2026-10-24 — Packet 0: stable archive snapshot before destructive restore

The existing local-test-only restore script already checked the supplied
archive's `pg_restore --list` catalog before `pg_restore --clean`. However, both
invocations reopened the caller-controlled path. A red-first fake-tool test
showed that changing the source after inspection could cause the destructive
restore to read **different bytes** than those validated by the catalog check.

The same existing `backend/scripts/restore-postgres.sh` now rejects symlinked
inputs, copies a regular archive into a private 0700 staging directory with a
0600 copy, and runs both `--list` and `--clean --single-transaction` against
the exact staged path. It removes the temporary copy on exit, including on
failure. Tests prove a post-inspection source mutation cannot affect the bytes
read by the restore invocation, and that symlinks fail before `pg_restore`.
No second script, database adapter or production path was created.

This addresses a local verification-time TOCTOU gap; it does not prove that
an archive is safe SQL, that its data pages are intact or that the database
can be restored. Real Supabase staging recovery, app-role RLS, migration replay,
100-way inventory contention, NP-031 `users` forced-RLS, Node 24/npm 11,
Flutter and genuine lockfiles remain **NOT RUN/BLOCKED**. See the corresponding
Implementation Ledger entry and generated local test transcripts.


### 2026-10-24 — Packet 0: offline restore payload verification

A verified table-of-contents (`pg_restore --list`) does not require the archive's
compressed data sections to be successfully extracted. The existing
`backend/scripts/restore-postgres.sh` therefore now runs a second *offline*
`pg_restore --file=/dev/null --no-owner --no-acl` against the identical
private staged `.dump`, with an empty child environment and all SQL/data
output suppressed, **before** the confirmed loopback-only destructive restore.
A malformed payload causes a fail-closed exit 2. The test uses a mock
`pg_restore` to model a readable catalog and unreadable payload; it fails before
this change and passes afterward. The backup/restore contract test asserts
that TOC, full-payload read and destructive restore all use one private file.

This source-level verification does not execute archive SQL or contact a
database. It is **not** evidence that dumped SQL is trustworthy, that schema
or privilege data are correct, or that a real restore succeeds. A disposable
PostgreSQL restore and the owner-approved Supabase staging gates remain
**NOT RUN/BLOCKED**, including NP-031, real cross-tenant RLS, migration replay,
100-way contention, data reconciliation, supported toolchain and Flutter.
Evidence and next safe packet are in the canonical Implementation Ledger.


### 2026-10-24 — Packet 0: JDBC short-form connection secret characterization

The source package preflight already rejected password-bearing libpq connection
URLs, PostgreSQL query-password parameters and keyword/value conninfo. It also
recognized ordinary PostgreSQL JDBC URLs containing `//host`, because those
contain a matching libpq-shaped URL substring. However, pgJDBC additionally
accepts a short database-name URL form without `//host`; a literal password
query parameter in that form was not inspected. A Node regression using an
isolated synthetic `.properties` and JSON source fixture reproduced that gap.

The existing `scripts/secret-scan.mjs` now checks the short JDBC form,
including percent-encoded password parameter names, without printing secrets;
placeholder-only examples remain permitted. This is a Packet 0 **source-package
verification** improvement, not a new database adapter or authentication path.
The app's live database configuration, migration/RLS policies and business logic
were not changed. The regression and local manifest/secret scan are reproducible
under the current Node 22 environment; supported Node 24/npm 11 and genuine
Supabase PostgreSQL acceptance remain separately blocked. The ledger records
the commands, limits, and next safe packet.

pgJDBC URL reference: https://jdbc.postgresql.org/documentation/use/


## 2026-10-24 — Exact-path verified source ZIP publication (Packet 0 continuation)

The existing `scripts/package-source.sh` already scans the source tree, stages a ZIP outside it, tests its CRC, and reruns the complete source-manifest and secret checks against the extracted stage. However, its final `mv -f` treated a destination replaced with a directory symlink as a directory and could report successful publication while placing `source.zip` inside that directory. The focused regression reproduced this behavior before the fix.

The same packager now invokes GNU `mv -f -T --` for the final move. The red/green security contract models both a late directory symlink (the archive must land at the exact output filename, not inside the link target) and a late real directory (publication must fail). No runtime app path or database/policy behavior changed. This only guards the local source-handoff tool; it does not authenticate a Git revision or establish a supported build, live RLS, or production readiness.

**Acceptance remains BLOCKED:** supported Node 24/npm 11 and authentic npm locks, Flutter, and a NearPill-owned Supabase PostgreSQL staging target with real app-role/RLS and data-integrity proof are still required, including NP-031 `users` forced-RLS verification.


## 2026-10-24 — Bind source ZIP to the initially reviewed manifest (Packet 0)

The source packager's second manifest verification previously used the manifest
*inside* the staged ZIP. A concurrent change to both a reviewed source file
and the unlisted manifest after preflight could therefore publish an archive
consistent with itself but inconsistent with the source just approved. A
synthetic intercepted-`zip` regression reproduced this acceptance gap before
the fix. The canonical `scripts/package-source.sh` now takes the manifest SHA-256
before source preflight and verifies it against the extracted stage before
publication. This rejects the swapped-manifest case while preserving valid
source ZIP replacement and the existing secret, CRC and file-set checks.

This is an in-process consistency control, **not** a trusted Git revision,
signed attestation, or real database security gate. Node 24/npm 11,
genuine lockfiles, Flutter and owner-approved NearPill Supabase PostgreSQL
app-role/RLS, migration, contention, reconciliation and restore evidence remain
**NOT RUN/BLOCKED**, including NP-031 `users` forced RLS.

### 2026-10-24 — Mobile signing and configuration source-artifact gate

The existing Packet 0 source scanner now fails closed on Apple `.p8` signing keys and `.mobileprovision` provisioning material even without recognizable token contents; it also treats `.plist`, `.xcconfig`, `.pbxproj`, and `.svg` as text for existing high-confidence secret detection. A synthetic key/profile and platform-config regression failed before the change and passed afterward. This is a packaging security characterization only, not iOS release-signing verification or a real application build. See the matching Implementation Ledger entry for runnable test evidence and blocked environment gates.


### 2026-10-24 — Extension-independent readable-source credential preflight

The existing Packet 0 source-artifact scanner now checks **all UTF-8-readable first-party files**, not only a fixed list of recognized extensions. The regression demonstrates that high-confidence synthetic tokens in `scripts/deploy.py`, `.envrc`, and an extensionless deployment credentials file were previously skipped and now fail closed with filename-only diagnostics. Binary assets containing NUL bytes or invalid UTF-8 are not interpreted as source text; a known text configuration containing NUL bytes fails closed rather than being silently skipped. The scanner remains heuristic and cannot attest to embedded binary secrets, Git history, or runtime configuration. Production Hono/auth/Drizzle/RLS, React/Flutter and live PostgreSQL are unchanged. The master Implementation Ledger records test results and environment gates.


## 2026-10-25 — Packet 0 Node runner: disjoint test sets

The baseline runner previously executed every `backend/test/packet0-*.test.mjs` file once as characterization and **again** inside `backend/test/*.test.mjs`. This duplicate process-level execution contributed to the previous complete-wrapper timeout. The existing `scripts/verify-packet0.sh` now discovers the full Packet 0 list as before and runs the remaining backend Node test files plus root contracts separately, preserving the union of all first-party test files while avoiding repeat runs. The unsupported Node 22 fallback additionally excludes only `password-migration.test.mjs`, whose Node 24 built-in Argon2 API is unavailable. Source- and environment-gate semantics, final BLOCKED status and Supabase RLS checks remain unchanged. Regression: `backend/test/packet0-acceptance-gates.test.mjs`; see the latest master Implementation Ledger for actual command counts and remaining blocked acceptance gates.


## 2026-10-25 — Packet 0 Node test inventory: CommonJS and JavaScript coverage

The existing disjoint runner included every `backend/test/*.test.mjs` and `test/*.test.mjs` file, but named `test/web_service_information.test.cjs` individually. This could omit newly introduced backend/root `.test.cjs` and `.test.js` contracts while reporting a successful runnable baseline. The canonical `scripts/verify-packet0.sh` now discovers all three supported first-party Node test suffixes in both `backend/test/` and `test/`, excluding only previously executed Packet 0 `.mjs` characterization files from the second run. Both the supported Node 24 path and unsupported-runtime diagnostic subset receive the discovered root inventory; only the known Node-24-specific password migration contract is excluded from the latter. An empty root test inventory fails closed. The existing `backend/test/packet0-acceptance-gates.test.mjs` records the red/green source-contract regression. No live database assertions are implied by local test coverage; see the latest master ledger for command evidence and unverified Supabase, Flutter, and lockfile gates.

## 2026-10-25 — Nested archive source-artifact gate (Packet 0)

The canonical `scripts/secret-scan.mjs` rejects first-party nested compressed archives by reviewed file extensions or recognized binary headers, including renamed ZIP data. An opaque archive can contain environment files or private signing credentials without exposing them to the source text detectors; a SHA-256 manifest alone only covers the outer archive bytes. Regression tests in the existing `packet0-secret-scan-gate.test.mjs` characterize this fail-closed source-packaging boundary. Ordinary binary images remain allowed. This is not an archive-content inspection, complete secret scan, live database verification or application behavior change.

## 2026-10-25 — Pre-execution source-integrity gate (Packet 0)

The single canonical Packet 0 runner formerly executed discovered first-party Node tests (and, on supported tooling, could begin dependency installation) **before** verifying the source manifest and scanning for packaged secrets. In a disposable red-first fixture, an unreviewed `backend/test/packet0-*.test.mjs` symbolic link executed code outside the project before the later source checks rejected the symlink. The new regression isolates the subprocess from Node's nested-test context to reproduce this without any live credentials or database access.

`scripts/verify-packet0.sh` now runs the **existing** secret scanner and complete SHA-256 first-party file-set verifier before any tests or `npm ci`, and terminates immediately with exit 1 on either failure. The later duplicate scan invocations were removed; the same required checks run exactly once. This prevents execution of unreviewed first-party tests under the tested source-integrity boundary. It does **not** prove the origin/authenticity of a user-supplied manifest, nor replace a signed release, Git revision, dependency provenance, or live Supabase PostgreSQL security and data-integrity acceptance. Hono authentication, Drizzle migrations, RLS and all application behavior remain unchanged. The master ledger records test evidence and outstanding environment gates.

## 2026-10-25 standalone mobile source-integrity parity (Packet 0 continuation)

The standalone `scripts/verify-mobile.sh` is a separate executable entrypoint that
runs first-party Node architecture tests and (when installed) Flutter dependency
resolution. Previously it could run a changed test file before verifying the
reviewed source. The canonical Packet 0 verifier already had a pre-execution
source gate; this update applies those **same existing** `secret-scan.mjs` and
`verify-source-manifest.mjs` checks before the standalone command executes
mobile tests or dependencies. A synthetic changed test in a disposable copied
source tree now causes exit 1 and does not execute. This is a local source
consistency check, not an authentication signature, actual mobile build, or
NearPill-owned Supabase RLS test. Flutter SDK and database acceptance remain
blocked until genuine supported resources are available.

## 2026-10-26 — Latest packaged-source reconciliation (Packet 0 continuation)

The above **20 October snapshot** is historical; its 250 extracted-file
count does not describe today's latest handoff. On 26 October the latest
available Packet 0 archive was reconciled byte-for-byte against the existing
working tree: **799 application/document/evidence files**, **zero missing**
and **zero different**. Input artifact SHA-256:
`fe52e43c455459373cb42f05cf20dab2b8d175bc9879ac35b197689c23dcb14e`.
The archive lacks `.git`, so branch and HEAD cannot be attested. The reviewed
manifest contains **311 first-party files**, excluding designated evidence
and generated directories; the code continues to have **seven** reviewed
PostgreSQL migration SQL files, **61** characterized Hono v1 routes,
**41** Flutter source Dart files, **four** Flutter Dart test files, and
**ten** React web `src` TS/TSX files. These are source inventory counts, not
production deployment or accepted feature parity evidence.

This continuation fixes a source-review blind spot: directories named as
build output were ignored even when nested inside active first-party source.
Two red-first regression tests showed that both the source manifest verifier
and the source-secret scanner silently skipped such paths. The existing
scanners now reject generated-name directories nested under code, test,
script, and infrastructure source trees, while leaving normal root/backend/web
build outputs excluded. No new backend, database, auth, payments, web or
Flutter implementation has been introduced. See the newest §28 ledger entry
for exact commands, red/green results and blockers.

**Gate decision:** Packet 0 remains **ACTIVE / ACCEPTANCE BLOCKED**; runnable
Node characterization does not prove supported Node 24/npm 11/lockfile builds,
Flutter tests, NearPill-owned Supabase PostgreSQL role/RLS checks, NP-031
`users` FORCE RLS remediation, migration replay, 100-way inventory contention,
financial reconciliation or backup/restore. No production credentials, roles,
data or SQL migrations were changed. Next safe work is **Packet 0 acceptance
continuation**, not a dependency-blocked subsequent packet.

## 2026-10-26 — Packet 0 served/bundled asset source-integrity characterization

Verified the latest supplied Packet 0 source package matches the active workspace
byte-for-byte before edits (804 files; no verifiable Git HEAD). The prior nested
source-directory fix covered `backend/src`, `web/src`, `lib`, and selected test
and infrastructure roots, but still excluded `build`, `dist` and `node_modules`
directories under runtime-delivered `backend/public`, `web/public`, and Flutter
`assets` paths. Two red-first source-fixture regressions reproduced those omissions.
Both existing scanners now refuse such nested directories and retain ordinary
generated root/backend/web output exclusions; the full evidence is recorded in
the master Implementation Ledger §28. No application business logic or SQL
migration is changed. Packet 0 remains acceptance-blocked pending supported
runtime/dependency locks, Flutter and owner-approved NearPill Supabase RLS,
concurrency, migration and restore evidence, including NP-031.

## 2026-10-26 — Packet 0 reviewed migration-directory exclusion guard

Both source verification tools formerly excluded generated-name directories
within the canonical `backend/migrations` SQL history. Fixture regressions
showed that `backend/migrations/postgres/dist/hidden.sql` was skipped. The
existing manifest verifier and secret scanner now fail closed on the
canonical migration subtree, preserving normal root/backend/web build
exclusions and leaving all seven SQL migrations unchanged. The red-first and
green evidence is in ledger §28. No live database, authentication, RLS,
order, or payment behavior was modified; the supported-runtime and owner-
approved Supabase app-role/RLS/migration/concurrency/restore gates remain
NOT RUN / BLOCKED.

## 2026-10-26 — Packet 0 local CI-action source review

The existing manifest verifier and source-secret scanner already protected
`.github/workflows` but not executable local GitHub Action code in
`.github/actions` and `.github/scripts` when a generated-name directory (for
example `dist` or `node_modules`) was nested underneath. Two disposable
source-fixture regressions failed before the change and now pass after the
same fail-closed nested source-path policy was extended to these two paths.
No such unreviewed directory is claimed to exist in the real project; this
is a characterization and verification-tooling change only. All canonical
migration SQL, Hono/Drizzle/auth/RLS business logic, web and Flutter files
remain unchanged. Packet 0 stays ACTIVE / BLOCKED until supported Node/npm,
original lockfiles, Flutter and an approved NearPill-owned Supabase staging
RLS/migration/concurrency/recovery gate can be executed, including NP-031.

## 2026-10-26 — Case-insensitive archive path collision characterization (Packet 0)

Linux can store `README.md` and `readme.MD` (and `components/` and
`Components/`) as distinct reviewed archive entries. Default Windows file
handling can alias those names, so an otherwise hash-valid archive might not
restore both files faithfully on a target developer workstation. The existing
manifest verifier and source-secret scanner did not reject those collisions.
The latter also recognized `.env` only with exact lowercase spelling, although
`.ENV` and `.Env.Production` are equivalent on common Windows filesystems.

Four disposable test cases reproduced these gaps before the existing verifiers
were modified. Both scanners now reject case-folded/NFC-normalized sibling
name collisions before excluded/generated-directory processing; the source
scanner also rejects case-variant local environment files. The behavior
changes only the offline first-party source validation/handoff, not running
Hono, identity, Drizzle, SQL migrations, RLS, React, Flutter or PostgreSQL.
The canonical manifest still covers 311 existing files. Real Supabase tenant
RLS, migration replay, 100-way stock contention, reconciliation, backup/restore,
supported Node/npm/Flutter builds and NP-031 remain NOT RUN/BLOCKED. Exact
commands and hashes are in the master Implementation Ledger. No database
rollback is required to reverse these scanner and regression changes.


## 2026-10-26 — Windows-reserved source path characterization (Packet 0)

The existing case-collision checks did not reject valid Linux filenames which
are unsafe for ordinary Windows extraction: `AUX.txt`, `COM¹.log`, a colon
within a filename and trailing dot/space. Both complete-manifest and secret
scan fixtures reproduced the gap (two failing test cases before changes).
Both existing scanners now reject those non-portable path components, including
directories, without creating an alternate source/package system. The tests
passed after the fix. The 311-entry reviewed baseline remains one canonical
source inventory; no SQL migration, authentication/RLS or business logic was
changed. The full acceptance gates remain blocked by supported Node/npm and
Flutter toolchains, authentic lockfiles, owner-approved NearPill staging and
NP-031/live tenant, inventory, financial and restore verification. Consult the
master Implementation Ledger for exact commands and regression evidence.

### 2026-10-26 — Windows CMD PostgreSQL credential preflight characterization

- Verified latest source handoff: `NearPill_Packet0_Windows_Portable_Paths_2026-10-26.zip` (822 source/evidence files matched local workspace); no Git HEAD or owner-approved NearPill Supabase staging identity in source.
- Scope: existing source scanner missed CMD quoted `set` and persistent `setx` libpq-password assignments in `.cmd`/`.bat`. Regression red-first; existing scanner now rejects literals while allowing external `%VARIABLE%` / `!VARIABLE!` references.
- Backend, PostgreSQL/Drizzle SQL migration history, RLS, auth, React, Flutter and business logic unchanged. Full acceptance requires pinned Node/npm, authentic lockfiles, Flutter and live NearPill-only Supabase RLS/migration/restore evidence. NP-031 remains OPEN.

## 2026-10-26 — Executable deployment-script decoding characterization (Packet 0)

**Finding:** The canonical source-secret scanner attempts to decode all first-party
files but treated unknown extensions as potentially binary. Malformed UTF-8 in
`.ps1`, `.psm1`, `.cmd`, `.bat` and `.py` executable deployment scripts could
therefore be silently omitted from scanning. A disposable invalid-UTF-8 PowerShell
fixture reproduced the miss before this change. The existing mandatory-text
classification now covers those script suffixes and `.psd1`, rejecting unreadable
text rather than reporting a clean source scan. Normal readable scripts and the
previously supported BOM-marked UTF-16 cases still pass.

This is local Packet 0 source-characterization coverage, not actual script
execution/semantic validity, live Supabase least-privilege verification or a
production migration. The seven reviewed SQL migrations, Hono identity, Drizzle,
RLS, checkout, payments, React and Flutter remain unmodified. The same blocked
Node/npm/lockfile/Flutter/approved NearPill Supabase RLS, NP-031, migration,
stock contention and recovery gates remain NOT RUN/BLOCKED. See the master
ledger for exact test commands and evidence.

## 2026-10-26 — Bootstrap trust for source-verification tools (Packet 0)

**Finding:** The existing Packet 0, foundation, mobile and packaging shell
entrypoints executed `scripts/secret-scan.mjs` *before* comparing that
executable checker with the reviewed source manifest. An altered checker could
therefore run unreviewed Node code, potentially performing side effects, before
the later complete-source gate detected its modification. A disposable fixture
confirmed the side effect prior to correction; no real repository credential
or exfiltration was observed.

**In-place correction:** All four entrypoints now check the hash and regular-
file/non-symlink status of **both** Node source-verification programs against
exactly one SHA-256 record each in the existing reviewed manifest before
launching Node, also rejecting symlinked checker/manifest directories. Regression fixtures exercise both altered tools and all four
entrypoints, retaining the existing Node version, post-execution manifest,
secret-scan and output-preservation behavior. The shell entrypoint and manifest
are assumed trusted—this is not cryptographic external provenance and does
not protect against a compromised shell host. Node 24/npm 11 lockfiles,
Flutter and explicitly authorized NearPill Supabase staging RLS, NP-031,
transaction/concurrency/reconciliation/restore gates remain BLOCKED/NOT RUN.
Existing Hono/auth, Drizzle and seven SQL migrations remain unchanged.

## 2026-10-26 — Case-insensitive npm source secret characterization (Packet 0)

**Finding:** The source scanner identified `.npmrc` and npm lockfiles by exact
case when applying their extra registry-credential checks. A source ZIP intended
for case-insensitive Windows extraction could therefore contain `.NPMRC` with
an opaque inline npm token or `PACKAGE-LOCK.JSON` with an authenticated registry
URL without triggering the specialized checks. A disposable fixture demonstrated
this miss before the change (expected RED).

**In-place characterization fix:** `scripts/secret-scan.mjs` now case-folds
conventional config/lockfile basenames before required-text and npm credential
checks. The existing scanner and single source manifest remain authoritative;
no new scan subsystem was created. The regression also confirms external npm
secret references and credential-free public registry URLs remain allowed.
This does not prove live environment credential hygiene. Hono, backend identity,
Drizzle and the seven SQL migrations, RLS, React, Flutter, and business logic
remain untouched. Packet 0 acceptance remains **BLOCKED** pending the supported
toolchains, three authentic lockfiles, and expressly authorized NearPill Supabase
staging for NP-031/RLS, transaction, inventory and restore evidence.

## 2026-10-26 — PostgreSQL backup artifact source-exclusion gate (Packet 0)

**Finding:** The source scanner rejected compressed archives but could accept
PostgreSQL custom-format `PGDMP` exports under unknown binary filenames, or
`.dump` / `.backup` files with no recognizable embedded credential. The source
packager does not use Git's `.gitignore` to decide what to include, so
ignoring `*.dump` in Git did not protect distributable source. A disposable
`.dump` fixture passed before the correction (expected RED).

**In-place change:** The existing `scripts/secret-scan.mjs` now rejects known
PostgreSQL backup suffixes and the `PGDMP` header even if renamed. The existing
`backend/test/packet0-secret-scan-gate.test.mjs` covers negative backup cases
and confirms version-controlled SQL migrations remain permitted. No database
state, production data, Drizzle schema or seven SQL migrations changed.
This source scan is **not** database integrity or backup/restore acceptance.
Node 24/npm 11, three authentic lockfiles, Flutter and an explicitly approved
NearPill Supabase staging database (including NP-031 `users` RLS, tenant
negative tests, stock contention, reconciliation and restore) remain
**NOT RUN/BLOCKED**.

## 2026-10-26 — Plain-text PostgreSQL dump artifact gate (Packet 0)

**Finding:** The existing source scanner rejected PostgreSQL `PGDMP` archives
and known backup extensions, but a plain-text `pg_dump` export could be named
`staging.sql` or `renamed.txt` and pass without a recognizable secret token.
These exports can contain customer, pharmacy, order and payment rows.
A disposable SQL-dump fixture passed the scanner before the change (RED).

**In-place change:** The same `scripts/secret-scan.mjs` now detects the
PostgreSQL-generated opening header for plain database and cluster SQL dumps,
including CRLF line endings, and rejects them regardless of text filename.
The existing regression suite verifies plain database/cluster exports are
rejected while normal reviewed migration SQL remains allowed. This is a
source-handoff heuristic, not a universal detector for manually assembled
SQL data exports, a managed secret scan, or live database security evidence.
The Hono/auth architecture, Drizzle repositories, RLS, React, Flutter and all
seven SQL migrations remain unchanged. Node 24/npm 11, original lockfiles,
Flutter and explicitly approved NearPill-owned Supabase staging remain
**NOT RUN/BLOCKED**, including NP-031 users FORCE RLS, real tenant-negative
tests, migration replay, stock contention, reconciliation and restore.


## 2026-10-26 — Python libpq environment credential source gate (Packet 0)

**Finding:** The existing source scanner checked hard-coded `PGPASSWORD` in
shell, YAML/CI, PowerShell, Node and CMD, but not in Python deployment
helpers using `os.environ[...] = <quoted literal>` or
`os.putenv(..., <quoted literal>)`. A disposable Python source fixture
with a synthetic opaque value passed before the fix (expected RED).

**In-place fix:** Extend only `scripts/secret-scan.mjs` to detect quoted
Python literals in these two setters; the new regression in the existing
`backend/test/packet0-secret-scan-gate.test.mjs` also verifies that
`os.environ[...]` and `os.getenv(...)` runtime references are allowed.
This is a high-confidence source-artifact heuristic, not a full Python
parser, Git-history secret scan or production credential attestation.
No PostgreSQL schema, Drizzle migrations, RLS policies, backend auth,
Hono, inventory/order/payment logic, React or Flutter code was modified.
Packet 0 acceptance remains **BLOCKED** pending the supported toolchain,
three authentic lockfiles, Flutter, a verified NearPill-owned Supabase
staging project, NP-031 `users` FORCE RLS, tenant-negative tests,
contention, reconciliation and restore.

## 2026-10-26 — Fixture-writing owner-role pre-connection guard (Packet 0)

**Confirmed before fix:** `assertApprovedFixtureTarget()` rejected provider admins
and reserved `pg_*` roles but did not reject the canonical `nearpill_owner` DDL
role. A red-first local fixture test accepted `DB_USER=nearpill_owner`.

**In-place correction:** The existing fixture preflight now refuses `nearpill_owner`
as either application or migrator login (including mixed case and Supabase
shared session-pooler suffix). No SQL, roles, sessions, domain behavior or
production system changed. The local tests check only that unsafe settings
are rejected *before connecting*. Actual application-role permissions,
PostgreSQL `FORCE ROW LEVEL SECURITY` on `users` (NP-031), the complete role
policy set and backup/restore must still be tested on authorized Supabase
staging, not inferred from these offline checks.


## 2026-10-26 — Fixture login identity ambiguity check (Packet 0)

**Red-first finding:** The current fixture-writing operator preflight accepted
`DB_USER` or `MIGRATOR_DB_USER` strings with embedded whitespace/control and
invisible formatting characters. A disposable test confirmed the pre-connect
validation incorrectly succeeded for such malformed role identities.

**Scope:** Added a fail-closed Unicode whitespace/control/format-character
check to the existing `backend/scripts/lib/verify-fixture-target.mjs` role
boundary and one regression in its existing Packet 0 test file. Standard local
role names and direct/session-mode staging configurations retain their
existing behavior. No database connection, migration, new module, auth,
Drizzle schema, RLS policy or domain behavior was changed.

**Acceptance limitation:** A local guard is not independent Supabase project
ownership or actual app/migrator-role evidence. Supported Node 24/npm 11,
authentic lockfiles, Flutter/Dart, NP-031 `users` FORCE RLS remediation,
application-role isolation, migration replay, contention, reconciliation and
backup/restore remain **NOT RUN/BLOCKED** until approved prerequisites exist.

## 2026-10-26 — Direct migrator login identity preflight consistency (Packet 0)

**Red-first source finding:** The canonical migration preflight could accept a
configured direct migrator login containing internal whitespace, a control
character or an invisible Unicode format character. Its fixture-writing peer
already rejected these ambiguous identity strings. A local no-connection
regression reproduced the mismatch.

**In-place characterization/tooling fix:** The existing
`backend/scripts/lib/verify-migration-target.mjs` now rejects those role strings
for both local and owner-approved staging configurations. The test lives in the
existing `backend/test/packet0-migration-target-guard.test.mjs`. Valid ordinary
role names retain their previous behavior. No production schema, SQL migration,
RLS policy, Hono/authentication, business rule, database endpoint or separate
application was changed.

**Acceptance:** Offline preflight testing does not prove actual Supabase project
ownership, TLS or role grants. Supported Node 24/npm 11 and authentic lockfiles,
Flutter, NP-031 `users` FORCE RLS and real staging tenant/stock/reconciliation/
restore gates remain **NOT RUN/BLOCKED** until independently verified.

## 2026-10-26 — Raw PostgreSQL connection target consistency (Packet 0)

**Red-first finding:** Migration and fixture-writing preflights trimmed the
configured `DB_HOST`, `DB_NAME`, `DB_PORT` and role strings before approving
them, while actual PostgreSQL clients consume raw environment values. Fixture
staging also trimmed its separate direct-migrator host/port. The reviewed target
could therefore differ from the eventual raw connection settings. Two new
regressions reproduced acceptance of padded settings without connecting.

**Scoped in-place correction:** `backend/scripts/lib/verify-migration-target.mjs`
and `backend/scripts/lib/verify-fixture-target.mjs` reject padding in these
connection fields before constructing pools; previous invalid-port diagnostics
are preserved. Existing local/direct and session-pooler configurations remain
supported, with regression tests in the existing Packet 0 guard suites. No SQL,
RLS policy, application auth, inventory/order/payment logic, migration history,
or live Supabase database was changed.

**Acceptance limitation:** Source-only negative tests cannot establish actual
Supabase project ownership, connected PostgreSQL roles/grants, tenant isolation,
migration replay, 100-way stock contention or backup/restore. Node 24/npm 11,
authentic lockfiles, Flutter and NP-031 `users` FORCE RLS remain blocked.

## 2026-10-26 — Extensionless operational helper decoding (Packet 0 continuation)

The source-secret scanner already rejected malformed text with recognized script extensions but could silently skip an unreadable extensionless or unfamiliar-suffix helper inside operational script/configuration trees. A red-first fixture now characterizes this gap; `scripts/`, `backend/scripts/`, `infra/`, and `.github/` require strict UTF-8 or supported UTF-16 text decoding regardless of suffix. Media assets outside those operational trees retain the existing binary exception. This is a source-handoff integrity improvement only: it is not code execution, a Git history scan, live PostgreSQL privilege proof, or Supabase staging acceptance. Existing Hono authentication, Drizzle, RLS, SQL migrations, and business flows are unchanged.

## 26 October 2026 — Backup/restore raw identity continuation

After independently matching the latest supplied 862-file archive with the
single extracted working tree, Packet 0 still lacks an owner-approved NearPill
Supabase staging project and its required toolchain. A targeted review found
that `backend/scripts/lib/verify-backup-target.mjs` and
`backend/scripts/lib/verify-restore-target.mjs` normalized host, database,
port and login fields for approval, but the shell tools used unmodified
process environment values. The two existing local-only preflights now reject
leading/trailing whitespace in `DB_HOST`, `DB_NAME`, `DB_PORT`, `DB_USER` and
`MIGRATOR_DB_USER`, without creating a second database path or modifying SQL.
Two shell-fixture regressions reproduced the mismatch before the change and
assert no PostgreSQL utility is invoked after the fix.

This is local characterization and fail-closed verification only. Approved
Supabase PostgreSQL remains the intended single managed provider; real
application-role RLS, NP-031 users FORCE RLS, migration replay, 100-way stock
contention, financial reconciliation and restore drills are NOT RUN/BLOCKED.

## 2026-10-26 — Standalone database operation preload preflight

The source audit found that the disposable-local backup and destructive-restore
shell entry points ran their Node target guards without first denying inherited
`NODE_OPTIONS`. An inherited preload could therefore execute before the target
approval logic. Two characterization regressions demonstrated this behavior
before the in-place correction; both shell scripts now reject nonempty ambient
Node options before invoking Node. The existing safety, archive, and SQL paths
are otherwise untouched. This local regression is not a Supabase restore drill,
role/grant proof, or production readiness evidence. Packet 0 remains BLOCKED.

## 2026-10-26 — SQLite data-artifact source boundary

The existing source-secret scanner could skip opaque SQLite database bytes,
including those renamed to a generic binary extension. A red-first synthetic
fixture demonstrated that the source ZIP gate incorrectly accepted these files.
The same scanner now rejects SQLite-format magic and common SQLite database
file extensions; its existing PostgreSQL backup and migration checks remain
unchanged. No SQLite storage adapter, database connection or migration was
created. The full Supabase/RLS, Node/npm and Flutter Packet 0 acceptance gates
remain NOT RUN/BLOCKED pending an authorized NearPill staging target and the
required supported toolchains.


## 2026-10-26 — SQLite WAL / rollback-journal source-artifact boundary

SQLite write-ahead-log (WAL) files may preserve committed database page
contents even when the main database file is absent. The existing source
scanner previously blocked SQLite `.db`/`.sqlite` files but silently accepted
`*-wal`, `*-shm`, and `*-journal` companion artifacts and renamed WAL payloads.
One red-first fixture reproduced this omission; the existing scanner now
rejects those companion names and both standard WAL header magic variants,
without reading or displaying database rows. Normal PostgreSQL Drizzle SQL
migrations and first-party image assets remain allowed. This only verifies
local source handoffs; it does not establish live Supabase RLS, PostgreSQL
backup recovery, Node/Flutter build acceptance, or production readiness.


## 2026-10-26 — Renamed SQLite rollback-journal header source gate

SQLite's rollback journal can contain original database page contents, even
when its name no longer ends with `-journal`. The existing Packet 0 scanner
blocked journal suffixes but did not recognize the documented eight-byte
rollback-journal magic in a renamed opaque file. A synthetic red-first
regression reproduced the omission, then passed after adding the existing
scanner's header check. Reviewed PostgreSQL migrations and normal images
remain allowed. No live database was accessed or changed; the supported
runtime, lockfiles, Flutter and Supabase acceptance gates remain BLOCKED.
Source: https://www.sqlite.org/fileformat.html#the_rollback_journal


## 2026-10-26 — npm registry URL credential source-handoff characterization

Packet 0 red-first testing found that the existing npm source scan checked
`_authToken` and resolved lockfile URLs, but missed HTTP Basic Auth userinfo
embedded directly in a `.npmrc` registry endpoint. The reviewed scanner now
rejects literal URL userinfo, preserves `${NPM_PASSWORD}` environment
substitution, and reports only the affected file path. No registry was
contacted. All current authentication, Hono/Drizzle/RLS, PostgreSQL migration
and business paths are preserved. Node 24/npm 11 locked builds, Flutter,
authorized Supabase staging RLS/NP-031, concurrency, financial reconciliation
and restore gates remain NOT RUN/BLOCKED.

### 2026-10-26 — Packet 0 npm registry query credentials

Characterization adds a red-first case for literal npm registry/tarball URL
query credentials, including percent-encoded parameter names. The existing
source scanner now rejects this source-handoff leak but permits external
`${NPM_TOKEN}` substitutions. This changes source verification only; Node 24,
Flutter and live Supabase acceptance remain blocked.

### 2026-10-26 — Packet 0 decoded npm lockfile URL verification

A red-first characterization proves raw regex inspection can miss a usable
npm registry credential serialized as escaped JSON URL characters. The
existing scanner now inspects decoded lockfile string values and keys for
HTTP userinfo and sensitive query parameters, while retaining safe external
environment references and refusing malformed JSON. This is source-only
verification: Node 24/npm 11 installs, Flutter, NP-031 user RLS, and an
approved live NearPill Supabase staging gate remain NOT RUN/BLOCKED.

### 2026-10-26 — Decoded lockfile metadata secret characterization

A synthetic npm lockfile containing a JSON-escaped high-confidence secret token
passed the original raw-text scanner. The existing source scanner now applies
its already-reviewed token/JWT/PostgreSQL-URL detectors to decoded JSON strings
(in addition to the prior decoded registry URL checks). No secret values are
printed in diagnostics. This is Packet 0 offline characterization only: Node
24/npm 11 reproducibility, Flutter, and authorized Supabase RLS/NP-031, stock
and restore gates remain NOT RUN/BLOCKED.

### 2026-10-26 — decoded npm lockfile auth-field characterization

Packet 0 source packaging must reject literal values of decoded npm lockfile
`_authToken`, `_auth`, and `_password` keys, including registry-scoped keys,
regardless of whether the values match high-confidence token-prefix heuristics.
A synthetic nested auth-key regression failed before correction, then passed
with `${NPM_TOKEN}` environment-placeholder preservation. This checks offline
source-hand-off integrity only. The original npm lockfiles, supported-runtime
builds and real Supabase staging acceptance are still unavailable/blocked.

### 2026-10-26 — npm package manifest decoded credential characterization

The pre-fix source scanner accepted a valid npm `package.json` whose
`publishConfig.registry` used JSON escapes to conceal HTTP registry userinfo.
Its existing decoded npm lockfile detector now also validates package manifest
strings and rejects credentialed URLs, inline auth values, high-confidence
secrets, and invalid JSON without logging credentials. The regression failed
before the fix and passed afterward. No application or migration changed.
Node 24/npm 11 builds, authentic lockfiles, Flutter and authorized Supabase
app-role/RLS/NP-031, contention and restore gates remain BLOCKED/NOT RUN.

### 2026-10-26 — decoded npm JSON PostgreSQL password source characterization

The Packet 0 scanner parsed JSON for registry credentials and high-confidence
secrets but did not apply existing libpq environment, JDBC short-URL and
keyword/value connection detectors to decoded npm JSON strings. Red-first
fixtures reproduced two failing regressions for Unicode-escaped PostgreSQL
password assignments/connection options. Existing detectors are now reused
for decoded `package.json` and lockfile values; synthetic inline passwords
are rejected with redacted diagnostics and an external secret reference remains
permitted. This verifies only offline source package handling. No Hono, Drizzle,
SQL migration or RLS behavior changed; supported Node/Flutter builds and actual
NearPill-owned Supabase staging/RLS/inventory/restore gates remain blocked.

### 2026-10-26 — Opaque asset plaintext credential characterization

The existing Packet 0 secret scanner now also checks opaque/binary file bytes for **recognizable ASCII plaintext** high-confidence provider tokens, Supabase service-role JWTs, and credentialed PostgreSQL URLs before skipping unparseable media. A synthetic image-metadata credential was accepted before this change and rejected after a red/green regression. Harmless binary assets remain allowed. This is a limited heuristic and does **not** inspect encrypted, compressed, or otherwise encoded payloads; it is not a history scan, production secret audit, or Supabase deployment acceptance.

## 2026-10-26 — Opaque asset metadata credential characterization

A synthetic binary media asset with embedded readable libpq password
assignment escaped the existing source scanner; a red-first regression
reproduced the omission. The canonical `scripts/secret-scan.mjs` now applies
existing PostgreSQL environment-password, JDBC/conninfo and npm authenticated
registry URL detectors before accepting opaque assets. It neither parses
compressed/encrypted media nor changes application/runtime/database behavior.
Source integrity, tests, and unavailable live database acceptance are recorded
in the master Implementation Ledger (§28).

### 2026-10-26 — decoded JSON PostgreSQL password-field characterization

The source-handoff scanner previously accepted a JSON object containing an
opaque PostgreSQL password directly in a `postgres.password`, database-context
`password`, or explicit `PGPASSWORD`/`db_password` field when the value lacked a
known provider token prefix. Synthetic red-first tests reproduced the omission.
The existing scanner now checks decoded ordinary JSON keys and values, and
preserves the source's documented `{ "ENV": "DB_PASSWORD" }` and external
placeholder behavior. This does not characterize live database permissions,
Supabase connectivity or production secrets. Packet 0 remains acceptance-blocked.

### 2026-10-26 — distributable environment-template literal credential characterization

A synthetic `.env.example` with an opaque literal `DB_PASSWORD`, migration
password, mail API key, or Supabase service-role key passed the old source
scanner, because the pattern was neither a recognized token nor a credentialed
connection string. Added red-first regression coverage and extended the
**existing** `scripts/secret-scan.mjs` to reject inline credential-like
assignments in `.env.example`, while preserving existing documented
`replace-with-...` placeholders, empty values and `${VARIABLE}` references.
No production secret, app runtime, Drizzle migration, RLS policy or database
object was modified. Live and supported-runtime Packet 0 gates remain blocked.

### 2026-10-26 — Packet 0 JSON byte-identity characterization

The existing dependency-free JSON checker used `TextDecoder('utf-8',
{ fatal: true })`, which silently removes a leading UTF-8 BOM. A synthetic
first-party `web/public/policies.json` containing BOM + otherwise valid JSON
therefore passed the syntax gate, although direct Node UTF-8 reading followed
by `JSON.parse` rejects those same bytes. A red-first regression now covers
this discrepancy; the existing checker rejects the BOM before decoding.
Normal UTF-8 JSON behavior and its error-reporting contract are preserved.
No application runtime, PostgreSQL migration, authentication, tenant RLS,
Flutter or React behavior was changed. The required supported-runtime and
explicitly authorized NearPill Supabase staging acceptance gates remain
NOT RUN/BLOCKED and must not be represented as passed by this source test.


### 2026-10-28 — Packet 0 SQL compatibility lexical-boundary characterization (NP-045)

The existing `backend/src/infrastructure/postgres/compat-pool.js` converted all
`?` characters into PostgreSQL bind placeholders and rewrote ` LIKE ` text even
inside quoted string values, quoted identifiers and SQL comments. It also used
a whole-string `RETURNING` check to decide whether an `INSERT` needed its
legacy `RETURNING id` result shape, so a literal/comment containing that word
could accidentally suppress the result clause. A **corrected test** reproduced
five failures on the original archive adapter (16 PASS / 5 FAIL of 21 tests).

The in-place adapter now performs these rewrites only on SQL code spans,
preserving single/double-quoted text, doubled quote escapes, PostgreSQL
`E'...'` escaped strings, dollar-quoted strings, line comments and nested block
comments. The existing password binary-CAS normalization, parameter order,
actor/tenant transaction context, `INSERT` result contract and returned facade
are unchanged for existing ordinary queries. Five characterizations were added
to the existing `packet0-transaction-characterization.test.mjs`; the four
adjacent PostgreSQL pool/RLS/contract suites complete **53/53 PASS** on
Node 22.16.0 (diagnostic only, not supported Node 24 acceptance). Real
Supabase PostgreSQL tests remain **NOT RUN / BLOCKED**; this test uses a
recording pool and cannot establish DB RLS or live SQL execution parity.

No database migrations, new modules, authentication, Hono routes, React, Flutter,
financial/domain rules or deployed PostgreSQL credentials were modified.
Packet 0 remains acceptance-blocked, and Packet 1 has not started.

### 2026-11-02 — Scoped runtime source-graph characterization

The Packet 0 transitive Hono import checker originally rejected known
MySQL/Express and `@supabase/supabase-js` edges, but accepted a relative
import from the live application graph into non-runtime `backend/scripts`,
`backend/test` or `backend/migrations`, as well as other `@supabase/*`
client SDKs. A synthetic negative test first demonstrated this accepted edge.
The existing import-graph assertion now restricts local runtime edges to
`backend/src` plus the two currently characterized root-level modules
`backend/passwords.js` and `backend/email.js`, and rejects all
`@supabase/*` packages as alternate runtime client authorities. This keeps
the existing Hono/Drizzle/backend session architecture unchanged and does
not claim compiled module-resolution or actual Supabase RLS acceptance.
No runtime modules, Drizzle SQL/migrations, secrets, user data, web/Flutter
application code or payment state changed.

### 2026-11-02 — Non-relative ESM source-boundary negative characterization

The live Hono graph walker previously returned early for any non-relative
specifier except known retired packages. This allowed `data:` inline executable
modules, `file:`/HTTP URL modules, absolute filesystem paths and package `#` import
maps to bypass the reviewed relative-source inventory. An expected-failure
negative test reproduced this source-verifier gap. The existing assertion now
rejects these specifiers while retaining native `node:` imports and ordinary
installed dependency specifiers. This changes Packet 0 characterization only;
it is **not** a compiler/loader-level proof, a dependency-integrity guarantee,
or a substitute for real Supabase actor-role RLS and migration acceptance. The
existing Hono app, Drizzle migrations, backend sessions, React, Flutter and
business logic are unchanged; all previously declared environment blockers remain.

### 2026-11-02 — Packet 0 R04 publication behavioral before-state (current continuation)

The existing catalog service's `setMedicinePublication` path only requires at
least one approved evidence record when publishing. A new isolated behavioral
characterization in `backend/test/packet0-data-inventory-parity.test.mjs`
shows that a record already marked `retired` is refused with zero approved
sources but becomes `published` after the mock evidence count becomes one.
No independent persisted OTC-eligibility decision is read during that action.
This is a **documented, unsafe current-state limitation**, not an accepted
product rule or production-readiness evidence. Do **not** remove this blocker
merely because the characterization test is green. A later reviewed OTC
eligibility/provenance implementation must replace this before-state assertion
with real allow/deny checks, including an application-role PostgreSQL test.
No catalog runtime code, Drizzle migrations, backend auth/RLS or provider
connections were changed during this Packet 0 characterization.

### 2026-11-03 — Payment webhook raw-body read ordering (Packet 0 unsafe before-state)

The existing Hono `backend/src/http/app.ts` API middleware currently executes
`await c.req.raw.clone().text()` for any path containing
`/payments/webhooks/` **before** entering `bodyLimit({ maxSize: 64 * 1024 })`.
This reads the entire cloned body before the declared 64 KiB limiter has
an opportunity to reject it. That is a potentially unbounded pre-limit memory
allocation for public payment webhook traffic; the presence of a 413 response
after the read is **not** size-limit security acceptance. The payment route in
`backend/src/http/routes/v1/register.ts` also declares a 64 KiB limit, but
that route declaration does not bound the preceding middleware read.

`backend/test/packet0-webhook-ingress-beforestate.test.mjs` evaluates the
existing middleware callback with a *recording stub*, not the installed Hono
runtime: a synthetic 128 KiB webhook triggers the full `raw-body-read` before
`size-limiter-entered`, while a non-webhook oversize request goes directly to
the limiter; a 1 KiB webhook retains existing body handling. These are
**unsafe current-state characterization tests**, not approval of the
implementation. The test must be replaced with secure bound-before-read
acceptance when the transport correction is authorized, and confirmed with
real supported-runtime HTTP requests including no/false Content-Length and
chunked uploads. No production code or RLS/migration/payment data was changed
in Packet 0. Record this as **NP-046 OPEN**; do not allow real webhook traffic
or production release based on the source-only result.

**Observed test outcomes for this continuation:** New regression reproduced RED before the change and passed GREEN after (1/1). Full acceptance-gate file 36/36 PASS. A canonical `bash scripts/verify-packet0.sh` attempt was interrupted while executing its third group; only first two final TAP groups are attested (307/307 and 294/294), **not** a complete canonical run. Independent execution of the remaining disjoint 16 files passed 252/252, yielding **853/853 partitioned source-level PASS** across 52 files. JS/JSON/shell 165/11/8 PASS; manifest 330/330 PASS; secret scan PASS; mobile 6/6 source PASS with exit 2 BLOCKED. Real Node24/Flutter/Supabase acceptance NOT RUN. Full logs are packaged as `docs/packet0-verification-2026-11-03-batch-watchdog-*.txt`.

### 2026-11-03 — NP-047 narrow trusted-proxy correction (acceptance still blocked)

The immediately preceding intake archive characterizes a real before-state:
`clientIp()` always accepted unverified leftmost `X-Forwarded-For` for the
existing durable login/recovery rate limiter. The current Packet 0 correction
now uses the authenticated *socket peer* by default, and only honors one
validated forwarded address when that exact peer was configured through the
backend-only typed `TRUSTED_PROXY_IPS` environment setting. The allowlist is
empty by default; arbitrary headers, comma chains, malformed IPs, missing
socket peers, CIDRs, wildcards and duplicate proxy entries cannot grant trust.
The existing Hono app injects the validated set into its canonical route
middleware, and Compose exposes the setting without enabling trust by default.
The NGINX `/api/` path continues to overwrite XFF instead of appending it.

Negative tests execute the real `transport.ts` function and typed config and
check the Hono/NGINX/Compose source wiring; installed Node 24/Hono with an
actual ingress socket, authentication rate limiting under load, and real
Supabase role/tenant RLS remain NOT RUN. Since NGINX may share one socket IP
across customers, explicit verified proxy configuration is required to prove
availability parity in staging. **NP-047 is SOURCE-MITIGATED / LIVE UNVERIFIED,
not CLOSED.** No migration, credential, authentication use case, Drizzle, RLS,
financial, web or Flutter behavior was modified. Packet 0 stays BLOCKED.


## 2026-11-03 16:52 Asia/Manila — Packet 0 current-source acceptance recheck (independent TAP)

**Source:** latest supplied `NearPill_Packet0_2026-11-03_Independent_NP047_Acceptance_Recheck.zip`, SHA-256 `60c831379332d4995920582d09532f0b92004bddad42b6b0a27df178b2c6b0a8`; ZIP CRC and **1219/1219 regular-file byte parity** passed before edits. Packet 0 remains **ACTIVE / ACCEPTANCE BLOCKED**; Packet 1 NOT STARTED. No Git revision, connected NearPill Supabase staging project or live deployment was verified.

**Evidence:** Direct existing TAP runner successfully attested **858/858 tests across 53 files** (297+279+282; exit 0, no skips). A separate wrapper attempt was interrupted at final secret-scan stage, with no overall exit code; do not claim that wrapper passed. Diagnostic Node 22/npm 10 only. Focused ingress/acceptance **48/48 PASS**; standalone mobile source **6/6 PASS**, verifier **exit 2 BLOCKED** without Flutter. Independent syntax **166 JS / 11 JSON / 8 shell PASS**, source manifest **331/331 PASS**, secret scan PASS, seven migration SQL files byte-identical. Raw transcripts and summary in `docs/packet0-verification-2026-11-03-1652-*.txt`.

**Change/limits:** Only baseline/ledger/manifest evidence was updated, not application, database, RLS, auth, payment, Flutter or deployment. Do not remove legacy paths without acceptance. Required Node24/npm11, genuine lockfiles, Flutter, authorized NearPill Supabase non-bypass app role, actual tenant RLS, 100-way stock contention, reconciliation, migration replay and restore remain **NOT RUN/BLOCKED**. NP-031–NP-042/R04 and installed-Hono NP-046/NP-047 are not closed. **Next safe packet: Packet 0 acceptance continuation.**


## 2026-11-03 — Packet 0 current source acceptance recheck (latest archive, independent gates)

**Source:** `NearPill_Packet0_2026-11-03_1652_Independent_Recheck.zip` (SHA-256 `014dd547e13d262d3606c6b72f6d79bc63e8451dfdaae9d354829b7ae0f5ef42`). CRC passed; **1224/1224 regular-file bytes** matched the canonical existing `nearpill_work` tree before changes. No Git branch/HEAD or production Supabase ownership has been established. Packet 0 remains **ACTIVE / ACCEPTANCE BLOCKED**; Packet 1 remains **NOT STARTED**.

**Evidence on the available diagnostic runtime:** `node scripts/run-packet0-tests.mjs <53 discovered Packet 0 files>` **exit 0, 858/858 PASS** across three zero-skip batches **297+279+282**. A separate `bash scripts/verify-packet0.sh` attempt produced those same complete TAP batches and a partial Node subset **122 PASS / 1 SKIP**, but its wrapper stalled at the post-execution source secret scan and was terminated by the execution window; **no wrapper exit status or complete PASS** is claimed. Independent `node scripts/check-js-syntax.mjs`, `node scripts/check-json-syntax.mjs`, `bash scripts/check-shell-syntax.sh`, `node scripts/verify-source-manifest.mjs`, `node scripts/secret-scan.mjs` all PASS (**166 JS, 11 JSON, 8 shell; 331/331 hashes; source secret scan PASS**). `bash scripts/verify-mobile.sh` **exit 2 BLOCKED** after **6/6 mobile source tests PASS**; Flutter analyze/test/build NOT RUN. Full raw logs in `docs/packet0-verification-2026-11-03-latest-current-*.txt`.

**Change/limits:** Only this baseline note, its matching manifest digest, existing plan/Implementation Ledger and dated evidence changed. No Hono/auth/Drizzle/RLS/database SQL/domain/React/Flutter production code or deployment configuration changed; seven PostgreSQL SQL migrations remain unchanged. Supported Node >=24.7/npm11 with authentic root/backend/web locks, Flutter 3.44.4/Dart 3.12.2 and pubspec.lock, installed Hono/NGINX ingress, and an explicitly NearPill-owned Supabase staging database with non-owner/non-`BYPASSRLS` app role plus separate direct migration/restore access remain **UNAVAILABLE**. NP-031–NP-042 and R04 remain open/unverified; NP-046 and NP-047 are source-mitigated but live ingress checks are NOT RUN. Real app-role RLS negatives, pool transaction-local isolation, 100-way inventory contention, order/payment reconciliation, migration replay and restore drill **NOT RUN**. Next safe work: Packet 0 supported-toolchain and authorized Supabase staging acceptance.

## 2026-11-03 — NP-047 actual loopback TCP peer characterization (Packet 0)

The existing `backend/test/packet0-forwarded-ip-trust.test.mjs` now exercises
`clientIp()` on a **real locally bound Node HTTP server** using actual
`IncomingMessage.socket.remoteAddress` values and client-sent request headers.
Two direct requests with different spoofed `X-Forwarded-For` values retain the
same connected socket-peer key. Only an explicitly configured exact loopback
peer can use a single valid forwarded address; duplicate headers, invalid
values and absent forwarding fall back to the peer. Six observed requests are
checked against the real socket's address. No Hono, NGINX, external networking,
Supabase or database role was mocked into a passing live acceptance result.

This improves the Packet 0 **local TCP characterization** of the already
source-mitigated NP-047; it does **not** close NP-047's deployed-ingress gate.
Installed Hono/NGINX on supported Node 24, verified proxy identity and real
per-user rate-limit/bucket behavior still require staging tests. No production
transport, auth, SQL/Drizzle, RLS, order/inventory/payment, React or Flutter
implementation changed.

## 2026-11-03 — Packet 0 failed webhook-stream read (source mitigation)

Current-source characterization found that `readWebhookBodyWithinLimit` let a
ReadableStream read failure escape as an exception after reading a partial
public webhook body. This could surface as an unhandled Hono HTTP 500 rather
than a controlled input rejection. A red-first test in the **existing**
`backend/test/packet0-webhook-ingress-beforestate.test.mjs` reproduced the
exception using a stream that emits a valid prefix and then errors. The
existing bounded reader now returns `{ ok: false, reason: 'read-error' }`, and
the existing Hono API middleware responds with a generic HTTP 400 without
invoking the payment handler or exposing private exception details. The
64 KiB byte limit, fatal UTF-8 validation and BOM preservation remain intact.

This is a diagnostic Node 22 source/Web Request regression, not an installed
Hono Node 24 or payment-provider acceptance. No Drizzle, authentication, RLS,
migration, React, Flutter, or production database operations changed. Packet 0
still requires supported runtime, authentic locks, an explicitly approved
NearPill-owned Supabase staging app role and real security/data-integrity tests.

### 2026-11-03 — NP-050 active-route provenance correction

This baseline distinguishes the dormant fallback `transport.ts:parseBody` from the actual `register.ts` Hono OpenAPI route registrations. All 61 production routes use `makeHandler(spec, services, true)`, `app.openapi`, and the validated `c.req.valid('json')` DTO path. The previously green interrupted-stream `parseBody()` unit test proves only the dormant fallback and **must not be cited as production ingress security acceptance**. The new mutation-guard regression protects route wiring but cannot substitute for installed Hono/Node24 malformed/aborted/oversized streaming JSON HTTP tests. The latest source characterization passed 867/867 across 54 files under unsupported Node22; real Supabase/Flutter gates remain blocked. No production behavior or migrations changed.

## 2026-11-04 — NP-051 Request.clone fail-closed on signed webhook ingress (Packet 0)

**Baseline:** Most recent supplied `NearPill_Packet0_2026-11-03_Active_JSON_Validation_Provenance.zip`, SHA-256 `f5c46719b8580c683d7fceb71049aa66ff1170b53e475d28f6aafaa68180f85d`; 1265 regular files; archive integrity verified. This is an archive baseline, not a verified Git HEAD or deployed Supabase project.

**Before-state and fix:** `backend/src/http/webhook-ingress.js:readWebhookBodyWithinLimit` called `Request.clone()` before its try/catch. An already-consumed Web Request raised the native `TypeError: unusable`, escaping the bounded reader. Red-first `backend/test/packet0-webhook-ingress-beforestate.test.mjs` reproduces that failure with an actual consumed Web Request. The existing reader now catches clone errors and returns `{ ok: false, reason: 'read-error' }`. A source-evaluated current Hono middleware contract maps the result to a generic HTTP 400 without reaching payment dispatch. No change to 64-KiB limit, strict UTF-8/BOM preservation, signature implementation, auth, Drizzle, RLS, schema or business domain.

**Current verification:** Red test expected failure (11 PASS, 1 FAIL); green focused webhook 12/12 PASS; adjacent webhook/payment 17/17 PASS. Complete Packet 0 files (54) tested without omissions in five completed disjoint groups: 296 + 280 + 69 + 133 + 90 = **868/868 PASS**, zero skips/failures. The enclosing `verify-packet0.sh` invocation was **INTERRUPTED/TIMED OUT** during its third batch, with no final wrapper exit; it is NOT a verifier PASS. Diagnostic Node22/npm10 only, not supported Node24/npm11 acceptance. Original SQL migrations preserved byte-for-byte.

**Acceptance boundaries:** NP-051 source-mitigated only. Real installed-Hono abort/retry and provider signature integration, supported Node24 clean installs from authentic lockfiles, Flutter SDK and lockfile gates, and owner-authorized NearPill Supabase staging RLS/application-role/migration/replay/100-way concurrency/reconciliation/restore tests remain NOT RUN/BLOCKED. Packet 0 ACTIVE / ACCEPTANCE BLOCKED. Packet 1 NOT STARTED. No production database, credentials, payments or deployment altered.

## 2026-11-04 — Packet 0 nine-file TAP batches (reproducible characterization)

**Baseline:** Latest supplied `NearPill_Packet0_2026-11-04_Webhook_Clone_FailClosed.zip` (7631958a8c4a6bbd21fbd5a5b03aa1eec4ea9299c6866279866077150bd83c96), 1,274-file intact source archive. The same existing codebase is the only target, without a Git HEAD or approved NearPill staging DB in this environment. Packet 0 remains **ACTIVE / ACCEPTANCE BLOCKED**, and Packet 1 is not started.

**Reproduced runner issue and in-place change:** The existing 18-file TAP batches repeatedly exhausted the execution window on this diagnostic host. Modified only `scripts/run-packet0-tests.mjs` to use nine-file batches while preserving complete discovery, a 120-second maximum per batch, failure on missing TAP summaries/empty files/skips and process-group termination on timeouts. Strengthened the existing 19-fixture acceptance regression to require three batches and still fail on a last-batch skip. Red-first focused test failed as expected; green focused test passed.

**Executable evidence:** The direct canonical runner verified all **54 Packet 0 files, 868/868 tests PASS** (six attested batches, no skips/todo/cancelled/failures, exit 0) on Node 22.16.0. The raw red/green/full transcripts are in `docs/packet0-verification-2026-11-04-nine-file-batch-raw.txt`; summary in `docs/packet0-verification-2026-11-04-nine-file-batch-summary.txt`. Seven reviewed PostgreSQL migration bytes remain unchanged. These runs do **not** prove accepted Node 24/npm 11 builds, installed Hono, Flutter or real Supabase app-role RLS/concurrency/reconciliation/restore gates, which remain **NOT RUN/BLOCKED**. No production behavior changed.

## 2026-11-04 — Packet 0 current nine-file runner independent acceptance recheck

**Latest baseline:** `NearPill_Packet0_2026-11-04_Nine_File_TAP_Continuation.zip`, SHA-256 `025aa747422cc33c6cb11e613c0d6bbcff11a082d41a6e10360107db778e4080`; ZIP integrity PASS, 1278 first-party regular archive files; no Git revision or deployment ownership asserted. One canonical NearPill Hono/Drizzle/PostgreSQL/RLS backend with React and Flutter, Supabase PostgreSQL provider selected. **Packet 0 is first incomplete dependency-ready packet, ACTIVE / ACCEPTANCE BLOCKED. Packet 1 NOT STARTED.**

**Current executable evidence:** The unmodified existing `bash scripts/verify-packet0.sh` completed (exit **2 BLOCKED**) with **868/868 Packet 0 characterization tests PASS** in six strict nine-file TAP batches (zero failed/skipped/todo), and **122 passes / 1 skip** in the unsupported-runtime supplemental Node subset (PARTIAL). Pre/post source integrity **332/332 PASS** and secret scans PASS. `bash scripts/verify-mobile.sh` returned **2 BLOCKED** after **6/6 source contracts PASS**; Flutter runtime unavailable. JS/JSON/shell syntax **167/11/8 PASS**. All seven reviewed SQL migration hashes match intake; no migration was applied. Full raw results and hash inventory are in `docs/packet0-verification-2026-11-04-current-{canonical,mobile-syntax,baseline-summary}.txt`.

**Files changed:** This existing baseline note, its one SHA-256 row in `docs/packet0-source-manifest-2026-10-21.sha256`, and the existing master plan/Implementation Ledger. Added three dated Packet 0 verification evidence text files. **No application code, business behavior, Hono auth, Drizzle, RLS, SQL migration, React, Flutter, proxy configuration, data or secrets changed. No obsolete runtime path removed** without accepted parity.

**Explicit blockers:** This host is Node22/npm10, not required Node24/npm11; root/backend/web npm lockfiles and pubspec.lock absent; no Flutter SDK, PostgreSQL tooling, or verified NearPill-owned Supabase staging connection/least-privilege non-`BYPASSRLS` app role. Installed-Hono/NGINX, NP-031–NP-042, R04, NP-046–NP-051 runtime acceptance, real tenant RLS/transaction-pool isolation, 100-way stock contention, migrations, financial reconciliation, and backup/restore remain **NOT RUN/BLOCKED**. Passing source tests do not close release/security gates. Supabase direct/session application connections and independent grants/RLS review remain the approved design; do not substitute Supabase Auth or run migrations against unrelated projects.

**Rollback:** Restore the three edited existing docs/manifest files from the identified SHA-verified input and remove the three new dated reports. No database rollback is required. **Next safe packet is Packet 0 supported-runtime and owner-authorized NearPill Supabase staging acceptance continuation. Stop before Packet 1.**



### 2026-11-04 latest supplied source acceptance verification

Latest archive `NearPill_Packet0_2026-11-04_0444_Acceptance_Recheck.zip` (`1ee5e11953e35af1c83d21082c982c79fbf8f813f86f084077733792d788d2fb` SHA-256, 1281 regular files; ZIP CRC PASS). On diagnostic Node22/npm10, canonical Packet 0 verifier exited **2 BLOCKED** after **868/868 source tests PASS** (54 files, six batches; no skip), with **122 pass/1 skip** supplemental Node tests. Mobile source contracts **6/6 PASS**, but Flutter verification exits 2 BLOCKED. JS/JSON/shell syntax 167/11/8 PASS; first-party source manifest 332/332 and secret scan PASS (both pre/post verification). Seven PostgreSQL migration files untouched. No live Supabase project/role or production cutover verified; real tenant/RLS, concurrency, financial reconciliation, migration replay and restore NOT RUN. The ledger and `docs/packet0-verification-2026-11-04-latest-evidence.txt` record exact evidence; Packet 0 stays active/blocked and Packet 1 is not started. No application code was changed.


## 2026-11-04 — independent latest-source Packet 0 acceptance continuation

**Resolved active source:** `NearPill_Packet0_2026-11-04_Latest_Source_Acceptance_Reconciled.zip` (SHA-256 `2aa1da5edfb8483e11006c131e697310486000685aa73994b7fc7205b56932f7`, 1284 regular files, ZIP CRC verified). This is an archive, not an identifiable Git checkout or live deployment. Existing Hono/Drizzle/PostgreSQL, React and Flutter remain canonical; Supabase PostgreSQL is the approved provider without a verified live cutover.

**Observed evidence:** The unmodified `bash scripts/verify-packet0.sh` completed normally with **exit 2 BLOCKED**, after **868/868 Packet 0 characterization tests PASS** in six complete nine-file batches; supplemental Node baseline **122 PASS/1 SKIP**, partial. `bash scripts/verify-mobile.sh` returned **exit 2 BLOCKED**, while **6/6 source contracts passed**; Flutter unavailable. JS/JSON/shell syntax **167/11/8 PASS**; pre/post **332/332 source fingerprints and secret scans PASS**. Seven reviewed SQL migration files exactly match the input SHA-256 fingerprints. Complete raw evidence is in `docs/packet0-verification-2026-11-04-1610-canonical.txt`, `docs/packet0-verification-2026-11-04-1610-mobile.txt`, and `docs/packet0-verification-2026-11-04-1610-evidence.txt`.

**No production change:** Test failures were not reproduced. No Hono/backend-auth, Drizzle/RLS, domain/order/inventory/payment, React/Flutter, infra or SQL migration edited; no legacy path removed. NP-031–NP-042, R04 and installed-runtime NP-046–NP-051 acceptance remain open/unverified. Node24/npm11 + genuine npm lockfiles, Flutter SDK/pubspec.lock and an identified NearPill-owned Supabase staging app role are unavailable. Real tenant RLS, 100-way stock contention, reconciliation, migration replay and restore were NOT RUN. **Packet 0 ACTIVE / ACCEPTANCE BLOCKED; Packet 1 NOT STARTED.**
