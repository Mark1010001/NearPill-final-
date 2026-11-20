# NearPill security audit (code review, 20 Nov 2026)

Scope: the repository as committed (backend, web, Android app, deploy files, CI). I read the code; I did not attack the live site, and I could not see your Render, Cloudflare, Supabase or Google Cloud dashboards. Items that depend on those are marked UNVERIFIED.

No critical or exploitable-today holes were found. The code is unusually careful. The issues below are hardening, plus one thing to confirm (secret rotation).

## Summary table

| # | Severity | Finding | Where |
|---|----------|---------|-------|
| 1 | High (until confirmed) | Secrets that were pasted into earlier chats may not be rotated yet | docs/ROTATE-SECRETS.md |
| 2 | Medium (FIXED 20 Nov) | Live site's session cookies are missing the `Secure` flag and `__Host-` prefix | backend/src/application/auth-service.js:38-89, render.yaml (NODE_ENV=staging) |
| 3 | Medium (ACCEPTED, not fixed) | Admin logins have no second factor | backend (no TOTP/MFA anywhere) |
| 4 | Medium (FIXED 20 Nov) | The admin chooses a partner's first password, so the admin knows it | backend/src/application/membership-service.js createPartnerAccount |
| 5 | Low | `/auth/register` reveals whether an email already has an account | backend/src/application/identity-service.js:88-90 |
| 6 | Low | API runs as root inside the container | deploy/Dockerfile (no USER) |
| 7 | Low | Public API map and database name | backend/src/http/app.ts:93, 128 |
| 8 | Low | Route preview can be used to run up the Google Routes bill | backend/src/infrastructure/google-route.js:7 |
| 9 | Low | CI actions pinned to tags, not commit hashes | .github/workflows/ci.yml |
| 10 | Low | HSTS without includeSubDomains/preload | deploy/nginx-headers-app.conf:6, -portal.conf:6 |
| 11 | Low | Android auto-backup not switched off | android/app/src/main/AndroidManifest.xml |
| 12 | Low | CSV export does not neutralise leading tab/CR | web/src/components/DataTable.tsx:14 |
| 13 | UNVERIFIED | Browser Maps key restrictions and quotas | Google Cloud console |

## Findings in plain English

### 1. Possibly-exposed secrets (High until you confirm)
docs/ROTATE-SECRETS.md says keys and passwords were pasted into earlier chats and should be treated as exposed (database passwords, Xendit test key and webhook token, Google keys, email key, Gemini key). If any are not rotated yet, anyone who ever saw those chats or zips could use them. Fix: finish the checklist in that file, delete old project zips, and set Google key quotas and a billing alert. Nothing in the committed code contains a secret (a secret scan found none, and `scripts/secret-scan.mjs` is enforced by a test).

### 2. Session cookies not marked Secure on the live site (Medium)
`auth-service.js` only adds `Secure` and the `__Host-` cookie prefix when `NODE_ENV === 'production'` (lines 38-41, 74, 81, 87, 89). Render runs `NODE_ENV=staging` (render.yaml), so the live https://nearpill.xyz cookies are issued without them. Risk: if a browser is ever tricked into an http:// request to the site (public Wi-Fi, a downgrade), the cookie could be sent in the clear. HSTS (already set) greatly reduces this, so it is Medium, not High. Fix: derive the flag from the site URL, for example `production || PUBLIC_APP_URL starts with https://`. Warning: the cookie name changes, so everyone is signed out once, and tests that use the cookie name need updating.

### 3. No second factor for admin (Medium)
An admin account can read all orders, create partner logins and send login emails. It is protected only by a password (plus the lockout and 8-hour session). Fix: add TOTP for the admin role, or at minimum require a long unique admin password and keep the admin email protected.

### 4. Admin knows each new partner's password (Medium)
`createPartnerAccount` stores a password the admin typed. The new email never contains it, but the admin knows it until the partner resets it. Fix: generate a random password on the server and never show it; the partner only ever uses the set-password link.

### 5. Email enumeration at sign-up (Low)
`identity-service.js:88-90` answers 409 "An account with this email already exists." before the email code is consumed, so anyone can test whether an email is registered (limited to 10 per hour per IP). Fix: perform that check only after the email code is verified, or return the same message for both cases.

