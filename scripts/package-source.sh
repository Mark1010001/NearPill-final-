#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${1:-$ROOT_DIR/../NearPill-source.zip}"

cd "$ROOT_DIR"

# Node preloads run before any JavaScript source/secret checker starts.
# Refuse ambient NODE_OPTIONS at the shell boundary to prevent unreviewed
# --require/--import code from executing ahead of the reviewed manifest gate.
if [[ -n "${NODE_OPTIONS:-}" ]]; then
  echo 'FAIL: NODE_OPTIONS preloads/flags are not permitted during source verification; run with NODE_OPTIONS unset.' >&2
  exit 1
fi

# These two Node source checkers run before the normal complete-manifest gate.
# Pin THEIR bytes with shell-only checks first, so a modified checker cannot
# execute unreviewed JS and only then report its own modification.
# This relies on a trusted entrypoint shell and reviewed manifest; it is NOT
# an external signature or a defense against a fully compromised host.
verify_reviewed_checkers_before_node() {
  local manifest='docs/packet0-source-manifest-2026-10-21.sha256'
  local filename expected recorded
  # Directory symlinks can redirect a seemingly regular manifest/checker
  # outside the canonical source tree before the Node verifier is started.
  if [[ -L docs || -L scripts || ! -d docs || ! -d scripts ]]; then
    echo 'FAIL: source verification directory missing or symlinked before Node execution.' >&2
    return 1
  fi
  if [[ ! -f "$manifest" || -L "$manifest" ]]; then
    echo 'FAIL: reviewed source manifest missing or symlinked before Node execution.' >&2
    return 1
  fi
  for filename in scripts/secret-scan.mjs scripts/verify-source-manifest.mjs; do
    if [[ ! -f "$filename" || -L "$filename" ]]; then
      echo "FAIL: source verification checker missing or symlinked: $filename" >&2
      return 1
    fi
    expected="$(awk -v file="$filename" '$2 == file && $1 ~ /^[a-f0-9]{64}$/ {print $1}' "$manifest")"
    if [[ ! "$expected" =~ ^[a-f0-9]{64}$ ]]; then
      echo "FAIL: exactly one reviewed source checker digest required: $filename" >&2
      return 1
    fi
    recorded="$(sha256sum -- "$filename")" || return 1
    if [[ "${recorded%% *}" != "$expected" ]]; then
      echo "FAIL: source checker changed before Node execution: $filename" >&2
      return 1
    fi
  done
}
verify_reviewed_checkers_before_node || exit 1

# Never remove an existing output archive or generate a new one until the
# source-artifact secret gate has passed. In particular, .env symlinks and
# binary signing material must not slip through the older find-only check.
node scripts/secret-scan.mjs
# Bind the handoff to the source manifest present BEFORE the manifest
# preflight starts. The manifest is excluded from its own hashes, so checking
# the extracted ZIP against its own swapped manifest would be insufficient.
manifest_path='docs/packet0-source-manifest-2026-10-21.sha256'
reviewed_manifest_hash="$(sha256sum -- "$manifest_path")"
reviewed_manifest_hash="${reviewed_manifest_hash%% *}"
# Packaging must use the same complete, reviewed first-party file inventory as
# Packet 0 acceptance. Reject new/unlisted or modified source before touching
# the previous archive; the verifier excludes this rolling master ledger/logs.
node scripts/verify-source-manifest.mjs

# The canonical scanner already rejects first-party .env/.env.* files and
# source symlinks. Do not rescan *excluded* generated/dependency directories
# with an unscoped `find`: installed dependencies and build/test tools may
# legitimately write .env.* artifacts that are never included in the ZIP.
# Both the staged ZIP's manifest and scanner are independently rechecked below.

