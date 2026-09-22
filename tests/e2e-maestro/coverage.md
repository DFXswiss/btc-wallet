# Coverage record

## Actual native Lightning payments (2026-09-08)

P11 and P12 completed with real Lightning payments of 1,000 sat each against
the existing local API and services stack. The native wallet, provider and
persisted backend records were correlated by the complete payment hash.
The bank, KYC and price inputs remain declared test fixtures: this is not a
real CHF transfer or a fully mock-free fiat/KYC environment.

Wallet source: `c908905866222fb74dfd5606b1c24c0d2ee3331d`.
Backend source: `50fedee04f4dd2ab98a62072a2919cc2404996e8`,
image `sha256:bdae2977961ebf498d83cd215e4a9476cb142f02415e0e2112db7d0e9d761526`.
Services source: `270356c71a7681cf21238d0a6ac6101ceda13864`.
The installed Release app on the owned iOS simulator used executable SHA-256
`0fda3f9b484ea44e712b8b2ba8633f220c2050e7535f5eaeedb6b4b22e999c2e`
and JavaScript bundle SHA-256
`2e8552faa34db91d9bb35ee46bf24344e8a4bd55236ee369cb9c6cda443716a6`.
No wallet-data or keychain reset occurred during these payment runs.

| Case | Actual payment and persisted correlation | Boundary |
| --- | --- | --- |
| P11 buy | BankTx 2 → Buy 1 / User 2 → BuyCrypto 1 / Transaction 2 → PayoutOrder 1; BuyCrypto and payout Complete, AML Pass; native receipt 1,000 sat, sender fee 0 sat. Transaction UID `T18E9D57D3F028B0E`. | The incoming 0.50 CHF BankTx is synthetic. Lightning payout and native receipt are actual. |
| P12 sell | Native payment 1,000 sat + 4 sat fee → actual LNbits webhook → CryptoInput 1 / Sell 1 / User 2 → BuyFiat 1 / Transaction 4 → FiatOutput 1 / BankTx 4; pay-in Completed and confirmed, AML Pass, BuyFiat and FiatOutput complete. | The 0.50 CHF bank output completed against the declared Frick test service. |

P11 payment hash:
`77dba3c7e61cb3db1eebd57c578f8f77ac8d8b2816764eb7e8abf491f209c2d7`.

P12 payment hash:
`a91e5c33344c55a5a4b3907119bdb2d41b7c4e0d5d9abcae6f8aedab7f594bcd`.

Native steps were operator-orchestrated, using the separate harness's existing-wallet
Maestro flows and visual review before each final payment action; this was not
one automated 13/13 suite. The complete hashes were checked in native transaction
details with flow 06, both exit 0. P11 execute ran once. P12 observe and process
completed with exit 0 after correcting a missing public entity-source input;
that setup failure is not counted as a successful run. Independent read-only
PostgreSQL and authenticated provider checks confirmed the same payment chains.
No Lightning mock-settlement endpoint or direct terminal-state SQL write was used.

The actual KYC-document store was local MinIO with verified Object Lock and
eleven-year COMPLIANCE retention. Dilisense responses, bank settlement, pricing,
KYC prerequisites and parts of backend startup remain explicitly simulated.

The dated payment report contains all five movement hashes, source pins, provider
status and native history captures. The independent SQL record and the final
validator record retain the exact correlation. All of them are retained in the
access-controlled test project outside this repository; credentials, seeds,
preimages and raw logs are not copied into this wallet repository.

P11 return was 996 sat + 4 sat fee, separate P12 prefunding was 2,000 sat,
and the final residual return was 992 sat + 4 sat fee. Treasury moved from
9,000 to 8,988 sat and the native wallet returned to 0 sat; the 12 sat difference
matches the three observed native fees. Prefunding and returns are not additional
P11/P12 test cases. A second complete payment replay was not executed.

The same source also has the dated September 7 P01–P09, P10 and P13 native
results (11/11 selected non-paying flows across three batches). On September 8,
P05 and P07 were freshly run without resetting the existing wallet, each exit 0:
independent QR-pixel decoding confirmed a mainnet 1,000-sat invoice with description
`Maestro-E2E`, and a mainnet Bech32m on-chain address matching the UI.
A separate P06-like address capture also matched its decoded QR. Address and
unpaid-invoice checks do not prove on-chain credit.

