# NearPill — Phase 0 product decisions and release gates

**Review date:** 30 October 2026 (Asia/Manila)  
**Scope:** Packet 0 / the 17 October 2026 real-world audit, reconciled against the current Hono + Drizzle + PostgreSQL + React + Flutter project.  
**Authority:** This register records questions and engineering observations; it does **not** approve any legal, clinical, pricing, payment or privacy decision. No live pharmacy transaction or customer-health-data collection is authorized by this file.

## Six required owner decisions (not yet approved)

| ID | Decision and provisional source evidence | Status | Approval and proof required before changing production behavior |
| --- | --- | --- | --- |
| D1 | **Operating model and licenses.** Decide whether NearPill is an informational intermediary, an ordering agent or a medicine seller; identify the merchant of record, licensed dispensing pharmacy and complaint/liability owner. Current source has pharmacy verification fields but not authoritative regulatory approval. | **OPEN — external legal/FDA/pharmacy review** | Qualified Philippine regulatory/legal opinion applied to the *actual* software + pickup + payment workflow; documented licensed partner/operator approvals. DTI's FAQ broadly states that online medicine sales are not allowed; it does not by itself settle NearPill's specific model. |
| D2 | **One pharmacy per order.** Current `backend/src/application/order-service.js` rejects mixed-pharmacy orders. The 17 October roadmap recommends this policy, but the business owner has not signed its public contract. | **SOURCE IMPLEMENTED — owner sign-off OPEN** | Product owner approves one-store pickup, customer-facing contract and the transition rules; actual database concurrency tests follow. |
| D3 | **Pickup and reservation clock.** Historical Chapter III says one day, while the existing `createOrderService` default is **3 days (72 hours)**. Neither should be silently changed. | **OPEN — conflicting requirements** | Approve clock origin, TTL, timezone, reschedule/expiration rules, payment dependencies, notification cutoff and audit trail; then update tests/schema/job policy together. |
| D4 | **Price governance.** Current admin-controlled catalog and approved evidence are source-level features, not proof of pharmacy/product approval or an agreed SRP/store-pricing policy. | **SOURCE IMPLEMENTED — commercial and pharmacist approval OPEN** | Approve who publishes per-store prices and evidence, correction workflow and verified publication controls. |
| D5 | **Deposit, GCash and refund rules.** Existing `createPaymentPolicy()` defaults to `mode: disabled`; an explicit policy is needed for full/deposit plans. The 50%/100% idea is a requirement, *not* proof of provider approval. | **OPEN — business and PSP approval** | Merchant-of-record decision, provider merchant approval/sandbox, deposit policy version, pickup remainder, cancellation and provider-confirmed refund process. Do not accept real payments until signed event handling, reconciliation and legal review pass. |
| D6 | **User age, DOB necessity and privacy.** The launch remains OTC-only and informational. The real-world audit proposes limiting age/DOB/health fields and excluding prescription upload, delivery and patient-specific dosing from v1. | **OPEN — privacy/legal/product review** | Document minimum data collected, lawful purpose and basis, retention/deletion, age eligibility, permitted guidance and reviewer responsibilities; perform privacy assessment before using real sensitive data. |

## Newly characterized OTC eligibility provenance gap (R04 — unresolved P0 release concern)

The canonical `backend/migrations/postgres/0005_catalog_discovery.sql` initially retires any legacy record with `rx_required = 1`, **then drops `rx_required`**. The current `setMedicinePublication` application use case checks for at least one approved `medicine_evidence` row before publishing, but does not distinguish a retired legacy prescription item from a reviewed OTC medicine. A local behavioral characterization now demonstrates that a retired item can move to `published` once the evidence count is nonzero. An approved evidence record **does not, by itself, prove OTC classification or regulator/pharmacist acceptance**. This is a release concern, not evidence that anyone actually republished such an item.

**Additional read-only repository characterization (30 October 2026):** Both public medicine discovery and per-pharmacy inventory SQL rely on `publication_status = 'published'`; discovery calculates `evidenceCount` for display without using it as an OTC eligibility predicate. The checkout stock lookup also gates on publication and verified-pharmacy status, but has no persisted OTC classification to check. A recording-client test inspects these actual constructed SQL statements; it does **not** execute PostgreSQL or prove that any real restricted item is exposed. A future fix must enforce approved OTC classification in the canonical database/repository and transactionally at checkout, not merely add a web/mobile filter.

**Status: OPEN — do not mark R04 OTC-only fully enforced or enable real medicine transactions.** Before changing migration history or publication rules, obtain an approved product classification/provenance policy (including what to do with legacy retired products); then enforce it in the canonical catalog/domain and database as appropriate and add source plus real staging negative tests (legacy Rx, unclassified new product, revoked evidence, authorized re-review). Preserve the seven existing migrations pending reviewed, non-destructive forward migration and authorized Supabase testing. No clinical or legal decision is made in Packet 0.

## Evidence boundary and engineering freeze

- **Preserved authority:** Hono application/session/RBAC, Drizzle repository and seven PostgreSQL migrations, native RLS, order/stock/payment domain, existing React portal and Flutter app. **Supabase-managed PostgreSQL** is the selected provider; do not revert to the earlier MySQL/Express snapshot or install Supabase Auth/Data API as a second authority.
- **Characterized behavior:** one-pharmacy order guard; draft-by-default medicine publication; payment policy defaults to disabled; 3-day reservation default is existing code, **not** an approved new SLA. These are local/source observations, not regulatory clearance or production tenant isolation.
- **Required database acceptance:** owner-approved NearPill Supabase staging, a non-owner and non-`BYPASSRLS` application role, explicit grants plus row policies, transaction-local verified actor context, real negative tenant tests, reviewed migration replay, 100-way stock contention, reconciliation and restore drill. Fixture tests alone are not sufficient.
- **Required toolchain acceptance:** Node 24/npm 11 under the original dependency lockfiles; supported Flutter/Dart toolchain and authentic lockfile; supported builds, tests and release-signing gates.
- **Release restriction:** prototype with synthetic data only until lawful operating model, licensed partners, privacy, stock and real-money provider requirements are independently reviewed and accepted. Do not expose real patient data or accept real payments based on this document.

## Source references (reviewed 30 October 2026)

- Real-world requirements: `NearPill_Real_World_Audit_and_Roadmap_2026-10-17.md` (older Express/MySQL audit; historical scope, not current architecture).
- Current target and Implementation Ledger: `NearPill_Master_In_Place_Whole_Codebase_Refactor_Engineering_Plan_2026-10-17.md`.
- Prior R01–R15 reconciliation: `docs/real-world-roadmap-reconciliation-2026-10-29.md`.
- Supabase connection and pooling: https://supabase.com/docs/guides/database/connecting-to-postgres
- Supabase grants and RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- DTI e-commerce FAQ (online medicines): https://ecommerce.dti.gov.ph/faqs/
- Philippine Data Privacy Act: https://privacy.gov.ph/data-privacy-act/

**Next safe work:** Obtain owner decisions and supported-runtime/authorized Supabase Packet 0 acceptance evidence. Do not begin another packet while Packet 0 remains acceptance-blocked.
