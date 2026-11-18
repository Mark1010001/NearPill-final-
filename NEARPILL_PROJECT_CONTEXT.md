# NearPill Project Context

Prepared 13 November 2026 from the current source tree and the product decisions discussed in this project. This is a handoff guide, not a release or production verification report.

## What NearPill is

NearPill is a Cebu City capstone project titled **“NearPill: Smart Geo Drugstore Finder with AI Support and Subscription-Based Services (Web & Mobile).”** It helps customers find nearby pharmacies, search their medicine listings, review availability, and arrange pharmacy pickup. It also has a partner-pharmacy portal and a platform operations portal.

The AI support currently present in the Flutter source is an on-device, rule-based help and medicine-guidance experience. It can explain app features and help users find listed products. It is not a clinical decision system: it must not diagnose symptoms, prescribe treatment, or determine safe dosage. The source inspected does not indicate that this assistant calls a paid AI API.

## Applications and source layout

| Area | Location | Purpose |
| --- | --- | --- |
| Flutter customer app | `lib/`, `android/` | Android customer experience: account, medicine search, pharmacy discovery/map, cart, checkout, orders and help. |
| Customer web app | `web/src/features/customer/` | Responsive browser customer app at `/app/`. |
| Operations portal | `web/src/app/`, `web/src/features/admin/`, `web/src/features/partner/` | Admin and pharmacy staff workflows. It remains separate from the customer experience; non-`/app/` routes are portal routes. |
| Backend API | `backend/src/` | Hono API, application services, authentication, catalogue, inventory, orders and payments. |
| PostgreSQL schema and migrations | `backend/src/infrastructure/postgres/`, `backend/migrations/postgres/` | Drizzle/PostgreSQL implementation and reviewed SQL migrations/RLS. |
| Deployment and checks | `compose.yaml`, `infra/`, `scripts/`, `test/`, `backend/test/`, `web/e2e/` | Local container topology, source/security checks and focused tests. |

Both customer clients and the portal use the canonical **`/api/v1`** API. The server, not the browser or phone, owns account identity, pharmacy membership, prices, stock, order ownership and payment status.

## Main roles and intended journeys

- **Customer:** browse medicines and verified pharmacies; use the map and current location; add a pharmacy’s listing to a cart; review pickup details; pay and track the resulting order; pick it up.
- **Pharmacy partner/staff:** manage that branch’s listings, stock and prices; review prescription requests when the prescription workflow is enabled; prepare paid orders; mark pickup progress and complete handover.
- **Platform administrator:** manage partners, catalogue records, publication controls, platform orders and subscription/report features.

The existing API creates an order for **one pharmacy at a time**. A multi-pharmacy purchase therefore needs independent order, payment, balance and pickup state per pharmacy. A payment or pickup at one branch must not settle another branch’s order.

## Product and checkout decisions from the project

These are the requested product rules to use when changing the code:

1. **Pharmacy-owned stock and pricing.** Each pharmacy controls its own quantities and prices. A stock upload should update its branch inventory without an admin queue. The CSV identifies the exact catalogue item by `catalog_id`; the discussed columns are:

   `pharmacy,catalog_id,brand,generic_name,strength,form,category,selling_unit,price,stock_quantity`

   Expected category values are **Non-prescription**, **Prescription**, and **Non-medicine**. Unknown or conflicting product identities should be reported for correction, not guessed.

2. **Tingi and selling units.** Quantity 1 is the unit actually dispensed: for example tablet, capsule, sachet, bottle, or box. `price` and `stock_quantity` must both use that same selling unit. Keep dosage form, selling unit, and supplier package size distinct. Order details should preserve a snapshot of the selling unit so a later listing edit does not rewrite the receipt.

3. **Prescription items.** Prescription listings may be discoverable, but checkout/payment must remain blocked until the legally and operationally approved prescription verification path is in place. The user requested a prescription image upload and review by staff at the fulfilling pharmacy. Prescription approval must be tied to the customer, pharmacy, exact item and current listing; a review must not unlock a different product or a stale listing.

4. **Optional deposits.** The requested customer option is pay in full or deposit per pharmacy. The upfront amount must be at least **₱100 for each pharmacy order**. For a ₱120 order and a ₱200 order, the intended deposit is ₱100 per order, leaving ₱20 and ₱100 due at their respective pickups. A remaining balance can be paid separately per branch.

5. **Payment authority and pickup.** GCash through Xendit has been configured/discussed for **Test Mode**. Only server-verified provider evidence may mark online payment as paid. A pending online balance payment must block manual settlement and pickup completion. Cash or another in-person method may be recorded by authorized pharmacy staff only when the server says the balance is still payable at the counter. Staff prepare the order and mark it ready; after handover, staff complete pickup, and reserved stock is recorded as sold exactly once.

