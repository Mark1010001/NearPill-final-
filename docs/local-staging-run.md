# Running NearPill on this Windows computer

The Android debug app is installed on `Pixel_7` (`emulator-5554`). It uses the local Hono API at `http://10.0.2.2:8080/api/v1`. The API connects over verified TLS to **NearPill Staging**, project `afqqozfjpiodanpogvfb`, Singapore, PostgreSQL 17.11. Production `aobxzstawwdbchplxaha` was not changed.

From the project folder, keep this command running when using the emulator:

```powershell
pwsh -NoProfile -File .\scripts\run-local-api.ps1
```

The launcher uses the installed Node 24.22.0 runtime and Supabase CA under `%LOCALAPPDATA%\NearPill`. It loads the ignored `backend/.env` and listens only on `127.0.0.1:8080`. Android's `10.0.2.2` address reaches that host listener. Debug HTTP is allowed only for that emulator address and loopback `127.0.0.1` for USB phone testing; release networking remains restricted. Its TLS initialization uses an encoded data URI to preserve JavaScript quotes under both Windows PowerShell and PowerShell 7.

For a physical Android phone, use `adb -s PHONE_ID reverse tcp:8080 tcp:8080`, then build/run with `--dart-define=API_BASE_URL=http://127.0.0.1:8080`. The phone must stay connected by USB and the local API must be running. Re-establish reverse forwarding after reconnection. The connected Z2460 runs Android 14 and supports ARM64; it needs `--target-platform android-arm64` when building an APK. The earlier x64 emulator APK cannot be installed on that phone. `build/app/outputs/flutter-apk/app-debug.apk` is overwritten by each build, so its architecture and API target depend on the last build command.

On November 8, the direct staging connection stopped working because this computer could not reach IPv6 (`ENETUNREACH`). The local API was restored using the session-pooler address read from NearPill Staging's dashboard: `aws-0-ap-southeast-1.pooler.supabase.com:5432`. The ignored backend environment now uses `nearpill_app.afqqozfjpiodanpogvfb`; the existing password, database and `DB_SSL=true` remain unchanged. The connection authenticated as the ordinary `nearpill_app` role, without superuser or RLS-bypass privileges, and the client verified its TLS 1.3 certificate. The pooler's internal database hop reports `pg_stat_ssl.ssl=false`; that field does not describe the verified client-to-pooler TLS socket. Migration/verification credentials and their direct endpoint were not changed.

The restored API returned `status=ok` from `/api/v1/ready` and six paracetamol catalogue listings across Bing, ALV and Dobol B. All six remain drafts with `canOrder=false`. The [Ask NearPill assistant](ask-nearpill.md) uses this same API for catalogue questions; app-help matching remains local. Direct-endpoint migration tooling still requires working IPv6. No schema or publication changes were needed for this restoration.

