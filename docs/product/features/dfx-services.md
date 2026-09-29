# DFX services

DFX session login and the Buy, Sell, Swap, and Point of Sale actions on the home and wallet screens. Buy and Sell open the DFX web services; Sell and Swap return through deep links into in-app confirm screens. POS uses DFX payment links.

## D-01 DFX session and login

**Routes:** none
**Entry:** Automatic on the home screen
**Tier:** Critical (DFX)

**Inputs.** Per-wallet identity signed for `POST` to config `REACT_APP_API_URL` path `/auth/`: body `{address, signature, wallet:"DFX Bitcoin"}`. Message text is `By_signing_this_message,_you_confirm_that_you_are_the_sole_owner_of_the_provided_Blockchain_address._Your_ID:_<address>`, prefixed `[<DFX_ENV>]_` when config `DFX_ENV` is set and not `prd`. Main wallet: first external address + cached ownership proof. LDS / Taproot-LDS: Lightning address as uppercase LNURL + stored `addressOwnershipProof`. Spark: Spark address + compact-message signature (error `wallets.lightning_spark_address_unavailable` if no address). Other wallet types throw.

**Options.** None. Tokens are cached per wallet ID in the `dfxSession` store and refreshed when the JWT is expired. Authenticated calls clear the token on HTTP 401.

**Behavior.** Signature-based JWT login (not LNURL-auth). After a successful login the app sends the app language via `PUT user`. At startup, all wallets except multisig and Spark sign in (`dfx-connect-at-init`); services are available if any login succeeds; if every attempt returns 403, services are hidden; wallets refused with 403 are hidden individually; Spark wallets are always treated as available and sign in on demand. Network failure at init sets unavailable. KYC types exist in the API definitions; no in-app KYC screen or hint was found. KYC in the DFX web app beyond that absence: Not verified in code.

The External services tile (`DfxServicesButtons`) sits on home and on the wallet screen (hidden for multisig). Header "External services". Wallet when no `walletID`: LDS, else Spark, else main. Header and buttons are hidden unless the session is available for that wallet; the tile's container keeps its fixed height, so an empty band stays visible. Errors show Alert "Something went wrong" plus the message; `ELECTRUM_BATCHING_UNSUPPORTED` maps to the UTXO-refresh unsupported-server string.

**Not supported.** Signing in with multisig or custom LNDHub as the session identity; in-app KYC UI.

**Depends on.** Config `REACT_APP_API_URL`, optional `DFX_ENV`; wallet ownership / Spark signatures; `dfxSession` storage.

**Known issues.** None recorded.

**Tests.** tests/unit/dfx-services-buttons.test.js, tests/unit/dfx-services-startup.test.js, tests/unit/dfx-session-context.test.js, tests/unit/dfx-session-coverage.test.js. CF-10, CF-11.

**Source.** api/dfx/hooks/auth.hook.ts, api/dfx/definitions/auth.ts, api/dfx/contexts/session.context.tsx, api/dfx/dfx-connect-at-init.ts, api/dfx/hooks/api-auth.hook.ts, components/DfxServicesButtons.tsx, screen/wallets/home.js, screen/wallets/asset.js

## D-02 Buy

**Routes:** none
**Entry:** Home, Buy
**Tier:** Critical (DFX)

**Inputs.** None in-app. Opens the DFX web buy page with query params `session` (JWT), `balances` (`<btc>@BTC`), `redirect-uri` (`dfxtaro://?wallet-id=<walletId>`), `lang` (app language, uppercase 2 letters). Balance passed is the full wallet balance (no haircut). Token is refreshed immediately before open.

**Options.** None.

**Behavior.** `openServices(..., 'buy')` opens config `REACT_APP_SRV_URL` path `/buy` via `Linking.openURL` (system browser; which browser the OS picks: Not verified in code.). If `openURL` rejects, the alert message is replaced so the URL (token) never appears. Return deep link `dfxtaro://buy` navigates to `WalletsRoot/WalletTransactions`. The app does not create a buy transaction; payout arrives from DFX to an address chosen server-side for the signed-in identity (which address: Not verified in code.).

**Not supported.** In-app buy UI; non-BTC balance params on the app side.

**Depends on.** D-01 session JWT; config `REACT_APP_SRV_URL`; deep-link scheme `dfxtaro:`.

**Known issues.** #260 Spark: DFX buy/sell ramp — buy is ready on the API side, sell is not

**Tests.** tests/unit/dfx-services-buttons.test.js, tests/unit/dfx-services-startup.test.js, tests/unit/dfx-session-context.test.js, tests/unit/dfx-session-coverage.test.js, tests/e2e-maestro/flows/11-dfx-buy-transition.yaml, tests/e2e-maestro/flows/16-dfx-buy-to-payment.yaml. CF-10.

**Source.** api/dfx/contexts/session.context.tsx, components/DfxServicesButtons.tsx, class/deeplink-schema-match.js

## D-03 Sell

**Routes:** Sell
**Entry:** Home, Sell; return through the dfxtaro://sell link, or through a spark: payment link for a Spark sell
**Tier:** Critical (DFX)

**Inputs.** Deep link `dfxtaro://sell?routeId=..&amount=..&wallet-id=..`. Confirm screen shows amount + "BTC", bank account (IBAN), fiat currency name, info "You will be notified by email when the bank transfer to your account is done.", button "Cash out to bank account" (testID `SellConfirm`).

**Options.** None on the confirm screen. Balance passed when opening the web sell page: on-chain = fresh UTXO sum minus a dummy-tx fee at `fastestFee`; Lightning/Spark = balance minus 3%. On-chain max is remembered for sweep logic (`DfxMaxAmount`).

