#!/bin/sh
set -eu

# This operation runs pg_restore --clean. Never infer a safe target from
# development defaults or from fixture-verification staging approval.
if [ "$#" -ne 1 ]; then
  echo 'usage: restore-postgres.sh <backup.dump>' >&2
  exit 2
fi
# Inherited Node preloads execute before the JavaScript target guard itself.
# Match the repository source-verification entrypoints: no ambient Node flags
# may inject code ahead of authorization for backup or destructive restore.
if [ -n "${NODE_OPTIONS:-}" ]; then
  echo 'DATABASE OPERATION BLOCKED: NODE_OPTIONS must be unset before verification.' >&2
  exit 2
fi
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
node "$SCRIPT_DIR/lib/verify-restore-target.mjs"

if [ ! -f "$1" ] || [ -L "$1" ]; then
  echo 'RESTORE BLOCKED: supplied dump must be a regular file, not a symlink.' >&2
  exit 2
fi

# Copy the approved input into a private 0700 directory. The same immutable-
# to-the-operator snapshot is inspected AND restored: otherwise an archive
# replaced after `pg_restore --list` could cause different, uninspected content
# to reach the destructive `--clean` invocation. The source can be changed by
# the caller, but that no longer changes the bytes handed to the restore tool.
# Restore data may contain account/order records, so stage only with umask 077
# and remove the copy on success, failure, or a terminating signal.
umask 077
private_dir=$(mktemp -d "${TMPDIR:-/tmp}/nearpill-restore.XXXXXXXX") || {
  echo 'RESTORE BLOCKED: could not create private archive staging area.' >&2
  exit 2
}
trap 'rm -rf -- "$private_dir"' 0
trap 'exit 2' 1 2 3 15
snapshot="$private_dir/approved.dump"
# The caller's pathname can be swapped to a symlink after the -f/-L test
# above. Copy without following source links, then reject any staged link
# BEFORE chmod (chmod would follow a link and could alter an unrelated file).
# This closes the source-check -> cp-open symlink race in addition to the
# already protected archive-inspection -> restore-content race.
if ! cp -P -- "$1" "$snapshot" 2>/dev/null ||
    [ -L "$snapshot" ] || [ ! -f "$snapshot" ] ||
    ! chmod 600 "$snapshot"; then
  echo 'RESTORE BLOCKED: could not stage a regular archive privately.' >&2
  exit 2
fi

# Bind the destructive approval to exact archive bytes, not merely an input
# pathname. Hash the same private snapshot used for offline verification and
# the restore itself. Do not print either the expected or actual digest, and
# fail before any pg_restore process is invoked if the bytes differ.
if ! snapshot_sha_line=$(sha256sum -- "$snapshot" 2>/dev/null); then
  echo 'RESTORE BLOCKED: unable to verify approved archive fingerprint.' >&2
  exit 2
fi
snapshot_sha=${snapshot_sha_line%% *}
if [ "$snapshot_sha" != "$NEARPILL_RESTORE_EXPECTED_SHA256" ]; then
  echo 'RESTORE BLOCKED: staged archive does not match approved SHA-256.' >&2
  exit 2
fi

# Check the staged archive catalog without a database connection before any
# destructive restore. A readable TOC is not proof of payload recoverability;
# a real disposable database restore drill remains mandatory.
# Discard diagnostics: archive metadata may contain sensitive names.
if ! env -i PATH="$PATH" pg_restore --list -- "$snapshot" >/dev/null 2>&1; then
  echo 'RESTORE BLOCKED: archive inspection failed before database access.' >&2
  exit 2
fi

# Reading the archive TOC only validates its catalog. Extract the entire
# restored SQL/data stream to a sink, without DB credentials or a connection,
# so corrupt compressed payloads are rejected before --clean. This does NOT
# establish SQL trust, semantic integrity, or successful PostgreSQL recovery;
# a real disposable restore drill remains a separate mandatory gate.
# Suppress all output because SQL/COPY data may contain sensitive records.
if ! env -i PATH="$PATH" pg_restore --file=/dev/null --no-owner --no-acl -- "$snapshot" >/dev/null 2>&1; then
  echo 'RESTORE BLOCKED: archive payload verification failed before database access.' >&2
  exit 2
fi

# Single-transaction + exit-on-error prevent declaring success after partial
# schema/data restoration. The guard above restricts destructive restoration
# to a separately confirmed disposable local test DB.
env -i PATH="$PATH" PGPASSWORD="$DB_PASSWORD" pg_restore \
  --clean --if-exists --single-transaction --exit-on-error --no-owner --no-acl \
  -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -- "$snapshot"
