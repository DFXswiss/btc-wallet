# Coverage record

The versions of all 13 flows described here — including the mode-specific
tightened P11/P12 — were measured as one complete series on 2026-09-04 against
a locally run API and services instance, driven by a `DFX_ENV=loc` build:
`Flows: 13, passed: 13, assertion failures: 0, aborted: 0` and
`Suite outcome: passed`, every flow individually `passed`. The API login is
evidenced by repeated `POST /v1/auth/ 201` in the logs. Both flows need that stack; they are not hermetic.

In that same stack the hierarchy showed the buy screen with `Kaufen` and
`Formular` for P11, and the sell screen with
`Deine IBAN hinzufügen oder auswählen` for P12. P11 and P12 assert these
disjoint mode markers in addition to the shared page title.

The reproducible app build uses
`REACT_APP_API_URL=http://127.0.0.1:3000/v1`,
`REACT_APP_SRV_URL=http://127.0.0.1:3001` and `DFX_ENV=loc`.

Before the runner was hardened, three series runs had collapsed during the
warm-up without any `FAILED` assertion; in the third the simulator was no
longer booted afterwards and 428 simulator processes were present. The green
series run now also evidences series robustness under the conditions of this
local run.

P8–P10 exercise the processing of the content a QR scan hands to
`DeeplinkSchemaMatch.navigationRouteFor`, through the registered
`dfxtaro:lightning:` scheme. The camera and the optical QR recognition itself
are not tested in the simulator.

