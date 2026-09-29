# Lightning payments

This area covers receiving and paying over Lightning: amount invoices and static address or LNURL QR codes, invoice and preimage views, paying BOLT11 invoices, Lightning addresses and LNURL-pay, LNURL-auth and LNURL-withdraw routing, LNDHub point-of-sale mode, the LApp browser (WebLN), and how Lightning rows appear in transaction history. Wallet types involved are LDS (`lightningLdsWallet`), plain LNDHub (`lightningCustodianWallet`), and Spark (`sparkWallet`); when more than one exists, LNDHub is preferred over Spark for the default Lightning wallet.

## L-10 Receive Lightning: invoice with amount

**Routes:** LNDReceive, LNDCreateInvoice
**Entry:** Home Receive when no multi-device wallet exists; Lightning wallet, Receive
**Tier:** Critical (DFX)

**Inputs.** On `LNDReceive`: amount field (placeholder hardcoded "Amount (optional)", not localized) with a unit-cycling button (`loc._.change_input_currency`); description field with placeholder "Description (optional)" (`receive.details_label` plus "(optional)"). On `LNDCreateInvoice` advanced modal: `AmountInput` (sats/BTC/fiat) and description, then "Create" (`receive.details_create`).

**Options.** Wallet selector listing all wallets; choosing an on-chain wallet redirects to `ReceiveDetails`. LNDHub/LDS wallets show a Boltcard/NFC section when an invoice is present (Android auto-starts NFC reading; iOS shows a hardcoded "Use Boltcard" button). Spark hides Boltcard/NFC and Android auto-NFC on this screen.

**Behavior.** Home "Receive" opens `LNDReceive` when a Lightning wallet exists, no multi-device wallet exists, and the Lightning wallet is not in POS mode; the asset screen and the generic receive wallet picker can also open it. There is no explicit create button: an invoice is generated when amount and description lose focus, or via the keyboard accessory "done". Changing inputs while a request is in flight queues one re-generation. Amount empty or zero does not create an invoice; the screen shows the static receive target instead (see L-11). On creation: success haptic, `wallet.addInvoice(amount, description)`, invoice decode, push-notification permission request, and payment-hash registration with the notification service. The screen shows a QR, copy (truncated), and share of the BOLT11. Paid detection polls `wallet.getUserInvoices(20)` every 3 s (starting 1 s after creation), matching by payment_request or payment_hash. When a polled invoice is past `timestamp + expire_time`, a new invoice is generated automatically. Expiry is not user-configurable. LNDHub server default expiry: Not verified in code. Spark passes `expirySecs: undefined` so the SDK default applies; decoded default is 3600 s. When paid, `SuccessView` shows amount in sats and description; "Done" (`send.success_done`) pops to top and refreshes wallet transactions. Creation failure → error haptic and `alert(error.message)`. Poll errors are reported once and silently to the user. Switching wallet clears the shown invoice and stops polling. Receive fees are not displayed.

A tapped NFC tag whose NDEF URI starts with `lnurlw` is treated as a Boltcard: the app fetches LNURL-withdraw details and calls the callback with the invoice; errors show `alert(reason)`.

`LNDCreateInvoice` is only reached indirectly (deeplink `openReceive` for an off-chain wallet, or LNURL-withdraw routing). It can show the Lightning address QR/copy/Share (`receive.details_share`) when `lnAddress` exists; "Advanced functions" (`receive.details_setAmount`) opens the amount modal. A wallet-export reminder runs before first use; declining sends the user to `WalletExport`. No Lightning wallet → `wallets.add_ln_wallet_first`. After creation it navigates to `LNDViewInvoice`. Zero amount is not blocked client-side here. What LNDHub returns for 0: Not verified in code. Spark treats ≤0 as an amountless invoice.

**Not supported.** Creating a zero-amount BOLT11 on `LNDReceive` (amountless receive uses the static address/LNURL path). Boltcard/NFC on Spark for `LNDReceive`.

