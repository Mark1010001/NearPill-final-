# NearPill — 17 October real-world audit reconciled to the latest source

**Reconciliation date:** 29 October 2026 (Asia/Manila). **Packet:** 0, source characterization only. **Status:** SOURCE REVIEWED; acceptance remains BLOCKED. This is a historical-to-current traceability document, not production certification.

## 2026-10-31 attached audit revalidation — newest source versus historical roadmap

**Source attribution:** The newly re-attached `NearPill_Real_World_Audit_and_Roadmap_2026-10-17.md` is the 17 October historical Express/MySQL audit, SHA-256 `621b8189adac1a2ecaef0de3e8002b5cb803e89931d371df127e9e5aeb68f18a`. The latest available single source handoff is `NearPill_Packet0_2026-10-31_Independent_Acceptance_Recheck.zip`, SHA-256 `9ab6a3c9664f4880e5447a0640d39db620b5246bbe9faccfdbae451e2364ba22`, with 1,108 regular files. Archive-to-worktree parity passed **before** this in-place Packet 0 documentation/test update. No Git HEAD or running deployment was supplied. Earlier source baselines in this document describe the historical October 29 review only.

**Precedence:** Historical Express/MySQL recommendation is not the current target. The October 20 provider decision in the master plan selects **Supabase-hosted PostgreSQL** and preserves the Hono transport, backend authentication, Drizzle migrations and native tenant RLS. No Supabase Auth, frontend PostgREST, second production database or MySQL/Express rollback is authorized. The attached roadmap's Chapter I OTC-only/Cebu/Android/pickup roles and R01–R15 business requirements remain *historical requirements evidence*, not a statement that any integration or feature passed acceptance.

**Current source reconciliation (no behavior change):**

- **R04 remains OPEN P0:** `0005_catalog_discovery.sql` migrates legacy Rx rows to `retired` and drops their legacy classification flag; `catalog-service.js` can republish a retired row once any approved evidence exists. Publication state alone does **not** establish OTC eligibility. The existing regression intentionally characterizes the gap; a fail-closed classification and regulator/pharmacist-approved publication policy still require later review, an authorized staging target and negative tests. Do not enable real medicine sales on this evidence.
- **R03/R12, NP-031 remain OPEN:** server-owned actor/membership routes and RLS migrations exist, but `users` ENABLE/FORCE RLS is not established by the seven reviewed SQL migrations. Real Supabase app-role RLS and cross-tenant allow/deny tests are **NOT RUN**; fixture/client tests do not replace the non-owner/non-`BYPASSRLS` staging checks.
- **R01/R07 remain unaccepted:** `android/app/build.gradle.kts` inherits `flutter.minSdkVersion`; it does not independently pin API 26. Actual Android 8 device compatibility, release signing, Flutter tests and location permission UX need a supported Flutter/Android runtime. No Android compatibility claim is made from the historical roadmap alone.
- **R09/R10/R11:** source enforces one-store checkout and centavo calculations, but 100-way stock contention and provider-backed 50%/100% payment/refund are NOT verified. Three-day reservation default is characterized, not approved against the older one-day Chapter III language.
- **D1–D6:** legal operating/merchant model, one-store public policy, reservation TTL, price governance, deposit/refund and age/privacy decisions remain owner-gated in `docs/real-world-phase0-decision-gates-2026-10-30.md`. Regulatory FDA/pharmacy approval remains **OPEN**. The DTI FAQ on online medicine sales warrants qualified interpretation for NearPill's proposed intermediary/pickup arrangement and is **not** itself a final individualized legal determination.

**Acceptance boundary:** Packet 0 remains **ACTIVE / BLOCKED** because supported Node/npm, authentic source lockfiles, Flutter, dedicated owner-approved NearPill Supabase staging roles, real RLS/concurrency/reconciliation/restore and release approvals are unavailable. The historical roadmap does not satisfy those gates; Packet 1 is not started.

## Sources, precedence, and non-regression decision

- Current source: the latest supplied `NearPill_Packet0_Acceptance_Gate_Recheck_2026-10-28.zip`, SHA-256 and ZIP entry counts recorded in the Implementation Ledger. The extracted archive is the single canonical editable project for this run; it has no verifiable Git HEAD.
- Older requirements audit: `NearPill_Real_World_Audit_and_Roadmap_2026-10-17.md`, originally auditing an Express/MySQL/vanilla-web snapshot and Chapters I–III.
- Current target: the master in-place engineering plan, subsequently amended on 20 October to select **Supabase-hosted PostgreSQL** and retain Hono, Drizzle, PostgreSQL RLS, server-owned authentication and one backend/web/Flutter application. The older audit's recommendation to *keep MySQL/Express* is historical and **must not be applied** to the newer source.
- Evidence tiers: `SOURCE-CONFIRMED` means present in current source, *not* running on supported Node/Flutter or validated against Supabase; `EXTERNAL GATE` means human/regulator/provider decision or real integration test; `OPEN` means unresolved. Tests cited below are source/local checks only.

