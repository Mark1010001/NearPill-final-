# NearPill: rotate secrets (checklist)

Why: keys and passwords were pasted into earlier chats, so treat them as exposed. Do this before you share the source, a zip or a demo recording. Nothing here costs money.

Audit result (15 Nov 2026): no real secret is written in the source code, docs, scripts or logs. Real values exist only in two files that are excluded from sharing: `backend\.env` and `android\local.properties`. Before zipping the project, make sure neither file is inside the zip.

Do not paste any new value into chat, into source files, or into screenshots.

## 1. Supabase database passwords
There are two logins: `nearpill_app` (used by the backend) and `nearpill_migrator` (used only by MIGRATE-STAGING.bat).

1. Supabase dashboard > your NearPill Staging project > SQL Editor.
2. Run (use a new random 20+ character password with letters and numbers only):
   `ALTER ROLE nearpill_app WITH PASSWORD 'NEW_APP_PASSWORD';`
   `ALTER ROLE nearpill_migrator WITH PASSWORD 'NEW_MIGRATOR_PASSWORD';`
3. Put NEW_APP_PASSWORD in `backend\.env` as `DB_PASSWORD=`. The migrator password is only typed into the hidden prompt of MIGRATE-STAGING.bat; do not store it in a file.
4. Also reset the Supabase "database password" under Project Settings > Database (the `postgres` owner login) and store it in your password manager.
5. Run START-SERVICES.bat and check `http://127.0.0.1:8080/api/v1/ready`.

## 2. Xendit test keys
1. Xendit dashboard (Test Mode) > Settings > API Keys: generate a new secret key, delete the old one.
2. Put it in `backend\.env` as `XENDIT_TEST_SECRET_KEY=`.
3. Settings > Webhooks: generate a new callback verification token, put it in `backend\.env` as `XENDIT_TEST_WEBHOOK_TOKEN=`, and enter the same token in the Xendit webhook settings.

## 3. Google keys (use three separate keys)
Today one key is used for both the backend routes and the Android map. Split it:

| Key | Used by | Restriction (Google Cloud Console > APIs & Services > Credentials) |
| --- | --- | --- |
| Server key | `GOOGLE_ROUTES_API_KEY` in `backend\.env` | API restriction: Routes API only |
| Android key | `MAPS_API_KEY` in `android\local.properties` | Application restriction: Android apps (package name + your SHA-1); API restriction: Maps SDK for Android |
| Website key | `VITE_GOOGLE_MAPS_BROWSER_KEY` in `web\.env` | Application restriction: HTTP referrers (`http://localhost:5173/*`, `http://127.0.0.1:5173/*`, plus your real site later); API restriction: Maps JavaScript API |

Steps: create the three keys, set the restrictions, delete the old shared key, update the two files, rebuild the app and website. Set a small daily quota and a budget alert in Billing so a leaked key cannot run up a bill.

## 4. Other places to check
- Any other tokens you pasted in chat (GitHub, Firebase, email services): revoke them in their dashboards.
- Old project zips in Downloads: delete any that might contain `.env` files, or rotate everything above and keep them.

## 5. After rotating
- Restart with START-SERVICES.bat.
- Log in on the website and the Android app once to confirm they work.