These results do not establish physical-device execution, production/store signing,
funded reinstall/import recovery, every requested payment method, a fully mock-free
fiat/KYC/price stack, or 100% coverage of every touched file. The earlier records
below remain historical and retain their original failures and limitations.

## Historical combined-artifact checkpoint (2026-09-06)

The current native evidence is from a freshly Xcode-signed combined Release
artifact built from wallet source
`d59482e759303bda45793134c86b9452c55211b3` plus 46 local, uncommitted
changes, installed on simulator `7BB44EC7-9799-4EA0-B34E-DC9A3FEA3043`
(iPhone 16 Pro, iOS 26.5, German). The selected stack heads were API
`138286fbf0658240d535322c2f1834fb7f0e65f0` and frontend
`42c4f875f45e6949fb032dacf34e009ee8e34fe2`. The build used Node 24.19,
CocoaPods 1.14.3 / ActiveSupport 7.0.8.7 and Xcode 26.6; code-sign
verification exited 0. Executable SHA-256:
`106a7fb3af8560c32df1362a63085edb9d5fd342422fa2104adaf8ff4d5f2b24`.
Installed bundle JavaScript SHA-256:
`50a395c977e8be1cd16ba1f257402de669ba1407e83b4902dd6c124b5cd775ad`.

The private `ENVFILE` overlay used the owned local API/services stack on
ports 3300/3301. Separate native batches were P01–P03 3/3, P04–P07 4/4,
P08–P09 2/2, P10 1/1 and P12–P13 2/2, each exit 0. P11 was 0/1, exit 1 at
the exact `^Kaufen$` assertion. Its exact failure screenshot visibly showed
`Kaufen`, `KYC VERVOLLSTÄNDIGEN` and a Safari tooltip, while the associated
accessibility hierarchy reported `Kaufen=false`, `KYC=false` and
`Safari=true`; the cause is not established. The one separately authorized
unchanged retry exited 1: `^Kaufen$` passed, but the later
`^Zahlungsinformation$` assertion failed. It is not green P11 evidence.
During these P11 attempts, no API-response body was captured and no KYC or database manipulation was performed.
The aggregate is 12/13 across separate batches, not a single 13/13 run.
The final unit gate reported 1,632 passed and 1 skipped across 87 suites;
the 31 runtime files were source-map matched, not 31 tests. No payment or
settlement is evidenced.

## Earlier intermediate-artifact checkpoint (2026-09-06)

The earlier intermediate-artifact evidence (2026-09-06) is from a freshly Xcode-signed
simulator artifact built from `d59482e759303bda45793134c86b9452c55211b3` plus
the local empty-app-codegen metadata fix. On simulator
`74C6CA5A-E2F0-4BC5-8E7E-2BE5DD4B0D7A`, the flows were measured in separate
batches: P01–P07 (7/7), P08–P09 (2/2), and P10/P12/P13 (3/3). This is not a
single fresh 13/13 run, and it is neither a remote exact-head nor a CI result.

In the same unfunded simulator, P11 first reached the DFX buy form but the
local API returned `400 KycRequired` from `PUT /v1/buy/paymentInfos` at
`^Zahlungsinformation$`. A no-reset follow-up with the existing,
precisely-matched user-83 fixture returned HTTP 200 and a 300 EUR quote. That
follow-up is fixture-assisted evidence, not the unmodified app-user result and
not a fiat transfer, purchase, settlement, or payout.

The historical 2026-09-04 local run reported all 13 flows green, but it is
retained only as dated historical evidence below; it does not renew the claim
for the current artifact. The API login was evidenced there by repeated
`POST /v1/auth/ 201` logs. Both P11 and P12 require that local stack and are
not hermetic.

In that same stack the hierarchy showed the buy screen with `Kaufen` and
`Formular` for P11, and the sell screen with
`Deine IBAN hinzufügen oder auswählen` for P12. P11 and P12 assert these
disjoint mode markers in addition to the shared page title.

