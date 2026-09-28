# Maestro flows (DFX buy/sell and LNURL-auth)

Three Maestro flows for paths that need the German iOS build, a local DFX
stack, or both. They run only on a local iOS simulator and are **not part of
CI**. All other wallet paths (on-chain create/receive/send, Spark create,
receive, backup export, send quotes and a real Spark payment) are covered by
the Detox suite in `tests/e2e/`, which runs in CI on an Android emulator. The
wallet's Lightning address on the receive screen is no longer asserted. `coverage.md` maps the
removed Maestro flows to their Detox replacements.

| Flow                                | What it does                                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `flows/10-lnurl-auth.yaml`          | Creates a wallet, adds the Lightning (Spark) wallet, opens a static third-party LNURL-auth link and taps `Authentifizieren`.       |
| `flows/16-dfx-buy-to-payment.yaml`  | Imports a fixed identity, opens DFX buy, checks the buy form, triggers a simulated bank payment and waits for the buy to complete. |
| `flows/17-dfx-sell-to-payment.yaml` | Imports the same identity, sends Spark to the DFX sell deposit address, checks the sell form and waits for the sell to complete.   |

## What each flow proves, and what it does not

**10 – LNURL-auth.** Proves that a Spark wallet refuses LNURL-auth for a
non-DFX service and says so: the prompt names `lightninglogin.live`, and after
`Authentifizieren` the app shows `Authentifizierung bei lightninglogin.live
fehlgeschlagen.` and `Dieses Wallet kann sich mit diesem Code nicht anmelden.`
It does not test a successful login, and it does not test the DFX login path
(signed with the Spark identity key). The refusal is decided in the app; no
request reaches the service.

**16 – DFX buy.** Proves that the buy form in the in-app browser shows the
wallet's own truncated Spark address with `Spark`, then `IBAN` and `BIC`, and
no `Invalid signature`. It then calls `PUT /v1/buy/<id>/simulatePayment` for
`E2E_BUY_CHF` (default 0.20), waits until `GET /v1/transaction` shows a
completed Buy newer than a snapshot taken before the trigger, and asserts that
the visible Spark balance is **at least** the payout of that buy.
Limits: there is no before/after delta, because no value survives a Maestro
`launchApp`. If the wallet already held at least the payout amount, the final
check passes without the new credit. The incoming payment is simulated through
the API, not sent by a bank.

**17 – DFX sell.** Proves that the wallet send path pays
`E2E_SPARK_DEPOSIT_ADDRESS`, the sell form opens without `Invalid signature`
and shows the BTC amount, the backend books and then completes a Sell newer
than the pre-send snapshot, and the visible Spark balance ends at exactly the
pre-send balance minus `E2E_PAYMENT_SAT` (a fee-free Spark transfer). Limits: the local stack has no bank attached, so the flow **settles
the bank leg itself**. `dfx-settle-fiat.js` asks `settle-service.mjs`, which
writes the missing payout fields and a matching `DBIT` `bank_tx` row straight
into the local database. The backend still has to match that row and complete
the sale, but the fiat payout is never sent or received. The wallet must
already hold at least `E2E_PAYMENT_SAT`, which is why 16 has to run first.
After the flow, `_return-spark-balance.yaml` sends the remaining Spark balance
minus a 4-sat fee reserve to `E2E_SPARK_RETURN_ADDRESS`. It skips if the
address is unset or the balance is too low. It fails the flow only if a return
was due and failed.

All three: German UI only, iOS simulator only, many taps on measured screen
points (the DFX tiles and browser controls have no selectors), and dependent on
live Spark/Breez. The Spark balance row only updates after a relaunch without
clearing state (`_relaunch-keep-state.yaml`); that relaunch is not a
persistence test.

## Prerequisites

- A booted iOS simulator and an already built `.app` bundle with app ID
  `swiss.dfx.bitcoin`, rendering in German. The runner does not build the app.
- `maestro` on `PATH`, and Homebrew OpenJDK at
  `/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home` (the runner
  sets `JAVA_HOME`; it exits 2 if Java is missing).
- Network access to Spark/Breez, and an app bundle built with `BREEZ_API_KEY`
  set (every flow creates or imports a Spark wallet). Flow 10 needs nothing
  else.
- The simulator must not hold anything worth keeping: before every flow the
  runner uninstalls the app, resets the simulator keychain and reinstalls it.

