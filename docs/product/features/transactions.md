# Transactions

On-chain (and shared) transaction history on the wallet screen, transaction status and details, fee bump and cancel (RBF / CPFP), and the automatic fiat rates and network fee estimates those screens use.

## T-01 Transaction list

**Routes:** none
**Entry:** Wallet screen
**Tier:** Critical

**Inputs.** None. The list has no search and no type filter.

**Options.** Row long-press: "Copy Amount", "Copy Note", "Copy Transaction ID", "Copy Block Explorer Link", "View in Block Explorer", "Expand Note". Header: tap balance to cycle BTC → sats → fiat; "Show Balance" / "Hide Balance" (may be biometric-gated); copy balance. With hide balance on, title, subtitle and amount show as `*****`.

**Behavior.** Lives on the wallet asset screen (`WalletAsset`), opened from home per wallet. Rows show "Pending" at 0 confirmations, else a relative time; subtitle "Conf: {number}" while confirmations < 7, plus local memo and any item memo; amount in the wallet’s preferred unit (green incoming, foreground outgoing); icons for pending, outgoing, incoming, on-chain, off-chain paid, or expired invoice. Tap a row with a hash opens TransactionStatus; Lightning invoice rows without a hash open the Lightning invoice view. Newest first by `received`. First page 15 rows, then infinite scroll pages of 20, 40, 80, … (doubling). Footer spinner while more rows remain. No pull-to-refresh; refresh is automatic via a 20 s `refreshAllWalletTransactions` loop (skipped when Electrum is disabled, the device is offline, or the last success was under 40 s ago), restarted on foreground and stopped on background. While refreshing, the header shows "Updating...". Empty state: "Your transactions will appear here", or the Lightning empty copy for non-Spark OFFCHAIN wallets. Lightning and Spark wallets share this list; their row semantics belong to the Lightning inventory. Explorer links are hard-coded to `https://mempool.space/tx/<txid>`.

**Not supported.** Pull-to-refresh; per-list search or type filter; configurable block explorer.

**Depends on.** Electrum / wallet transaction refresh; fiat rate when the preferred unit is fiat; cached transactions when the server is unreachable (refresh errors are only logged).

**Known issues.** The 20 s refresh loop does not start at launch: a wallet opened in the first 40 s after start shows no history and a stale balance until Home is focused again later (reproduced on an Android emulator; the e2e specs wait for this).

**Tests.** tests/unit/asset-dfx-services.test.js, tests/e2e/transactions.spec.js (Detox: the two newest rows are in chain order), tests/e2e/onchain-send.spec.js (funded wallet). CF-02, CF-03.

**Source.** screen/wallets/asset.js, components/TransactionListItem.js, components/TransactionsNavigationHeader.js, blue_modules/storage-context.js, navigation/WalletsStack.tsx

## T-02 Transaction status and details

**Routes:** TransactionStatus, TransactionDetails
**Entry:** Transaction row
**Tier:** Critical

**Inputs.** On TransactionDetails: editable memo ("Note to Self" placeholder). Save writes local `txMetadata` and alerts "Transaction note has been successfully saved."

**Options.** TransactionStatus header "Details" opens TransactionDetails. On details: copy per address; if any local wallet owns the address, highlight and "View {walletLabel}" (navigates to `WalletTransactions`; whether that shows the overview instead of the intended wallet is Not verified in code.). "View in Block Explorer" and long-press "Copy Link" use `https://mempool.space/tx/<txid>`. Errors: "Unable to open the link with the default browser. Please change your default browser and try again." or the raw error. Continuity may publish a `ViewInBlockExplorer` activity with that URL when enabled.

**Behavior.** Status (from a list row with a hash) shows amount in the wallet’s preferred unit, memo, direction icon (pending / outgoing / incoming), for outgoing the first output address under "To", fee as inputs minus outputs in sats, confirmations as "{confirmations} confirmations" capped at "6+", and an ETA line; values respect hide-balance. While unconfirmed, Electrum is polled after 1 s then every 31 s; ETA uses the same four `eta_*` strings as receive. On first confirmation: success haptic, ETA clears, polling stops, wallet refreshes. Action eligibility (only when `wallet.allowRBF()` and effectively only plain `HDsegwitBech32`): CPFP "Bump Fee" for incoming unconfirmed; RBF "Bump Fee" for outgoing unconfirmed with RBF sequence and no external inputs; "Cancel Transaction" when RBF bump applies and at least one output is not owned. A spinner shows while checks run; nothing renders when an action is not possible. If both CPFP and RBF bump apply, both buttons would share the label "Bump Fee".

Details shows, when present: memo, unique input addresses ("Input") with copy-all, output addresses minus inputs ("Output") with copy-all, fee in sats, transaction ID with copy, received date, block height, input/output counts. The memo is local app storage only; it is not on-chain. Whether it syncs across devices: Not verified in code.

**Not supported.** Configurable block explorer; RBF/CPFP actions for multisig, watch-only, legacy/P2SH, taproot, Lightning, and non-plain HDSegwitBech32 subclasses (checks fail closed).

**Depends on.** Electrum for confirmation polling and RBF/CPFP eligibility; mempool.space fee API (with Electrum fallback) for ETA; fiat rate when the unit is fiat.

**Known issues.** #207 Transaction Status confirmation poll never fires

