#!/usr/bin/env bash

set -uo pipefail

readonly E2E_JAVA_HOME='/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home'
export JAVA_HOME="$E2E_JAVA_HOME"
export PATH="$JAVA_HOME/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FLOW_DIR="$REPO_ROOT/tests/e2e-maestro/flows"
MANIFEST="$REPO_ROOT/tests/e2e-maestro/last-run.json"
APP_ID='swiss.dfx.bitcoin'
readonly INTER_FLOW_PAUSE_SECONDS=12

SIMULATOR_UDID=''
APP_BUNDLE_PATH=''
FLOW_FILTER='*.yaml'

usage() {
  printf 'Usage: %s --device SIMULATOR_UDID --app APP_BUNDLE [--flow FLOW_GLOB]\n' "$0"
  printf '       %s SIMULATOR_UDID APP_BUNDLE [FLOW_GLOB]\n' "$0"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 2
}

while (($#)); do
  case "$1" in
    --device)
      (($# >= 2)) || fail '--device requires a Simulator UDID'
      SIMULATOR_UDID="$2"
      shift 2
      ;;
    --app)
      (($# >= 2)) || fail '--app requires the path to an installed-build .app bundle'
      APP_BUNDLE_PATH="$2"
      shift 2
      ;;
    --flow)
      (($# >= 2)) || fail '--flow requires a basename glob such as 05-*'
      FLOW_FILTER="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      fail "unknown option: $1"
      ;;
    *)
      if [[ -z "$SIMULATOR_UDID" ]]; then
        SIMULATOR_UDID="$1"
      elif [[ -z "$APP_BUNDLE_PATH" ]]; then
        APP_BUNDLE_PATH="$1"
      elif [[ "$FLOW_FILTER" == '*.yaml' ]]; then
        FLOW_FILTER="$1"
      else
        fail "unexpected argument: $1"
      fi
      shift
      ;;
  esac
done

[[ -n "$SIMULATOR_UDID" ]] || fail '--device is required because every flow must reset one specific simulator'
[[ -n "$APP_BUNDLE_PATH" ]] || fail '--app is required because the app is reinstalled before every flow'
[[ "$FLOW_FILTER" != */* ]] || fail '--flow accepts a basename glob, not a path'
[[ "$APP_BUNDLE_PATH" == *.app ]] || fail "--app must point to a .app bundle: $APP_BUNDLE_PATH"
[[ -d "$APP_BUNDLE_PATH" ]] || fail "app bundle does not exist: $APP_BUNDLE_PATH"
APP_BUNDLE_PATH="$(cd "$(dirname "$APP_BUNDLE_PATH")" && pwd)/$(basename "$APP_BUNDLE_PATH")"
[[ -x "$JAVA_HOME/bin/java" ]] || fail "Java is missing at $JAVA_HOME/bin/java"
command -v java >/dev/null 2>&1 || fail 'Java is not available after setting JAVA_HOME'
MAESTRO_BIN="$(command -v maestro)" || fail 'maestro is not installed or not on PATH'
command -v xcrun >/dev/null 2>&1 || fail 'xcrun is not installed or not on PATH'
[[ -d "$FLOW_DIR" ]] || fail "flow directory does not exist: $FLOW_DIR"

shopt -s nullglob
FLOWS=("$FLOW_DIR"/$FLOW_FILTER)
shopt -u nullglob

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
manifest_tmp="$(mktemp "$MANIFEST.tmp.XXXXXX")" || fail "cannot create manifest next to $MANIFEST"
trap 'rm -f "$manifest_tmp"' EXIT

printf '{\n' >"$manifest_tmp"
printf '  "startedAt": "%s",\n' "$(json_escape "$started_at")" >>"$manifest_tmp"
printf '  "device": "%s",\n' "$(json_escape "$SIMULATOR_UDID")" >>"$manifest_tmp"
printf '  "appBundle": "%s",\n' "$(json_escape "$APP_BUNDLE_PATH")" >>"$manifest_tmp"
printf '  "filter": "%s",\n' "$(json_escape "$FLOW_FILTER")" >>"$manifest_tmp"
printf '  "flows": [\n' >>"$manifest_tmp"

if ((${#FLOWS[@]} == 0)); then
  printf '  ],\n' >>"$manifest_tmp"
  printf '  "passed": 0,\n' >>"$manifest_tmp"
  printf '  "assertionFailures": 0,\n' >>"$manifest_tmp"
  printf '  "aborted": 0,\n' >>"$manifest_tmp"
  printf '  "failed": 0,\n' >>"$manifest_tmp"
  printf '  "suiteOutcome": "configuration-error",\n' >>"$manifest_tmp"
  printf '  "suiteExitCode": 2\n' >>"$manifest_tmp"
  printf '}\n' >>"$manifest_tmp"
  mv "$manifest_tmp" "$MANIFEST"
  trap - EXIT
  fail "no flows matched '$FLOW_FILTER' in $FLOW_DIR"
fi

failed=0
passed=0
assertion_failures=0
aborted=0
first=1

ensure_simulator_ready() {
  printf 'Checking simulator %s readiness\n' "$SIMULATOR_UDID"
  if ! xcrun simctl bootstatus "$SIMULATOR_UDID" -b; then
    printf 'ERROR: simulator %s could not be booted or did not become ready\n' \
      "$SIMULATOR_UDID" >&2
    return 1
  fi
}

reset_simulator_app() {
  printf 'Resetting %s on simulator %s\n' "$APP_ID" "$SIMULATOR_UDID"

  # terminate/uninstall legitimately fail when the app is not installed yet.
  # The container check below makes a failed removal impossible to ignore.
  xcrun simctl terminate "$SIMULATOR_UDID" "$APP_ID" >/dev/null 2>&1 || true
  xcrun simctl uninstall "$SIMULATOR_UDID" "$APP_ID" >/dev/null 2>&1 || true
  if xcrun simctl get_app_container "$SIMULATOR_UDID" "$APP_ID" app >/dev/null 2>&1; then
    printf 'ERROR: %s is still installed after uninstall\n' "$APP_ID" >&2
    return 1
  fi
  if ! xcrun simctl keychain "$SIMULATOR_UDID" reset; then
    printf 'ERROR: failed to reset the simulator keychain\n' >&2
    return 1
  fi
  if ! xcrun simctl install "$SIMULATOR_UDID" "$APP_BUNDLE_PATH"; then
    printf 'ERROR: failed to install %s\n' "$APP_BUNDLE_PATH" >&2
    return 1
  fi
  if ! xcrun simctl get_app_container "$SIMULATOR_UDID" "$APP_ID" app >/dev/null 2>&1; then
    printf 'ERROR: %s is not installed after simctl install\n' "$APP_ID" >&2
    return 1
  fi
}

for flow in "${FLOWS[@]}"; do
  name="$(basename "$flow")"

  if ((first == 0)); then
    printf '\nWaiting %d seconds before the next simulator reset\n' \
      "$INTER_FLOW_PAUSE_SECONDS"
    sleep "$INTER_FLOW_PAUSE_SECONDS"
  fi

  started_seconds="$(date +%s)"
  flow_log="$(mktemp "${TMPDIR:-/tmp}/maestro-flow.XXXXXX")" || \
    fail "cannot create temporary Maestro log for $name"

  printf '\n==> %s\n' "$name"
  if ensure_simulator_ready && reset_simulator_app && ensure_simulator_ready; then
    "$MAESTRO_BIN" --device "$SIMULATOR_UDID" test "$flow" 2>&1 | tee "$flow_log"
    flow_exit=${PIPESTATUS[0]}
  else
    flow_exit=125
  fi

  finished_seconds="$(date +%s)"
  duration_seconds=$((finished_seconds - started_seconds))
  if ((flow_exit == 0)); then
    outcome='passed'
    passed=$((passed + 1))
  elif grep -Eq 'Assert.*FAILED' "$flow_log"; then
    outcome='assertion-failed'
    assertion_failures=$((assertion_failures + 1))
    failed=$((failed + 1))
  else
    outcome='run-aborted'
    aborted=$((aborted + 1))
    failed=$((failed + 1))
  fi
  rm -f "$flow_log"

  if ((first == 0)); then
    printf ',\n' >>"$manifest_tmp"
  fi
  first=0
  printf '    {"name":"%s","exitCode":%d,"durationSeconds":%d,"outcome":"%s"}' \
    "$(json_escape "$name")" "$flow_exit" "$duration_seconds" "$outcome" >>"$manifest_tmp"
done

suite_exit=0
suite_outcome='passed'
if ((assertion_failures > 0 && aborted > 0)); then
  suite_exit=1
  suite_outcome='mixed-failure'
elif ((assertion_failures > 0)); then
  suite_exit=1
  suite_outcome='assertion-failed'
elif ((aborted > 0)); then
  suite_exit=1
  suite_outcome='environment-error'
fi

printf '\n  ],\n' >>"$manifest_tmp"
printf '  "passed": %d,\n' "$passed" >>"$manifest_tmp"
printf '  "assertionFailures": %d,\n' "$assertion_failures" >>"$manifest_tmp"
printf '  "aborted": %d,\n' "$aborted" >>"$manifest_tmp"
printf '  "failed": %d,\n' "$failed" >>"$manifest_tmp"
printf '  "suiteOutcome": "%s",\n' "$suite_outcome" >>"$manifest_tmp"
printf '  "suiteExitCode": %d\n' "$suite_exit" >>"$manifest_tmp"
printf '}\n' >>"$manifest_tmp"
mv "$manifest_tmp" "$MANIFEST"
trap - EXIT

printf '\nManifest: %s\n' "$MANIFEST"
printf 'Flows: %d, passed: %d, assertion failures: %d, aborted: %d\n' \
  "${#FLOWS[@]}" "$passed" "$assertion_failures" "$aborted"
printf 'Suite outcome: %s\n' "$suite_outcome"
exit "$suite_exit"
