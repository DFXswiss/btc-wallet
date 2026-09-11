# Spark wallet E2E with Maestro

This suite runs the 17 user paths listed in `coverage.md` individually on an iOS
simulator. P01–P15 start the app with cleared state, walk through onboarding
themselves and check at least one visible state. P16 and P17 import a fixed
Spark identity through `_setup-import.yaml` instead of creating a random wallet.

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
  LNURL test service. P11/P12/P16/P17 need a reachable DFX web flow.
- P11, P12, P16 and P17 additionally require an account that is tradable on the
  API side (verified status, a non-zero limit, deposit addresses). That state is
  set outside the suite; without it those flows fail rather than silently pass.
  P16 and P17 import a fixed Spark identity (`E2E_SPARK_MNEMONIC`) and need that
  identity to be tradable on the local stack (see the fixture section below).
  Without the mnemonic they fail rather than skip.
- P14, P15 and P17 need a Lightning counterpart, configured only through the
  runner's environment (`E2E_TREASURY_URL`, `E2E_TREASURY_KEY`, optional
  `E2E_TREASURY_MAX_SAT` default 1000, optional `E2E_TREASURY_MAX_FEE_SAT` default
  100). The payment amount those three flows type and assert is `E2E_PAYMENT_SAT`
  (default 10). It must end in 0: the amount field keeps a zero after the
  cursor, so backspace deletes the last typed digit. P15 sends one tenth of that amount so the Spark fee still fits
  in the remaining balance. P16 pays over Spark through a local loopback
  payout service (`E2E_SPARK_PAYOUT_URL`, `E2E_SPARK_PAYOUT_KEY`, optional
  `E2E_SPARK_PAYOUT_MAX_SAT` default 1000). Maestro's `runScript` sandbox does not see the shell
  environment, so the runner forwards `E2E_PAYMENT_SAT` (always, default 10) and
  each treasury or payout variable that is set, plus `E2E_SPARK_MNEMONIC`,
  `E2E_SPARK_DEPOSIT_ADDRESS` and `E2E_SPARK_WALLET_ADDRESS` when set, to
  `maestro test` as `-e NAME=VALUE` (unset names are omitted). The flows bind those names in the
  `runScript` `env` map, and `treasury.js` / `spark-payout.js` read the script
  bindings first, then `process.env`. If the URL or the key is missing,
  `tests/e2e-maestro/scripts/treasury.js` or
  `tests/e2e-maestro/scripts/spark-payout.js` exits 2 and the flow fails. It does
  not skip the payment or report success. Amounts above `E2E_TREASURY_MAX_SAT`
  are rejected before anything is sent. The helper never prints the key; BOLT11
  values it prints are the invoices the app has to pay (P15 send, P14/P17
  return). The runner does not echo the forwarded values.
- The given simulator must not hold any wallet state worth protecting for
  P01–P15. Before every flow the runner terminates and uninstalls the app,
  resets the simulator keychain and installs the given bundle anew. On top of
  that P01–P15 start with `clearState: true`. P14, P15, P16 and P17 later relaunch
  with `clearState: false` so the Spark row can show the balance after a
  payment. P16 and P17 start from `_setup-import.yaml` (`clearState: true`) and
  re-import the same identity after that reset.

## Local DFX stack for P11/P12/P16/P17

The distinguishable buy and sell screens, and the P16/P17 payment extensions,
require a complete local stack. The
tracked defaults remain `3000`/`3001`. The owned verification stack uses a
private, uncommitted `ENVFILE` overlay with:

```text
REACT_APP_API_URL=http://127.0.0.1:3300/v1
REACT_APP_SRV_URL=http://127.0.0.1:3301
DFX_ENV=loc
```

Keep that overlay private and do not print its environment values in logs.

## Fixed Spark identity for P16/P17

P16 and P17 import one Spark identity so the local backend can see the same
user on every run. The mnemonic is **not** in this repository.

- Set `E2E_SPARK_MNEMONIC` outside the repo and pass it to `maestro test` as
  `-e E2E_SPARK_MNEMONIC=...`. The flows declare it in their `env:` block;
  without that declaration Maestro types the literal `${E2E_SPARK_MNEMONIC}`.
  If the variable is missing, `_setup-import.yaml` fails with an assertion
  that names the variable and this section. There is no skip. `run-maestro.sh`
  forwards the name only when it is set; it does not print the value.
  Maestro writes the `inputText` of the import step into its run log, so that
  log contains the identity and must not be shared. The identity is disposable
  and exists only for the local stack.
- P17 needs `E2E_SPARK_DEPOSIT_ADDRESS`: DFX's reusable Spark **deposit**
  address for that identity on the local stack (sell destination, always the
  same for Spark payouts to the fixture IBAN). P16 needs
  `E2E_SPARK_WALLET_ADDRESS`: the identity's **own** Spark address — the
  value in `user.address` with which the wallet signs in to the backend
  (buy destination). Do not swap them. Both are declared in `env:`; the
  runner forwards each only when set and does not print the value. If the
  one a flow needs is missing, that flow fails with an assertion that names
  the variable and this section. Neither address is in the repository.
- Before a run, seed **only** the local stack with that identity's Spark
  address. Never run this against dev or prod:

  ```sh
  psql "$LOCAL_DATABASE_URL" \
    -v addr="$SPARK_ADDRESS" \
    -f tests/e2e-maestro/scripts/seed-local-backend.sql
  ```

  `$LOCAL_DATABASE_URL` is the local stack's connection string. `$SPARK_ADDRESS`
  is the Spark address of the imported identity. Both stay outside the repo.
- The stack must already have free Spark deposit addresses (`POST /v1/deposit`)
  and `Spark/BTC` with `sellable = true`. The SQL does not create those.

## Local Spark payout service for P16

P16's simulated buy credit is a Spark transfer from the backend wallet, not a
Lightning payment from the treasury counterpart. The service that performs
that transfer is **not part of this repository**. It holds
`SPARK_WALLET_SEED`, binds only to `127.0.0.1`, and requires
`SPARK_PAYOUT_KEY`. Run it only against the local stack, never against dev
or prod:

```sh
SPARK_WALLET_SEED='<seed>' \
SPARK_PAYOUT_KEY='<key>' \
SPARK_PAYOUT_MAX_SAT='<limit>' \
node /tmp/spark-payout-service.js <accountIndex>
```

The flow then needs `E2E_SPARK_PAYOUT_URL` (loopback, e.g. `http://127.0.0.1:18765`),
`E2E_SPARK_PAYOUT_KEY` (same key), and `E2E_SPARK_WALLET_ADDRESS`. Optional
`E2E_SPARK_PAYOUT_MAX_SAT` defaults to 1000. The runner forwards those names
only when set and does not print the values. If the URL or the key is
missing, `tests/e2e-maestro/scripts/spark-payout.js` exits 2 and the flow
fails. It does not skip the payout.

The selected local API stack must supply `FAUCET_LOW_BALANCE_THRESHOLD` at boot;
do not silently omit this required variable. The frontend build needs sufficient
Docker resources; `cannot allocate memory` is an environmental failure, not a
fixed minimum established by this document.

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
state cannot otherwise be guaranteed for P01–P15. The runner resets the
simulator before every match, installs the bundle and then starts its own
`maestro test`. P16 and P17 re-import the fixed identity after that reset.
Between two flows it waits 12 seconds so the repeated simulator resets do not overload
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

- P8–P10 still send no money. With a reproducible expired BOLT11 vector P8 checks
  parsing, amount, the rendering of the invoice itself (`lnbc2500u`) and the
  expected expiry error. P9 captures the Lightning address created in the same
  flow, encodes its LNURL-pay target and ends at the amount entry. P10 checks
  the authentication prompt and the rejection expected for Spark. All three hand
  the QR content to the registered deeplink through `openLink`; camera and
  optical QR recognition are not tested in the simulator.
- P14 and P15 complete Lightning payments against the treasury counterpart: P14
  receives `E2E_PAYMENT_SAT` (default 10) until the Spark detail header shows
  that amount on `WalletBalance` under `WalletLabel` `Lightning (Spark)`. P15
  sends one tenth of that amount until the counterpart reports the invoice paid
  and the Spark row is no longer the funded amount and not `0 sats`. They are
  not hermetic; without the treasury environment they fail rather than skip.
  After a payment the Spark row only showed the new balance after an app
  restart without wiping state (`launchApp` with `clearState: false`); waiting
  on the still-open screen was not enough. P14, P15, P16 and P17 therefore relaunch
  that way before every wallet-row assertion that follows a payment. That is a
  product observation, not a persistence test.
- P16 and P17 import a fixed Spark identity (`E2E_SPARK_MNEMONIC`) and need the
  local DFX stack plus a tradable backend account for that identity (the
  fixture above). P16 asserts the buy mask shows the truncated
  `E2E_SPARK_WALLET_ADDRESS` plus `Spark`, then `IBAN` and `BIC`, and that
  `Invalid signature` is absent. It then has the local Spark payout service
  send `E2E_PAYMENT_SAT` to that wallet from the backend Spark account and
  asserts `WalletBalance` has risen by that amount. That payout is simulated:
  it is not a DFX BuyCrypto, even though it uses the same Spark wallet DFX
  would pay from. There is no fiat credit.
  P17 fills the Spark wallet from the counterpart if the visible balance is
  below `E2E_PAYMENT_SAT`, opens sell, asserts the truncated on-screen
  address matches `E2E_SPARK_DEPOSIT_ADDRESS`, pays that address through the
  wallet send path, and asserts `WalletBalance` has fallen. Missing trade
  approval fails on `NUTZERDATEN EINGEBEN` with a pointer to the fixture,
  not a skip. A bank payout, a real CHF transfer, and a camera QR read stay
  outside the suite.
- P14 and P17 return the visible Spark balance minus a 4 sat fee reserve in an
  `onFlowComplete` hook (`_return-spark-balance.yaml`), so the return also runs
  after a failed assertion. At the default 10 sat credit that leaves 6 sat
  returnable. A completed P14 therefore costs only the native Lightning fee.
  P17 returns only the Spark remainder after the sell; the sold amount does not
  come back. If the hook cannot read a Spark balance (0, missing, at or below
  the 4 sat reserve, or the app is not on the Spark wallet screen) it skips,
  logs that, and does not fail the flow. If a balance was readable and the
  return then fails, the hook fails and the flow is red. An abort before the
  hook still leaves credit on the Spark identity; the next P16/P17 run re-imports
  that same identity.
- No current physical-device payment proof is claimed here. An earlier note
  about a 10-sat payment on an iPhone is historical and unverified, so it is
  excluded from this suite's evidence.
- The DFX web surface and its API are not part of this repository. P11 and P12
  use disjoint mode markers plus the exact DFX page title to check the external
  transition. Later fixture-assisted observations recorded in `coverage.md`
  were limited to a local quote/payment-information view for P11 and the IBAN
  form for P12. Those two paths still do not prove settlement. P16 and P17 are
  the payment extensions; they are not hermetic. The owned verification stack
  uses the private overlay shown above; that configuration must not be
  conflated with the dated historical series record below.
- The QR component has neither `testID` nor `accessibilityLabel`. P5–P7
  therefore check the visible payload, which sits in the same render branch as
  the QR, not the pixels or whether they decode.
- Persistence across app restarts, keychain entitlements, NFC, camera QR reads,
  hardware wallets and multi-device are not part of these 17 paths. The
  P14/P15/P17 relaunch without wiping state only exists so the Spark row can
  show the new balance; it is not a persistence proof. P16 and P17 import the
  fixed identity after the runner's reset; that is not a persistence proof.
- Dynamic Spark and DFX responses can turn the suite red. That is intended; the
  runner does not treat missing external prerequisites as success.

## Current native verification checkpoint (2026-09-06)

The current combined Release artifact was built on the MacBook Pro from wallet
source `d59482e759303bda45793134c86b9452c55211b3` plus 46 local, uncommitted
changes and exercised on simulator `7BB44EC7-9799-4EA0-B34E-DC9A3FEA3043` (iPhone 16 Pro,
iOS 26.5, German). The selected stack heads were API
`138286fbf0658240d535322c2f1834fb7f0e65f0` and frontend
`42c4f875f45e6949fb032dacf34e009ee8e34fe2`. The build used Node 24.19,
CocoaPods 1.14.3 / ActiveSupport 7.0.8.7 and Xcode 26.6; code-sign
verification exited 0. The executable SHA-256 is
`106a7fb3af8560c32df1362a63085edb9d5fd342422fa2104adaf8ff4d5f2b24` and
the installed bundle JavaScript SHA-256 is
`50a395c977e8be1cd16ba1f257402de669ba1407e83b4902dd6c124b5cd775ad`.

The private `ENVFILE` overlay used the owned local API/services stack on
ports 3300/3301. Native flows ran in separate batches: P01–P03 3/3,
P04–P07 4/4, P08–P09 2/2, P10 1/1 and P12–P13 2/2, each exit 0. P11 was
0/1, exit 1 at the exact `^Kaufen$` assertion. Its exact failure screenshot
visually showed `Kaufen`, `KYC VERVOLLSTÄNDIGEN` and a Safari tooltip, while
the associated accessibility hierarchy reported `Kaufen=false`,
`KYC=false` and `Safari=true`; the visual/accessibility disagreement has no
established cause. The one separately authorized unchanged retry exited 1:
`^Kaufen$` passed but the later `^Zahlungsinformation$` assertion failed.
The retry is not green P11 evidence. The aggregate is 12/13 across separate
batches, not a single 13/13 run. The final unit gate reported 1,632 passed
and 1 skipped across 87 suites; the 31 runtime files were source-map
matched, not counted as 31 tests. No payment or settlement is evidenced.

## Historical measurement

The versions of these flows — including the mode-specific P11/P12 assertions —
were measured as one complete series on 2026-09-04 against a local API and
services instance with `DFX_ENV=loc`: `Flows: 13, passed: 13, assertion
failures: 0, aborted: 0`, with suite outcome `passed`. This is a dated
historical repository record, not a current native-E2E or release claim and
not evidence that the run used the private `3300`/`3301` overlay described
above. The current combined-app installation and exercise are documented in
the checkpoint above; later fixture-assisted P11/P12 observations are
described separately in `coverage.md`; neither proves settlement or payout.
Details, flow mappings and the known P11 load-timing flake remain in
`coverage.md`.

The exact mapping of path, flow and assertion is in `coverage.md`.