6. **Maps and location.** Show a clearly distinguishable marker for the customer’s actual location and separate markers for pharmacies. The app source includes a Google Maps route-preview path; the server-side Google Routes key, Maps key restrictions, quotas and billing configuration are deployment requirements.

## What the current source shows—and important gaps

These points are based on source inspection for this document; no running staging database, live payment, deployment, or phone session was tested for this handoff.

- The backend has account-scoped web sessions with CSRF checks for cookie-authenticated changes, mobile bearer credentials, pharmacy-membership authorization, PostgreSQL repositories and server-side order/payment services.
- The Flutter app uses one API client, secure credential storage and the `/api/v1` API. Emulator API base defaults to `http://10.0.2.2:8080`; it can be overridden with `--dart-define=API_BASE_URL=...`.
- The customer browser app is mounted at `/app/`; the Operations Portal owns the other routes. The portal uses server sessions and branch-scoped partner API routes.
- **Inventory workflow gap:** the current pharmacy CSV importer still requires a matching catalogue product and rejects a category that conflicts with the catalogue record. The portal still displays review/publication-related ordering states such as “Ask an admin to verify/publish” and “Check the product category.” This does not yet fully match the requested no-admin-approval inventory workflow. Do not tell users this is fixed until the master-catalogue/category policy and all affected checkout checks are intentionally updated and verified.
- **Prescription workflow limitation:** the current source includes prescription-review routes and sample-photo UI, but labels it as a staging/sample flow. The customer UI explicitly says sample approval does not enable prescription checkout. It is not evidence that production prescription ordering or pharmacist dispensing compliance is complete.
- **Payment limitation:** the checked-in backend template defaults payment policy to disabled and leaves the Xendit Test Mode settings commented. Any local Test Mode configuration is environment-specific and was not inspected here. Test-mode payments are not live collection, and Xendit test credentials do not establish pharmacy-specific settlement or split payouts.
- **Database/deployment limitation:** project documentation targets Supabase-managed PostgreSQL for staging/production, while Docker Compose PostgreSQL is a disposable local fixture. Supabase project ownership, live migration state, roles/RLS, backup/restore and production security were not verified here.
- **Documentation caveat:** some repository audit documents are dated and may describe older code. Recheck source and current deployment behavior before treating an old audit as current acceptance.
- Previous chats included secrets and API keys. Treat any still-active values shared in chat as exposed: rotate/revoke them as applicable, keep secrets only in ignored local/server environment configuration, and never put them in this file, source archive, screenshots, or client app.

## Local development references

The repository documents Node.js **24.22.0**, npm **11.19.1**, Flutter **3.44.4** and Dart **3.12.2** as the pinned toolchain.

- Backend: `npm ci --prefix backend`, then `npm run dev:backend` from the repository root. Direct backend development defaults to port `3001`.
- Web: `npm ci --prefix web`, then `npm run dev:web`. Vite proxies API and recovery requests to `VITE_DEV_API_TARGET`, defaulting to `http://127.0.0.1:3001`.
- Local Docker Compose: copy `.env.example` to `.env`, set local placeholder passwords, then `docker compose up --build`. The gateway is `http://localhost:8080`; the database and API are not exposed as public host ports.
- Android emulator with Compose: the documented default API URL is `http://10.0.2.2:8080`. A physical phone needs an API URL it can actually reach; `10.0.2.2` is emulator-specific.
- Relevant focused checks include `npm run test:backend`, `npm run typecheck:web`, `npm run build:web`, `npm run test:web:e2e`, and `flutter test --no-pub`. Use the project’s source and runtime gates before claiming a supported build or release.

## Working rules for future changes

- Read the relevant instructions and trace the full caller path before editing.
- Keep production read-only unless the user explicitly authorizes a concrete production action. Use isolated staging or fixtures for data-changing tests.
- Do not invent stock, product classification, pharmacist approval, identity, payment status, licenses, or deployment configuration.
- Preserve server-side validation, account/branch ownership, inventory reservations, idempotency, prescription safeguards, authoritative pricing and accessible UI states.
- Make the smallest complete change, including affected Flutter/web/backend callers and focused regression coverage. Do not run broad test suites unless requested or necessary.
- Distinguish source-level checks, fixtures, staging checks, Xendit Test Mode callbacks and physical-device checks in reports.

## Scope of this context file

This file summarizes project intent and source-level facts only. It does not claim that the connected phone is running the current build, that staging data matches the CSV, that a fresh Xendit payment was verified, or that the app is ready for public release.
