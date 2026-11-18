#!/bin/sh
set -eu

# pg_dump exports potentially sensitive account, pharmacy and order data.
# Packet 0 only authorizes explicitly confirmed disposable local-test backups.
# Supabase staging/production use a separately approved managed-backup runbook.
# Inherited Node preloads execute before the JavaScript target guard itself.
# Match the repository source-verification entrypoints: no ambient Node flags
# may inject code ahead of authorization for backup or destructive restore.
if [ -n "${NODE_OPTIONS:-}" ]; then
  echo 'DATABASE OPERATION BLOCKED: NODE_OPTIONS must be unset before verification.' >&2
  exit 2
fi
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
node "$SCRIPT_DIR/lib/verify-backup-target.mjs"

# mktemp creates an exclusive 0600 file. Publish through an atomic hard link
# so an existing backup (including a symlink) is NEVER overwritten. Keep the
# temporary file in the same private directory for same-filesystem linking.
umask 077
temporary=$(mktemp "${BACKUP_FILE}.partial.XXXXXXXX")
trap 'rm -f -- "$temporary"' EXIT HUP INT TERM

# An empty child environment prevents PGHOSTADDR/PGSERVICE/PGOPTIONS from
# redirecting the dump to an unintended PostgreSQL target.
env -i PATH="$PATH" PGPASSWORD="$DB_PASSWORD" PGSSLMODE=disable pg_dump \
  -Fc --no-owner --no-acl -h "$DB_HOST" -p "$DB_PORT" \
  -U "$DB_USER" -d "$DB_NAME" -f "$temporary"
if [ ! -s "$temporary" ]; then
  echo 'BACKUP FAILED: pg_dump did not produce a nonempty archive.' >&2
  exit 1
fi
# A nonempty file is not necessarily a readable custom-format dump. Inspect
# the archive's table of contents before publishing it; this opens no DB
# connection and exposes no listing in logs. A full restore drill is still
# required separately to establish that archived payloads can be recovered.
if ! env -i PATH="$PATH" pg_restore --list -- "$temporary" >/dev/null 2>&1; then
  echo 'BACKUP FAILED: pg_restore could not inspect the custom-format archive.' >&2
  exit 1
fi
# A valid TOC does not establish that compressed row data can be read. Before
# publishing the archive, extract the full SQL/COPY stream offline into a sink
# using the same private temporary file. Do not print potentially sensitive
# SQL, COPY data, or archive metadata. This is a readability check only: it
# does NOT prove restore success, semantic integrity, or SQL trust. A real
# disposable database restore drill remains a separate mandatory gate.
if ! env -i PATH="$PATH" pg_restore --file=/dev/null --no-owner --no-acl -- "$temporary" >/dev/null 2>&1; then
  echo 'BACKUP FAILED: archive payload could not be extracted before publication.' >&2
  exit 1
fi
# Treat BACKUP_FILE as the exact filename, never as a directory. A concurrent
# process could create a directory symlink there after the initial unused-path
# check; ordinary `ln` would otherwise link sensitive data *inside* it and
# misleadingly report success. GNU -T rejects that destination fail-closed.
if ! ln -T -- "$temporary" "$BACKUP_FILE" 2>/dev/null; then
  echo 'BACKUP FAILED: archive destination changed or could not be published safely.' >&2
  exit 1
fi
rm -f -- "$temporary"
trap - EXIT HUP INT TERM
printf '%s\n' "$BACKUP_FILE"
