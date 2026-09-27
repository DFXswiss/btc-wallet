# Maestro coverage

All three flows run on a German iOS simulator, locally only, not in CI. See
`README.md` for setup.

| Flow | What it proves | Limits |
| --- | --- | --- |
| 10 LNURL-auth | A Spark wallet refuses LNURL-auth for a non-DFX service and shows a user-facing message. | Only the refusal; no successful login, no DFX login path. |
| 16 DFX buy | Buy form shows the wallet's own Spark address, IBAN and BIC without `Invalid signature`; a simulated bank payment completes the buy and the Spark balance is at least the payout. | Balance ≥ payout, no before/after delta, so a pre-existing balance also passes. Bank payment is simulated via the API. Needs the local stack. |
| 17 DFX sell | Wallet sends Spark to the DFX deposit address, the sell form opens, the backend books and completes the sell, and the balance drops by exactly the amount sent. | The flow settles the bank leg itself by writing to the local database (`dfx-settle-fiat.js` → `settle-service.mjs`); no fiat payout is sent. Depends on 16 funding the wallet. Needs the local stack. |

## Removed flows

The other wallet paths are covered by the Detox suite in `tests/e2e/`, which
runs in CI on an Android emulator.

| Old flow | Now |
| --- | --- |
| 01 onboarding, on-chain wallet | `onchain.spec.js` `beforeAll` (create) and `spark.spec.js` `beforeAll` (import). |
| 02 create Spark wallet | `spark.spec.js` `beforeAll` (adds the Lightning wallet and waits for its row). |
| 03, 06, 07, 08, 09, 14, 15 | Identical copies that only checked a Lightning address on the receive screen. Receive is now covered by `spark.spec.js` "creates an invoice for the typed sats amount and description"; the Lightning address itself is no longer asserted. |
| 04, 13 settings → Lightning wallet details | Same navigation as `spark.spec.js` "exports the BIP-85 child phrase…" (Settings → Lightning wallet details → export). |
| 05 invoice with amount and description | `spark.spec.js` invoice test, which also decodes the BOLT11 and checks amount, description, network and expiry. |
| 11, 12 DFX buy/sell transition | Dropped: they asserted DFX web app screens, not the wallet. The wallet side (DFX opens without a login screen or `Invalid signature`) is still checked by 16 and 17. |
| 18 Spark receive retry | Dropped: the retry branch was optional, so the flow passed whether or not it ran. |
| 19 Spark recovery export | `spark.spec.js` "exports the BIP-85 child phrase…", which also checks the notice gate and the exact words. |
| 20–25 BOLT11 / Lightning-address sends | Dropped as flows: one-off manual mainnet runs with hard-coded balances. Replaced by `spark-send.spec.js` (BOLT11 and Lightning-address quote with fee); those tests quote but never pay. |
