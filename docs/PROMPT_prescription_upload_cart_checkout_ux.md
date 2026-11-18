# Prompt: Fix prescription photo upload; redesign Cart and Checkout UX (NearPill)

## Role
Act as a **senior full-stack engineer and senior product designer (UI/UX)** on NearPill, a Cebu City pharmacy finder
(Flutter Android app in `lib/`, React web in `web/src/`, Hono/PostgreSQL API in `backend/src/`, canonical API `/api/v1`).
Work carefully, trace the full caller path before editing, make the smallest *complete* change, and verify it by running it.
Do not claim anything is fixed until you have exercised it.

## Read first (do not skip)
- `NEARPILL_PROJECT_CONTEXT.md` (product rules and known gaps) and `docs/local-staging-run.md`.
- Prescription flow: `web/src/features/customer/OrderPages.tsx` (`PrescriptionUpload`), `web/src/features/partner/PartnerPages.tsx`
  (`PrescriptionQueue`), `web/src/api/client.ts`, `lib/screens/orders/prescription_review.dart`,
  `lib/features/orders/data/order_repository.dart`, `backend/src/http/routes/v1/register.ts` (prescription routes),
  `backend/src/http/app.ts` (body limit for `POST /api/v1/prescription-reviews` is 1,450,000 bytes).
- Cart/checkout: `web/src/features/customer/cart.ts`, `OrderPages.tsx`, `customer.css`;
  `lib/features/cart/presentation/cart_view_model.dart`, `lib/screens/orders/checkout.dart`, `confirmation.dart`, `orders.dart`.

## Part 1 - Fix the prescription photo upload
**Reported problem:** uploading a prescription photo does not work reliably, and the pharmacy staff review step in the portal
needs to work end to end. Reproduce first, then find the root cause(s). Do not guess; check each of these:
1. **Size/limits:** phone photos are routinely 3-12 MB. The server rejects bodies over ~1.45 MB (base64 inflates by ~33%).
   Confirm what happens on the web and Flutter clients (413 handling, user-facing message). Fix on the client with
   resize/compress (for example longest side about 1600 px, JPEG quality about 0.8, re-check final size) *before* upload;
   keep the server limit as the safety net and align client/server limits and error text.
2. **Formats:** accept JPEG and PNG. Handle HEIC/HEIF and camera captures sensibly (convert or give a clear message).
   Validate type by content, not only file extension or MIME string.
3. **Request shape:** verify the client payload matches `PrescriptionSubmitSchema` (field names, base64 vs multipart, MIME,
   the customer, pharmacy and exact medicine/listing IDs). Check CSRF/session handling on the web client and bearer auth on mobile.
4. **Partner side:** the review queue, photo fetch (`/partner/prescription-reviews/:id/photo`), version/optimistic-lock
   handling, approve/reject, and refresh. Make sure staff can open the photo (zoom/rotate), see which customer-safe details
   they need (item, strength/form, pharmacy), and record a decision. Handle stale versions with a clear "refresh" message.
5. **UX states:** idle, choosing, previewing (show the selected image before sending, with remove/replace), uploading
   (progress or disabled button, no double submit), success, pending review, rejected (with next step), approved,
   and every error. Mobile-friendly camera/gallery pickers; accessible labels; focus moves to status messages.

**Hard constraints (do not change these rules):**
- Prescription checkout/payment **stays blocked** until the owner-approved verification path exists. A sample/staging approval
  must **not** unlock checkout. Keep the UI copy honest about this.
- A review is tied to **customer + pharmacy + exact item + current listing**; it must never unlock a different product or a stale listing.
- Photos are sensitive: `Cache-Control: private, no-store`, no logging of image bytes, no image in URLs or local storage,
  remove the photo after the decision as the current design does. Do not add third-party upload services.
- Keep server-side validation, ownership checks and idempotency. Never trust the client for identity or prices.

## Part 2 - Redesign Cart and Checkout (act as senior UI/UX designer)
Goal: **professional, calm, trustworthy, and very easy to navigate** for first-time users on a phone. Apply this to both the
Flutter app and the customer web app (`/app/`) so they feel like one product. Keep the existing green brand and Material 3 theme.

