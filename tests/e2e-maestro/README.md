# Spark wallet E2E with Maestro

This suite runs the 13 user paths listed in `coverage.md` individually on an iOS
simulator. Every flow starts the app with cleared state, walks through
onboarding itself and checks at least one visible state. No flow inherits state
from a previous one.

## Prerequisites

- A booted iOS simulator able to run the app under test with the app ID
  `swiss.dfx.bitcoin`, plus the path to the already built `.app` bundle. The
  runner does not build the app.
- The app has to render in German. The selectors match the language of the
  existing simulator build and of the handbook flows already in use.
- Maestro has to be on `PATH` as `maestro`.
- Homebrew OpenJDK has to be installed at
  `/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home`. The runner sets
  `JAVA_HOME` and extends `PATH`; if Java is missing it aborts with exit 2.
- Network access to Spark/Breez and to the DFX API. P9 uses the `@breez.tips`
  address registered by the freshly created Spark wallet instead of a foreign
  LNURL test service. P11/P12 need a reachable DFX web flow.
- The given simulator must not hold any wallet state worth protecting. Before
  every flow the runner terminates and uninstalls the app, resets the simulator
  keychain and installs the given bundle anew. On top of that every flow uses
  `clearState: true`.

## Local DFX stack for P11/P12

The distinguishable buy and sell screens require a complete local stack. The app
build uses:

```text
REACT_APP_API_URL=http://127.0.0.1:3000/v1
REACT_APP_SRV_URL=http://127.0.0.1:3001
DFX_ENV=loc
```

The API environment has to set `FAUCET_LOW_BALANCE_THRESHOLD`; the current API
requires the variable at boot while the e2e harness does not set it. The
frontend build needs more than 8 GB of memory available to Docker, otherwise it
can abort with `cannot allocate memory`.

## Running

All flows on a specific booted simulator:

```sh
bash scripts/e2e/run-maestro.sh \
  --device '<SIMULATOR-UDID>' \
  --app '<PATH-TO-APP-BUNDLE>'
```

Run only matching flow files; the filter is a basename glob:

```sh
bash scripts/e2e/run-maestro.sh \
  --device '<SIMULATOR-UDID>' \
  --app '<PATH-TO-APP-BUNDLE>' \
  --flow '05-*'
```

The values are also accepted positionally as `UDID APP_BUNDLE [FLOW_GLOB]`. UDID
and app path are mandatory; without them the runner aborts, because the fresh
state cannot otherwise be guaranteed. The runner resets the simulator before
every match, installs the bundle and then starts its own `maestro test`. Between
two flows it waits 12 seconds so the repeated simulator resets do not overload
the CoreSimulator services. Before and after every reset `simctl bootstatus -b`
checks whether the device is booted and ready, and boots a crashed simulator
again; because of the reproduced series crashes these two safeguards must not be
removed.

After failures the runner continues with the remaining flows. A failed reset or
readiness check is recorded as flow exit 125 and `run-aborted`. For every flow
`tests/e2e-maestro/last-run.json` holds name, exit code, duration and one of the
outcomes `passed`, `assertion-failed` or `run-aborted`. Telling the two failure
kinds apart reads the flow log and is therefore a heuristic: it classifies the
failure but does not decide success. Both kinds count as a failure and set the
suite exit to 1, so a misclassification cannot turn a red run green. The
manifest and the final line count successful flows, failed assertions and
aborted runs separately. If every failure is an abort, the suite outcome is
explicitly `environment-error`; assertions and aborts together yield
`mixed-failure`. The runner exits 1 as soon as a flow was not successful, and 2
on a configuration error or an empty filter.

## Deliberate limits

- P8–P10 send no money. With a reproducible expired BOLT11 vector P8 checks
  parsing, amount, the rendering of the invoice itself (`lnbc2500u`) and the
  expected expiry error. P9 captures the Lightning address created in the same
  flow, encodes its LNURL-pay target and ends at the amount entry. P10 checks
  the authentication prompt and the rejection expected for Spark. All three hand
  the QR content to the registered deeplink through `openLink`; camera and
  optical QR recognition are not tested in the simulator.
- The send path was additionally evidenced manually on a physical iPhone running
  iOS 26.6.1 with a real Breez key: a scanned 10 sat invoice was paid, and the
  receiving wallet showed `10`, `sats`, `Erhalten` and `Geraetetest`. The
  [Maestro documentation](https://docs.maestro.dev/platform-support/ios-uikit)
  rules out test execution on physical iOS devices, so this measurement is not
  an automated suite result.
- The DFX web surface and its API are not part of this repository. P11 and P12
  check the buy respectively sell screen reached, using disjoint markers; the
  exact DFX page title additionally evidences the external transition.
  Production answers the Spark login with `400 Invalid signature`. With
  `DFX_ENV=loc` the login succeeds against a local API carrying the pending
  sell-side change (`POST /v1/auth/ 201`), and together with a local services
  instance the session is passed through: P11 reaches `Kaufen` and `Formular`,
  P12 `Deine IBAN hinzufügen oder auswählen`. Entries and completions are not
  checked. Against production the page stays at the step `Login bei DFX
Services`, and the Spark login keeps failing with `400 Invalid signature`
  until that API change is deployed. A `DFX_ENV=prd` build fails against this
  local API already at the on-chain login, because the non-production API
  prefixes the signed message with `[env]_`. Not every wallet then receives a
  token and `session.context.tsx` hides the entire `Externe Services` block. The
  local database holds 233 assets, including the buyable and sellable
  `BTC/Lightning` (id 236) and `BTC/Bitcoin` (id 113); the earlier seed
  suspicion is refuted. A control run against a server state without the API
  change is still missing. Bank payout, buy completion, swap completion and the
  deeplink with a real DFX route stay outside the suite.
- The QR component has neither `testID` nor `accessibilityLabel`. P5–P7
  therefore check the visible payload, which sits in the same render branch as
  the QR, not the pixels or whether they decode.
- Persistence across app restarts, keychain entitlements, NFC, camera QR reads,
  hardware wallets, multi-device and successful payments with a balance are not
  part of these 13 paths.
- Dynamic Spark and DFX responses can turn the suite red. That is intended; the
  runner does not treat missing external prerequisites as success.

## Last measured state

The versions of this state — including the mode-specific tightened P11/P12 —
were measured as a complete series on 2026-09-04 against the local API carrying
the pending sell-side change and the local services instance with `DFX_ENV=loc`:
`Flows: 13, passed: 13, assertion failures: 0, aborted: 0` and
`Suite outcome: passed`, every flow individually `passed`. P11 reaches the buy
screen, P12 the sell screen with the IBAN row. Against production P11/P12 stay
red because of `400 Invalid signature`. The control run against a server state
without that API change is still missing. Details and limits are in
`coverage.md`, including a load-timing flake seen once in P11.

The exact mapping of path, flow and assertion is in `coverage.md`.