**Depends on.** Wallet `addInvoice` / `decodeInvoice` / `getUserInvoices`; LNDHub `/addinvoice`; Spark SDK `receivePayment(Bolt11Invoice)`; notifications module; for Boltcard, react-native-nfc-manager.

**Known issues.** None recorded.

**Tests.** tests/unit/lnd-receive-spark.test.js, tests/unit/receive-details.test.js, tests/unit/spark-home.test.js, tests/unit/asset-dfx-services.test.js, tests/unit/deeplink-schema-match.test.js, tests/e2e/spark.spec.js (Detox: invoice for a typed amount and description), tests/e2e/spark-receive.spec.js (funded: an app invoice paid from a second team wallet turns the screen to paid and adds exactly the amount), tests/e2e/spark.spec.js (Detox: a changed amount replaces the open invoice); CF-05, CF-06.

**Source.** screen/lnd/lndReceive.tsx, screen/lnd/lndCreateInvoice.js, navigation/ReceiveDetailsStack.tsx, screen/wallets/home.js, screen/wallets/asset.js, screen/receive/details.js, class/wallets/lightning-custodian-wallet.js, class/wallets/spark-wallet.ts, class/deeplink-schema-match.js, class/boltcard.ts, hooks/nfc.hook.ts.

## L-11 Receive Lightning: static address QR

**Routes:** none
**Entry:** Lightning receive without an amount
**Tier:** Important

**Inputs.** None beyond leaving the amount empty on the Lightning receive screen (`LNDReceive`, documented under L-10).

**Options.** None.

**Behavior.** When no amount is entered on `LNDReceive`, the screen shows a static receive target instead of a BOLT11. For LNDHub/LDS: QR is `wallet.getLnurl()` (bech32 LNURL-pay of the Lightning address) or `lnAddress`; copy/share text is `lnAddress`. For Spark: QR/copy is the Lightning address `lnAddress`, falling back to the raw Spark address (`spark1…`) until an address is registered; the Spark address is fetched via the SDK when connected and cached/persisted. If nothing is available, the text is "No receive address is available yet. Check that the wallet is connected, then try again." (`wallets.lightning_spark_address_unavailable`); Spark additionally shows "Try again" (`wallets.list_tryagain`) to retry the address lookup.

**Not supported.** A plain LNDHub wallet without a Lightning address (no `lnAddress` / `getLnurl`) shows the same "no receive address" wording and no retry. Runtime confirmation of that path: Not verified in code.

**Depends on.** LDS `getLnurl` / `lnAddress`; Spark `getSparkAddress` and connection state.

**Known issues.** None recorded.

**Tests.** tests/unit/lnd-receive-spark.test.js, tests/e2e/spark-receive.spec.js (funded: the address shown before an amount is typed); CF-06.

**Source.** screen/lnd/lndReceive.tsx, class/wallets/lightning-lds-wallet.ts, class/wallets/spark-wallet.ts.

## L-12 Invoice view, paid state, preimage

**Routes:** LNDViewInvoice, LNDViewAdditionalInvoicePreImage, LNDViewAdditionalInvoiceInformation
**Entry:** Lightning transaction row
**Tier:** Important

**Inputs.** None (read-only views).

**Options.** On unpaid invoices, copy and Share (`lightning:<bolt11>`). On paid (or outgoing `paid_invoice`), header "Details" (`send.create_details`) opens the preimage screen. A Boltcard button can appear on the unpaid invoice view regardless of wallet type. Whether Spark invoices ever reach a working Boltcard path here: Not verified in code.

