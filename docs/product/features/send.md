# Send

On-chain send: choosing a destination, composing amount and fee, confirming and broadcasting, coin control, PSBT signing for watch-only and multi-device wallets, the shared QR scanner, and the Tools screens for raw broadcast and address ownership checks.

## S-01 Send on-chain: destination

**Routes:** ScanCodeSend, ManualEnterAddress
**Entry:** Home or wallet screen, Send
**Tier:** Critical

**Inputs.** Live camera QR, image from the gallery, clipboard paste, or typed text on ManualEnterAddress. Accepted content includes Bitcoin addresses and `bitcoin:` URIs (including BIP21 with optional `amount`, `label`, and `lightning=`), BOLT11 / Lightning destinations (routed out of this area), LNURL, and base64 PSBT when a multisig wallet exists. App-scheme prefixes `bluewallet:bitcoin:` and `dfxtaro:bitcoin:` are stripped before parsing.

**Options.** On Home, a long press on Send opens an action sheet to choose photo, scan, or clipboard. The keyboard button on the scan screen opens ManualEnterAddress.

**Behavior.** Screen title is "Send"; the scan hint is "Scan a Bitcoin QR code". Dispatch order on scanned or pasted content: (1) base64 PSBT opens PsbtMultisig only if a multisig wallet exists, otherwise nothing happens; (2) unified BIP21 (`bitcoin:` plus `lightning=`) goes to SendDetails for an on-chain wallet or to Lightning invoice pay for an off-chain wallet, using the `walletID` param, else the Lightning wallet, else the main wallet; (3) LNURL is forwarded out of this area; (4) otherwise a Bitcoin address or `bitcoin:` URI opens SendDetails, while Lightning invoices, Spark addresses/URIs and Lightning addresses open Lightning pay; (5) unrecognised content closes the screen silently. ManualEnterAddress is a multiline field labelled "Text address or invoice" (title "Enter address"); Continue stays disabled until the text is a possible Lightning or on-chain destination, then routes the same way as scan (no PSBT handling). Address recognition strips `bitcoin:` / `bitcoin://` and query strings and validates with mainnet `toOutputScript`; BIP21-decodable addresses are also accepted. A widget `openSend` action can open SendDetails directly. Camera UI appears only after camera permission is granted.

**Not supported.** Combined-URI wallet chooser, signed-PSBT-file deeplink, Azteco and watch-only import from URL are disabled in the deeplink matcher. BIP47 payment codes are not recognised on the send path. Whether payment-code sending exists elsewhere: Not verified in code.

**Depends on.** Camera permission and QR scanning (`react-native-camera-kit-no-google`, camera permission hook, QR scanner with UR decoding); deeplink schema matching.

