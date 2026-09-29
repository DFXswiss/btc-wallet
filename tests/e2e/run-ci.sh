#!/usr/bin/env bash
# Runs the Detox suites the way CI does.
#   run-ci.sh unfunded <artifacts dir>  suites without funds; failure videos, screenshots and logs are recorded.
#   run-ci.sh funded                    suites that type funded recovery phrases; nothing is recorded, because
#                                       artifacts of this public repository are downloadable, and there are no
#                                       retries, because a retried spark-pay.spec.js would pay again.
#   run-ci.sh all <artifacts dir>       both, in that order.
set -u
MODE="${1:?mode: unfunded, funded or all}"
status=0
unfunded() {
  npx detox test -c android.release --headless -R 1 --record-videos failing --record-logs failing --take-screenshots failing \
    --artifacts-location "${1:?artifacts directory}" \
    tests/e2e/onchain.spec.js tests/e2e/wallet-details.spec.js tests/e2e/scan.spec.js \
    tests/e2e/deeplink.spec.js tests/e2e/entropy.spec.js tests/e2e/import-discovery.spec.js tests/e2e/multisig.spec.js \
    tests/e2e/multisig-import.spec.js tests/e2e/settings.spec.js tests/e2e/spark.spec.js || status=1
}
funded() {
  npx detox test -c android.release --headless --record-videos none --record-logs none --take-screenshots none \
    tests/e2e/onchain-send.spec.js tests/e2e/spark-send.spec.js tests/e2e/spark-receive.spec.js tests/e2e/spark-transfer.spec.js tests/e2e/spark-pay.spec.js || status=1
}
case "$MODE" in
  unfunded) unfunded "${2:-}" ;;
  funded) funded ;;
  all) unfunded "${2:-}"; funded ;;
  *) echo "unknown mode: $MODE" >&2; exit 2 ;;
esac
exit $status
