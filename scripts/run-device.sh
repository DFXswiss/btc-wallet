#!/usr/bin/env bash
# Install & launch BtcTaroWallet on a real device.
#
# Usage:
#   scripts/run-device.sh android [debug|release]
#   scripts/run-device.sh ios     [debug|release]
#
# Requirements:
#   - Android: ANDROID_HOME set, device in USB-debugging mode, `adb devices`
#              lists exactly one device.
#   - iOS:    Full Xcode installed (not CLT only), valid signing team in Xcode,
#             device trusted & connected via USB (or wireless after pairing).

set -euo pipefail

PLATFORM="${1:-}"
VARIANT="${2:-debug}"

if [[ -z "$PLATFORM" ]]; then
  echo "Usage: $0 <android|ios> [debug|release]" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

run_android() {
  command -v adb >/dev/null || { echo "adb not in PATH"; exit 1; }

  local devices
  devices=$(adb devices | awk 'NR>1 && $2=="device" {print $1}')
  local count=$(wc -l <<<"$devices" | tr -d ' ')
  if [[ "$count" -eq 0 ]]; then
    echo "No Android devices connected. Enable USB debugging and run: adb devices"
    exit 1
  fi
  echo "Connected devices:"
  echo "$devices"

  if [[ "$VARIANT" == "release" ]]; then
    echo "Building release APK..."
    # NOTE: intentionally no `./gradlew clean` here. On RN 0.83 new arch, a
    # clean right before assembleRelease triggers
    # https://github.com/facebook/react-native/issues/56334 by wiping the
    # per-library codegen/jni dirs that Android-autolinking.cmake expects.
    # A full reset is still available via `scripts/full-clean.sh` or by
    # running `./gradlew clean` manually.
    (cd android && ./gradlew assembleRelease)
    local apk="android/app/build/outputs/apk/release/app-release.apk"
    [[ -f "$apk" ]] || { echo "APK not found at $apk"; exit 1; }
    for d in $devices; do
      echo "Installing $apk on $d..."
      adb -s "$d" install -r -d "$apk"
    done
    adb -s "$(echo "$devices" | head -n1)" shell monkey -p swiss.dfx.bitcoin -c android.intent.category.LAUNCHER 1
  else
    ENVFILE=.env.prd npx react-native run-android --active-arch-only
  fi
}

run_ios() {
  if ! xcode-select -p | grep -q "Xcode.app"; then
    echo "Xcode is not installed (or not selected)."
    echo "  1) Install Xcode from the Mac App Store"
    echo "  2) sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
    echo "  3) sudo xcodebuild -runFirstLaunch"
    exit 1
  fi
  command -v pod >/dev/null || { echo "cocoapods not installed (brew install cocoapods)"; exit 1; }

  if [[ ! -d ios/Pods ]]; then
    echo "Running pod install..."
    (cd ios && pod install)
  fi

  # Pick the first *physical* iOS device in xctrace's `== Devices ==` section.
  # Physical iPhones/iPads use one of two UDID shapes:
  #   - modern: 8 hex chars + '-' + 16 hex chars (e.g. 00008110-00044D840C20401E)
  #   - legacy: 40 hex chars
  # The Mac host that also shows up in that section uses the standard
  # 8-4-4-4-12 UUID format, so we explicitly exclude it.
  local udid
  udid=$(xcrun xctrace list devices 2>/dev/null \
    | sed -n '/== Devices ==/,/== Simulators ==/p' \
    | grep -oE '\(([0-9A-Fa-f]{8}-[0-9A-Fa-f]{16}|[0-9A-Fa-f]{40})\)' \
    | head -n 1 \
    | tr -d '()')
  if [[ -z "${udid:-}" ]]; then
    echo "No physical iOS device detected. Connect & trust device, then retry."
    echo "Tip: 'xcrun xctrace list devices' should list your iPhone under '== Devices =='."
    exit 1
  fi
  echo "Running on device UDID: $udid"

  local scheme="BlueWallet-loc"
  [[ "$VARIANT" == "release" ]] && scheme="BlueWallet"

  # Note: `--udid` in @react-native-community/cli-platform-ios targets
  # simulators only. For physical devices, `--device "$udid"` is the correct
  # flag (it accepts either a device name or UDID).
  npx react-native run-ios --scheme "$scheme" --device "$udid" \
    $( [[ "$VARIANT" == "release" ]] && echo "--mode Release" )
}

case "$PLATFORM" in
  android) run_android ;;
  ios)     run_ios ;;
  *) echo "Unknown platform: $PLATFORM"; exit 1 ;;
esac