**Behavior.** Tile opens `REACT_APP_SRV_URL` `/sell` like Buy. The in-app `Sell` route is reached only by the return deep link; for a Spark sell the web app currently hands back a `spark:` payment link instead, so this screen is not shown (observed in the Maestro suite); by code that link opens the Lightning send screen with the deposit address filled in but without the amount, and the payment is confirmed there (not verified on a device). Loads `GET sell/<routeId>` (authenticated); load failure leaves a spinner (error swallowed). Confirm, on-chain: fetch UTXOs, build a tx to the DFX deposit address at cached `fastestFee`, RBF sequence for HD bech32 wallets; if the user kept the widget MAX and the wallet did not change, the target is a sweep; then the standard `Confirm` screen (normal send path signs/broadcasts). Confirm, non-on-chain: `LnurlPay` with params from `lightningDepositPayParams` — Spark + `spark1` address → `sparkAddress`; Spark + Spark invoice → `sparkInvoice`; otherwise LNURL. Errors: Alert "Something went wrong" + message. Supported asset on the app side: BTC only. Fiat currencies and IBAN come from DFX.

**Not supported.** Non-BTC sell assets in the app; starting the confirm screen without the deep link.

**Depends on.** D-01 session; config `REACT_APP_SRV_URL`; Electrum/UTXOs for on-chain; LnurlPay / Spark payment path for Lightning; deep link `dfxtaro://sell`.

**Known issues.** #260 Spark: DFX buy/sell ramp — buy is ready on the API side, sell is not

**Tests.** tests/unit/dfxSellMax.test.js, tests/unit/dfxMaxAmount.test.js, tests/unit/dfx-spark-invoice-payment.test.js, tests/unit/dfx-lightning-deposit.test.js, tests/e2e-maestro/flows/12-dfx-sell-transition.yaml, tests/e2e-maestro/flows/17-dfx-sell-to-payment.yaml. CF-11.

**Source.** screen/dfx/sell.tsx, helpers/dfxMaxAmount.ts, helpers/dfxLightningDeposit.ts, components/DfxServicesButtons.tsx, api/dfx/contexts/session.context.tsx, class/deeplink-schema-match.js, navigation/DeeplinkStack.tsx, navigation/index.tsx

## D-04 Swap

**Routes:** Swap
**Entry:** Home, Swap (DFX Swap flag)
**Tier:** Important

**Inputs.** Deep link `dfxtaro://swap?routeId=..&amount=..&wallet-id=..`. Screen shows spend amount BTC, spending network, deposit address, receiving asset/network; button "Confirm".

**Options.** Tile button only when Settings → Feature Flags → "DFX Swap" (`isDfxSwap`) is on. The deep link itself is not gated (observed; no check in `swap.tsx`).

**Behavior.** Loads `GET swap/<routeId>`; on failure goes back. Confirm: on-chain like Sell but fee from a live `recommendedFees()` call; LDS or Spark → `LnurlPay` like Sell; any other wallet → Alert "Unsupported wallet type".

**Not supported.** Swap from wallet types other than on-chain main path, LDS, or Spark; tile without the feature flag.

**Depends on.** Feature flag `isDfxSwap`; D-01 session; config `REACT_APP_SRV_URL`; Electrum / LnurlPay as for Sell; deep link `dfxtaro://swap`.

**Known issues.** None recorded.

**Tests.** tests/unit/dfx-spark-invoice-payment.test.js, tests/unit/dfxMaxAmount.test.js. No covering flows.

**Source.** screen/dfx/swap.tsx, components/DfxServicesButtons.tsx, screen/settings/FeatureFlags.tsx, helpers/dfxLightningDeposit.ts, class/deeplink-schema-match.js, navigation/DeeplinkStack.tsx

## D-05 DFX point of sale

**Routes:** CashierDfxPos, ReceiveDfxPos
**Entry:** Home, POS (DFX Point of Sale flag)
**Tier:** Nice

**Inputs.** Cashier: select a sell route (`Route <id> - <fiat>/<IBAN first4>***<last4>`), enter amount in fiat, generate invoice. Customer display: same route selector; QR of the payment link `lnurl`.

**Options.** Tile "Point of Sale" (hardcoded) only with feature flag "DFX Point of Sale" (`isDfxPos`). Enabling it turns off generic "POS mode" and vice versa. Distinct from non-DFX `CashierPos` / `PosReceive`.

**Behavior.** Cashier loads `GET route` (sell routes), sets app fiat currency to the route's currency, gets or creates a payment link with external ID `BtcTaroPos_01_<routeId>`, `POST paymentLink/payment` (external ID `BtcTaroPayment_<ms>`, expiry +1 h), long-polls `paymentLink/payment/wait`, can `DELETE` to cancel, "Show QR code" → `ReceiveDfxPos`. Completed: "Payment received successfully!" and "New purchase". Customer screen shows "Please wait for cashier" and auto-resets 6 s after success. All cashier/customer strings are hardcoded English. `NOT_AVAILABLE` has no rendered message (visual result: Not verified in code.). Payment is received by DFX (payment link on the sell route → fiat payout to the route's IBAN); the app does not receive funds itself (inferred from API usage; server behaviour: Not verified in code.).

**Not supported.** DFX POS without the feature flag; using this flow for non-DFX POS mode.

**Depends on.** Feature flag `isDfxPos`; D-01 session; DFX `paymentLink` API; sell routes with IBAN.

**Known issues.** None recorded.

**Tests.** tests/unit/dfx-services-buttons.test.js (navigation to CashierDfxPos). No covering flows.

**Source.** screen/wallets/dfx/cashierPos.tsx, screen/wallets/dfx/receivePos.tsx, api/dfx/hooks/payment-link.hook.ts, components/DfxServicesButtons.tsx, screen/settings/FeatureFlags.tsx, navigation/ReceiveDetailsStack.tsx
