# Coverage record

## Current combined-artifact checkpoint (2026-09-06)

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

| Path                                   | Flow                                               | State assertion                                                                                                                                                            | Measured run                                  | Limit / not covered                                                                                   |
| -------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| P1 Onboarding to on-chain wallet       | `flows/01-onboarding-onchain-wallet.yaml`          | `Wallet Backup`, `On-Chain-Wallet` and `Lightning-Wallet` visible                                                                                                          | **green**, P01-P07 batch                     | Ends in the wallet list. No persistence check after restart.                                          |
| P2 Create Spark wallet                 | `flows/02-create-spark-wallet.yaml`                | Full wallet row `Bitcoin, Lightning (Spark), 0 sats, …` visible; the previous add row not visible                                                                          | **green**, P01-P07 batch                     | Ends after the Spark creation.                                                                        |
| P3 Lightning address registered        | `flows/03-spark-lightning-address.yaml`            | Address `…@breez.tips` visible; the missing-address message not visible                                                                                                    | **green**, P01-P07 batch                     | The concrete account is dynamic. Registration is observed through its UI result.                      |
| P4 Spark wallet details from settings  | `flows/04-spark-wallet-details.yaml`               | `Typ` and `Breez Spark` visible                                                                                                                                            | **green**, P01-P07 batch                     | Ends in the wallet detail screen.                                                                     |
| P5 Invoice with amount and description | `flows/05-receive-invoice-amount-description.yaml` | BOLT11 payload carrying the amount-bearing `lnbc10u1` (1000 sat in the human readable part), plus `1000` and `Maestro-E2E` visible; keyboard not visible; no address error | **green**, P01-P07 batch                     | The tap on `sats` closed the numeric pad. QR pixels are not decoded for lack of a semantic selector.  |
| P6 Receive without amount              | `flows/06-receive-lightning-address.yaml`          | Address `…@breez.tips` visible, no BOLT11 and no address error                                                                                                             | **green**, P01-P07 batch                     | The address is also the source of the rendered QR; the QR pixels are not decoded.                     |
| P7 Spark on-chain receive (#261)       | `flows/07-receive-spark-onchain-address.yaml`      | `bc1` address and confirmation hint visible; no address error                                                                                                              | **green**, P01-P07 batch                     | QR pixels and the later credit after confirmations are not checked.                                   |
| P8 Send BOLT11                         | `flows/08-send-bolt11-to-confirmation.yaml`        | Expired BOLT11 reaches `Abgelaufen`, `250000`, `lnbc2500u`, then `Rechnung verfallen`; no payment step                                                                     | **green**, P08-P09 batch                      | Deliberately expired vector; no payment is made.                                                      |
| P9 LNURL-pay                           | `flows/09-send-lnurl-pay.yaml`                     | Derived local LNURL reaches amount-entry screen with `Lightning (Spark)`, `Senden`, `Gebühr`, `MAX`, `Note`, and `Weiter`; no payment step                                 | **green**, P08-P09 batch                      | Flow stops before `Weiter`; no payment is made.                                                       |
| P10 LNURL-auth                         | `flows/10-lnurl-auth.yaml`                         | `dfxtaro:lightning:` reaches domain, authentication prompt and the defined Spark rejection                                                                                 | **green**, P10/P12/P13 batch                  | Successful authentication stays unchecked.                                                            |
| P11 DFX buy screen                     | `flows/11-dfx-buy-transition.yaml`                 | Re-run reached `Kaufen`/`Formular`, then logged `PUT /v1/buy/paymentInfos` HTTP 400 `KycRequired`; fixture follow-up returned HTTP 200 with a 300 EUR quote | **red first run; fixture follow-up**, current | HTTP 200 quote only; no completed purchase, settlement, or payout claimed. |
| P12 DFX sell screen                    | `flows/12-dfx-sell-transition.yaml`                | Page title, `Deine IBAN hinzufügen oder auswählen`, and the entered IBAN stored                                                                                            | **green**, P10/P12/P13 batch                  | Form/account-storage navigation only; not a completed sell or payout.                                 |
| P13 Lightning entry in settings        | `flows/13-settings-lightning-entry.yaml`           | Target screen shows `Typ` and `Breez Spark`                                                                                                                                | **green**, P10/P12/P13 batch                  | Ends in the assigned wallet detail screen.                                                            |

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

**What neither covers: the payout.** A buy needs an incoming fiat transfer, and a payout for
Bitcoin or Lightning needs a node — this environment simulates neither. Only EVM assets have a
local payout path. That limit is a property of the harness, not of the wallet, and no assertion
here pretends otherwise.

**The flows depend on an external precondition.** The account they drive must be tradable —
verified status, a non-zero limit, and Lightning deposit addresses. That state is set outside
the flow, and each extended section says so in a comment. Without it both flows fail, which is
the honest behaviour: they do not paper over a stack that cannot serve them.

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
