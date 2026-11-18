#!/usr/bin/env bash
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

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

# Match the canonical Packet 0 verifier: a machine without Node cannot run
# the reviewed JavaScript scanners or any Node characterization. This is an
# environment blocker (not a source defect); the shell-only checker digests
# above must still be verified before returning NOT RUN / BLOCKED.
if ! command -v node >/dev/null 2>&1; then
  echo 'ENVIRONMENT BLOCKER: Node.js is not installed; mobile source scans and Node contracts are NOT RUN.' >&2
  echo 'BLOCKED: install the declared Node 24 runtime before mobile verification (exit 2).' >&2
  exit 2
fi

# The standalone mobile command also executes first-party Node tests and can
# resolve Flutter dependencies. Match Packet 0's pre-execution trust boundary:
# reject changed/unreviewed source before either operation, rather than
# reporting a toolchain-only BLOCKED status after unreviewed code has run.
echo '==> mobile source pre-execution integrity gate'
if ! node scripts/secret-scan.mjs; then
  echo 'FAIL: mobile source secret scan blocked execution.' >&2
  exit 1
fi
if ! node scripts/verify-source-manifest.mjs; then
  echo 'FAIL: mobile source manifest blocked execution.' >&2
  exit 1
fi

# The rolling source manifest excludes its own bytes. Freeze the reviewed
# manifest separately so a test cannot rewrite both a source file and its
# digest entry to make the post-execution manifest scan appear green.
reviewed_manifest='docs/packet0-source-manifest-2026-10-21.sha256'
if [[ ! -f "$reviewed_manifest" || -L "$reviewed_manifest" ]]; then
  echo 'FAIL: reviewed mobile source manifest missing or symlinked.' >&2
  exit 1
fi
reviewed_manifest_hash="$(sha256sum -- "$reviewed_manifest")" || exit 1
reviewed_manifest_hash="${reviewed_manifest_hash%% *}"

blocked=0
failed=0

# Standalone mobile verification executes Node characterization and source
# security tooling as part of its acceptance boundary. Without this check,
# fake/pinned Flutter and Dart alone could produce exit 0 on Node 22 even
# though the repository declares >=24.7.0 <25. Report a toolchain BLOCKED
# rather than a code failure; continue runnable contracts and postflight
# integrity checks for diagnostic evidence.
supported_node_release() {
  local release="$1" minor
  [[ "$release" =~ ^v24\.([0-9]+)\.([0-9]+)$ ]] || return 1
  minor="${BASH_REMATCH[1]}"
  (( 10#$minor >= 7 ))
}
node_release="$(node --version 2>/dev/null || true)"
if ! supported_node_release "$node_release"; then
  echo "BLOCKED: Node ${node_release:-unavailable} is outside supported >=24.7.0 <25 for mobile acceptance."
  blocked=1
fi

# The root package also pins npm >=11 <12. The standalone command can run
# without invoking npm directly, but must not independently attest a green
# Packet 0 mobile baseline under an unsupported project toolchain. A missing
# or prerelease npm binary is an environment blocker; do not skip the runnable
# architecture or post-execution source integrity checks.
npm_release="$(npm --version 2>/dev/null || true)"
if [[ ! "$npm_release" =~ ^11\.[0-9]+\.[0-9]+$ ]]; then
  echo "BLOCKED: npm ${npm_release:-unavailable} is outside supported npm >=11 <12 for mobile acceptance."
  blocked=1
fi

run_gate() {
  local label="$1"
  shift
  echo "==> $label"
  if "$@"; then
    echo "PASS: $label"
  else
    echo "FAIL: $label" >&2
    failed=1
  fi
}

# Node --test exits 0 even if every architecture test is skipped. Reuse the
# reviewed TAP attestation from Packet 0: mobile contracts count as PASS only
# when each discovered assertion actually runs with zero skips or todos.
run_gate "mobile architecture contracts" node scripts/run-packet0-tests.mjs --baseline test/mobile-architecture.test.mjs

if command -v flutter >/dev/null 2>&1; then
  # Keep standalone `npm run verify:mobile` aligned with the canonical Packet 0
  # Flutter/Dart pins. A successful build on a different SDK does not prove
  # parity with the supported release environment. Check before `pub get`.
  flutter_release="$(flutter --version 2>/dev/null | head -n 1)"
  dart_release="$(dart --version 2>&1 || true)"
  if [[ ! "$flutter_release" =~ ^Flutter[[:space:]]+3\.44\.4[[:space:]]+.*channel[[:space:]]+stable([[:space:]]|$) ]] ||
     [[ ! "$dart_release" =~ ^Dart[[:space:]]+SDK[[:space:]]+version:[[:space:]]+3\.12\.2[[:space:]]+\(stable\) ]]; then
    echo 'BLOCKED: Flutter 3.44.4 and Dart 3.12.2 are required for mobile acceptance.'
    echo 'SKIP: Flutter dependency resolution, analyzer and tests require the pinned SDK.'
    blocked=1
  elif [[ ! -f pubspec.lock || -L pubspec.lock ]]; then
    # An application release must not resolve fresh transitive versions and
    # call them the characterized baseline. This source currently lacks an
    # authentic pubspec.lock: record BLOCKED rather than generating one here.
    echo 'BLOCKED: reviewed Flutter application pubspec.lock is missing or symlinked; dependency/analyzer/test gates are NOT RUN.'
    blocked=1
  else
    run_gate "Flutter locked dependency resolution" flutter pub get --enforce-lockfile
    if [[ $failed -eq 0 ]]; then
      run_gate "Flutter analyzer" flutter analyze
      run_gate "Flutter tests" flutter test
    fi
  fi
else
  echo "BLOCKED: Flutter SDK is not installed; dependency/analyze/test gates were not executed."
  blocked=1
fi

# Flutter tooling and Node characterization tests can write first-party
# files after the pre-execution review. Reverify the entire reviewed source,
# including absence of newly added files/secrets, before reporting any PASS or
# environment-only BLOCKED outcome. Never hide a mutation behind a missing SDK.
echo '==> mobile source post-execution integrity gate'
if ! node scripts/secret-scan.mjs; then
  echo 'FAIL: post-execution source secret scan.' >&2
  failed=1
fi
if ! node scripts/verify-source-manifest.mjs; then
  echo 'FAIL: post-execution source integrity.' >&2
  failed=1
fi
current_manifest_hash="$(sha256sum -- "$reviewed_manifest" 2>/dev/null)" || current_manifest_hash=''
current_manifest_hash="${current_manifest_hash%% *}"
if [[ -L "$reviewed_manifest" || "$current_manifest_hash" != "$reviewed_manifest_hash" ]]; then
  echo 'FAIL: reviewed manifest changed during mobile verification.' >&2
  failed=1
fi

if [[ $failed -ne 0 ]]; then
  exit 1
fi
if [[ $blocked -ne 0 ]]; then
  exit 2
fi
exit 0
