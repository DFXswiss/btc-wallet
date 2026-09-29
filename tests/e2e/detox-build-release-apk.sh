#!/usr/bin/env bash
# Builds the release APK plus the Detox test APK for the Android emulator, both signed with a throwaway key.
# E2E_ENV_FILE picks the environment (default .env.dev); BREEZ_API_KEY (optional) is appended to a temporary copy of it,
# without it Spark cannot start.
# E2E_ANDROID_ARCHS overrides the ABI (x86_64 on CI, arm64-v8a on Apple silicon).
set -euo pipefail

ANDROID_SDK_ROOT=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}
if [[ -z "$ANDROID_SDK_ROOT" ]]; then
  echo "ANDROID_HOME or ANDROID_SDK_ROOT must be set" >&2
  exit 1
fi

find android -name '*.apk' -delete

KEYSTORE="$PWD/detox.keystore"
ENVFILE_PATH="$(mktemp "${TMPDIR:-/tmp}/detox-env.XXXXXX")"
trap 'rm -f "$ENVFILE_PATH" "$KEYSTORE"' EXIT
cp "${E2E_ENV_FILE:-.env.dev}" "$ENVFILE_PATH"
if [[ -n "${BREEZ_API_KEY:-}" ]]; then
  printf '\nBREEZ_API_KEY=%s\n' "$BREEZ_API_KEY" >> "$ENVFILE_PATH"
fi

rm -f "$KEYSTORE"
keytool -genkeypair -keystore "$KEYSTORE" -alias detox -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass 123456 -keypass 123456 -dname 'cn=Unknown, ou=Unknown, o=Unknown, c=Unknown' >/dev/null

(cd android && ENVFILE="$ENVFILE_PATH" SENTRY_DISABLE_AUTO_UPLOAD=true ./gradlew assembleRelease assembleReleaseAndroidTest \
  -DtestBuildType=release "-PreactNativeArchitectures=${E2E_ANDROID_ARCHS:-x86_64}" \
  "-PMYAPP_UPLOAD_STORE_FILE=$KEYSTORE" -PMYAPP_UPLOAD_STORE_PASSWORD=123456 \
  -PMYAPP_UPLOAD_KEY_ALIAS=detox -PMYAPP_UPLOAD_KEY_PASSWORD=123456)

# The test APK is signed with the debug key; Android only instruments it when both APKs share a signer.
APKSIGNER="$(ls -d "$ANDROID_SDK_ROOT"/build-tools/*/apksigner | sort -V | tail -1)"
"$APKSIGNER" sign --ks "$KEYSTORE" --ks-pass=pass:123456 android/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk
