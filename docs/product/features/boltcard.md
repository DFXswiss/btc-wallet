# Boltcard

NFC "Pay Card" programming and management for the lightning.space (LDS) Lightning wallet: create and write an NTAG424 DNA card, set limits, pause or delete, back up keys, and inspect a tapped card. Spark and custom LNDHub wallets have no Boltcard entry point.

## B-01 Create and program a card

**Routes:** AddBoltcard, WrittenCardError
**Entry:** Wallet screen, Cards, Add
**Tier:** Important

**Inputs.** Physical NTAG424 DNA NFC card or ring. Create needs an LDS wallet with a Lightning address (`lnAddress`) and admin key. Keys are derived deterministically from the main wallet's DFX ownership proof (not random): K0 = sha256(`k0-seed-<proof>`)[0..32], K1=K3 and K2=K4 from matching seeds. Defaults at create: `tx_limit` 100000, `daily_limit` 100000 (sats; unit on the server side: Not verified in code.), counter 0. Card name is set to `<lnAddress prefix> PAY CARD`; UID is the physical tag UID.

**Options.** None at creation: no wallet picker, no custom limits, no custom name.

**Behavior.** On the LDS wallet screen, the "Pay Card" header button opens `AddBoltcard` when the wallet has no cards (otherwise `BoltCardDetails`). On mount the screen resolves the LNDHub invoice URL via LDS `getUser` if missing, then syncs the local card list with the server (drop local-only, fetch secrets for server-only). UI: how-to text "To create your first Pay Card, tap the \"Create\" button and hold your compatible NFC card or ring until all keys are set.", button "Create", title "Create Pay Card".

On "Create", a six-step progress sequence: (1) start NFC with "Please tap and hold your card" and read UID; (2) generate fresh card details; (3) `POST /boltcards/cards` with admin key; (4) `GET /boltcards/auth?a=<otp>` for secrets including `lnurlw_base`; (5) write NDEF URI, set SUN/SDM, change keys 1–4 then key 0, self-test p/c against UID; (6) save on the LDS wallet and persist. Success navigates to `BoltCardDetails` with `boltcardUid` after 2 s. iOS shows progress in the system NFC sheet; Android shows in-app `HoldCardModal` with cancel. Card API base is config `REACT_APP_LDS_URL`, or `REACT_APP_LDS_DEV_URL` when feature flag `ldsDEV` is on; reads use the invoice key, writes the admin key (`X-Api-Key`).

If create fails with `AUTH_FAILED` / code `91ae` or `OTHERS` / code `6982` (card already keyed), navigates to `WrittenCardError`. That screen explains the card already has keys, offers "Scan Backup" (QR must be JSON with k0–k4, else alert "Invalid backup data"), then "Start NFC" to wipe with those secrets and return to `AddBoltcard` after 2 s. Wipe errors are swallowed. Other create errors are reported to error tracking only; no user alert. Behaviour on a device without NFC: Not verified in code.

**Not supported.** Backing wallet other than LDS; choosing limits or name at creation; card types other than NTAG424 DNA (ISO-DEP).

**Depends on.** NFC hardware and permissions (`NFCReaderUsageDescription` on iOS; `android.permission.NFC` on Android); LDS boltcards API; main-wallet ownership proof for key derivation; an existing LDS wallet.

**Known issues.** None recorded.

**Tests.** tests/unit/asset-dfx-services.test.js (Pay Card button → AddBoltcard when no cards). No covering flows.

**Source.** screen/boltcard/add.tsx, screen/boltcard/writtenCardError.tsx, api/boltcards/hooks/ntag424.hook.ts, api/boltcards/hooks/bolcards.hook.ts, api/boltcards/hooks/api.hook.ts, api/boltcards/definitions/urls.tsx, class/wallets/lightning-lds-wallet.ts, class/Ntag424.js, contexts/wallet.context.tsx, screen/wallets/asset.js, navigation/WalletsStack.tsx

## B-02 Card details, limits, pause, delete

**Routes:** BoltCardDetails, DeleteBoltcard
**Entry:** Wallet screen, card
**Tier:** Important

**Inputs.** Edit form: "Card Name", "Tx Limit", "Daily Limit" (amount inputs via `useInputAmount`, stored in sats). Delete confirms with switch "Also reset my card." (default on).

**Options.** Actions row (hardcoded English): "Add" → `AddBoltcard`; "Edit"/"Txs" toggle; "Pause"/"Activate"; "Delete" → `DeleteBoltcard` with `boltcardUid`. Horizontal carousel when the wallet has multiple cards (no maximum found in code; server-enforced maximum: Not verified in code.).

**Behavior.** Title "Pay Card Details". Each card shows UID, name, tx limit, daily limit, and active state. "Update" sends `PUT /boltcards/cards/<id>` with admin key; only non-empty / >0 fields are overridden. Pause/activate calls `GET /boltcards/cards/enable/<id>/<true|false>`. While the screen is open, hits poll every 5 s via `GET /boltcards/hits` (invoice key), reversed, `amount > 0`, filtered to the selected card, cached as `cachedHits`. Update errors are reported only; enable toggle has no try/catch.

