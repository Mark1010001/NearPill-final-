#!/usr/bin/env bash
set -euo pipefail

# Packet 0 characterization: parse every first-party shell script with its
# declared interpreter. Source manifest/package checks exclude generated trees,
# so their scripts must not be allowed to make this acceptance gate flaky.
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
checked=0
failed=0
# Process substitution hides failures from the producer (find or sort). A
# truncated traversal could otherwise produce a misleading PASS when at least
# one readable script was discovered before the error. Capture the complete
# inventory in a private file and check the whole pipeline before parsing it.
inventory="$(mktemp "${TMPDIR:-/tmp}/nearpill-shell-inventory.XXXXXXXX")"
trap 'rm -f -- "$inventory"' EXIT
if ! find "$ROOT_DIR" \
  \( -type d \( -name .git -o -name node_modules -o -name .dart_tool -o -name .gradle \
  -o -name .idea -o -name .next -o -name .turbo -o -name .vercel \
  -o -name dist -o -name build -o -name coverage -o -name test-results \
  -o -name playwright-report -o -name .auth \) -prune \) -o \
  \( -type f -print0 \) | sort -z > "$inventory"; then
  echo 'FAIL: first-party shell source discovery failed; refusing incomplete syntax coverage.' >&2
  exit 1
fi
while IFS= read -r -d '' script; do
  relative="${script#"$ROOT_DIR"/}"
  # Shell entrypoints may be invoked as `bash scripts/deploy` or shipped as
  # extensionless executables. A *.sh-only scan would silently omit those.
  # Probe just the first two bytes before reading the full shebang, so binary
  # assets and non-shell sources are not interpreted as shell text.
  if [[ "$script" != *.sh ]]; then
    prefix=''
    IFS= read -r -n 2 prefix < "$script" || true
    [[ "$prefix" == '#!' ]] || continue
  fi

  first_line="$(head -n 1 -- "$script")"
  interpreter=''
  if [[ "$first_line" == '#!'* ]]; then
    # Recognize only the actual interpreter token, not a substring such as
    # `sh` in a Python path. Support /usr/bin/env and env -S shebangs.
    read -r -a shebang_parts <<< "${first_line#\#!}"
    executable="${shebang_parts[0]##*/}"
    if [[ "$executable" == env ]]; then
      offset=1
      [[ "${shebang_parts[1]:-}" == '-S' ]] && offset=2
      executable="${shebang_parts[$offset]:-}"
      executable="${executable##*/}"
    fi
    case "$executable" in
      bash) interpreter=bash ;;
      sh|dash|ash) interpreter=sh ;;
      *)
        if [[ "$script" == *.sh ]]; then
          echo "FAIL: unsupported interpreter in first-party shell script: $relative" >&2
          failed=1
        fi
        continue ;;
    esac
  elif [[ "$script" == *.sh ]]; then
    interpreter=sh
  else
    continue
  fi

  checked=$((checked + 1))
  if ! "$interpreter" -n -- "$script"; then
    echo "FAIL: shell syntax ($interpreter): $relative" >&2
    failed=1
  fi
done < "$inventory"

if (( checked == 0 || failed != 0 )); then
  (( checked > 0 )) || echo 'FAIL: no first-party shell scripts discovered.' >&2
  exit 1
fi
echo "PASS: $checked first-party shell scripts passed syntax checks."
