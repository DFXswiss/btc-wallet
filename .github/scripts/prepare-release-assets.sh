#!/bin/bash
set -euo pipefail

RELEASE_ASSETS_DIR="${RUNNER_TEMP}/release-assets"
mkdir -p "$RELEASE_ASSETS_DIR"

cp ./android/app/build/outputs/apk/release/app-release.apk \
  "$RELEASE_ASSETS_DIR/DFX-Btc-Wallet-${GITHUB_REF_NAME}.apk"
cp ./android/app/build/outputs/apk/release/app-release.apk.idsig \
  "$RELEASE_ASSETS_DIR/DFX-Btc-Wallet-${GITHUB_REF_NAME}.apk.idsig"
cp ./android/app/build/outputs/bundle/release/app-release-transparent.aab \
  "$RELEASE_ASSETS_DIR/DFX-Btc-Wallet-${GITHUB_REF_NAME}.aab"
cp ./android/app/build/outputs/bundle/release/transparency-cert.pem \
  "$RELEASE_ASSETS_DIR/DFX-Btc-Wallet-${GITHUB_REF_NAME}-transparency-cert.pem"

(
  cd "$RELEASE_ASSETS_DIR"
  shasum -a 256 \
    "DFX-Btc-Wallet-${GITHUB_REF_NAME}.apk" \
    "DFX-Btc-Wallet-${GITHUB_REF_NAME}.apk.idsig" \
    "DFX-Btc-Wallet-${GITHUB_REF_NAME}.aab" \
    "DFX-Btc-Wallet-${GITHUB_REF_NAME}-transparency-cert.pem" \
    > SHA256SUMS
)

echo "RELEASE_ASSETS_DIR=$RELEASE_ASSETS_DIR" >> "$GITHUB_ENV"