### Local DFX stack (16 and 17)

The app build uses a private, uncommitted `ENVFILE` overlay that points at the
local stack:

```text
REACT_APP_API_URL=http://127.0.0.1:3300/v1
REACT_APP_SRV_URL=http://127.0.0.1:3301
DFX_ENV=loc
```

The stack must have free Spark deposit addresses, `Spark/BTC` with
`sellable = true`, and `FAUCET_LOW_BALANCE_THRESHOLD` set at API boot. Make the
test identity tradable with the seed script, **against the local stack only**:

```sh
psql "$LOCAL_DATABASE_URL" -v addr="$SPARK_ADDRESS" \
  -f tests/e2e-maestro/scripts/seed-local-backend.sql
```

Without it, 16 fails at `NUTZERDATEN EINGEBEN` with a pointer to this file.

### Environment variables

All values stay outside the repository and are never printed. The runner
forwards the `E2E_*` values to `maestro test -e` only when they are set; a flow
that needs a missing required value fails. The settle-helper variables are
consumed by the runner itself, which passes the derived `E2E_SETTLE_URL` and
`E2E_SETTLE_KEY` on to the flows. `E2E_SPARK_RETURN_ADDRESS` is optional: the
refund step skips when it is unset.

| Name                                 | Used by | Meaning                                                                                                          |
| ------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------- |
| `E2E_SPARK_MNEMONIC`                 | 16, 17  | Fixed test identity imported by `_setup-import.yaml`. Maestro writes it to its run log; do not share those logs. |
| `E2E_SPARK_WALLET_ADDRESS`           | 16      | The identity's own Spark address (`user.address`), expected on the buy form.                                     |
| `E2E_SPARK_DEPOSIT_ADDRESS`          | 17      | DFX's reusable Spark sell deposit address for that identity. Do not swap it with the one above.                  |
| `E2E_API_URL`                        | 16, 17  | Local API origin, e.g. `http://127.0.0.1:3300`.                                                                  |
| `E2E_DFX_JWT`                        | 16, 17  | Bearer token for the identity (secret).                                                                          |
| `E2E_BUY_CHF`                        | 16      | Simulated buy amount, default `0.20`.                                                                            |
| `E2E_PAYMENT_SAT`                    | 17      | Sell amount in sats, default `10`; must end in `0` (the amount field keeps a trailing zero).                     |
| `SETTLE_KEY`                         | 17      | Enables the settle helper (see below).                                                                           |
| `SETTLE_PORT`, `SETTLE_DB_CONTAINER` | 17      | Optional; default `18790` and `spark276-db-1`.                                                                   |
| `E2E_SPARK_RETURN_ADDRESS`           | 17      | Optional destination for the leftover Spark balance.                                                             |

### Settle helper (17)

`scripts/settle-service.mjs` is a local-only helper that runs `psql` through
`docker exec` in the local database container. When both `SETTLE_KEY` and
`E2E_API_URL` are set, `run-maestro.sh` starts it on `127.0.0.1`, passes
`E2E_SETTLE_URL` and `E2E_SETTLE_KEY` to Maestro, and stops it on exit. It
refuses to start unless `E2E_API_URL` is plain HTTP on `127.0.0.1`,
`localhost` or `[::1]` (the buy and sell backend scripts exit 2 otherwise too),
but it cannot detect a loopback proxy to another stack, so check which stack is
running. **Never point it at a development or production stack.**

## Running

```sh
bash scripts/e2e/run-maestro.sh --device '<SIMULATOR-UDID>' --app '<PATH-TO-APP-BUNDLE>'
bash scripts/e2e/run-maestro.sh --device '<SIMULATOR-UDID>' --app '<PATH-TO-APP-BUNDLE>' --flow '10-*'
```

`--flow` takes a basename glob. Flows run in file order, so 16 runs before 17.
Between flows the runner waits 12 seconds and checks the simulator with
`simctl bootstatus -b` before and after each reset. These guards prevent
CoreSimulator crashes during repeated resets; do not remove them.

The runner continues after a failure and writes
`tests/e2e-maestro/last-run.json` with the name, exit code, duration and
outcome (`passed`, `assertion-failed`, `run-aborted`) of each flow. A failed
reset counts as exit 125 / `run-aborted`. The split between assertion failures
and aborts comes from the flow log and is only a hint; both make the suite
exit 1. Configuration errors and an empty filter exit 2.