**Known issues.** None recorded.
**Tests.** tests/unit/ManualAddressSend.test.js, tests/unit/spark-home.test.js, tests/unit/asset-dfx-services.test.js, tests/unit/deeplink-schema-match.test.js, tests/e2e/scan.spec.js (Detox: scanned BIP21 fills address and amount), tests/e2e/onchain-send.spec.js (funded, typed address; skipped until the Android prompt fix #281 is merged), CF-03
**Source.** screen/send/ScanCodeSend.tsx, screen/send/ManualAddressSend.tsx, class/deeplink-schema-match.js, screen/wallets/home.js, screen/wallets/asset.js

## S-02 Send on-chain: amount, fee, confirm, broadcast

**Routes:** SendDetails, Confirm, CreateTransaction, Success
**Entry:** After the destination
**Tier:** Critical

**Inputs.** Destination arrives as route params (`uri` BIP21 or `address`, optionally with `amount`, `amountSats`, `unit`, `memo`, `isEditable`). On SendDetails the recipient "To:" line is display-only and cannot be edited or re-scanned. Amount is entered in BTC, sats or local fiat via AmountInput. Optional single-line note/memo. BIP21 `amount` pre-fills BTC amount, `label` becomes the memo, `pj` becomes the payjoin URL; decode failure shows "Unable to decode Bitcoin address".

**Options.** MAX sets amount to the wallet balance and switches the unit to BTC (keyboard accessory always on iOS; on Android only while the keyboard is visible). Fee row "Fee" opens Fast (~10m), Medium (~3h) and Slow (~1d) presets with absolute fee and sat/vB; Medium or Slow is disabled when its rate equals a faster tier. "Custom" accepts integer sat/vByte only (values below 1 become 1; invalid input re-prompts with "The fee is not valid."). Default fee is the fastest tier the balance can afford, else medium, else slow, else `1` until estimates load. RBF has no user toggle: it is set automatically only for exact type HDSegwitBech32Wallet when `noRbf` is absent. Coin-control entry appears only as "{amount} BTC is frozen" when frozen coins exist. Wallet picker is shown only when more than one on-chain wallet allows send; otherwise the wallet label is static. On Confirm, a Payjoin switch appears when BIP21 carried `pj` and the wallet allows payjoin. Confirm header "Details" opens CreateTransaction (biometric unlock when biometrics are enabled).

**Behavior.** Fee estimates load from cache key `NetworkTransactionFee`, then mempool.space recommended fees (fastest = fastestFee+1, medium = halfHourFee, slow = hourFee), falling back to Electrum histogram / estimatefee, then hardcoded 2/1/1 sat/vB. Next refreshes UTXOs (retries; failure messages for refresh failure, spent coin-control coin, or Electrum without batching). Per-recipient checks reject missing/zero amount, amount ≤ 500 sats ("…greater than 500 sats"), fee below 1, empty or invalid address, amount over balance (or over balance excluding frozen coins), and Lightning invoice-looking strings ("…go to your Lightning wallet…"). Valid recipients: legacy, P2SH, P2WPKH/P2WSH and P2TR (taproot v1 with a valid 32-byte x-only point); witness versions above 1 are rejected; mainnet only. Coin selection uses coinselect (split for MAX); no solution shows the hardcoded alert "Not enough balance. Try sending smaller amount or decrease the fee." Routing after build: watch-only → PsbtWithHardwareWallet; multisig → PsbtMultisig; otherwise signed hex and memo are saved and Confirm opens. Confirm shows per-recipient amount (BTC and fiat), address, fee, then "Send now" (disabled when Electrum is disabled). Broadcast waits for Electrum, optional biometrics, then `broadcastTx`; success registers the txid for push notifications and opens Success with amount and fee; failure shows "Broadcast failed." or the raw error. Payjoin (BIP78) uses the original tx as fallback; both txids are watched; allowed only for HDSegwitBech32Wallet (and subclasses) and HDAezeedWallet. CreateTransaction shows signed hex, recipients, fee, size, sat/vB and memo; actions are "Copy and broadcast later", "Verify on coinb.in", and share as a `.txn` file (iOS share sheet; Android Downloads with storage permission, skipped on API ≥ 33). Privacy blur/screenshot protection runs while CreateTransaction is focused; exact per-platform effect: Not verified in code. Success shows amount, fee in sats, Lottie animation and "Done"; on-chain Confirm passes a positive amount so the direction icon is treated as incoming (asserted in unit tests; visual confirmation: Not verified in code). Batch/multi-recipient state exists but no UI adds a recipient, so batch send is unreachable. Spark and Lightning wallets are excluded from SendDetails. Who can send: HD BIP84/49/44 (and related subclasses), aezeed, multisig, single-key legacy/segwit; watch-only only with hardware-wallet mode (see S-04); AbstractHDWallet default cannot. There is no taproot sending wallet type in create/import paths; P2TR is recipient-only. Whether import can yield a taproot spend wallet: Not verified in code.

**Not supported.** Editing the destination on SendDetails; user RBF toggle; decimal sat/vB custom fees; adding recipients in the UI; payjoin except HD BIP84 and aezeed; RBF except exact HDSegwitBech32Wallet type.

**Depends on.** Electrum (UTXO fetch with batching when a UTXO set is known, fee fallback, broadcast); mempool.space (fee estimates and explorer link from related tools); coinb.in (verify link); biometrics for broadcast and Details; bip21, bitcoinjs-lib, coinselect; payjoin-client and class/payjoin-transaction; push-notification txid registration.

**Known issues.** None recorded.
**Tests.** tests/unit/utils.test.js, tests/unit/fetchUtxoBatching.test.js, tests/unit/legacyWalletFetchUtxoBatching.test.js, tests/unit/electrumBatchingDetection.test.js, tests/unit/legacy-wallet.test.js, tests/unit/deeplink-schema-match.test.js, tests/unit/AmountInput.test.js, tests/unit/send-confirm-branches.test.js, tests/unit/send-confirm-fee.test.js, tests/unit/send-biometric-abort.test.js, tests/unit/payjoin-transaction.test.js, tests/unit/send-success.test.js, CF-03. tests/e2e/onchain-send.spec.js (Detox, funded) signs a typed-amount send and a MAX send and checks amount and fee against the signed transaction; it never broadcasts. Both checks are skipped until the Android prompt fix (#281) is merged, since the custom fee rate is typed into that prompt. Batch send is not covered end to end.
**Source.** screen/send/details.js, screen/send/confirm.js, screen/send/create.js, screen/send/success.js, models/networkTransactionFees.js, class/wallets/legacy-wallet.ts, class/wallets/abstract-hd-electrum-wallet.ts, class/deeplink-schema-match.js, helpers/utils.ts, components/AmountInput.js, class/payjoin-transaction.js, class/biometrics.js, blue_modules/BlueElectrum.js

## S-03 Coin control

**Routes:** CoinControl
**Entry:** Send details, when coins are frozen
**Tier:** Important

**Inputs.** Wallet UTXO list after a refresh (10 s race). Per-UTXO label (placeholder "Note to Self"), freeze switch, and multi-select via coloured avatars.

**Options.** Detail modal: amount, confirmations, memo, address, `txid:vout`, editable label (debounced save), Freeze, "Use Coin". Floating Freeze / "Unfreeze" and "Use Coin" / "Use Coins". Frozen state is persisted in wallet UTXO metadata.

**Behavior.** Title "Coin Control". Reachable only by tapping "{amount} BTC is frozen" on SendDetails; with no frozen coins the screen cannot be opened in this build. Lists all UTXOs including frozen, sorted by height, txid and vout. Rows show amount, memo or address, "Change" and "Freeze" badges. Header tip explains the feature; once coins are selected it shows "{value} selected". "Use" returns chosen UTXOs to SendDetails, which then limits balance and coin selection to them; frozen coins can be spent deliberately this way. Empty wallet shows "This wallet doesn’t have any coins at the moment." MAX on SendDetails still uses the full wallet balance even when coin control has limited the UTXO set (observed in code; not verified at runtime).

**Not supported.** Opening coin control from a header action when nothing is frozen (that action is unused).

**Depends on.** Electrum UTXO refresh; SendDetails coin-selection path.

**Known issues.** None recorded.
**Tests.** None.
**Source.** screen/send/coinControl.js, screen/send/details.js

## S-04 Sign with a hardware or watch-only wallet (PSBT)

**Routes:** PsbtWithHardwareWallet
**Entry:** Send details of a watch-only wallet
**Tier:** Important

**Inputs.** Unsigned PSBT built on SendDetails for a watch-only wallet that allows send (HD xpub/ypub/zpub and the per-wallet "Use with Hardware Wallet" switch under Wallet details › Advanced). Signed return via "Scan Signed Transaction" (camera, animated UR, Base43 Electrum-desktop QR) or "Open Signed Transaction" (file picker). Non-base64 input is treated as final tx hex; base64 is combined with the original PSBT.

**Options.** Export unsigned PSBT: animated QR (BC-UR v2 `crypto-psbt` by default, or legacy URv1 if "Legacy URv1 QR" is on in Settings › General), "Export to file" (`.psbt`), "Copy to Clipboard". After import: copy hex, verify on coinb.in, "Send now".

**Behavior.** Title "Send". Plain single-address watch-only wallets cannot send. After a signed import, broadcast uses Electrum with a biometric gate, saves the memo, registers the push txid and opens Success (without amount/fee card when amount is undefined). Errors include "The selected file doesn’t contain a transaction that can be imported.", "There is no transaction signing in progress.", and a raw BC-UR decode failure alert. There is no vendor-specific USB/BLE/NFC signer; interop is generic PSBT over QR, file or clipboard. Which hardware devices work: Not verified in code.

**Not supported.** Sending from plain single-address watch-only wallets; in-scanner file button on this flow (hidden).

**Depends on.** Electrum for broadcast; biometrics; BC-UR libraries; document picker / filesystem helpers; Settings › General legacy UR switch; camera/QR scanner (S-06).

**Known issues.** None recorded.
**Tests.** tests/unit/watch-only-wallet.test.js, tests/integration/watch-only-wallet.test.js. No end-to-end test.
**Source.** screen/send/psbtWithHardwareWallet.js, class/wallets/watch-only-wallet.js, screen/wallets/details.js, blue_modules/ur/index.js, blue_modules/fs.js, screen/settings/GeneralSettings.tsx

## S-05 Multi-device co-signing

**Routes:** PsbtMultisig, PsbtMultisigQRCode
**Entry:** Send from a multi-device wallet; scanned PSBT
**Tier:** Important

**Inputs.** PSBT from SendDetails Next on a MultisigHDWallet, or a scanned/pasted base64 PSBT (Home/asset require that the wallet can still produce signatures). Optional `receivedPSBTBase64` param is combined in.

**Options.** "Sign" cosigns with local keys. "Send now" once signature count ≥ M (biometric gate, double-tap guard). After this wallet has signed, a partially signed PSBT is shown as an animated QR for the next cosigner. PsbtMultisigQRCode offers animated PSBT QR, "Scan or import file" (action sheet on Mac desktop) and "Share" (`.psbt` export).

**Behavior.** PsbtMultisig title is "Send". Shows total sent to non-own outputs (BTC and fiat), up to two destinations plus hardcoded "and N more...", and fee. One "Vault Key N" row per required signature with a check once signed. If the wallet holds no key for the PSBT: "Your wallet is not part of this multisig setup". PsbtMultisigQRCode rejects scanned hex with "Failed to import. Please make sure that the provided data is valid." PsbtMultisigQRCode has no navigator caller in the codebase and is unreachable; co-signing in practice uses PsbtMultisig and its inline QR.

**Not supported.** Reaching PsbtMultisigQRCode as a navigable screen in this build.

**Depends on.** Multisig HD wallet cosign/finalize; Electrum broadcast; biometrics; BC-UR / QR export.

**Known issues.** None recorded.
**Tests.** tests/unit/psbtMultisig.test.js, tests/unit/send-psbtMultisig-branches.test.js, tests/unit/cosign.test.js, tests/unit/multisig-hd-wallet.test.js, tests/unit/multisig-hd-wallet-guard.test.js, tests/integration/multisig-hd-wallet.test.js, tests/e2e/multisig.spec.js (Detox: the vault signs its share of a PSBT another cosigner signed, completing the 2-of-3 quorum).
**Source.** screen/send/psbtMultisig.js, screen/send/psbtMultisigQRCode.js, screen/send/details.js, screen/wallets/home.js, screen/wallets/asset.js, class/wallets/multisig-hd-wallet.js

## S-06 QR scanner

**Routes:** ScanQRCode
**Entry:** Scan buttons
**Tier:** Critical

**Inputs.** Camera; gallery image (decoded by rn-qr-generator; no QR → "We were unable to find a QR Code in the selected image…"); file import only when the caller sets `showFileImportButton`; NFC button reads a BoltCard, not a PSBT.

**Options.** Animated QR: BC-UR v2 for `UR:CRYPTO-PSBT`, `UR:CRYPTO-ACCOUNT`, `UR:CRYPTO-OUTPUT` and multipart `UR:BYTES`; legacy URv1 for other `UR…` strings, with progress "please continue scanning" n/N. Electrum-desktop Base43 PSBT QRs are converted to base64. Duplicate frames are de-duplicated by hash.

**Behavior.** Full-screen modal scanner used by PSBT, broadcast and address tools. Bad UR fragment shows "Invalid animated QRCode fragment. Please try again." with alert title key `send.scan_error`, which is missing from loc/en.json (title likely empty or undefined; Not verified in code.). Camera permission: if blocked, at most once per 7 days shows "Camera Permission Required" / "Permission is currently denied…" with Open Settings. On Android the NFC hold-card modal is shown; on desktop the modal is contained.

**Not supported.** Using the NFC button to import a PSBT.

**Depends on.** Camera permission hook; react-native-camera-kit-no-google; rn-qr-generator; BC-UR; react-native-image-picker / permissions.

**Known issues.** None recorded.
**Tests.** tests/unit/CosignerCamera.test.js, tests/e2e/scan.spec.js (Detox, through the scanner's manual-entry field), `tests/e2e/spark.spec.js` (Detox: a scanned Lightning invoice opens the Lightning payment screen), CF-09
**Source.** screen/send/ScanQRCode.js, hooks/cameraPermisions.hook.ts, navigation/index.tsx

## S-07 Broadcast raw transaction

**Routes:** Broadcast
**Entry:** Settings, Tools
**Tier:** Nice

**Inputs.** Paste field for transaction hex; "Scan or open file" opens the scanner with file import. Non-base64 scanned text is used as hex. A base64 PSBT is accepted only if already finalized; otherwise it is silently ignored.

**Options.** Status cycles through "Insert Transaction Hex", Pending, Success and Error. On success, "Open link in explorer" opens the mempool.space transaction page.

**Behavior.** Title "Broadcast". Entry is Settings › Tools › "Broadcast Transaction". Broadcast uses a throwaway HDSegwitBech32Wallet via Electrum. On success shows "Success! Your transaction has been broadcasted!" and registers the txid for push notifications. Thrown errors appear as an alert with the raw message. No biometric gate and no wallet association. The button is disabled while pending or empty.

**Not supported.** Broadcasting a non-finalized PSBT (silently ignored); tying the broadcast to a specific wallet.

**Depends on.** Electrum; ScanQRCode with file import; mempool.space explorer link; push-notification registration.

**Known issues.** None recorded.
**Tests.** None.
**Source.** screen/send/broadcast.js, screen/settings/tools.js, screen/settings/settings.js

## S-08 Is it my address

**Routes:** IsItMyAddress
**Entry:** Settings, Tools
**Tier:** Nice

**Inputs.** Pasted or scanned address; `bitcoin:` prefix and query are stripped.

**Options.** "Clear"; "View QRCode" opens ReceiveDetails for that address.

**Behavior.** Entry is Settings › Tools › "Is it my address?". Each wallet’s `weOwnAddress` is checked. Result is "{label} owns {address}" per matching wallet, or "None of the available wallets own the provided address."

**Not supported.** Nothing further beyond address ownership check against wallets already in the app.

**Depends on.** Wallet `weOwnAddress` implementations; optional ScanQRCode; ReceiveDetails for the QR view.

**Known issues.** None recorded.
**Tests.** None.
**Source.** screen/send/isItMyAddress.js, screen/settings/tools.js
