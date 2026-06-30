#!/usr/bin/env bash
#
# Validate the store-listing metadata before it is pushed to App Store Connect /
# Google Play. Gates:
#   1. No FIXME- placeholders left in any metadata file.
#   2. Store-side character limits (App Store / Play).
#   3. URL fields are well-formed http(s) URLs within Apple's 255-char limit.
#
# Used by both release.yml and store-metadata.yml so a release can never ship a
# FIXME or oversize field live. Collects all violations before exiting.

set -euo pipefail

# Force UTF-8 so character counts (not bytes) are used for umlauts etc.
export LC_ALL=C.UTF-8
export LANG=C.UTF-8

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

LOCALES="de-DE en-US"
fail=0

# 1) FIXME guard.
matches=$(grep -rE "^FIXME-" ios/fastlane/metadata android/fastlane/metadata 2>/dev/null || true)
if [ -n "$matches" ]; then
  echo "::error::Metadata still contains FIXME placeholders:"
  echo "$matches"
  fail=1
fi

# 2) Character limits (wc -m counts the trailing newline; drop it).
check() {
  file="$1"; limit="$2"; label="$3"
  if [ -f "$file" ]; then
    chars=$(($(wc -m < "$file" | tr -d ' ') - 1))
    if [ "$chars" -gt "$limit" ]; then
      echo "::error::$label exceeds $limit chars (got $chars): $file"
      fail=1
    fi
  fi
}

for loc in $LOCALES; do
  check "ios/fastlane/metadata/$loc/name.txt" 30 "iOS name ($loc)"
  check "ios/fastlane/metadata/$loc/subtitle.txt" 30 "iOS subtitle ($loc)"
  check "ios/fastlane/metadata/$loc/promotional_text.txt" 170 "iOS promotional_text ($loc)"
  check "ios/fastlane/metadata/$loc/keywords.txt" 100 "iOS keywords ($loc)"
  check "ios/fastlane/metadata/$loc/description.txt" 4000 "iOS description ($loc)"
  check "ios/fastlane/metadata/$loc/release_notes.txt" 4000 "iOS release_notes ($loc)"
  check "android/fastlane/metadata/android/$loc/title.txt" 50 "Android title ($loc)"
  check "android/fastlane/metadata/android/$loc/short_description.txt" 80 "Android short_description ($loc)"
  check "android/fastlane/metadata/android/$loc/full_description.txt" 4000 "Android full_description ($loc)"
  check "android/fastlane/metadata/android/$loc/changelogs/default.txt" 500 "Android changelog ($loc)"
done

# 3) URL fields: optional, but if present must be a well-formed http(s) URL <= 255 chars.
check_url() {
  file="$1"; label="$2"
  if [ -f "$file" ]; then
    url=$(head -n1 "$file" | tr -d '\r' | sed 's/[[:space:]]*$//')
    [ -z "$url" ] && return 0
    if [ "${#url}" -gt 255 ]; then
      echo "::error::$label exceeds 255 chars (got ${#url}): $file"; fail=1
    fi
    if ! printf '%s' "$url" | grep -qiE '^https?://[^[:space:]]+\.[^[:space:]]+$'; then
      echo "::error::$label is not a valid http(s) URL: $file ($url)"; fail=1
    fi
  fi
}
for loc in $LOCALES; do
  check_url "ios/fastlane/metadata/$loc/marketing_url.txt" "iOS marketing_url ($loc)"
  check_url "ios/fastlane/metadata/$loc/privacy_url.txt" "iOS privacy_url ($loc)"
  check_url "ios/fastlane/metadata/$loc/support_url.txt" "iOS support_url ($loc)"
done

if [ "$fail" -ne 0 ]; then exit 1; fi
echo "store metadata preflight OK"
