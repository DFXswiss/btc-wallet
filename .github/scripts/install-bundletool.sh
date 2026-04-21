#!/bin/bash
set -euo pipefail

BUNDLETOOL_BIN_DIR="${RUNNER_TEMP}/bundletool-bin"
mkdir -p "$BUNDLETOOL_BIN_DIR"

curl -L --fail \
  -o "$BUNDLETOOL_BIN_DIR/bundletool.jar" \
  "https://github.com/google/bundletool/releases/download/${BUNDLETOOL_VERSION}/bundletool-all-${BUNDLETOOL_VERSION}.jar"

cat > "$BUNDLETOOL_BIN_DIR/bundletool" <<'EOF'
#!/bin/sh
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
exec java -jar "$SCRIPT_DIR/bundletool.jar" "$@"
EOF

chmod +x "$BUNDLETOOL_BIN_DIR/bundletool"
echo "$BUNDLETOOL_BIN_DIR" >> "$GITHUB_PATH"