This computer's network began resetting Node's default hybrid TLS handshake. The local launcher selects `X25519:P-256` curves before loading the server. A fresh connection verified the ordinary app role, TLS 1.3, and certificate validation against the original direct staging endpoint. Retry default curves after the network changes. This adjustment is confined to the local launcher. See [Supabase's SSL connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres#ssl) for encryption and certificate-verification requirements.

The database is a separate staging environment. Create a new test account in the app; existing production accounts are not copied. Local development verification codes fill automatically. No real email is sent. Use synthetic information while testing.

The installed Flutter SDK is `%LOCALAPPDATA%\NearPill\toolchains\flutter-3.44.4\flutter`. Select that SDK in Android Studio if reopening the Flutter project. The APK is `build/app/outputs/flutter-apk/app-debug.apk`.

To run the web portal locally, use the same Node runtime on PATH and point its proxy at the local API:

```powershell
$env:PATH = "$env:LOCALAPPDATA\NearPill\toolchains\node-v24.22.0-win-x64;$env:PATH"
$env:VITE_DEV_API_TARGET = 'http://127.0.0.1:8080'
npm --prefix web run dev -- --host 127.0.0.1
```

Separate app and migration credentials are stored locally outside source control. The application uses only `nearpill_app`, without schema ownership or RLS bypass. Migration and verification environment files are in `%LOCALAPPDATA%\NearPill`; do not distribute them or `backend/.env`.

## Verified behavior

- All 19 numbered migrations applied through the canonical checksum-protected runner; original migrations were retained.
- Real API signup, login, wrong-password rejection, profile access, session rotation/replay revocation and logout pass.
- Real checkout preserves server-owned prices and replays the same request without a second reservation. Customer B cannot read customer A's order.
- Customer/partner isolation, protected prices, reservation deletion restrictions and pooled actor reset pass under the ordinary app role.
- The 100-way stock test reserves exactly three of three units, without overselling. Synthetic users, pharmacies, medicine listings and orders are removed afterward; an early synthetic audit receipt remains as test history.
- OTC publication requires a recorded review; the application cannot change the eligibility fields.
- Live catalogue checks return exactly the 171 original pharmacy listings, without demo copies, with coordinate validation and private location-response caching. The `catalog_browse` capability reads drafts but cannot change stock or publish medicines; retired items and inactive-pharmacy inventory remain hidden, and the capability clears on pooled connection reuse. Write probes were rolled back.
- Flutter analyzer has passed. All 33 Flutter tests pass, including map, road-route rendering and cancellation, medicine refresh, full catalogue pagination, location fallback, high-accuracy GPS request/timeout handling, and browse-only listing checks. Android debug build, web production build and backend/web type checks have passed.
- Backend and web production dependency audits report zero known vulnerabilities.

## Release requirements still outstanding

The route feature uses Google Routes with `GOOGLE_ROUTES_API_KEY` in the ignored backend environment. The existing key returned a real 3,247-metre driving route with 38 geometry points and a 566-second estimate from the simulated Cebu position to Bing. The installed emulator displayed the blue road path, location dot, and 3.25 km / 10 min route card through the authenticated backend endpoint. Route estimates exclude live traffic. Tracking stops when the route is closed or the map/app is left. The server rejects anonymous route requests. Google Cloud key restrictions, quotas and billing monitoring still need review before public release; no billing settings were changed during implementation.

This is a local development run against isolated staging. The supplied Google Maps key is configured locally in the ignored `android/local.properties`. Bing, ALV, and Dobol B are published in staging with demo verification references. Actual pharmacy license evidence remains pending. Bing and Dobol B use the centers of the supplied Plus Codes decoded with Google's Open Location Code implementation. ALV uses the [public coordinate listing for 183 M. Velez Street](https://ph.near-place.com/alv-pharmacy-183-m-velez-street-cebu-city) and needs a storefront location check.

The two leftover test pharmacies were permanently deleted by migration 0034 (applied). Migrations 0033 to 0035 are applied to staging. The portal's Remove action still deactivates a pharmacy and retains its records and order history; removed pharmacies no longer appear in the dashboard, reports, subscriptions, staff lists or stocks.

Ordering rules in staging: stocked non-prescription and non-medicine items can be ordered straight away. A prescription medicine can only be ordered after the customer uploads a prescription and the pharmacy approves it (the server refuses the order otherwise, and the customer brings the prescription when picking up). In the cart the customer ticks the items to check out. At payment the customer pays in full or pays a deposit (the larger of ₱100 or 50% of the total, with the rest at pickup); orders of ₱100 or less are paid in full.

Pickup date and receipt (migration 0036, apply with `MIGRATE-STAGING.bat`): at checkout the customer picks a pickup date (today up to 7 days ahead, Philippine time) and an optional time window (morning 8-12, afternoon 12-5, evening 5-8). The server rejects past dates, dates more than 7 days ahead, and a window that has already ended today; it does not check the pharmacy's opening days because opening hours are stored only as free text. The customer can change the date once (`PUT /orders/:id/pickup`) while the order is reserved or paid but not yet being prepared. Orders placed before the migration show "No pickup date". The pharmacy portal shows the date, filters by Today, Tomorrow and This week, and marks overdue pickups. Paid orders have a "Download receipt (PDF)" button on the website and the Android app; the PDF is built on the device and writes amounts as "PHP 130.00" because the standard PDF fonts have no peso sign. The Android app needs the `share_plus` package (`flutter pub get` on a PC with network access).

The three source documents were imported as 154 draft catalog items and 171 pharmacy inventory entries. This accounts for 174 source rows with three explicit duplicates merged. Bing has 47 source listings, Dobol B has 80, and ALV has 44. Bing's provided stock counts were retained. ALV and Dobol B provide no stock counts, so their inventory is zero and unavailable pending confirmation. Four conflicting source classifications are flagged for review.

Search and pharmacy detail pages now browse all 171 original source listings using their original names: Bing 47, ALV 44, and Dobol B 80. The 13 previous `[DEMO]` copies are retired, preserving their history. The 154 original catalog records remain drafts pending actual review; the app shows `Awaiting review` and prevents ordering. ALV/Dobol B stock remains unconfirmed. Use the refresh button beside Search medicines to reload listings and acquire a fresh permitted location. Listings show straight-line distance from that position; without location they remain browsable. Import, demo setup, and retirement receipts are stored under `%LOCALAPPDATA%\NearPill\imports\2026-11-07-medicine-documents` and recorded in database audit history.

Google Maps key restrictions must allow Maps SDK for Android, package `dev.nearpill.mobile`, and this computer's debug certificate SHA-1 `71:7D:CC:EA:B9:04:A8:76:90:3B:50:64:F9:8E:E8:16:87:93:D8:B3`. The release signing certificate requires its own allowed fingerprint. Cloud key restrictions have not been inspected.

The Android emulator displays the Google map of Cebu. A denied location request and manual Cebu search were checked visually. After owner approval, precise location access was enabled while using the app. At the simulated position 10.3157, 123.8854, the map shows the user dot and all three pharmacy pins. Search shows ALV at 0.04 km, Bing at 2.06 km, and Dobol B at 2.54 km in a straight line, with original names and review/stock labels. Opening ALV from the map shows its source inventory with ordering disabled. A transient emulator connection timeout recovered using Retry. Real-phone GPS and external turn-by-turn navigation still need device testing. The guarded staging API check also passed radius exclusion, manual search with no invented distance, and exclusion of pending pharmacies using temporary synthetic records that were removed afterward.

Further Pixel 7 movement testing verified the user dot moving from Bing to Dobol B and the nearest pharmacy changing to the corresponding store at 0.0 km after location refresh. The shared location service now requests high accuracy so Search can acquire a GPS fix without the map open. After rebuilding, Search independently showed Dobol B medicine listings at 0.00 km with fresh emulator GPS fixes. API checks at each of the three pharmacy coordinates selected that same pharmacy first at 0.00 km and returned all three public pharmacies. These are simulated-location checks, not real-phone accuracy measurements.

The source documents still match the original imported checksums. No pharmacist review identities, dates, or evidence references and no ALV/Dobol B counted quantities were supplied in the follow-up. The prepared review workbook has 154 medicine rows, with four classification conflicts highlighted, and 124 stock-count rows (ALV 44, Dobol B 80). Confirmation fields are blank. No medicine approvals or stock confirmations were written on the basis of that workbook.

Real email, Google sign-in, payment providers, signed release builds and a public HTTPS API are not configured. Reviewed pharmacy and medicine data must be supplied before actual use. No real medicine was approved or published by these tests.

The production secret key and legacy JWT secret pasted into chat still require owner rotation. They were not placed in source or the app. Production changes and a provider backup/restore rehearsal were not performed.

Supabase reports a `pg_trgm` extension-in-public warning from the original migration design. Public schema usage and all app-table access are denied to Data API roles; the warning still requires a separate extension-location review before production release.

The broad source-packaging suite includes POSIX tools and Linux filesystem cases. A complete clean Linux CI/package run remains required; Windows cannot exercise case-colliding or forbidden filenames, and this computer lacks the `zip` tool. Packaging must use a clean source copy, excluding local secrets and generated Flutter/Gradle/TypeScript files. Do not package this running working directory with `backend/.env`.



## Public website (/site/) and portal polish

A public marketing site lives at `/site/` (landing, features, partners, about, contact, policies) in `web/src/features/site/`. It uses the existing plain CSS and React setup (no Tailwind, no new packages). The Policies page reads the same `/policies.json` as `policies.html` and the apps, so there is one source of policy text. `/` is still the portal sign-in, which links to the website, and `/app/` is the real customer app. The portal and sign-in got a small visual polish (button radius, hover lift, active-nav accent, table header) in `web/src/styles.css`; the customer app styles were not changed so it keeps matching the Android app. Tests: `web/e2e/site.spec.ts`.

## Customer web app: responsive layout
- Under 900px (phones, small tablets) the app keeps the Android bottom tab bar. From 900px up the same five links (Home, Search, Map, Orders, Profile) sit in the header.
- Lists and grids use more columns as the screen widens (2 from 640px, 3 from 1180px); Home pharmacies become a grid; the map is taller on desktop; short landscape phones get a slimmer bar.
- Tested at 320, 390, 768, 1024, 1280 and 1920px for no sideways scrolling (`e2e/parity.spec.ts`).

## Settings and delete account

Apply migration `0037_account_deletion.sql` with `MIGRATE-STAGING.bat` (you type the database password yourself). It lets the app role blank an email on deletion and scrub prescription photos.

Delete account (Profile > Settings on both the app and the website) needs the account password and is refused while any order is still active. Deleting renames the account to "Deleted account", clears email, phone, birthdate and prescription photos, replaces the password with a random one and signs the customer out everywhere; order records stay for the pharmacies without personal details.

There is no "Continue with Google" button. The backend still contains inactive `/auth/google` endpoints; they refuse every request while `GOOGLE_CLIENT_ID` is empty, so leave it empty.

## Sign-up and login security (migration 0038)

Run MIGRATE-STAGING.bat (you type the database password) so `0038_signup_hardening.sql` is applied. It adds the `auth_throttle_events` table (rate limits) and the `terms_accepted_at` / `terms_version` columns on `users`. Until it is applied, sign-up still works but the per-email and per-IP send limits are skipped and a clear error is logged.

Rules the server enforces (website and Android show the same messages):
- Email: valid format, dotted domain, not a throwaway domain; a 6-digit emailed code proves it (valid 15 minutes after verifying, one use).
- Password for new accounts: 10-128 characters with a letter and a number, not common, not your name or email. Login accepts older passwords; the login response carries `passwordNeedsUpdate` for weak ones.
- Sign-up needs `acceptedTerms: true` (stored with a version and time), a hidden honeypot left empty and at least 2 seconds on the form.
- Limits: send code 1 per 30 s and 5 per hour per email, 20 per hour per IP; wrong-code and register limits per IP and per email. Over a limit: "Try again in N minutes."
- The reply to "send code" is the same whether or not the account exists; existing accounts get a "someone tried to sign up" email.
- Settings has "Sign out of all devices"; resetting a password signs out everywhere and emails a notice.
- The email provider must be configured. The code is only returned in the response in local dev mode.
