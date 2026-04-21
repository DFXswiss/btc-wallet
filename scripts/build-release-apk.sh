#!/bin/bash
set -euo pipefail

# Required env vars:
#   KEYSTORE_FILE_HEX         hex-encoded app signing keystore (xxd -plain keystore.jks)
#   KEYSTORE_PASSWORD
#   KEYSTORE_KEY_PASSWORD
#   KEYSTORE_ALIAS
#   TRANSPARENCY_KEYSTORE_HEX hex-encoded code transparency keystore
#   TRANSPARENCY_PASSWORD
#   TRANSPARENCY_ALIAS
#
# Optional:
#   BUILD_NUMBER              deterministic versionCode override

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ── validate ──────────────────────────────────────────────────────────────────
for var in KEYSTORE_FILE_HEX KEYSTORE_PASSWORD KEYSTORE_KEY_PASSWORD KEYSTORE_ALIAS \
           TRANSPARENCY_KEYSTORE_HEX TRANSPARENCY_PASSWORD TRANSPARENCY_ALIAS; do
  [ -n "${!var:-}" ] || { echo "Missing required env: $var" >&2; exit 1; }
done

# ── secure delete helper ──────────────────────────────────────────────────────
secure_delete() {
  local file="$1"
  [ -f "$file" ] || return 0
  if command -v shred &>/dev/null; then
    shred -u "$file"
  else
    rm -Pf "$file"
  fi
}

# ── keystores: write to temp files, guarantee cleanup on exit/error ───────────
KEYSTORE="$(mktemp /tmp/app-signing.XXXXXX.keystore)"
TRANSPARENCY_KEYSTORE="$(mktemp /tmp/transparency.XXXXXX.keystore)"
chmod 600 "$KEYSTORE" "$TRANSPARENCY_KEYSTORE"

cleanup() {
  secure_delete "$KEYSTORE"
  secure_delete "$TRANSPARENCY_KEYSTORE"
}
trap cleanup EXIT INT TERM

printf '%s' "$KEYSTORE_FILE_HEX"         | xxd -plain -revert > "$KEYSTORE"
printf '%s' "$TRANSPARENCY_KEYSTORE_HEX" | xxd -plain -revert > "$TRANSPARENCY_KEYSTORE"

# ── gradle args ───────────────────────────────────────────────────────────────
SIGN_ARGS=(
  "-PMYAPP_UPLOAD_STORE_FILE=$KEYSTORE"
  "-PMYAPP_UPLOAD_KEY_ALIAS=$KEYSTORE_ALIAS"
  "-PMYAPP_UPLOAD_STORE_PASSWORD=$KEYSTORE_PASSWORD"
  "-PMYAPP_UPLOAD_KEY_PASSWORD=$KEYSTORE_KEY_PASSWORD"
)
[ -n "${BUILD_NUMBER:-}" ] && SIGN_ARGS+=("-PMYAPP_VERSION_CODE=$BUILD_NUMBER")

# ── build ─────────────────────────────────────────────────────────────────────
cd android
./gradlew assembleRelease "${SIGN_ARGS[@]}"
./gradlew bundleRelease   "${SIGN_ARGS[@]}"
cd "$REPO_ROOT"

# ── code transparency ─────────────────────────────────────────────────────────
AAB="android/app/build/outputs/bundle/release/app-release.aab"
TRANSPARENT_AAB="android/app/build/outputs/bundle/release/app-release-transparent.aab"
TRANSPARENCY_CERT="android/app/build/outputs/bundle/release/transparency-cert.pem"

bundletool add-transparency \
  --bundle="$AAB" \
  --output="$TRANSPARENT_AAB" \
  --ks="$TRANSPARENCY_KEYSTORE" \
  --ks-key-alias="$TRANSPARENCY_ALIAS" \
  --ks-pass=pass:"$TRANSPARENCY_PASSWORD"

keytool -exportcert \
  -alias "$TRANSPARENCY_ALIAS" \
  -keystore "$TRANSPARENCY_KEYSTORE" \
  -storepass "$TRANSPARENCY_PASSWORD" \
  -rfc -file "$TRANSPARENCY_CERT"