## Requirement-to-current-code traceability (older audit R01–R15)

| ID | October 17 requirement | Current in-place source evidence | Reconciled state / required acceptance |
|---|---|---|---|
| R01 | Android customer application | `lib/`, `android/app/build.gradle.kts` and Flutter architecture tests | SOURCE-CONFIRMED; supported Flutter build, Android 8/API26 target validation and signed release NOT RUN |
| R02 | Customer registration and verification | `backend/src/application/identity-service.js`, `durable-login-security.js`, `password-recovery-service.js`, `backend/migrations/postgres/0004_identity_security.sql` | SOURCE-CONFIRMED; production email/OTP and live session revocation NOT VERIFIED |
| R03 | Real partner/admin authentication | `backend/src/application/membership-service.js`, `backend/src/http/routes/v1/register.ts`, `web/src/api/client.ts` | SOURCE-CONFIRMED; real cross-tenant application-role RLS and portal E2E NOT RUN; older browser demo login findings refer to retired web scripts |
| R04 | OTC-only catalog and transaction | Public and order repositories filter `publication_status=published`; migration `0005_catalog_discovery.sql` initially retires legacy Rx rows **but drops their `rx_required` classification**; `catalog-service.js` permits retired-to-published with any approved evidence count | **OPEN P0:** current source does not prove persistent OTC eligibility. Packet 0 behavioral test characterizes re-publication, and a recording-client SQL contract confirms public discovery, per-store inventory and checkout currently lack a separate OTC-classification predicate; block real medicine transactions until approved classification/provenance policy, code and real staging negative tests. |
| R05 | Central master catalog | `backend/src/application/catalog-service.js` and `0005_catalog_discovery.sql` | SOURCE-CONFIRMED; real FDA product-registration/source evidence operational approval EXTERNAL GATE |
| R06 | Verified availability/stock | `backend/src/infrastructure/postgres/inventory-repository.js`, `catalog-repository.js` | SOURCE-CONFIRMED; real pharmacy ownership/availability freshness and contention validation OPEN |
| R07 | Nearby map and GPS fallback | `lib/screens/map.dart`, `lib/features/map/data/location_service.dart`, `lib/features/map/presentation/map_view_model.dart` | SOURCE-CONFIRMED implementation, Flutter/device permission, real map credentials and location fallback E2E NOT RUN |
| R08 | Safe informational OTC guidance | No approved pharmacist-reviewed production knowledge-corpus/runtime validation established by this source audit | OPEN; do not claim clinical review or personalized medical capability |
| R09 | Single-store cart/order and pickup | `backend/src/application/order-service.js` rejects mixed-pharmacy orders; `backend/src/infrastructure/postgres/order-repository.js` uses transactions and centavos | SOURCE-CONFIRMED; real database concurrency/idempotency acceptance NOT RUN |
| R10 | GCash 50%/100%, provider-verified payment | `backend/src/application/payment-subscription-service.js` contains webhook-verification and refund-pending transitions | SOURCE-CONFIRMED *interface/logic*, but no verified merchant account, provider approval, signed sandbox events or live-money authorization; 50%/100% terms require owner decision |
| R11 | Pickup, expiry, reschedule | `backend/src/application/order-service.js` and `backend/test/packet0-order-expiry-scope.test.mjs` | SOURCE-CONFIRMED partial lifecycle; Chapter III one-day versus historical 3-day TTL remains POLICY OPEN; real scheduler/restore gate NOT RUN |
| R12 | Pharmacy partner orders | `backend/src/application/membership-service.js`, `backend/src/http/routes/v1/register.ts`, `backend/src/application/order-service.js` | SOURCE-CONFIRMED membership-scoped endpoints; live tenant negatives and database grants OPEN |
| R13 | Basic/Premium entitlement/reports | `backend/src/application/payment-subscription-service.js`, `backend/src/application/report-service.js` | SOURCE-CONFIRMED; billing provider, entitlement and renewal end-to-end NOT VERIFIED |
| R14 | Security/privacy/audit | Backend session/RBAC modules and `backend/migrations/postgres/0002_rls.sql` + `0004_identity_security.sql` | SOURCE-CONFIRMED design; master plan NP-031–NP-041 source-level authorization findings remain OPEN, real non-owner/non-BYPASSRLS app-role RLS tests NOT RUN |
| R15 | Cloud, TLS, backups, load | `compose.yaml`, `infra/`, `.github/workflows/ci.yml`, dedicated `scripts/verify-*` | SOURCE-CONFIRMED tooling; staging deployment, restore drill, support, real TLS and capacity tests NOT RUN |