# Stage the archive next to its destination and replace it only once the ZIP
# has been created AND passed an integrity check. A failed zip/unzip must not
# destroy the last known-good source handoff.
output_dir="$(cd -- "$(dirname -- "$OUTPUT")" && pwd -P)"
output_name="$(basename -- "$OUTPUT")"
[[ "$output_name" != '.' && "$output_name" != '..' ]] || { echo 'Invalid archive output name.' >&2; exit 1; }
case "$output_dir/" in
  "$ROOT_DIR/"|"$ROOT_DIR/"*)
    echo 'Refusing to package inside the source tree (would risk including old/staged archives).' >&2
    exit 1 ;;
esac
staging_dir="$(mktemp -d "$output_dir/.${output_name}.staging.XXXXXXXX")"
trap 'rm -rf -- "$staging_dir"' EXIT
staged_zip="$staging_dir/source.zip"

# Keep archive contents aligned with the manifest and scanner exclusions.
# Both root-level and nested generated directories are excluded; otherwise a
# clean build or browser test run can contaminate the source handoff.
excluded_dirs=(node_modules .dart_tool .gradle .idea .next .turbo .vercel dist build coverage .git)
zip_excludes=()
for dir in "${excluded_dirs[@]}"; do
  zip_excludes+=("$dir/*" "*/$dir/*" "$dir/" "*/$dir/")
done
zip_excludes+=(
  'web/playwright-report/*' 'web/playwright-report/'
  'web/test-results/*' 'web/test-results/'
  'web/playwright/.auth/*' 'web/playwright/.auth/'
  '.env' '*.log' '.DS_Store' 'analyze-output.txt'
)
zip -qr "$staged_zip" . -x "${zip_excludes[@]}"

# ZIP CRC validation proves the archive is readable, but NOT that its contents
# still match the reviewed source. Source may change between the preflight
# checks and zip, or a packaging tool may accidentally add an extra file.
unzip -tq "$staged_zip" >/dev/null
mkdir "$staging_dir/verified-source"
unzip -qq "$staged_zip" -d "$staging_dir/verified-source"
# Fail closed if both the source and the manifest changed after the initial
# preflight, even when those changed bytes are internally self-consistent.
# Check the reviewed digest outside the extracted tree: a checksum kept only
# inside the ZIP could be rewritten alongside the rest of the ZIP.
packaged_manifest_hash="$(sha256sum -- "$staging_dir/verified-source/$manifest_path")"
packaged_manifest_hash="${packaged_manifest_hash%% *}"
if [[ "$packaged_manifest_hash" != "$reviewed_manifest_hash" ]]; then
  echo 'FAIL: reviewed manifest changed during packaging; refusing publication.' >&2
  exit 1
fi
(
  cd "$staging_dir/verified-source"
  node scripts/verify-source-manifest.mjs
  node scripts/secret-scan.mjs
)
# The rolling Implementation Ledger and Packet 0 verification transcripts are
# intentionally excluded from the immutable *source* digest manifest. They
# must nevertheless be identical in the final handoff. A concurrent edit to
# those records after `zip` cannot be detected by the source-only hash gate.
# Compare every included archive member with the working tree immediately
# before publication, using the SAME generated/output exclusions as zip.
# Missing or unexpectedly added documentation is a packaging failure too.
parity_excludes=("${excluded_dirs[@]}" 'playwright-report' 'test-results' '.auth' \
  '.env' '*.log' '.DS_Store' 'analyze-output.txt')
parity_args=()
for pattern in "${parity_excludes[@]}"; do
  parity_args+=("--exclude=$pattern")
done
if ! diff -rq "${parity_args[@]}" -- "$ROOT_DIR" "$staging_dir/verified-source"; then
  echo 'FAIL: staged ZIP is not byte-for-byte identical to the eligible current source/evidence tree.' >&2
  exit 1
fi
# Publish ONLY to the exact reviewed output filename. Without -T, a late
# directory or directory symlink at that path makes mv silently move
# source.zip *inside* the attacker-selected directory and report success.
# A regular prior archive can still be replaced after staged verification.
mv -f -T -- "$staged_zip" "$output_dir/$output_name"
echo "Created verified source archive: $output_dir/$output_name"