### 6. Container runs as root (Low)
deploy/Dockerfile has no `USER` line, so node and nginx run as root. A bug in a dependency would then have more reach. Fix: add a non-root user and run both processes as it (port 10000 is fine).

### 7. Public API map and database name (Low)
`/api/v1/openapi.json` is public and the health endpoint returns the database name (app.ts:93, 128). Fix: serve the API document only outside staging/production, and return just `{status:'ok'}`.

### 8. Google Routes cost abuse (Low)
Any signed-in user can call the route preview once per second (google-route.js:7), roughly 86,000 calls a day. Fix: a per-user daily cap, plus a quota and billing alert on the Google key.

### 9. CI actions pinned to tags (Low)
`actions/checkout@v4`, `actions/setup-node@v4`, `subosito/flutter-action@v2` can change under you. Permissions are already least-privilege (`contents: read`). Fix: pin to commit hashes and add Dependabot for Actions.

### 10-12. Small hardening items
- HSTS is `max-age=31536000` only. Consider `includeSubDomains` (and preload once every subdomain is https).
- AndroidManifest does not set `android:allowBackup="false"`. Tokens are in the Keystore-backed secure storage, so risk is low.
- `csvCell` escapes a leading `= + - @`, not a leading tab or carriage return.

### 13. UNVERIFIED: Google browser Maps key
The website key is public by design (GoogleMap.tsx:38). It must be restricted to HTTP referrers https://nearpill.xyz/* and https://www.nearpill.xyz/* and to the Maps JavaScript API, with a quota. I cannot see that setting.

## What is already strong (checked in code)
- No secrets committed; `.gitignore` and `.dockerignore` exclude env files; secret-scan gate test exists.
- Sessions: HttpOnly, SameSite=Strict, CSRF token on writes, tokens stored hashed, 15-minute access tokens, rotating refresh tokens, argon2 password hashing, durable login lockout with owner notification.
- Password reset: random 32-byte single-use token, stored as a hash, old links deleted when a new one is issued, generic response (no account hint), all sessions revoked after a reset, "your password changed" email.
- Authorization: customer orders and payments are filtered by the signed-in user in the SQL itself (`WHERE o.id = ? AND o.user_id = ?`), plus database row-level security as a second layer. Admin and partner routes require the role.
- XSS: no `dangerouslySetInnerHTML`, `innerHTML` or `eval` anywhere in the web code. Strict CSP (`script-src 'self'` plus Google Maps only).
- Redirects: sign-in return path is checked to be same-origin and under /app/; payment checkout link is checked before it is shown; external links use `noreferrer`.
- Uploads: prescription photos checked for real PNG/JPEG signature, 1 MB and size limits; stock files auto-validated.
- Webhooks: Xendit callback token is compared in constant time, and the payment state is re-read from Xendit before anything is confirmed.
- CORS is an allow-list; OTP codes are never echoed in staging/production; logs contain no emails, tokens or locations.
- Landing page and sign-up: no contact form, no newsletter or email-marketing integration, no subscriber list, honeypot and timing checks plus a per-IP limit on sign-up.

## Quick order of work
Before lunch: 1 (rotate and confirm), 13 (check the Google key), 7, 9.
After lunch: 2, 5, 4, 6, 8.
Later: 3 (admin second factor), 10-12.

## Status of the Medium findings (updated 20 Nov 2026)
- 2 Fixed: session and CSRF cookies are now Secure, and the session cookie uses the `__Host-` prefix, whenever the site is reached over https (`useSecureCookies` in auth-service.js, used by server.ts). Everyone is signed out once after the deploy.
- 3 Not done by owner's choice (20 Nov): an emailed sign-in code for administrators was built, then removed at the owner's request. Admins sign in with email and password only. Risk accepted: a stolen or guessed admin password gives full admin access; the existing login lockout and rate limits still apply.
- 4 Fixed: the admin no longer types a partner password. The server makes a long random one that nobody sees; the partner chooses their own password through the emailed set-password link.
- Also fixed while there: an invitation or reminder email that Brevo refuses is now reported or retried instead of being treated as sent.
