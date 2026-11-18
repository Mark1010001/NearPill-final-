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


code_failure=0
environment_blocker=0

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

# Packet 1's standalone verifier must honor Packet 0's pre-execution trust
# boundary. A failing integrity gate must stop BEFORE foundation tests or
# local tools can evaluate unreviewed code; an eventual FAIL is too late.
printf '\n== Foundation source pre-execution integrity gate ==\n'
if ! node scripts/secret-scan.mjs; then
  echo 'FAIL: foundation source secret scan blocked execution.' >&2
  exit 1
fi
if ! node scripts/verify-source-manifest.mjs; then
  echo 'FAIL: foundation source manifest blocked execution.' >&2
  exit 1
fi

printf '\n== Runtime policy ==\n'
node scripts/check-runtime.mjs
runtime_status=$?
if (( runtime_status == 0 )); then
  echo "PASS: Runtime policy"
elif (( runtime_status == 2 )); then
  echo "ENVIRONMENT BLOCKER: active Node/npm runtime is outside the declared policy."
  environment_blocker=1
else
  echo "FAIL: Runtime policy (exit $runtime_status)"
  code_failure=1
fi

printf '\n== Root lockfile ==\n'
node scripts/check-lockfile.mjs
lock_status=$?
if (( lock_status == 0 )); then
  echo "PASS: Root lockfile"
elif (( lock_status == 2 )); then
  echo "ACCEPTANCE BLOCKER: root package-lock.json has not been generated yet."
  environment_blocker=1
else
  echo "FAIL: Root lockfile (exit $lock_status)"
  code_failure=1
fi

run_required "Foundation contract tests" node --test test/engineering-foundation.test.mjs
run_required "Typed environment test harness" node --test test/env-config.test.mjs
run_required "First-party JavaScript syntax" node scripts/check-js-syntax.mjs
run_required "Secret scan" node scripts/secret-scan.mjs

printf '\n== TypeScript strict check ==\n'
if command -v tsc >/dev/null 2>&1; then
  tsc_version="$(tsc --version 2>/dev/null || true)"
  if [[ "$tsc_version" != "Version 7.0.2" ]]; then
    echo "ENVIRONMENT BLOCKER: declared TypeScript is 7.0.2; available compiler is ${tsc_version:-unknown}."
    environment_blocker=1
  fi
  if tsc -p tsconfig.json --noEmit; then
    echo "PASS: TypeScript compatibility check (${tsc_version:-unknown})"
  else
    echo "FAIL: TypeScript strict check"
    code_failure=1
  fi
else
  echo "ENVIRONMENT BLOCKER: tsc is unavailable."
  environment_blocker=1
fi

printf '\n== ESLint ==\n'
if command -v eslint >/dev/null 2>&1; then
  if eslint eslint.config.mjs scripts/*.mjs test/engineering-foundation.test.mjs; then
    echo "PASS: ESLint"
  else
    echo "FAIL: ESLint"
    code_failure=1
  fi
else
  echo "ENVIRONMENT BLOCKER: eslint is unavailable."
  environment_blocker=1
fi

printf '\n== Prettier ==\n'
if command -v prettier >/dev/null 2>&1; then
  if prettier --check package.json tsconfig.json tsconfig.base.json eslint.config.mjs .prettierrc.json compose.yaml scripts test/engineering-foundation.test.mjs test/env-config.test.mjs backend/src/config/env.ts .github/workflows/ci.yml README.md .env.example; then
    echo "PASS: Prettier"
  else
    echo "FAIL: Prettier"
    code_failure=1
  fi
else
  echo "ENVIRONMENT BLOCKER: prettier is unavailable."
  environment_blocker=1
fi

printf '\n== Compose configuration ==\n'
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  if DB_PASSWORD=verification-only MYSQL_ROOT_PASSWORD=verification-only docker compose config --quiet; then
    echo "PASS: Compose configuration"
  else
    echo "FAIL: Compose configuration"
    code_failure=1
  fi
else
  echo "ENVIRONMENT BLOCKER: Docker Compose v2 is unavailable."
  environment_blocker=1
fi

printf '\n== Packet 1 foundation verification result ==\n'
if (( code_failure != 0 )); then
  echo "FAIL: Packet 1 foundation has code/configuration failures."
  exit 1
fi
if (( environment_blocker != 0 )); then
  echo "BLOCKED: available Packet 1 checks passed, but required tooling/runtime gates remain unavailable."
  exit 2
fi

echo "PASS: Packet 1 foundation gates completed."