**Business rules the UI must express clearly**
- One order per pharmacy. If the cart spans pharmacies, **group items by pharmacy** with a header per group, each group with its
  own subtotal, pickup details and payment choice. A payment or pickup at one branch never settles another branch.
- Payment choice per pharmacy: **Pay in full** or **Pay a deposit** (at least PHP 100 per pharmacy order; example: PHP 120 order
  and PHP 200 order give PHP 100 deposit each, leaving PHP 20 and PHP 100 due at pickup). Show "Pay now", "Due at pickup" and
  "Total" explicitly. Use the server-computed amounts only; the UI never calculates authority.
- Quantity 1 is the **selling unit** (tablet, capsule, sachet, bottle, box). Show price per unit and the unit name on every line.
- Prescription items: show a clear "Prescription required" badge and review status; block checkout for them with a plain-language
  explanation and a link to the upload step. Never imply the sample approval allows purchase.
- Stock/price changes: surface "price updated" or "only N left" inline with a one-tap fix, not a generic failure.

**UX requirements**
- **Cart:** pharmacy-grouped list, large thumbnails/icons, name + strength + form + unit, quantity stepper (min 1, max stock, 48 dp
  targets), remove with undo, subtotal per pharmacy, sticky bottom summary with one primary action, and a friendly empty state
  with a "Find medicines" action.
- **Checkout as a short stepper (3 steps max):** 1 Review items -> 2 Pickup and payment (per pharmacy) -> 3 Confirm. Always show
  progress, allow going back without losing state, and keep one primary button per screen. Pickup info: pharmacy name, address,
  hours/open status, and a map/directions link.
- **Confirmation/receipt:** order number, per-pharmacy status, pay-now vs due-at-pickup, what to bring, and how to track it in Orders.
- **Trust and clarity:** plain language (no jargon), currency as PHP with the peso sign and two decimals, the line "Reservation is not
  proof of payment" where relevant, and a visible note that the app does not give medical advice.
- **States:** loading skeletons, empty, error with retry, offline, and double-submit protection on every action that spends money
  or reserves stock.
- **Accessibility:** WCAG AA contrast, text scales to 200% without clipping, semantic labels, visible focus, screen-reader order,
  touch targets of at least 48 dp, no color-only status (pair with icon/text).
- **Consistency:** shared spacing scale, type scale and components; remove one-off styles. Reuse existing widgets/components.

## Process
1. Reproduce the upload failure (web and phone) and write down the root cause(s) before changing code.
2. Propose a short design (3-6 bullets plus a rough layout sketch per screen) and then implement it.
3. Implement backend changes only where required (limits, validation, error codes), then web, then Flutter. Keep API contracts
   backward compatible and update `contracts.ts`/OpenAPI together with the clients.
4. Add **focused** regression tests: server limit/validation, client resize/format handling, the per-pharmacy deposit math rendering,
   Rx-blocked checkout, and widget tests for cart grouping and the stepper. Update stale tests rather than weakening them.
5. Run: `npm run typecheck:web`, `npm run test:backend`, `flutter analyze`, `flutter test`. Fix everything you introduced.

## How to run and verify locally (Windows, already set up)
- `START-API.bat` starts the API on 8080 (connects to Supabase **staging** only; never touch production `aobxzstawwdbchplxaha`).
- `START-NEARPILL.bat` starts web portal (5173), checks, emulator and app; `START-PHONE.bat` runs the app on the USB phone
  (`adb reverse tcp:8080 tcp:8080`). Logs are in `logs\`. Use synthetic accounts and test data only.
- Verify on the **phone** and the web, with screenshots: upload a 5+ MB photo, upload a bad file, submit, view it as pharmacy staff,
  approve/reject, then run the cart and checkout flows with items from two pharmacies.

## Safety rules
- Keep secrets out of source, logs, screenshots and chat. Do not print `.env` values or API keys.
- No production changes. No real payments (Xendit Test Mode only). Do not invent pharmacist approvals, stock or licenses.
- Distinguish in your report what was verified by unit tests, on the web, on the emulator, and on the physical phone.

## Definition of done
- Prescription photo upload works on web and phone for typical camera photos, with clear errors and a working staff review.
- Cart and checkout are grouped per pharmacy, show pay-now/due-at-pickup correctly, and are navigable in three steps or fewer.
- All checks above pass; screenshots attached; a short change summary lists files touched, risks, and anything left undone.
