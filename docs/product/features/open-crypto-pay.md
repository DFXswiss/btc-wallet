# OpenCryptoPay

Paying an OpenCryptoPay (OCP) payment request detected from a scanned or pasted LNURL. Lightning is preferred when a Lightning wallet can cover the amount; otherwise the on-chain commit screen builds a signed transaction and hands it to the OCP provider.

## O-01 Pay an OpenCryptoPay request

**Routes:** OpenCryptoPayCommitOnchain
**Entry:** Scanned payment request
**Tier:** Important

**Inputs.** An LNURL whose GET reply has `standard === "OpenCryptoPay"` with `transferAmounts` per method (`Lightning`, `Bitcoin`), `quote.id`, `callback`, LNURL-pay style `minSendable`/`metadata`, and optional `recipient`. Detection is by reply content, not URI prefix: any LNURL path (`lightning:LNURL...`, `dfxtaro:lightning:`, bare LNURL, `lightning=` URL param) goes through `LnurlNavigationForwarder`, which checks `isOpenCryptoPayResponse` before normal LNURL handling. Loader texts: `lnd.lnurl_loader_title`, `lnd.lnurl_loader_text`, `lnd.lnurl_loader_text_onchain`.

**Options.** Method selection order: (1) if neither Lightning nor on-chain BTC is offered → "Unsupported lnurl", error reported, go back; (2) Lightning first — user's Lightning wallet (LDS, then custom LNDHub, then Spark) if balance > requested sats → `LnurlPay` with BOLT11 from `callback?quote=<id>&asset=BTC&method=Lightning` (`free` when the callback host is a DFX domain, fee waived only for LNDHub-type wallets); (3) else on-chain — main wallet if balance > requested sats and it is a `LegacyWallet` subclass → `OpenCryptoPayCommitOnchain`; (4) else if any Lightning wallet exists (insufficient balance) → `LnurlPay` anyway; (5) else "Unsupported lnurl". Observed edge: `getLightningPaymentRequestDetails()` dereferences Lightning `minFee` without a guard and runs before the on-chain branch, so an on-chain-only OCP request may throw and go back before the on-chain path (runtime: Not verified in code.).

**Behavior.** On-chain preparation in the forwarder: fetch recipient via `callback?quote=<id>&asset=BTC&method=Bitcoin` (BIP21 `uri` → address/label); refresh UTXOs; build and sign a tx for exactly the requested sats at fee rate `ceil(OCP minFee)`, non-RBF (`finalRBFSequence`), change to the next free internal address; memo = BIP21 label. Confirm screen: amount in BTC + local fiat, "To" address, optional "Memo", "Fee" line; header "Details" → `CreateTransaction` (biometric unlock first if enabled); title "Confirm". "Send now" does **not** broadcast: the app posts hex, txid, `asset=BTC`, `method=Bitcoin`, and `quote` to the OCP tx endpoint (callback path `/cb/` replaced by `/tx/`). The provider is expected to broadcast (server-side: Not verified in code.). Success: haptic + `Success` with amount and fee. Error (reply `error` or network failure): red "Payment request failed. Please try again." and the button becomes "Scan again" → `ScanCodeSendRoot`. Error details are logged, never shown.

**Not supported.** Fee selection or RBF for OCP on-chain; non-BTC assets; paying from a non-main on-chain wallet; displaying `recipient` contact data (parsed but unused).

**Depends on.** Network access to the merchant's OCP provider; bitcoinjs-lib; Electrum for UTXOs; Lightning wallet helper for the Lightning path; `LnurlNavigationForwarder` / Scan / deep-link LNURL entry.

**Known issues.** None recorded.

**Tests.** None.

**Source.** class/open-crypto-pay.ts, screen/open-crypto-pay/openCrytoPayCommitOnchain.tsx, screen/lnd/lnurlNavigationForwarder.tsx, helpers/lightning-wallet.ts, helpers/freeLightningDomains.ts, class/deeplink-schema-match.js, navigation/SendDetailsStack.tsx
