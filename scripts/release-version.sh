#!/usr/bin/env bash
set -euo pipefail

# Single source of truth for release versioning (mirrors RealUnit's
# tool/generate_release_info.dart, adapted to this RN repo).
#
# Usage:  release-version.sh <tag>     e.g. v1.2.3  (or android/v1.2.3, ios/v1.2.3)
#         release-version.sh dev       (or no arg)  -> dev sentinel
#
# Emits machine-readable key=value lines on stdout:
#   release_tag, marketing_version, version_code
#
# Build-number schema, identical on iOS and Android, deterministic from the tag:
#   MAJOR*10000000 + MINOR*100000 + PATCH*1000 + 999
# Segments must be 0..99. Any pre-release/build suffix (-, +) is rejected so the
# old beta tags can never re-enter the pipeline.
#
# Without a real tag this emits a `dev` sentinel with version_code=0; the store
# lanes treat version_code=0 as a hard failure so a tagless build is never shipped.

RAW="${1:-dev}"

emit() { echo "release_tag=$1"; echo "marketing_version=$2"; echo "version_code=$3"; }

if [ -z "$RAW" ] || [ "$RAW" = "dev" ]; then
  emit dev 0.0.0 0
  exit 0
fi

# strip optional platform prefix (android/ ios/) and leading v
TAG="${RAW#android/}"; TAG="${TAG#ios/}"; VER="${TAG#v}"

case "$VER" in
  *-* | *+*) echo "release-version: tag must be vX.Y.Z with no suffix, got: $RAW" >&2; exit 1 ;;
esac

MAJOR=$(printf '%s' "$VER" | cut -d. -f1)
MINOR=$(printf '%s' "$VER" | cut -d. -f2)
PATCH=$(printf '%s' "$VER" | cut -d. -f3)
EXTRA=$(printf '%s' "$VER" | cut -d. -f4)

[ -z "$EXTRA" ] || { echo "release-version: tag must be vX.Y.Z, got: $RAW" >&2; exit 1; }

for seg in "$MAJOR" "$MINOR" "$PATCH"; do
  case "$seg" in
    '' | *[!0-9]*) echo "release-version: version segments must be numeric, got: $RAW" >&2; exit 1 ;;
  esac
  [ "$seg" -ge 0 ] && [ "$seg" -le 99 ] || { echo "release-version: segments must be 0..99, got: $RAW" >&2; exit 1; }
done

VERSION_CODE=$(( MAJOR * 10000000 + MINOR * 100000 + PATCH * 1000 + 999 ))
emit "$VER" "$VER" "$VERSION_CODE"