**Behavior.** Opened after `LNDCreateInvoice` or by tapping a Lightning row in history. Unpaid and not expired: QR, "Please pay {amt} sats." (`lndViewInvoice.please_pay` / `sats`), "For: {description}", copy, Share; polls `getUserInvoices(20)` every 3 s until paid or expired. Expired: icon and `lndViewInvoice.wasnt_paid_and_expired`; no auto-regeneration on this screen. Paid: `SuccessView` with amount and memo/description. Preimage screen shows Payment Hash (copy), LNURL + Domain when a stored LNURL-pay success record exists for that hash, Preimage (copy + QR) only when not all zeros, Memo, Description, Value, Fee ("0 sats" / "N sats"), Received; if there is no preimage, `preImageData` is `none`.

`LNDViewAdditionalInvoiceInformation` calls `wallet.fetchInfo()` and shows QR/copy/share of `info_raw.uris[0]` with "Open direct channel with this node:"; network error → `errors.network` and back. No code navigates to this route outside navigation registration, so it is effectively unreachable.

**Not supported.** Auto-regeneration of expired invoices on this screen. Reaching the additional invoice information (node URI) screen from the UI.

**Depends on.** Wallet `getUserInvoices` / `fetchInfo`; stored LNURL-pay success records keyed by payment hash.

**Known issues.** None recorded.

**Tests.** tests/unit/lnd-receive-spark.test.js (navigation to LNDViewInvoice), tests/e2e/spark.spec.js (Detox: an open invoice opens with amount, description and the same request); CF-06. No automated test found for the preimage screen.

**Source.** screen/lnd/lndViewInvoice.js, screen/lnd/lndViewAdditionalInvoicePreImage.js, screen/lnd/lndViewAdditionalInvoiceInformation.js, navigation/ReceiveDetailsStack.tsx, navigation/WalletsStack.tsx, components/TransactionListItem.js.

## L-13 Pay Lightning: invoice, address, LNURL-pay

**Routes:** ScanLndInvoice, LnurlPay, LnurlPaySuccess
**Entry:** Send with a Lightning destination
**Tier:** Critical (DFX)

**Inputs.** Destinations accepted on `ScanLndInvoice`: LNURL (bech32 `lnurl1…`, optionally inside `lightning:`, `http…?lightning=`, or `dfxtaro:` / `bluewallet:` wrappers); Lightning address `user@domain` (also `mailto:`); BOLT11 mainnet `lnb…` and testnet `lntb…` with or without `lightning:` / `lightning://`; BIP21 with a `lightning=` param (BOLT11 extracted and paid over Lightning); Spark only: raw `spark1…` and `spark:` invoice URIs. Amount via `AmountInput` with unit switch and "Max"; "Note" field. Labels "To:", "From your wallet:", and "Note" are hardcoded English.

**Options.** Wallet selector filtered to off-chain wallets (or Spark-only for Spark destinations) when more than one suitable wallet exists. Unit toggle remains available on the confirmation screen even when amount is read-only.

**Behavior.** Entry via QR/clipboard/image on Home, asset screen, and `ScanCodeSend`; OS deeplinks; LNURL forwarder for LNURL-pay; LApp browser; deeplink `openSend` on an off-chain wallet; also DFX Sell/Swap Lightning deposit payments and "Repeat" from LNURL success. BOLT11 amount is taken from the invoice and the field is disabled; LNURL is prefilled with the service minimum (or 1) and editable; Lightning address amount is empty and editable. Note/description is locked when invoice/LNURL metadata carries a description; editable for Lightning address. Expiry line shows "Expires in {time} minutes" / "Expired" (`lnd.expiresIn`, `lnd.expired`). Fees: LNDHub/LDS show "0 sats - {3% of amount} sats" or "Free" (`_.free`) for fee-waived domains (`lightning.space` and DFX-domain LNURLs); Spark shows an SDK fee quote or "-". Max/sweep: LNDHub sends 97% of balance for LNURL max (3% fee headroom); Spark sends the full amount with `isMax` so fees come from a max-fee quote. "Next" (`lnd.next`) always goes to `LnurlPay` with `invoice` / `lnurl` / `sparkAddress` / `sparkInvoice` params.