**Characterization guard added in this Packet 0 run:** `backend/test/packet0-real-world-roadmap-contract.test.mjs` checks current source query and API boundaries for OTC publication, verified pharmacy, one-pharmacy checkout and server-owned access. These are *not* live integration, legal, clinical, or payment tests.

## Phase 0 decisions from the old real-world roadmap — still explicitly unresolved

1. Legal operating model, licensed pharmacy/operator, merchant-of-record, who receives payments and who dispenses/handles complaints: **UNAPPROVED / EXTERNAL GATE**. Do not accept real orders or collect deposits until reviewed by qualified local legal/regulatory advisers and approved partners.
2. One-pharmacy-per-order: **SOURCE IMPLEMENTED**, but owner confirmation of the business contract still required; do not quietly reintroduce aggregated checkout.
3. Pickup/reservation TTL and reschedule/expiry clock: **POLICY OPEN**, because old documents disagree (1 day vs 3 days); do not silently choose a new SLA here.
4. Published price governance: **SOURCE IMPLEMENTED as admin-controlled mutation**; business approval of store-specific pricing/reference SRP and provenance still required.
5. 50% deposit/100% payment, refund/cancellation and remainder at pickup: **POLICY/PROVIDER OPEN**; no claim of a working PSP or merchant approval.
6. Minimum age, DOB necessity, privacy and restricted medicines: **POLICY/LEGAL OPEN**; preserve launch OTC-only and information-only boundary, avoid extra health-data collection.

## Critical security and regulatory hold

The master plan already records NP-031–NP-041 concerning source-level RLS/grant and tenant-scoped SQL mutation authority. **Do not mark those resolved** merely because API routes are authenticated or local characterization tests pass. A dedicated NearPill-owned Supabase staging project is needed to test the *actual* non-owner, non-`BYPASSRLS` app role, grants, policies, transaction-local actor context and all positive/negative cases. Do not connect to an unrelated project or apply production SQL.

The DTI eCommerce FAQ (retrieved 29 October 2026) continues to state that online medicine selling is not allowed, citing FDA Memorandum Circular No. 2020-10: https://ecommerce.dti.gov.ph/faqs/ . This FAQ does **not** establish a final legal determination about NearPill's particular software-intermediary/pickup workflow. Obtain written/qualified Philippine FDA and legal interpretation **before enabling real medicine transactions or GCash payments**. Philippine Data Privacy Act: https://privacy.gov.ph/data-privacy-act/ .

Supabase official references (retrieved 29 October 2026): https://supabase.com/docs/guides/database/connecting-to-postgres (persistent Hono direct or session-mode TLS; direct migration/restore) and https://supabase.com/docs/guides/database/postgres/row-level-security (RLS **plus** least-privilege grants and negative tests). Do not substitute Supabase Auth/Data API for NearPill backend authority.

## Packet and next boundary

**Packet 0 remains ACTIVE / ACCEPTANCE BLOCKED.** Keep existing Hono, React, Flutter, Drizzle, RLS and order/inventory/payment business logic. No MySQL/Express rollback, new duplicate application, unapproved DB cutover or second packet is authorized by the 17 October historical audit. On supported Node 24/npm 11 and Flutter with authentic lockfiles, rerun required builds/unit and contract tests. On owner-authorized Supabase staging, run migration replay, real role/RLS negatives, 100-way inventory contention, payment/stock reconciliation and backup/restore. Only after Packet 0 acceptance can the ledger identify the first next dependency-safe packet; Packet 1 is not yet accepted.

### 2026-10-30 Phase 0 handoff addendum

The current-source re-audit retains all six October 17 owner decisions as unresolved until explicit sign-off. A dedicated, non-authoritative handoff register now records each decision, evidence and approval gate in `docs/real-world-phase0-decision-gates-2026-10-30.md`; `backend/test/packet0-real-world-phase0-gates.test.mjs` adds source-level payment-default and order-policy characterization. Neither the register nor its tests authorize real pharmacy sales, alter payment settings, redefine the reservation TTL, or demonstrate Supabase RLS acceptance. Packet 0 remains **ACTIVE / ACCEPTANCE BLOCKED**.