Delete screen title "Delete Pay Card": "Are you sure you want to delete this card?", shows UID, how-to text, lost-card note, button "Yes, delete this card". With wipe on: NFC session, UID must match or throws "Card UID mismatch" (reported only), then wipe (reset file settings, keys back to all-zero version 00, empty NDEF). Then `DELETE /boltcards/cards/<id>`; server failure is reported but local deletion proceeds. Navigates to the last remaining card's details, or `WalletTransactions` if none. With wipe off (lost card): server + local delete only.

**Not supported.** Managing cards for non-LDS wallets.

**Depends on.** LDS boltcards API; NFC when wiping on delete; LDS wallet `boltcards` list.

**Known issues.** None recorded.

**Tests.** tests/unit/asset-dfx-services.test.js (Pay Card button → BoltCardDetails when cards exist). No covering flows.

**Source.** screen/boltcard/details.tsx, screen/boltcard/delete.tsx, screen/boltcard/BoltCardsCarousel.tsx, components/BoltCardUI.tsx, api/boltcards/hooks/bolcards.hook.ts, api/boltcards/hooks/ntag424.hook.ts, class/wallets/lightning-lds-wallet.ts, navigation/WalletsStack.tsx

## B-03 Card backup

**Routes:** BackupBoltcard
**Entry:** Wallet details
**Tier:** Nice

**Inputs.** None. Reads the legacy single-card field `ldsWallet.getBoltcard()`.

**Options.** None.

**Behavior.** Title "Backup Pay Card". Shows a QR of JSON `{action:"wipe", k0, k1, k2, k3, k4, version:1}` — no UID, no LNURL, no server data. The wallet-details "Backup Pay Card Details" button appears only when `wallet.getBoltcard()` is set. Cards created via the current multi-card flow use `addBoltcard` and never set the legacy field, so this entry is hidden for them (observed from code; runtime: Not verified in code.). An equivalent wipe-backup QR is also shown on `TappedCardDetails` when the tapped card's keys derive from this wallet and all keys are written. Keys are deterministic from the main wallet's ownership signature, so the tap-reader can re-derive them without this backup.

**Not supported.** Backing up a card that exists only in the multi-card `boltcards` list via this screen.

**Depends on.** Legacy `boltcard` field on `LightningLdsWallet`; main-wallet ownership proof for key re-derivation elsewhere.

**Known issues.** None recorded.

**Tests.** tests/unit/wallet-details-spark.test.js (BackupBoltcard navigation). No covering flows.

**Source.** screen/boltcard/backup.tsx, screen/wallets/details.js, class/wallets/lightning-lds-wallet.ts, screen/wallets/tappedCardDetails.tsx, navigation/WalletsStack.tsx

## B-04 Tap a card

**Routes:** TappedCardDetails
**Entry:** Scanner, NFC button
**Tier:** Important

**Inputs.** NFC read payload from `ScanQRCode`: UID, key versions K0–K4, NDEF URI as `lnurlw_base`. Detected when the JSON has any of `lnurlw_base`, `uid`, `k0Version`…`k4Version` (`BoltCard.isPossiblyBoltcardTapDetails`). Auth tries the wallet-derived key when version is `01`, else the zero key; `91ae` means not this wallet's card.

**Options.** On the details screen, when gated: "Create Pay Card" (empty card + LDS wallet) → `AddBoltcard`; "Send to Card" (LNURLp + LDS wallet) → `ScanLndInvoice` with the bech32 LNURL-pay; "Reset card" (my card, unregistered) → wipe; "Unregister and reset card" (my card, registered) → wipe, server DELETE, local delete (errors ignored).

**Behavior.** Home and wallet Scan buttons open `ScanQRCode`, which has an "NFC" control; a Boltcard-like payload navigates to `TappedCardDetails`. Title "Pay Card Details". Derived state: empty (all key versions `00`), written (all `01`), written with errors (mix), "derived from my wallet" when secrets authenticate. If `lnurlw_base` is present, fetches LNURL-withdraw and LNURL-pay for min/max amounts and marks registered. If an LDS wallet exists and secrets are known, matches server cards by `external_id` and requires UID and key equality. Displayed: UID (copy), card state, "Is it my card?", server status, LNURLw/LNURLp ranges, K0–K4 (copyable), wipe-backup QR when applicable.

Separately, on `LNDReceive` / `LNDViewInvoice`, an NFC tag whose payload starts with `lnurlw` runs `BoltCard.widthdraw` (LNURL-withdraw callback with the invoice). Any Boltcard-compatible card works, not only this wallet's. Android listens automatically once an invoice exists; iOS needs the hardcoded "Use Boltcard" button. Disabled for Spark wallets on `LNDReceive`.

**Not supported.** Using Boltcard withdraw on Spark receive; non-NTAG424 cards.

**Depends on.** NFC; LDS wallet for create/send/unregister actions; merchant/card LNURL endpoints for withdraw and pay probes; ScanQRCode NFC path.

**Known issues.** None recorded.

**Tests.** tests/unit/tapped-card-details.test.js, tests/unit/asset-dfx-services.test.js, tests/unit/spark-home.test.js. No covering flows.

**Source.** screen/wallets/tappedCardDetails.tsx, screen/send/ScanQRCode.js, class/boltcard.ts, api/boltcards/hooks/ntag424.hook.ts, screen/lnd/lndReceive.tsx, screen/lnd/lndViewInvoice.js, screen/wallets/home.js, screen/wallets/asset.js, navigation/WalletsStack.tsx