On `LnurlPay`: read-only amount (unit toggle still possible), LNURL image, description, domain, copyable BOLT11/Spark destination, fee line, "Pay" (`lnd.payButton`). Biometric confirmation runs if enabled. Insufficient funds (Spark includes quoted fee) → red `send.insufficient_funds` and Cancel instead of Pay. Spark: Pay disabled until a fee quote exists; quote failure → "Payment request failed. Please try again." (`send.server_error`) plus "Try again"; a changed fee raises `lnd.error_fee_quote_invalid` and re-quotes. Pending Spark payments show "This payment is still on its way. Do not send it again." (`wallets.lightning_spark_payment_in_transit`) and wait for SDK outgoing-payment events; failure → "Payment failed" (`wallets.lightning_spark_payment_failed`). Spark address/invoice sends use persisted payment seeds reconciled after restart; unreconcilable → `send.details_utxo_refresh_failed`. LNDHub pays via `/payinvoice`; mainnet/testnet cross-payment is blocked ("Cross transfer between LN testnet and mainnet is not allowed."); HTTP 503 → "Payment is in transit" (config key `REACT_APP_LDS_DEV_URL` is involved for LDS). Other errors alert the raw message. Success for BOLT11/Spark → `Success` with amount (sats), fee, description; LNURL → `LnurlPaySuccess`. Close pops the whole send stack.

Spark paying a Lightning address on a trusted domain (`lightning.space`) whose LNURL response carries a `sparkAddress` pays that Spark address directly (no Lightning invoice) unless paying max or sending a comment. History: LNDHub/Spark sends become `paid_invoice` rows; LNURL-pay success data is stored under `lnurlpay_success_data_<paymentHash>`.

LNURL-pay protocol: Lightning address resolves to `https://<domain>/.well-known/lnurlp/<user>` (`http` for `.onion`); Tor/onion rejected with "Tor connections are not supported." (`settings.tor_unsupported`). Amount must fall in `minSendable`/`maxSendable` (msat → sats); out of range → English "The specified amount is invalid, X it should be between MIN and MAX". Metadata may show `text/plain` and base64 image; returned invoice amount must match. Comments sent only if `commentAllowed`, truncated to that length. Success actions (LUD-09/10): `message`, `url` (opens via Linking), `aes` (decrypted with preimage).

`LnurlPaySuccess` loads the stored success record by payment hash (or display data from `LnurlPay`): animated success with fee, domain, description, image, and success-action card. "Repeat" (`_.repeat`) re-opens `LnurlPay` with the same LNURL when not disposable; otherwise "Done". Without display data: plain success + Done.

**Not supported.** Paying amountless (zero) BOLT11 invoices from this screen (`lnd.error_tip_invoice_not_supported` "Invoices with 0 amount are not supported."). Paying a Spark destination with no Spark wallet (`wallets.no_ln_wallet_error` and the screen closes). Fee-free Lightning for Spark (waiver domains apply to LNDHub/LDS only). Tor/onion LNURL hosts.

**Depends on.** Deeplink/LNURL parsing (`class/lnurl.js`, `class/deeplink-schema-match.js`); LNDHub `/payinvoice`; Spark fee quote and send APIs and payment-seed persistence; fee-waiver domain helper; AsyncStorage for LNURL-pay success records.

**Known issues.** Paying a Spark invoice (raw or `spark:` URI) does not fill in its amount; the regular send screen opens instead (seen on iOS and Android during device testing).