The current own local-stack run used
`REACT_APP_API_URL=http://127.0.0.1:3300/v1`,
`REACT_APP_SRV_URL=http://127.0.0.1:3301` and `DFX_ENV=loc`.

Before the runner was hardened, three series runs had collapsed during the
warm-up without any `FAILED` assertion; in the third the simulator was no
longer booted afterwards and 428 simulator processes were present. The green
series run on 2026-09-04 also evidenced series robustness under the conditions
of that historical local run.

P8–P10 exercise the processing of the content a QR scan hands to
`DeeplinkSchemaMatch.navigationRouteFor`, through the registered
`dfxtaro:lightning:` scheme. The camera and the optical QR recognition itself
are not tested in the simulator.

Flows 03, 05, 06, 07, 08, 09, 14 and 15 now only open Spark receive and assert a `spark1` address. They no longer register a Lightning address, create a BOLT11 invoice, or show an on-chain deposit. A **green** cell is only a run of the assertion in that row. Rows whose file changed after the old batch say `not re-run on this assertion`.

| Path                                   | Flow                                               | State assertion                                                                                                                                                            | Measured run                                  | Limit / not covered                                                                                   |
| -------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| P1 Onboarding to on-chain wallet       | `flows/01-onboarding-onchain-wallet.yaml`          | `Wallet Backup`, `On-Chain-Wallet` and `Spark` visible; `Lightning-Wallet` not visible                                                                                     | not re-run on this assertion                  | Ends in the wallet list. No persistence check after restart. The Spark row is the add row, not a funded wallet. |
| P2 Create Spark wallet                 | `flows/02-create-spark-wallet.yaml`                | Full wallet row `Bitcoin, Spark, 0 sats` visible; `Lightning-Wallet` add row not visible                                                                                    | not re-run on this assertion                  | Ends after the Spark creation.                                                                        |
| P3 Lightning address registered        | `flows/03-spark-lightning-address.yaml`            | Spark receive shows a `spark1` address; no `@breez.tips`, BOLT11, amount field, on-chain row, or `bc1`                                                                     | not re-run on this assertion                  | The concrete account is dynamic. Registration is observed through its UI result.                      |
| P4 Spark wallet details from settings  | `flows/04-spark-wallet-details.yaml`               | `Typ` and `Breez Spark` visible                                                                                                                                            | **green**, P01-P07 batch                     | Ends in the wallet detail screen.                                                                     |
| P5 Invoice with amount and description | `flows/05-receive-invoice-amount-description.yaml` | Spark receive shows a `spark1` address; no `@breez.tips`, BOLT11, amount field, on-chain row, or `bc1`                                                                     | not re-run on this assertion                  | The tap on `sats` closed the numeric pad. QR pixels are not decoded for lack of a semantic selector.  |
| P6 Receive without amount              | `flows/06-receive-lightning-address.yaml`          | Spark receive shows a `spark1` address; no `@breez.tips`, BOLT11, amount field, on-chain row, or `bc1`                                                                     | not re-run on this assertion                  | The address is also the source of the rendered QR; the QR pixels are not decoded.                     |
| P7 Spark on-chain receive (#261)       | `flows/07-receive-spark-onchain-address.yaml`      | Spark receive shows a `spark1` address; no `@breez.tips`, BOLT11, amount field, on-chain row, or `bc1`                                                                     | not re-run on this assertion                  | QR pixels and the later credit after confirmations are not checked.                                   |
| P8 Send BOLT11                         | `flows/08-send-bolt11-to-confirmation.yaml`        | Spark receive shows a `spark1` address; no `@breez.tips`, BOLT11, amount field, on-chain row, or `bc1`                                                                     | not re-run on this assertion                  | Deliberately expired vector; no payment is made.                                                      |
| P9 LNURL-pay                           | `flows/09-send-lnurl-pay.yaml`                     | Spark receive shows a `spark1` address; no `@breez.tips`, BOLT11, amount field, on-chain row, or `bc1`                                                                     | not re-run on this assertion                  | Flow stops before `Weiter`; no payment is made.                                                       |
| P10 LNURL-auth                         | `flows/10-lnurl-auth.yaml`                         | `dfxtaro:lightning:` reaches domain, authentication prompt and the defined Spark rejection                                                                                 | **green**, P10/P12/P13 batch                  | Successful authentication stays unchecked.                                                            |
| P11 DFX buy screen                     | `flows/11-dfx-buy-transition.yaml`                 | Re-run reached `Kaufen`/`Formular`, then logged `PUT /v1/buy/paymentInfos` HTTP 400 `KycRequired`; fixture follow-up returned HTTP 200 with a 300 EUR quote | **red first run; fixture follow-up**, current | HTTP 200 quote only; no completed purchase, settlement, or payout claimed. |
| P12 DFX sell screen                    | `flows/12-dfx-sell-transition.yaml`                | Page title, `Deine IBAN hinzufügen oder auswählen`, and the entered IBAN stored                                                                                            | **green**, P10/P12/P13 batch                  | Form/account-storage navigation only; not a completed sell or payout.                                 |
| P13 Lightning entry in settings        | `flows/13-settings-lightning-entry.yaml`           | Target screen shows `Typ` and `Breez Spark`                                                                                                                                | **green**, P10/P12/P13 batch                  | Ends in the assigned wallet detail screen.                                                            |
| P14 Spark receive                      | `flows/14-receive-lightning-balance.yaml`          | Current file only opens Spark receive and asserts a `spark1` address. Historical text, not this file: Treasury pays a Spark invoice for `E2E_PAYMENT_SAT` (default 10); SuccessView shows that amount / `^ sats$` / `^Maestro-E2E$`; after an app restart without wiping state, Spark detail `WalletLabel` `Lightning (Spark)` contains `WalletBalance` matching that amount, not `0 sats`; `onFlowComplete` pays the visible balance minus 4 sat back (6 sat at the default) through the wallet Spark send path to `E2E_SPARK_RETURN_ADDRESS`, or skips without failing if that address is unset | not run on this head                          | Current file only opens Spark receive and asserts a `spark1` address. It does not call treasury and has no return hook. |
| P15 Spark receive                      | `flows/15-send-lightning-payment.yaml`             | Current file only opens Spark receive and asserts a `spark1` address. Historical text, not this file: After a same-flow `E2E_PAYMENT_SAT` credit (default 10), SuccessView shows that amount / `^ sats$` / `^Maestro-E2E$`; after an app restart without wiping state the Spark row shows the funded amount; the app pays a treasury invoice of one tenth of that amount (1 sat at the default); send SuccessView shows that send amount / `^ sats$` / `^Maestro-E2E-send$`; counterpart `paid=true`; after a second restart the Spark row is no longer the funded amount and not `0 sats` | not run on this head                          | Current file only opens Spark receive and asserts a `spark1` address. It does not call treasury and does not pay. |
| P16 DFX buy through backend chain      | `flows/16-dfx-buy-to-payment.yaml`                 | Imports a fixed Spark identity through `_setup-import.yaml` (`E2E_SPARK_MNEMONIC`); fails closed if `E2E_SPARK_WALLET_ADDRESS` is missing. Buy mask shows the truncated `E2E_SPARK_WALLET_ADDRESS` plus `Spark`, then `Zahlungsinformation` / `IBAN` / `BIC`; `Invalid signature` is absent. The flow snapshots `/v1/transaction`, triggers `PUT /v1/buy/<id>/simulatePayment` for `E2E_BUY_CHF` (default 0.20), waits for a Buy in Completed with id greater than that snapshot, and after an app restart without wiping state asserts `backendState === 'ok'`, that `backendTxAmount` is a positive whole-sat integer from the transaction `outputAmount`, and that the visible Spark sat amount is at least that payout | **green**, 2026-09-21 at head `4dd3e7ede5786ec667b34c620e7e799f6320edb1`: `16-dfx-buy-to-payment.yaml` exit 0, 446 s, `passed`. Counter-checks on the same head: with `STATE_KIND` flipped to `sell-complete` the flow turns red (exit 1, 416 s); with the comparison `>=` flipped to `<` it turns red (exit 1, 451 s). Both changes were reverted afterwards. | Needs the local DFX stack, a tradable backend account for that identity (`scripts/seed-local-backend.sql`), `E2E_SPARK_MNEMONIC`, `E2E_SPARK_WALLET_ADDRESS`, `E2E_API_URL`, and `E2E_DFX_JWT`. Without them the flow fails rather than skip. Missing trade approval fails on `NUTZERDATEN EINGEBEN` with a pointer to the fixture. The incoming payment is raised through `scripts/dfx-simulate-payment.js`, not a transfer from a real bank. The address is not read from the screen; the mask shows it truncated and the flow checks that truncated form against the env value. Camera QR is not used. The Spark row only showed the new balance after that restart, not on the still-open screen. The sat credit is not asserted as a fixed amount because it follows the rate. Needs `BREEZ_API_KEY` in the build, otherwise `createSparkWallet` fails with `Lightning konnte nicht gestartet werden.` and no flow gets past the import. The closing check is the backend state, that `backendTxAmount` is a positive whole-sat integer, and that the visible Spark sat amount is at least that payout. Limitation: if the wallet already held at least this payout before the buy, the condition is also satisfied without the new credit. |
| P17 DFX sell through backend chain     | `flows/17-dfx-sell-to-payment.yaml`                | Imports a fixed Spark identity through `_setup-import.yaml` (`E2E_SPARK_MNEMONIC`); fails closed if `E2E_SPARK_DEPOSIT_ADDRESS` is missing. No Lightning funding: P16 has to run first so the same identity already holds the Spark payout; the visible Spark balance must be at least `E2E_PAYMENT_SAT` (default 10) or the flow fails rather than skip. After opening Spark detail, `WalletLabel`/`WalletBalance` is copied as the pre-send amount. The flow snapshots `/v1/transaction` before the wallet send, pays `E2E_SPARK_DEPOSIT_ADDRESS` through the wallet send path, polls and settles the new Sell after it is booked with an id greater than that snapshot, exercises the sell mask, and only then performs the decisive poll requiring the Sell to be Completed with an id greater than that snapshot. After a restart it asserts Spark `WalletBalance` is no longer that pre-send amount; `onFlowComplete` pays any remaining visible Spark balance minus 4 sat through the wallet Spark send path to `E2E_SPARK_RETURN_ADDRESS`, or skips without failing when the address is unset or nothing remains above the reserve | **green**, 2026-09-21 at head `4dd3e7ede5786ec667b34c620e7e799f6320edb1`: `17-dfx-sell-to-payment.yaml` exit 0, 591 s, `passed`. Counter-check on the same head: with `STATE_KIND` flipped to `buy-complete` the flow turns red (exit 1, 623 s); after the flip was reverted it passes again (exit 0, 574 s). The wallet payment runs before the sell mask; the decisive `sell-complete` poll runs after the mask. | Needs a prior P16 run on the same identity, the local DFX stack, a tradable backend account for that identity (`scripts/seed-local-backend.sql`), `E2E_SPARK_MNEMONIC`, `E2E_SPARK_DEPOSIT_ADDRESS`, `E2E_API_URL`, `E2E_DFX_JWT`, and an environment-only `SETTLE_KEY` for the repository helper at `tests/e2e-maestro/scripts/settle-service.mjs`. `scripts/e2e/run-maestro.sh` starts and stops that helper. Does not need `E2E_TREASURY_*`. Without the required names the flow fails rather than skip. Missing trade approval fails on `NUTZERDATEN EINGEBEN` with a pointer to the fixture. The deposit address is taken from the env value and paid before the wait; it is not read back from the sell mask. The flows do not open a bank app, do not inspect an IBAN credit, and do not read a camera QR. P17 returns only the Spark remainder after the send, via `E2E_SPARK_RETURN_ADDRESS`; the sent amount does not come back. If that address is unset the hook skips. An abort before the hook can still leave credit on the same identity; the next run re-imports it. The Spark row only showed a newly credited balance after a restart without wiping state. |

## Historical load timing note for P11

In a dated run limited to P11 and P12, P11 failed once at `^Kaufen$`. The
captured hierarchy showed an empty Safari view — only `Zurück zu BTC Taro` and
`Schließen`, no DFX content — so the page had not finished loading. The
immediately repeated single run and the full series run passed. This separate
historical load-timing observation must not be conflated with the current
unfunded P11 `KycRequired` result or the fixture-assisted follow-up.

## Historical comparison measurements for P11/P12

The following comparisons are historical measurements, not current-artifact
proof.

- With the on-chain wallet the same tap opens the DFX surface correctly;
  `Kaufen`, a `bc1q…` address and `KYC VERVOLLSTÄNDIGEN` are visible.
- The Spark error also occurs on the parent commit `c9a67d9d8d`. The last
  commit of head `9cde627127` is therefore not its cause.
- Against a locally run API and services instance with an app built with
  `DFX_ENV=loc`, the wallet login
  succeeds; the API logs contain `POST /v1/auth/ 201` repeatedly. In the
  captured traffic the Spark wallet logs in with its LNURL address
  (`LNURL1DP68GURN8GHJ7CNJV4JH5…`) next to the on-chain address.
- Without the local stack the flows do not reach the forms; they are not
  hermetic and depend on externally provisioned services.
- The earlier regexes `.*(Kaufen|Buy).*` and `.*(Verkaufen|Sell).*` both matched
  the page title `Buy & Sell directly into your wallet`. The old green P11/P12
  results were vacuously true. After the Spark dialog title `Lightning (Spark)`
  and the address `.*@.*` this is the third documented case of the same error
  class in this suite.
- A `DFX_ENV=prd` build is not a valid counter-run against the same local API:
  even the on-chain login fails. outside `prd` the app and the API do not verify the same message
  cryptographically. Since `session.context.tsx` only sets `isAvailable` once
  every wallet has received a token, the whole `Externe Services` block is
  missing in this mixed operation.
- The earlier suspicion that the local database lacked the required assets is
  refuted: both the Lightning and the on-chain Bitcoin asset are present and
  tradable.
- This measurement does not isolate the API-side change as the cause: a control
  run against a server state without it is still missing.

## How far the earlier intermediate-artifact buy and sell form flows reach

P12 reached IBAN form/account storage in the earlier intermediate-artifact batch. P11
reached the buy form in the earlier unfunded batch and stopped at the KYC precondition; the fixture follow-up returned HTTP 200 with a 300 EUR quote/payment-information view from the payment-info endpoint. Neither flow is a completed
purchase or sell, and neither has settlement or payout proof.

**Buy.** Historical runs reached payment-information markers, but the earlier
unfunded run stopped at the KYC precondition. The fixture-assisted follow-up
proves only an HTTP 200 quote/payment-information view, not a payment, fiat
transfer, or settlement.

**Sell.** The earlier flow opens the account picker, enters a test IBAN, and
asserts the grouped IBAN is stored and the add-account placeholder is gone.
This is form/account-storage navigation only; it is not a completed sell or
payout. Entering a wrong IBAN digit turns the flow red.

**P11/P12 still stop before the payout; P16 and P17 carry it through the backend.** P11 and P12
assert the buy and sell screens only. P16 and P17 are the payment extensions of those two paths
and now require the DFX backend to book the Spark movement end to end.

P16 asserts the buy mask (truncated `E2E_SPARK_WALLET_ADDRESS` plus `Spark`, then `IBAN` and
`BIC`), snapshots `/v1/transaction`, raises an incoming bank payment on the buy route through
`PUT /v1/buy/<id>/simulatePayment`, waits for a Buy in `Completed` newer than that snapshot, and
only then asserts that the visible Spark sat amount returned as `passthrough` is at least
`backendTxAmount`, which `backend-state.js` derives as whole sat from this run's transaction
`outputAmount`. Limitation: if the wallet already held at least this payout before the buy, the
condition is also satisfied without the new credit. The payout is performed by DFX itself over
its own Spark payout path; no local helper is involved. What stays synthetic
is the fiat leg: the incoming bank payment is raised through the backend's own DEV/LOC
simulation route, not by a real bank transfer.

P17 has no funding of its own: P16 has to run first so the imported identity already holds the
Spark payout that P17 sells. P17 then pays the sell deposit address through the wallet send path,
polls and settles the new backend pay-in (`sell-booked`) newer than a snapshot taken before the
send, and exercises the sell mask. Only after that mask does the decisive poll require the Sell
to be complete (`sell-complete`) and newer than the snapshot. A fallen `WalletBalance` alone is
no longer accepted as proof. Leftover Spark is returned through the same send path to
`E2E_SPARK_RETURN_ADDRESS`; if that address is unset the hook skips.

Both fail closed rather than skip. On 2026-09-21 at head
`4dd3e7ede5786ec667b34c620e7e799f6320edb1`, P16 passed against the local stack (exit 0, 446 s).
Flipping its target state to `sell-complete` turns it red (exit 1, 416 s), as does flipping the
comparison from `>=` to `<` (exit 1, 451 s); both changes were reverted afterwards. P17 passed
(exit 0, 591 s); flipping its target state to `buy-complete` turns it red (exit 1, 623 s), and
reverting the flip makes it pass again (exit 0, 574 s). Its sell completes only because a loopback
service supplies the bank return a local stack cannot produce. That service is now tracked at
`tests/e2e-maestro/scripts/settle-service.mjs`, and `scripts/e2e/run-maestro.sh` starts and stops it
when `SETTLE_KEY` and the local
`E2E_API_URL` are set. The service fills what a bank would decide and leaves
the backend to create the payout position, find and attach the bank line, and
complete the sell.

This is deliberately a different boundary from the historical P12 reference
above. P12 completed its bank output against the declared Frick test service.
For P17, `FRICK_BASE_URL` points at a discard port because this local stack has
no bank service attached. The tracked helper fills the missing `valutaDate`,
`frickReference`, `remittanceInfo`, `frickCustomId` and `isReadyDate` payout
fields and writes the returning `DBIT` bank row; it does not link the row or
mark `buy_fiat` complete. Those remain backend work.
It rejects requests without `SETTLE_KEY`, reuses a matching unattached bank row
on repeated calls, and returns HTTP 409 while the position is not ready.

Both chains were additionally measured directly against the backend, outside the flows: a buy
from the fiat credit through `BuyCrypto` `Complete` to a Spark payout received in the wallet,
and a sell from a booked `CryptoInput` carrying the wallet's own transfer id through
`ForwardConfirmed` to `BuyFiat.isComplete`.

**The flows depend on an external precondition.** The account they drive must be tradable —
verified status, a non-zero limit, and deposit addresses. P16 and P17 import a fixed Spark
identity through `_setup-import.yaml` (`E2E_SPARK_MNEMONIC`) instead of creating a random
wallet. Tradability for that identity is set by `scripts/seed-local-backend.sql` on the
local stack only; the SQL does not create Spark deposit addresses, which the stack must
already have. Missing `E2E_SPARK_MNEMONIC`, the address a flow needs, or trade approval
fails on `NUTZERDATEN EINGEBEN` with a pointer to the fixture, not a skip. P17 additionally
needs a prior P16 run on that identity so the Spark balance is already there; it does not
fund itself and does not use `E2E_TREASURY_*`. Without those
preconditions those flows fail, which is the honest behaviour: they do not paper over a
stack that cannot serve them. They fail rather than skip.

## Historical manual-device note (not current proof)

An older note claimed that a physical iPhone running iOS 26.6.1 completed a
10-sat Spark payment. That physical-device claim was not re-verified in the
current evidence and is not current proof; no physical-iPhone result is claimed
here. It was not an automated suite result, because the
[Maestro documentation](https://docs.maestro.dev/platform-support/ios-uikit)
does not support execution on physical iOS devices.

## Elements not addressable semantically

- The DFX tiles are bitmaps without `testID` or `accessibilityLabel` and are
  operated through measured points.
- `QRCodeComponent` exposes no selector for the QR. P5–P7 therefore assert
  payload and state, not the QR pixels.
- The scanner actions are unlabelled icon buttons. P8–P10 do not bypass payload
  processing, only camera and optical recognition: `openLink` delivers the same
  content to the central deeplink router as the scanner does.

These gaps were not papered over by changes to production code.
