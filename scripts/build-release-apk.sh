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
#   SENTRY_AUTH_TOKEN         required so the release build fails loud instead of
#                             silently shipping without crash symbolication
#   SENTRY_URL, SENTRY_ORG, SENTRY_PROJECT
#                             not secrets, but sentry-cli needs all three to know
#                             where to upload - without them it defaults to
#                             sentry.io and fails with "An organization ID or
#                             slug is required"
#   BREEZ_API_KEY             baked into the binary via a generated overlay .env
#                             (ENVFILE); never written to a tracked .env file
#
# Optional:
#   BUILD_NUMBER              deterministic versionCode override
#   MARKETING_VERSION         versionName override (X.Y.Z)

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ── validate ──────────────────────────────────────────────────────────────────
for var in KEYSTORE_FILE_HEX KEYSTORE_PASSWORD KEYSTORE_KEY_PASSWORD KEYSTORE_ALIAS \
           TRANSPARENCY_KEYSTORE_HEX TRANSPARENCY_PASSWORD TRANSPARENCY_ALIAS \
           SENTRY_AUTH_TOKEN SENTRY_URL SENTRY_ORG SENTRY_PROJECT \
           BREEZ_API_KEY; do
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

# ── keystores + breez overlay: write to temp files, guarantee cleanup ─────────
# Trap before the second mktemp: if a later mktemp or chmod fails, set -e would
# otherwise exit with the already-created files still in /tmp.
KEYSTORE="$(mktemp /tmp/app-signing.XXXXXX.keystore)"
cleanup() {
  secure_delete "${KEYSTORE:-}"
  secure_delete "${TRANSPARENCY_KEYSTORE:-}"
  secure_delete "${BREEZ_ENVFILE:-}"
}
trap cleanup EXIT INT TERM
TRANSPARENCY_KEYSTORE="$(mktemp /tmp/transparency.XXXXXX.keystore)"
BREEZ_ENVFILE="$(mktemp /tmp/breez-env.XXXXXX)"
chmod 600 "$KEYSTORE" "$TRANSPARENCY_KEYSTORE" "$BREEZ_ENVFILE"

printf '%s' "$KEYSTORE_FILE_HEX"         | xxd -plain -revert > "$KEYSTORE"
printf '%s' "$TRANSPARENCY_KEYSTORE_HEX" | xxd -plain -revert > "$TRANSPARENCY_KEYSTORE"

# .env.prd has no trailing newline; leading \n keeps BREEZ_API_KEY on its own line.
cp .env.prd "$BREEZ_ENVFILE"
printf '\nBREEZ_API_KEY=%s\n' "$BREEZ_API_KEY" >> "$BREEZ_ENVFILE"
export ENVFILE="$BREEZ_ENVFILE"

# ── gradle args ───────────────────────────────────────────────────────────────
SIGN_ARGS=(
  "-PMYAPP_UPLOAD_STORE_FILE=$KEYSTORE"
  "-PMYAPP_UPLOAD_KEY_ALIAS=$KEYSTORE_ALIAS"
  "-PMYAPP_UPLOAD_STORE_PASSWORD=$KEYSTORE_PASSWORD"
  "-PMYAPP_UPLOAD_KEY_PASSWORD=$KEYSTORE_KEY_PASSWORD"
)
[ -n "${BUILD_NUMBER:-}" ] && SIGN_ARGS+=("-PMYAPP_VERSION_CODE=$BUILD_NUMBER")
[ -n "${MARKETING_VERSION:-}" ] && SIGN_ARGS+=("-PMYAPP_VERSION_NAME=$MARKETING_VERSION")

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

# `bundletool add-transparency` only signs the code-transparency block and emits an
# otherwise UNsigned bundle, so re-sign the output with the upload key. Google Play
# rejects unsigned uploads ("All uploaded bundles must be signed"); the GitHub-release
# flow never caught this because it only attests the AAB, never uploads it to Play.
jarsigner \
  -keystore "$KEYSTORE" \
  -storepass "$KEYSTORE_PASSWORD" \
  -keypass "$KEYSTORE_KEY_PASSWORD" \
  -sigalg SHA256withRSA -digestalg SHA-256 \
  "$TRANSPARENT_AAB" "$KEYSTORE_ALIAS"

# Fail loudly if the bundle is somehow still unsigned before it ever reaches Play.
# `jarsigner -verify` exits 0 even for unsigned jars, so assert on its output text.
jarsigner -verify "$TRANSPARENT_AAB" | grep -q 'jar verified\.' \
  || { echo "Transparent AAB is not signed after jarsigner — refusing to continue" >&2; exit 1; }

keytool -exportcert \
  -alias "$TRANSPARENCY_ALIAS" \
  -keystore "$TRANSPARENCY_KEYSTORE" \
  -storepass "$TRANSPARENCY_PASSWORD" \
  -rfc -file "$TRANSPARENCY_CERT"
