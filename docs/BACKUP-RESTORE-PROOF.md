# Backup and restore proof (free tier)

Goal: show the panel that NearPill data can be recovered. Everything here is free.

## 1. What Supabase gives you
- Free projects get **daily automatic backups** kept for 7 days (Dashboard -> Database -> Backups). Restoring from the dashboard is a paid feature, so the free way is the practice restore below.

## 2. Take a backup (on your PC)
1. Install PostgreSQL client tools (pg_dump / pg_restore) or use Docker.
2. Get the **direct connection string** of NearPill Staging (Dashboard -> Connect). Use the migrator/postgres password, never paste it into chat or docs.
3. In PowerShell:
   `pg_dump -Fc --no-owner --no-acl "<connection string>" -f nearpill-staging-backup.dump`
4. Keep the .dump file OUT of the project folder (it contains personal data) and never commit it.

## 3. Practice restore into a throw-away database
1. Create a second free Supabase project called `NearPill Restore Test` (or a local Postgres).
2. `pg_restore --no-owner --no-acl -d "<restore-test connection string>" nearpill-staging-backup.dump`
3. Compare: run `select count(*) from orders;`, `... from inventory;`, `... from drugstores;` on both databases. The numbers must match.
4. Take a **screenshot** of both counts side by side and save it as `docs/backup-restore-proof.png`.
5. Delete the restore-test project afterwards.

## 4. Say this to the panel
"Supabase backs up daily and keeps 7 days. We also take our own dump and proved a restore into a separate database with matching row counts (screenshot)."

Note: the repo script `backend/scripts/backup-postgres.sh` is deliberately limited to disposable local databases; use the manual steps above for Supabase.