**Tests.** tests/unit/scan-lnd-invoice-spark.test.js, tests/unit/ManualAddressSend.test.js, tests/unit/deeplink-schema-match.test.js, tests/unit/spark-home.test.js, tests/unit/asset-dfx-services.test.js, tests/unit/lnurl-pay-spark.test.js, tests/unit/fee-quote-binding.test.js, tests/unit/dfx-spark-invoice-payment.test.js, tests/unit/spark-wallet.test.js, tests/unit/send-success.test.js, tests/unit/lnurl.test.js, tests/unit/lnurl-pay-success.test.js, tests/integration/lightning-custodian-wallet.test.js, tests/e2e/spark-send.spec.js (funded, quotes only), tests/e2e/spark-pay.spec.js (funded, pays a BOLT11 invoice), tests/e2e/spark.spec.js (Detox: `lightning:` link to the payment screen), tests/e2e/spark.spec.js (Detox: a scanned invoice opens the payment screen; an empty wallet shows Insufficient funds instead of Pay), tests/e2e/spark-transfer.spec.js (funded: Spark address paid, paid again as a new payment, paid once on a double tap; a trusted-domain Lightning address settles over Spark); CF-07, CF-11.

**Source.** screen/lnd/scanLndInvoice.js, screen/lnd/lnurlPay.js, screen/lnd/lnurlPaySuccess.js, class/lnurl.js, class/deeplink-schema-match.js, class/wallets/lightning-custodian-wallet.js, class/wallets/spark-wallet.ts, helpers/freeLightningDomains.ts, helpers/lightning-wallet.ts, navigation/SendDetailsStack.tsx, api/spark/payment-seeds.ts.

## L-14 LNURL-auth login

**Routes:** LnurlAuth
**Entry:** Scanned LNURL-auth code
**Tier:** Critical (DFX)

**Inputs.** An LNURL with `tag=login` (via forwarder, `LNDCreateInvoice` redirect, or deeplink such as the `dfxtaro` scheme).

**Options.** None beyond which Lightning wallet is used (see Behavior).

**Behavior.** Prompt: "Would you like to {log in at | register an account at | link your account at | be authenticated at}" plus the hostname plus "using your Lightning wallet?" chosen by the LNURL `action` param (`lnurl_auth.*_question_part_1/2`), bold hostname, "Authenticate" button. Success: SuccessView and `lnurl_auth.*_answer`. Error: `lnurl_auth.could_not_auth` plus raw reason. No explicit cancel; header close pops the stack. DFX-domain logins (hostname `dfx.swiss` or subdomain) use the Lightning wallet they were started from; all other logins use the default Lightning wallet (LNDHub before Spark). No Lightning wallet → `wallets.add_ln_wallet_first`.

Key derivation: LNDHub/LDS uses HMAC-SHA256(wallet secret, hostname) as a secp256k1 private key (BlueWallet scheme, not LUD-05 BIP32). DFX logins append `address` (LNURL of the Lightning address), `signature` (address ownership proof), and `wallet=DFX Bitcoin`. Spark supports only DFX-domain logins: k1 is signed with the Spark identity key from the source mnemonic (must match the wallet identity pubkey), and appends Spark address plus a compact signature of the DFX sign message. Non-DFX login with Spark → "This wallet cannot sign in with that code." (`wallets.lightning_spark_lnurl_auth_unsupported`).

**Not supported.** Spark LNURL-auth for non-DFX domains. LUD-05 BIP32 linking-key derivation for LNDHub (uses HMAC instead).

**Depends on.** Default or source Lightning wallet; LNURL-auth protocol in `class/lnurl.js`; for Spark, identity key from the Spark context.

**Known issues.** None recorded.

**Tests.** tests/unit/lnurl-auth.test.js, tests/unit/spark-context.test.js, tests/unit/lnurl.test.js, tests/e2e-maestro/flows/10-lnurl-auth.yaml; CF-09.

**Source.** screen/lnd/lnurlAuth.js, class/lnurl.js, class/wallets/lightning-custodian-wallet.js, api/spark/contexts/spark.context.tsx, screen/lnd/lnurlNavigationForwarder.tsx, class/deeplink-schema-match.js.

## L-15 LNURL routing and LNURL-withdraw

**Routes:** LnurlNavigationForwarder
**Entry:** Scanned LNURL
**Tier:** Important