| Path                                   | Flow                                               | State assertion                                                                                                                                                                                                                          | Measured run    | Limit / not covered                                                                                                                                                                                                                        |
| -------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1 Onboarding to on-chain wallet       | `flows/01-onboarding-onchain-wallet.yaml`          | `Wallet Backup`, `On-Chain-Wallet` and `Lightning-Wallet` visible                                                                                                                                                                        | **green**, 25 s | Ends in the wallet list. No persistence check after restart.                                                                                                                                                                               |
| P2 Create Spark wallet                 | `flows/02-create-spark-wallet.yaml`                | Full wallet row `Bitcoin, Lightning (Spark), 0 sats, …` visible; the previous add row not visible                                                                                                                                        | **green**, 26 s | Ends after the Spark creation.                                                                                                                                                                                                             |
| P3 Lightning address registered        | `flows/03-spark-lightning-address.yaml`            | Address `…@breez.tips` visible; the missing-address message not visible                                                                                                                                                                  | **green**, 31 s | The concrete account is dynamic. Registration is observed through its UI result.                                                                                                                                                           |
| P4 Spark wallet details from settings  | `flows/04-spark-wallet-details.yaml`               | `Typ` and `Breez Spark` visible                                                                                                                                                                                                          | **green**, 29 s | Ends in the wallet detail screen.                                                                                                                                                                                                          |
| P5 Invoice with amount and description | `flows/05-receive-invoice-amount-description.yaml` | BOLT11 payload carrying the amount-bearing `lnbc10u1` (1000 sat in the human readable part), plus `1000` and `Maestro-E2E` visible; keyboard not visible; no address error                                                               | **green**, 40 s | The tap on `sats` closed the numeric pad. QR pixels are not decoded for lack of a semantic selector.                                                                                                                                       |
| P6 Receive without amount              | `flows/06-receive-lightning-address.yaml`          | Address `…@breez.tips` visible, no BOLT11 and no address error                                                                                                                                                                           | **green**, 30 s | The address is also the source of the rendered QR; the QR pixels are not decoded.                                                                                                                                                          |
| P7 Spark on-chain receive (#261)       | `flows/07-receive-spark-onchain-address.yaml`      | `bc1` address and confirmation hint visible; no address error                                                                                                                                                                            | **green**, 32 s | QR pixels and the later credit after confirmations are not checked.                                                                                                                                                                        |
| P8 Send BOLT11                         | `flows/08-send-bolt11-to-confirmation.yaml`        | `dfxtaro:lightning:` reaches `250000` for the expired BOLT11, the invoice itself as `lnbc2500u`, `Abgelaufen` and then `Rechnung verfallen`                                                                                              | **green**, 39 s | No payment is made with the deliberately expired vector.                                                                                                                                                                                   |
| P9 LNURL-pay                           | `flows/09-send-lnurl-pay.yaml`                     | The last 18 characters of the LNURL generated in this run (the prefix `lnurl1dp68gurn8ghj` is carried by every https LNURL and distinguishes nothing), together with `Lightning (Spark)`, `Senden`, `Gebühr`, `MAX`, `Note` and `Weiter` | **green**, 41 s | Ends in the amount entry of the LNURL-pay screen; the payment itself is not made.                                                                                                                                                          |
| P10 LNURL-auth                         | `flows/10-lnurl-auth.yaml`                         | `dfxtaro:lightning:` reaches domain, authentication prompt and the defined Spark rejection                                                                                                                                               | **green**, 37 s | Successful authentication stays unchecked.                                                                                                                                                                                                 |
| P11 DFX buy screen                     | `flows/11-dfx-buy-transition.yaml`                 | Page title, `Kaufen` and `Formular` visible, then the completed purchase: `Zahlungsinformation`, `Wechselkurs` and the tabs `Text` and `QR-Code`; login, `Invalid signature` and `KYC VERVOLLSTÄNDIGEN` not visible                      | **green**, 32 s | Evidences a purchase driven to its payment instructions in the local stack. The payout itself stays unchecked — it needs an incoming fiat transfer the harness does not model. Without the local stack the flow does not reach this point. |
| P12 DFX sell screen                    | `flows/12-dfx-sell-transition.yaml`                | Page title and `Deine IBAN hinzufügen oder auswählen` visible, then the account stored: the grouped `DE89 3704 0044 0532 0130 00` visible and the add-account placeholder gone; login and `Invalid signature` not visible                | **green**, 38 s | Evidences a sell driven to a stored bank account in the local stack, with `PUT /v1/sell/paymentInfos` answering 200. The payout stays unchecked. Without the local stack the flow does not reach this point.                               |
| P13 Lightning entry in settings        | `flows/13-settings-lightning-entry.yaml`           | Target screen shows `Typ` and `Breez Spark` (`Typ` is Spark-specific, the generic header `Wallet` checked earlier was not)                                                                                                               | **green**, 31 s | Ends in the assigned wallet detail screen.                                                                                                                                                                                                 |

## Known flakiness in P11

In a run limited to P11 and P12, P11 failed once at `^Kaufen$`. The captured
hierarchy shows an empty Safari view — only `Zurück zu BTC Taro` and
`Schließen`, no DFX content — so the page had not finished loading. The
immediately repeated single run and the full series run both passed. This is a
load-timing effect, not a signature or code failure; it is recorded here rather
than smoothed over, because a flow that fails once can fail again in CI.

## Comparison measurements for P11/P12

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

## How far a full buy and sell reaches

P11 and P12 no longer stop at the screen — each drives its transaction to the point where the
user would act on it, against a local stack.

**Buy.** The form resolves the rate, and the page shows the payment instructions with
`Zahlungsinformation`, `Wechselkurs` and both the `Text` and `QR-Code` tabs. The flow also
asserts that `KYC VERVOLLSTÄNDIGEN` is **not** visible — the account status is loaded before the
user exists on the API side, and that assertion is what separates a completed purchase from a
half-loaded page. Reverting it turns the flow red, so it measures rather than decorates.

**Sell.** The flow adds a bank account: it opens the account picker, enters a test IBAN, stores
it, and asserts both that the grouped `DE89 3704 0044 0532 0130 00` is visible and that the
add-account placeholder is gone. Behind it, `PUT /v1/sell/paymentInfos` answers 200 with the
deposit address, fee and rate. Entering a wrong IBAN digit turns the flow red.

**What neither covers: the payout.** A buy needs an incoming fiat transfer, and a payout for
Bitcoin or Lightning needs a node — this environment simulates neither. Only EVM assets have a
local payout path. That limit is a property of the harness, not of the wallet, and no assertion
here pretends otherwise.

**The flows depend on an external precondition.** The account they drive must be tradable —
verified status, a non-zero limit, and Lightning deposit addresses. That state is set outside
the flow, and each extended section says so in a comment. Without it both flows fail, which is
the honest behaviour: they do not paper over a stack that cannot serve them.

## Manual device evidence

On a physical iPhone running iOS 26.6.1 a release build of this branch was run
with a real Breez key: create a Spark wallet, scan the QR code of a 10 sat
invoice and execute the payment. The receiving wallet then showed `10`, `sats`,
`Erhalten` and the description `Geraetetest`. This evidences the complete Spark
send path on real hardware manually. It is not an automated suite result,
because the
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
