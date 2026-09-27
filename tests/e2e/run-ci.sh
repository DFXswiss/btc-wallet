#!/usr/bin/env bash
# Runs the Detox suites in two passes. Failure artifacts (video, screenshots, logs) are recorded only for
# the suites without funded recovery phrases, because the workflow uploads them from a public repository.
set -u
ARTIFACTS="${1:?artifacts directory}"
status=0
npx detox test -c android.release --headless -R 1 --record-videos failing --record-logs failing --take-screenshots failing \
  --artifacts-location "$ARTIFACTS" tests/e2e/onchain.spec.js tests/e2e/spark.spec.js || status=1
npx detox test -c android.release --headless -R 1 --record-videos none --record-logs none --take-screenshots none \
  tests/e2e/onchain-send.spec.js tests/e2e/spark-send.spec.js || status=1
exit $status