**Inputs.** An LNURL scanned or pasted on Home, the asset screen, or `ScanCodeSend`; also OS LNURL deeplinks.

**Options.** None.

**Behavior.** `LnurlNavigationForwarder` shows loader title "Loading Lnurl" (`lnd.lnurl_loader_title`) and text `lnd.lnurl_loader_text` / `lnd.lnurl_loader_text_onchain`. Routing: `tag=login` → `LnurlAuth` (no network call); OpenCryptoPay payment-link response → Lightning `LnurlPay` if the Lightning wallet balance covers it, else on-chain `OpenCryptoPayCommitOnchain` from the main wallet (provider min fee rate), else Lightning anyway, else "Unsupported lnurl" (DFX-domain callbacks marked fee-free for LNDHub); `payRequest` → `ScanLndInvoice`; `withdrawRequest` → `LNDCreateInvoice`. Any error is reported and the screen goes back silently (no user alert).

OS LNURL deeplinks go to `LNDCreateInvoice`, which redirects pay-requests to `ScanLndInvoice` and logins to `LnurlAuth`. BOLT11, Spark, and Lightning-address deeplinks go to `ScanLndInvoice`.

LNURL-withdraw (inside `LNDCreateInvoice`, no dedicated screen): fetches withdraw params, prefills max withdrawable, and immediately creates an invoice and calls the callback (`k1`, `pr`) with no separate confirmation. Min/max violations → `receive.minSats` / `receive.maxSats` (or `*Full` with currency). Fixed amounts disable the amount input. Server `status: ERROR` → "Reply from server:" plus the reason. Then shows `LNDViewInvoice`. Boltcard tap-to-receive is another LNURL-withdraw path (see L-10).

**Not supported.** A confirmation step before claiming the maximum on LNURL-withdraw. User-visible alerts when the forwarder fails (silent back).

**Depends on.** LNURL fetch/parse; OpenCryptoPay payment-link handling; `LNDCreateInvoice` for withdraw; Lightning and main on-chain wallets for OpenCryptoPay balance routing.

**Known issues.** None recorded.

**Tests.** tests/unit/spark-home.test.js, tests/unit/asset-dfx-services.test.js, tests/unit/lnd-receive-spark.test.js, tests/unit/deeplink-schema-match.test.js; CF-09. No dedicated forwarder unit test found.

**Source.** screen/lnd/lnurlNavigationForwarder.tsx, screen/lnd/lndCreateInvoice.js, class/deeplink-schema-match.js, navigation/SendDetailsStack.tsx.

## L-16 Point of sale (LNDHub POS mode)

**Routes:** PosReceive, CashierPos
**Entry:** POS mode flag
**Tier:** Nice

**Inputs.** Cashier: amount with unit switch. Customer display shows the static LNURL QR and address (no amount entry).

**Options.** Global "POS mode" switch on Feature Flags reveals, for `lightningLdsWallet` only, "Activate POS mode" and "Go to cashier station" in wallet details. Wallet selector labels POS wallets "(POS mode)". All POS strings are hardcoded English.

**Behavior.** Two devices share one LDS wallet. Cashier sets LNURL-pay min=max to the sale amount on the LDS server (`adjustLnurlPayAmount`). Customer display (`PosReceive`, opened by Receive when the wallet is in POS mode) shows the static LNURL QR + address and polls every 3 s through "Please wait for cashier" → "Waiting for payment..." + "You will be charged: N sats" → "Payment received successfully!". Cashier: "Generate Invoice", "Cancel purchase" (resets to 1 sat), paid banner with sats and check icon; after payment resets amount to 1 sat. Turning POS mode off restores range 1…100,000,000 sats. Paid detection matches the newest paid invoice with the exact amount after the sale started.

**Not supported.** Tips, printing, receipts, fiat-denominated pricing (fiat only as an input unit conversion). POS mode for non-LDS Lightning wallets.

