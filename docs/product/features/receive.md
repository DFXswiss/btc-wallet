# Receive

On-chain receive addresses, BIP21 payment requests with optional amount and label, live watching for an incoming payment, and Azteco voucher redeem (not reachable in the current build).

## R-01 Receive on-chain

**Routes:** ReceiveDetails
**Entry:** Wallet screen, Receive (home Receive: multi-device wallet first, else the main wallet when no Lightning wallet exists)
**Tier:** Critical

**Inputs.** Optional amount (placeholder hard-coded as "Amount (optional)"); unit cycles BTC → sats → local fiat → BTC, default sats, accessibility label "Change input currency". Max length 11 characters in BTC, 15 in sats or fiat. Comma becomes a dot; non-digits are stripped. Fiat amounts convert with the stored exchange rate. Optional label (placeholder "Description (optional)", testID `CustomAmountDescription`).

**Options.** Wallet switcher at the top (`BlueWalletSelect`). Long-press on the QR: "Share" (PNG of the QR on every platform); "Copy" copies the QR image on iOS/macOS only. Text "Share" button shares the BIP21 string. Copy text below the QR is the plain address, or the full BIP21 string once an amount or label is set.

**Behavior.** Shows a receive address and QR for an on-chain wallet. From the wallet asset screen Receive FAB when `wallet.allowReceive()` (non-OFFCHAIN wallets). Home Receive opens this screen for the multi-device wallet when one exists; otherwise it opens Lightning receive when a Lightning wallet exists, and only then this screen for the main wallet. Also opened from an address in WalletAddresses, from Send → "Is it my address" → view QR (address, no walletID), from a push notification with payload type 3, and from Continuity activity `ReceiveOnchain` when enabled.

If an address is passed in, it is shown as-is. Otherwise for ONCHAIN wallets the screen races `getAddressAsync()` against a 1000 ms timeout; on timeout, error, or Electrum offline mode it falls back to the locally derived next free index without contacting the server. HD wallets scan from `next_free_address_index` up to gap limit 20 for the first address with no history (a lookup error counts as free); if none is free in the window, the next unchecked address is returned. Non-HD wallets show their single address. Newly created wallets are BIP84 bech32 (`bc1q`); imported wallets use the address format of their class. Opening the screen marks the wallet export as saved, requests notification permission, and triggers a balance revalidation.

The QR encodes `bitcoin:<address>`, or a BIP21 URI with amount (BTC) and/or label via `bip21encode`. Amount ≤ 0 is dropped; a label that is empty after removing one space is dropped. No `pj=` (payjoin) parameter. After amount or label is cleared, the copy text returns to the bare address but the QR may keep the previous BIP21 URI (stale `bip21encoded`). There is no address-reuse warning and no explicit "new address" button.

A poll every 5 s via Electrum balance-by-address watches for payment. When unconfirmed > 0: pending view with "Pending {amt1} ({amt2})", ETA (`"ETA: In ~9 minutes"` / `"ETA: In ~10 to 30 minutes"` / `"ETA: In ~30 minutes to 3 hours"` / `"ETA: In ~1 day"`), heavy haptic, poll interval 25 s. When unconfirmed returns to 0 and confirmed balance grew: success view `"+{amt1} ({amt2})"`, success haptic, poll stops, wallets refresh. If unconfirmed returns to 0 without a confirmed gain, the address view returns. Poll errors are only logged. Switching to another on-chain wallet resets watcher and input state; switching to Lightning navigates to Lightning receive (or POS receive in POS mode). Header title "Receive". Android hardware back closes the screen. KeyboardAvoidingView is disabled on iPad.

**Not supported.** Payjoin receive; BIP21 `lightning=` unified QR on this screen; address-reuse warning; explicit new-address control (next free address is automatic). Home Receive skips this screen for the main wallet when a Lightning wallet exists.

**Depends on.** Electrum (address history, balance and mempool polling, tx vsize); mempool.space fee API with Electrum fallback for ETA; fiat rate for amount display and fiat entry.

**Known issues.** None recorded.

**Tests.** tests/unit/receive-details.test.js, tests/unit/useInputAmount.test.js, tests/unit/deeplink-schema-match.test.js, tests/e2e/onchain.spec.js (Detox: mainnet address, BIP21 with amount and label). CF-01, CF-02.

**Source.** screen/receive/details.js, components/QRCodeComponent.tsx, hooks/useInputAmount.ts, class/deeplink-schema-match.js, class/wallets/abstract-hd-wallet.ts, class/wallets/abstract-wallet.ts, models/networkTransactionFees.js, navigation/ReceiveDetailsStack.tsx, screen/wallets/asset.js, screen/wallets/home.js

## R-02 Azteco voucher redeem

**Routes:** AztecoRedeem
**Entry:** Not reachable in the current build
**Tier:** Nice

**Inputs.** Voucher as four code groups `c1`–`c4` from URL query params. Target wallet selectable via SelectWallet (default `wallets[0]`, no chain filter).

**Options.** Change target wallet on the redeem screen ("Redeem to wallet").

**Behavior.** Not reachable in the current build. The only upstream entry, the `https://azte.co` deep link, is commented out; no other navigation reaches this screen. If opened, the screen shows "Your voucher code is" and the target wallet. Redeem fetches `toWallet.getAddressAsync()`, then GETs the Azte.co despatch endpoint with the four codes and the address. HTTP 200 is success ("Success"). Failures show "Something went wrong. Is this voucher still valid?". With no wallets: "Before redeeming, you must first add a Bitcoin wallet." Dead-code defects: a second SelectWallet call passes an undefined wallet context; there is no chain check, so an off-chain wallet could be selected.

**Not supported.** Any in-app entry path in this fork.

**Depends on.** Azte.co HTTP API.

**Known issues.** None recorded.

**Tests.** tests/unit/deeplink-schema-match.test.js (documents the Azte.co deep-link entry is disabled). No screen or `class/azteco.js` tests. No covering flows.

**Source.** screen/receive/aztecoRedeem.js, class/azteco.js, class/deeplink-schema-match.js, navigation/AztecoRedeemStack.tsx
