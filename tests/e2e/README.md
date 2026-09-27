# Detox end-to-end tests (Android)

These run a release build on an Android emulator and check outcomes a user depends on. They decode the transaction hex and the BOLT11 invoice the app produced, and compare amounts and fees with what the screen shows. `.github/workflows/e2e-android.yml` runs them on every pull request.

| Spec                        | Needs                                                                                                 | Proves                                                                                                                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `onchain.spec.js`           | nothing                                                                                               | Self-test passes. A created wallet survives a restart and has a mainnet `bc1q` address. A sats amount and a label end up in the BIP21 request as the right BTC amount. Deleting the only wallet resets the app.                                        |
| `encrypted-storage.spec.js` | nothing                                                                                               | Encrypting storage makes the app ask for the password on launch, rejects a wrong one and restores the same wallet. A plausible-deniability password opens separate storage, and the real password still opens the original wallet.                     |
| `spark.spec.js`             | `BREEZ_API_KEY` (build and test run)                                                                  | A Spark wallet starts. An invoice carries exactly the typed sats amount and description. The recovery export is gated by the notice and shows the BIP-85 child of the on-chain phrase, computed independently in the test.                             |
| `onchain-send.spec.js`      | `HD_MNEMONIC_BIP84` (confirmed UTXOs)                                                                 | A payment pays the typed amount to the destination. The fee shown equals inputs minus outputs at the chosen rate. MAX sends everything to one output minus the shown fee. Nothing is broadcast.                                                        |
| `spark-send.spec.js`        | `BREEZ_API_KEY`, `SPARK_E2E_MNEMONIC` (Spark wallet with a few hundred sats), `E2E_LIGHTNING_ADDRESS` | A BOLT11 invoice and a Lightning address reach the confirmation with the right amount and a quoted fee, and Pay is enabled. Nothing is paid.                                                                                                           |
| `spark-pay.spec.js`         | same as `spark-send.spec.js`                                                                          | Pays a 10-sat invoice. The fee charged is at most the fee quoted before paying, and the Spark balance drops by exactly the amount plus the charged fee. Spends real sats on every run, so point `E2E_LIGHTNING_ADDRESS` at a wallet the team controls. |

A suite whose inputs are missing fails with a "not set" error instead of skipping.

In CI, `run-ci.sh` records failure videos, screenshots and logs only for `onchain.spec.js`, `encrypted-storage.spec.js` and `spark.spec.js`. The funded suites type recovery phrases, and the artifacts of this public repository are downloadable. The funded pass runs without retries so a failed payment test is never paid twice.

## Running locally

Requirements: an Android SDK with an emulator image, JDK 17, and an AVD named `Pixel_API_29_AOSP`.

```sh
export ANDROID_HOME=~/Android/sdk
E2E_ANDROID_ARCHS=arm64-v8a npm run e2e:release-build   # x86_64 (the default) on Intel hosts and CI
npx detox test -c android.release --headless tests/e2e/onchain.spec.js
```

To include Spark, set `BREEZ_API_KEY` for both the build and the test run. For the funded suites, set the variables from the table above for the test run. `npm run e2e:release-test` runs all suites the way CI does.
