# NearPill deployment (Render + Supabase + nearpill.xyz)

One Render web service (`render.yaml`, image `deploy/Dockerfile`) serves everything on one origin:
the website, the customer app, the admin and partner portals, and the API at `/api/v1`.
The Android app talks to the same address. The database stays on Supabase (Singapore).

Cost: Render Starter, about USD 7 per month. Supabase Free plan.

## 1. One-time preparation (you)
1. Copy the public Supabase CA certificate `supabase-ca-2021.crt` into `backend/certs/`.
   (Supabase dashboard: Database settings, SSL Configuration.) The API verifies the database
   certificate, so the image build fails on purpose if this file is missing.
2. Create a private GitHub repository and push the project. Before the first commit run
   `git status` and confirm no `.env` file is listed (they are git-ignored).
3. Rotate any key that was ever pasted into chat, email or a screenshot (see `ROTATE-SECRETS.md`).

## 2. Render
1. Render dashboard, New, Blueprint, pick the repository. It reads `render.yaml`.
2. Fill the variables marked `sync: false` (database user and password, Brevo, Gemini, Google Routes,
   Xendit test keys, `MAIL_FROM`). Use the same values as `backend/.env`.
   Keep `NODE_ENV=staging`: the database is the NearPill staging project, and the server refuses
   to start in `production` mode with Xendit test keys.
3. After the first deploy, open `https://<service>.onrender.com/api/v1/health`. Expect
   `{"status":"ok","database":"postgres"}`.

## 3. Domain nearpill.xyz
1. Render service, Settings, Custom Domains: add `nearpill.xyz` and `www.nearpill.xyz`.
2. At the domain registrar add the DNS records Render shows for each name, then wait for the
   certificate to be issued.
3. `PUBLIC_APP_URL` and `CORS_ORIGINS` in `render.yaml` already use these names.

## 4. Supabase
- Free plan projects pause after 7 days without activity. `.github/workflows/keepalive.yml` calls the
  health check twice a week. Set the GitHub repository variable `HEALTH_URL` to
  `https://nearpill.xyz/api/v1/health`, then run the workflow once by hand.
- The free plan has no backups. `backend/scripts/backup-postgres.sh` refuses to run against
  Supabase on purpose. Take a manual `pg_dump` from your own computer before the defense, keep the
  file private, and never commit it. The data is staging test data and the schema is rebuilt by
  `npm --prefix backend run db:migrate`.

## 5. Android release APK
1. Create the signing key once (keep the file and passwords safe, never commit them):
   `keytool -genkey -v -keystore nearpill-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias release`
2. Copy `android/key.properties.example` to `android/key.properties` and fill in the real paths and passwords.
3. `MAPS_API_KEY` is already in `android/local.properties`. In Google Cloud restrict that key to the
   package name and the release signing fingerprint.
4. Build (Windows PowerShell), with a production package id of your choice, for example `xyz.nearpill.app`:
   `$env:ORG_GRADLE_PROJECT_NEARPILL_APPLICATION_ID="xyz.nearpill.app"; flutter build apk --release`
   Release builds use `https://nearpill.xyz` automatically. The file is
   `build/app/outputs/flutter-apk/app-release.apk`.
5. Share the APK through a GitHub Release link. People allow "install unknown apps" and tap Install.

## 6. Checks before the defense (November 26)
- Health URL returns ok; sign up with a real email and receive the code; browse, order, My Orders.
- Admin and partner portals sign in and load their dashboards on nearpill.xyz.
- Install the APK on a phone using mobile data, not your Wi-Fi.
- The keep-alive workflow has run successfully, and the Supabase project is not paused.
- Keep a screen recording of the full flow as a fallback.

## Known limitation to explain
OTC eligibility is not stored per medicine (R04 in `readiness-audit.md`), and real medicine sales and
online payments remain disabled pending policy approval.
