#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# A hostile inherited Node preload (--require/--import) runs BEFORE the
# source/secret checks inside our first Node child. Reject it in the shell
# entrypoint so a green integrity scan cannot follow unreviewed execution.
# The executable PATH and parent shell remain trusted environment inputs.
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

# Node may be absent altogether on an unprovisioned host. This is an
# environment gate, not evidence that a reviewed source checker failed.
# Do not report the source scan as PASS or try to execute arbitrary fallbacks:
# no JavaScript verification can run without the declared runtime.
if ! command -v node >/dev/null 2>&1; then
  echo 'ENVIRONMENT BLOCKER: Node.js is not installed; source scans and all Node tests are NOT RUN.' >&2
  echo 'BLOCKED: install the declared Node 24 runtime before Packet 0 verification (exit 2).' >&2
  exit 2
fi

code_failure=0
environment_blocker=0
lockfiles_ready=1
dependencies_ready=0
node_supported=0
npm_supported=0

version_ge() {
  local actual="$1" required="$2"
  local a_major a_minor a_patch r_major r_minor r_patch
  # Reject prerelease/malformed builds: trimming -rc or -dev would otherwise
  # turn an unsupported runtime into a false accepted stable release.
  [[ "$actual" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
  [[ "$required" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
  IFS=. read -r a_major a_minor a_patch <<<"${actual#v}"
  IFS=. read -r r_major r_minor r_patch <<<"${required#v}"

  if (( a_major != r_major )); then (( a_major > r_major )); return; fi
  if (( a_minor != r_minor )); then (( a_minor > r_minor )); return; fi
  (( a_patch >= r_patch ))
}

run_required() {
  local label="$1"; shift
  printf '\n== %s ==\n' "$label"
  if "$@"; then
    echo "PASS: $label"
  else
    local status=$?
    echo "FAIL: $label (exit $status)"
    code_failure=1
  fi
}

# Freeze the reviewed manifest *outside* the manifest's self-excluded source
# hashes. Otherwise a test could rewrite a source file AND its manifest entry,
# making both the pre- and post-execution source checks independently pass.
# This snapshot must precede any repository test or dependency install.
reviewed_manifest='docs/packet0-source-manifest-2026-10-21.sha256'
if [[ ! -f "$reviewed_manifest" || -L "$reviewed_manifest" ]]; then
  echo 'FAIL: reviewed source manifest is missing or a symlink.' >&2
  exit 1
fi
reviewed_manifest_digest="$(sha256sum -- "$reviewed_manifest")" || {
  echo 'FAIL: cannot fingerprint the reviewed source manifest.' >&2
  exit 1
}
reviewed_manifest_digest="${reviewed_manifest_digest%% *}"

assert_reviewed_manifest_unchanged() {
  local current
  current="$(sha256sum -- "$reviewed_manifest")" || {
    echo 'FAIL: reviewed manifest is unreadable after verification.' >&2
    exit 1
  }
  if [[ "${current%% *}" != "$reviewed_manifest_digest" ]]; then
    echo 'FAIL: reviewed manifest fingerprint changed during Packet 0; refusing acceptance.' >&2
    exit 1
  fi
}

# Verify exactly the reviewed first-party source before ANY repository test or
# npm installation can execute it. Previously the manifest and secret scan ran
# after Node tests; an unreviewed symlinked .test.mjs could already have run
# outside-tree code by the time verification rejected the source. A failure
# here must terminate immediately, not merely set code_failure for later.
printf '\n== Packet 0 source pre-execution integrity gate ==\n'
run_required 'Source artifact secret scan' node scripts/secret-scan.mjs
run_required 'Complete first-party source fingerprint' node scripts/verify-source-manifest.mjs
if (( code_failure != 0 )); then
  echo 'FAIL: source integrity preflight blocked all test execution and installs.'
  exit 1
fi
# Detect a changed manifest even if its revised entries still match source.
assert_reviewed_manifest_unchanged

node_version="$(node --version 2>/dev/null || true)"
npm_version="$(npm --version 2>/dev/null || true)"
echo "npm runtime: ${npm_version:-unavailable}"
if [[ ! "$npm_version" =~ ^11\.[0-9]+\.[0-9]+$ ]]; then
  echo "ENVIRONMENT BLOCKER: npm 11 is required for reproducible dependencies."
  environment_blocker=1
else
  npm_supported=1
fi

printf '\n== Source lockfile provenance ==\n'
for lockfile in package-lock.json backend/package-lock.json web/package-lock.json; do
  if [[ -f "$lockfile" ]]; then
    echo "PRESENT: $lockfile (content/manifest checks require supported dependencies)"
  else
    echo "SOURCE BLOCKER: missing $lockfile (cannot prove reproducible npm ci)"
    environment_blocker=1
    lockfiles_ready=0
  fi
done
echo "Node runtime: ${node_version:-unavailable}"
if [[ -z "$node_version" ]]; then
  echo "ENVIRONMENT BLOCKER: Node is unavailable; project requires >=24.7.0 <25."
  environment_blocker=1
else
  if version_ge "$node_version" "24.7.0" && [[ "${node_version#v}" == 24.* ]]; then
    node_supported=1
  else
    node_supported=0
    environment_blocker=1
    echo "ENVIRONMENT BLOCKER: Node $node_version is outside supported range >=24.7.0 <25."
  fi

  # An accepted baseline requires the actual locked dependencies, not only
  # filenames. Keep installs/builds behind BOTH the supported toolchain and
  # complete source lockfiles; otherwise an unavailable registry must never
  # be mistaken for an application build failure or a successful acceptance.
  if (( node_supported == 1 && lockfiles_ready == 1 )) && (( npm_supported == 1 )); then
    # A source-present lockfile is not automatically consistent with the
    # corresponding package.json. Check every surface before any npm install;
    # npm clean-install lifecycle scripts are always suppressed here. The
    # existing reviewed source manifest/secret gate runs even earlier.
    # These checks prove structural alignment, NOT independent provenance or
    # safety of third-party dependencies.
    printf '\n== Pre-install lockfile/package contracts ==\n'
    lockfile_structure_ok=1
    for checker in scripts/check-lockfile.mjs scripts/check-backend-lockfile.mjs scripts/check-web-lockfile.mjs; do
      if node "$checker"; then
        echo "PASS: $checker"
      else
        status=$?
        echo "FAIL: $checker (exit $status); no dependencies will be installed."
        code_failure=1
        lockfile_structure_ok=0
      fi
    done
    clean_installs_ok=0
    if (( lockfile_structure_ok == 1 )); then
      printf '\n== Locked clean installs and relevant builds ==\n'
      clean_installs_ok=1
      for surface in root backend web; do
        case "$surface" in
          root) install_cmd=(npm ci --ignore-scripts) ;;
          backend) install_cmd=(npm ci --prefix backend --ignore-scripts) ;;
          web) install_cmd=(npm ci --prefix web --ignore-scripts) ;;
        esac
        if "${install_cmd[@]}"; then
          echo "PASS: clean $surface install from its lockfile"
        else
          status=$?
          echo "FAIL: clean $surface install (exit $status); inspect registry/network vs dependency errors."
          code_failure=1
          clean_installs_ok=0
          break
        fi
      done
    else
      echo 'SKIP: clean installs blocked by inconsistent source lockfiles.'
    fi
    if (( clean_installs_ok == 1 )); then
      dependencies_ready=1
      run_required 'Root strict TypeScript check' npm run typecheck
      run_required 'Web portal TypeScript check' npm run typecheck:web
      run_required 'Web portal production build' npm run build:web
    else
      echo 'SKIP: TypeScript/web builds require successful clean installs.'
    fi
  else
    echo 'ENVIRONMENT/SOURCE BLOCKER: clean installs and web build require Node 24, npm 11 and all three genuine lockfiles.'
    environment_blocker=1
  fi

  # Bound Node test FILE concurrency to avoid exhausting constrained CI hosts.
  # Every discovered test still runs; this only limits simultaneous workers.
  # Discover every Packet 0 characterization test in the canonical backend
  # test directory. A manually maintained list previously omitted new tests,
  # making the acceptance suite narrower than the real source test inventory.
  # Bash leaves an unmatched glob literal; explicitly refuse an empty suite.
  # Include nested feature folders; otherwise a reviewed test under
  # backend/test/identity/ can be silently omitted from acceptance.
  # Hidden first-party feature folders are reviewed by the source manifest too.
  # Include them in the same recursive test inventory rather than silently
  # treating dot-prefixed directories as exempt from executable coverage.
  shopt -s globstar nullglob dotglob
  packet0_tests=()
  for file in backend/test/**/packet0-*.test.mjs backend/test/**/packet0-*.test.cjs backend/test/**/packet0-*.test.js; do
    [[ -f "$file" ]] || continue
    packet0_tests+=("$file")
  done
  if (( ${#packet0_tests[@]} == 0 )); then
    echo 'FAIL: no Packet 0 characterization tests found; cannot accept an empty suite.'
    code_failure=1
  else
    echo "Packet 0 test files discovered: ${#packet0_tests[@]}"
    run_required "Packet 0 characterization, including executable transaction boundaries" \
      node scripts/run-packet0-tests.mjs "${packet0_tests[@]}"
  fi

  # Use the single canonical first-party syntax checker for both standalone
  # and acceptance runs. It excludes generated output and dependency caches.
  run_required 'First-party JavaScript parse checks' node scripts/check-js-syntax.mjs
  run_required 'First-party JSON parse checks' node scripts/check-json-syntax.mjs
  run_required 'First-party shell parse checks' bash scripts/check-shell-syntax.sh

  # Packet 0 files have already been executed above. Keep the full baseline
  # coverage while running each file only once: the remaining backend contracts
  # plus discovered root ESM/CommonJS contracts form a disjoint second group. This avoids a second
  # copy of the expensive database/RLS characterization suite on constrained CI.
  remaining_backend_tests=()
  for file in backend/test/**/*.test.mjs backend/test/**/*.test.cjs backend/test/**/*.test.js; do
    [[ -f "$file" ]] || continue
    # The basename, not the containing folder, controls packet membership.
    [[ "${file##*/}" == packet0-*.test.mjs || "${file##*/}" == packet0-*.test.cjs || "${file##*/}" == packet0-*.test.js ]] && continue
    remaining_backend_tests+=("$file")
  done
  # Root contracts include both ESM and CommonJS. A fixed filename for the
  # original CommonJS test would silently exclude future first-party tests.
  root_node_tests=()
  for file in test/**/*.test.mjs test/**/*.test.cjs test/**/*.test.js; do
    [[ -f "$file" ]] || continue
    root_node_tests+=("$file")
  done

  printf '\n== Full Node baseline ==\n'
  echo 'Running only remaining unique Node contracts; Packet 0 ran above.'
  if (( ${#remaining_backend_tests[@]} == 0 )); then
    echo 'FAIL: no remaining backend contracts discovered; review first-party test inventory.'
    code_failure=1
  elif (( ${#root_node_tests[@]} == 0 )); then
    echo 'FAIL: no root Node contracts discovered; review first-party test inventory.'
    code_failure=1
  elif (( node_supported == 1 && dependencies_ready == 1 )); then
    # Union with the earlier Packet 0 run covers every first-party backend,
    # root, web/mobile and foundation Node contract on the supported runtime.
    # A successful Node exit alone is insufficient: skipped-only or mixed
    # suites can exit 0. Apply the same zero-skip TAP attestation used for
    # the Packet 0 characterization suite to the supported-runtime baseline.
    node scripts/run-packet0-tests.mjs --baseline "${remaining_backend_tests[@]}" "${root_node_tests[@]}"
    node_test_status=$?
    if (( node_test_status == 0 )); then
      echo "PASS: remaining Node baseline (Packet 0 contracts executed above)"
    else
      echo "FAIL: remaining Node baseline on supported runtime (exit $node_test_status)"
      code_failure=1
    fi
  else
    echo "SKIP: supported-runtime full Node baseline requires Node >=24.7.0 plus complete clean-installed dependencies (runtime: $node_version)."
    echo '      Native crypto.argon2 is unavailable on Node 22; real npm dependency gates are not satisfied here.'
    printf '\n== Runnable remaining Node subset (not a full acceptance gate) ==\n'
    runnable_backend_tests=()
    for file in "${remaining_backend_tests[@]}"; do
      [[ "$file" == backend/test/password-migration.test.mjs ]] && continue
      runnable_backend_tests+=("$file")
    done
    if node scripts/run-packet0-tests.mjs --partial-baseline "${runnable_backend_tests[@]}" "${root_node_tests[@]}"; then
      echo 'PARTIAL: remaining Node contracts executed only where supported; skipped contracts and unrun password-migration tests remain blockers.'
    else
      echo 'FAIL: runnable Node subset contained a failed/cancelled test, missing TAP summary, or no executed tests.'
      code_failure=1
    fi
  fi
fi

printf '\n== Flutter baseline ==\n'
if command -v flutter >/dev/null 2>&1; then
  flutter_release="$(flutter --version 2>/dev/null | head -n 1)"
  dart_release="$(dart --version 2>&1 || true)"
  echo "$flutter_release"
  echo "$dart_release"
  # Compare complete SDK versions, not prefixes (3.44.40 is not 3.44.4).
  if [[ ! "$flutter_release" =~ ^Flutter[[:space:]]+3\.44\.4[[:space:]]+.*channel[[:space:]]+stable([[:space:]]|$) ]] ||
     [[ ! "$dart_release" =~ ^Dart[[:space:]]+SDK[[:space:]]+version:[[:space:]]+3\.12\.2[[:space:]]+\(stable\) ]]; then
    echo 'ENVIRONMENT BLOCKER: Flutter 3.44.4 and Dart 3.12.2 are required by this source.'
    echo 'SKIP: Flutter dependency resolution and tests cannot establish acceptance on a mismatched SDK.'
    environment_blocker=1
  elif [[ ! -f pubspec.lock || -L pubspec.lock ]]; then
    echo 'SOURCE/ENVIRONMENT BLOCKER: reviewed Flutter application pubspec.lock is missing or symlinked; reproducible dependency resolution is NOT RUN.'
    environment_blocker=1
  elif ! flutter pub get --enforce-lockfile; then
    echo 'ENVIRONMENT BLOCKER: enforced Flutter lockfile dependency resolution failed; analyzer and tests are not runnable.'
    environment_blocker=1
  else
    run_required 'Flutter analyzer' flutter analyze
    run_required 'Flutter tests' flutter test
  fi
else
  echo "ENVIRONMENT BLOCKER: Flutter SDK is unavailable."
  environment_blocker=1
fi

# Source can change during tests/builds even when pre-execution review passed.
# Reuse the SAME scanners at the end: a changed file, added symlink or leaked
# credential must be a code failure, not masked as an environment-only BLOCKED.
# This cannot replace a trusted external source attestation; it is a local
# start/end baseline invariant within the existing Packet 0 runner.
printf '\n== Packet 0 post-execution source integrity ==\n'
run_required 'Post-execution source secret scan' node scripts/secret-scan.mjs
run_required 'Post-execution source integrity' node scripts/verify-source-manifest.mjs
assert_reviewed_manifest_unchanged

printf '\n== Packet 0 verification result ==\n'
if (( code_failure != 0 )); then
  echo "FAIL: code/test failure detected."
  exit 1
fi
if (( environment_blocker != 0 )); then
  echo "BLOCKED: executable checks completed where possible, but supported runtime/source prerequisites are unavailable."
  exit 2
fi

# A green Node/Flutter toolchain is only a LOCAL BASELINE. This script does
# not execute the live app-role RLS negatives, migration replay, 100-way order
# contention, reconciliation, and real backup/restore drill. A zero exit here
# could be consumed by CI as Packet 0 acceptance despite never checking those
# mandatory gates. There is deliberately no environment-variable bypass:
# extend the canonical verifier with actual owner-approved tests and evidence
# before Packet 0 can return success.
echo 'PASS: Packet 0 local toolchain/build baseline completed.'
echo 'BLOCKED: Packet 0 acceptance requires independently executed real NearPill-owned PostgreSQL app-role RLS, migration, 100-way inventory, reconciliation and restore gates; none are run by this verifier.'
exit 2