**Depends on.** LDS wallet admin key and LNURL-pay amount adjustment on the LDS server; Feature Flags POS mode switch.

**Known issues.** None recorded.

**Tests.** tests/unit/wallet-details-spark.test.js, tests/unit/receive-details.test.js, tests/unit/spark-home.test.js, tests/unit/asset-dfx-services.test.js.

**Source.** screen/lnd/cashierPos.tsx, screen/lnd/lndPosReceive.tsx, screen/wallets/details.js, screen/settings/FeatureFlags.tsx, class/wallets/lightning-lds-wallet.ts, navigation/ReceiveDetailsStack.tsx, BlueComponents.js.

## L-17 LApp browser (WebLN)

**Routes:** LappBrowser
**Entry:** Not reachable in the current build
**Tier:** Nice

**Inputs.** URL bar (auto-prefix https). WebLN pages may request payments or invoices.

**Options.** Back, refresh, home; default start page DuckDuckGo. No allowlist found (any URL).

**Behavior.** Not reachable in the current build. The screen is an in-app WebView titled "LApp Browser" (`wallets.list_ln_browser`) with a WebLN indicator (green/red). It injects `window.webln`: `enable` resolves true; `sendPayment` confirms "This page asks for permission to pay an invoice" then opens `ScanLndInvoice`; `makeInvoice` confirms "This page wants to pay you N sats" then creates an invoice with the max of min/max/default amount; `getInfo`, `signMessage`, and `verifyMessage` reject "not implemented". The page also scrapes `lnbc…` text in span/input/a tags on an interval and offers to pay (rate-limited to one prompt per 3 s and once per invoice). The only navigation into `LappBrowserRoot` is the `openlappbrowser` deeplink case, which is commented out; no UI entry point was found.

**Not supported.** Reaching the browser from the current UI or active deeplinks. WebLN `getInfo` / `signMessage` / `verifyMessage`.

**Depends on.** In-app WebView; Lightning wallet for WebLN pay/invoice; `ScanLndInvoice` for payments.

**Known issues.** None recorded.

**Tests.** None.

**Source.** screen/lnd/browser.js, navigation/LappBrowserStack.tsx, navigation/index.tsx, class/deeplink-schema-match.js.

## L-18 Lightning rows in history

**Routes:** none
**Entry:** Wallet screen
**Tier:** Important

**Inputs.** None (list display). Context menu can copy amount/note (not for expired).

**Options.** None.

**Behavior.** Transaction list items for Lightning include `user_invoice` / `payment_request` (incoming invoices), `paid_invoice` (outgoing), and `bitcoind_tx` (LNDHub on-chain refill). Unpaid unexpired invoices show amount; unpaid expired show "Expired" (`lnd.expired`) in grey with an expired icon; paid incoming use the off-chain incoming icon; outgoing use the off-chain icon. Tap opens `LNDViewInvoice` (paid → success and preimage details). Spark maps all SDK payments (Lightning, Spark transfers, deposits/withdrawals, tokens) to `paid_invoice` / `user_invoice` rows; memo falls back to English (not localized) strings such as "Lightning payment/invoice", "Spark payment/receive", "Deposit", "Withdraw", "Token payment/receive"; send value includes fees; `expire_time` is fixed at 3600.

**Not supported.** Context-menu copy of amount/note for expired invoices.

**Depends on.** Wallet transaction list data; Spark payment mapping in the Spark wallet class.

**Known issues.** None recorded.

**Tests.** tests/unit/asset-dfx-services.test.js, tests/unit/spark-wallet.test.js (mapping coverage of individual cases: Not verified in code.), tests/e2e/spark.spec.js (Detox: open invoice row), tests/e2e/spark-pay.spec.js (funded: the payment is the newest row with amount plus fee); CF-06, CF-07, CF-10.

**Source.** components/TransactionListItem.js, class/wallets/spark-wallet.ts.