**Tests.** No unit tests for these screens; tests/e2e/transactions.spec.js and tests/e2e/onchain-send.spec.js (Detox: value for the wallet, fee and confirmations match a public explorer for the transaction ID shown in Details); CF-02.

**Source.** screen/transactions/transactionStatus.js, screen/transactions/details.js, components/TransactionListItem.js, class/hd-segwit-bech32-transaction.js, navigation/WalletsStack.tsx

## T-03 Fee bump and cancel (RBF, CPFP)

**Routes:** RBFBumpFee, RBFCancel, CPFP
**Entry:** Transaction status
**Tier:** Important

**Inputs.** Fee suggestion picker: Fast (~10m), Medium (~3h), Slow (~1d) from recommended fees, plus Custom sat/vB (digits only, max 9 characters). Fast is preselected. Minimum is original fee rate + 1, shown as "The total fee rate (satoshi per vByte) you want to pay should be higher than {min} sat/vByte." "Create" stays disabled until the new rate is above the minimum.

**Options.** After creation: signed tx hex ("This is your transaction’s hex—signed and ready to be broadcasted to the network."), "Copy", "Verify on coinb.in", then "Send now" (disabled when Electrum offline mode is on).

**Behavior.** Opened only from TransactionStatus with `{txid, wallet}`. Each screen re-checks `wallet.type === HDSegwitBech32Wallet.type` and the same predicates as status (RBFBumpFee drops the bump-tx helper check). Failure: "This transaction is not bumpable." (CPFP / RBF bump) or "This transaction is not replaceable." (cancel). Explanatory copy: CPFP / RBF bump / cancel explain strings. RBF bump reuses the same UTXOs and targets (recalculates amount if the original was send-max) and increments sequence. RBF cancel sends all inputs to our change address. CPFP spends our unconfirmed outputs to our change address; child fee rate is raised until the package average meets the target. None can add extra UTXOs when the fee is too high; creation errors show as "Error: <message>". Broadcast pings Electrum, waits for connection, then `broadcastTx`; failure alerts "Broadcast failed." or the error message. On success memos (hard-coded English): CPFP stores "Child pays for parent (CPFP)" and subscribes the new txid for push; RBF bump copies the old memo; RBF cancel stores "Cancelled: <memo>" or "Cancelled transaction". Then the Success screen; wallet refresh after 4 s. If RBFBumpFee/RBFCancel mount checks throw, the screen may stay on the spinner: Not verified in code.

**Not supported.** Fee bump/cancel for wallet types other than plain HD Segwit Bech32; adding extra UTXOs when the fee cannot be met; broadcast while Electrum offline mode is enabled.

**Depends on.** Electrum (construction checks, broadcast); mempool.space recommended fees with Electrum / hard-coded fallback; push subscription for CPFP child txid.

**Known issues.** None recorded.

**Tests.** tests/integration/hd-segwit-bech32-transaction.test.js (live Electrum; not in PR CI). No unit or UI tests for the three screens. No covering flows.

**Source.** screen/transactions/RBFBumpFee.js, screen/transactions/RBFCancel.js, screen/transactions/CPFP.js, class/hd-segwit-bech32-transaction.js, BlueComponents.js, models/networkTransactionFees.js

## T-04 Fiat rates and fee estimates

**Routes:** none
**Entry:** Automatic
**Tier:** Important

**Inputs.** None on these screens; preferred currency is chosen under Settings → Currency (default USD, or the device currency if supported).

**Options.** Fifty-five fiat units in `models/fiatUnits.json`, each with a named rate source: Bitstamp (USD, EUR, GBP); CoinGecko (32 currencies including CHF, AUD, CAD, JPY, BRL, …); CoinDesk (13 including CNY, COP, ISK, KES, …); Yadio (ARS, CLP, VES); YadioConvert (LBP); wazirx (INR); Exir (IRR, IRT). Settings → Currency shows source, rate and last updated; changing currency alerts on fetch failure via `settings.currency_fetch_error`.

**Behavior.** `updateExchangeRate()` fetches at most every 30 minutes with a 10 s debounce, at startup, on app foreground, and when the currency is changed. On failure the stored rate is kept and flagged error; a rate is outdated after 31 minutes or after an error. Outdated rates are surfaced on the send-side amount input, not on receive. In this area, rates feed receive fiat entry and pending/received amounts, and list/status amounts when the unit is fiat.

Network fee estimates: `recommendedFees()` tries mempool.space `/api/v1/fees/recommended` first (fastest is +1 sat/vB; medium halfHour; slow hour). On failure, Electrum `estimateFees`; on failure again, hard-coded 2/1/1 sat/vB. The fee picker first shows cached fees from AsyncStorage. These estimates drive receive and status ETA lines and the RBF/CPFP fee suggestions.

**Not supported.** Configurable rate provider per currency beyond the built-in source map; configurable block-explorer fee endpoint.

**Depends on.** The fiat provider HTTP APIs named above; mempool.space fee API; Electrum as fee-estimate fallback.

**Known issues.** None recorded.

**Tests.** tests/unit/currency.test.js, tests/integration/Currency.test.js (live APIs; not in PR CI). No covering flows.

**Source.** blue_modules/currency.js, models/fiatUnits.json, models/fiatUnit.ts, models/networkTransactionFees.js, screen/settings/currency.js, BlueComponents.js
