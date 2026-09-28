# Wallets

On-chain wallet lifecycle: create and import, recovery-phrase backup, the home and per-wallet screens, details and delete, XPUB and address lists, message signing, BIP47 payment codes, wallet picker/reorder, and multi-device (multisig) create, import, and cosigner export. The app treats `wallets[0]` as the main on-chain wallet (home On-Chain row, DFX ownership proof, backup banner, multisig own key, and delete-everything). The home layout is three fixed rows (Multi-Device, On-Chain, Lightning), not a free wallet list. Default label for new or imported single-sig wallets is "Bitcoin On-Chain". Many options depend on Advanced mode (Settings → General): type picker and entropy on create, passphrase and search-accounts on import, custom quorum and format for multisig, master fingerprint and derivation path in details.

| Class | User-facing type | Creatable / import only / internal |
|---|---|---|
| AbstractWallet, AbstractHDWallet, AbstractHDElectrumWallet | base classes | internal |
| HDSegwitBech32Wallet | HD SegWit (BIP84 Bech32 Native) — On-Chain Wallet | creatable (the only created single-sig type); importable |
| HDSegwitP2SHWallet | HD SegWit (BIP49 P2SH) | import only (create type picker is inert) |
| HDLegacyP2PKHWallet | HD Legacy (BIP44 P2PKH) | import only |
| HDLegacyBreadwalletWallet | HD Legacy Breadwallet (P2PKH), m/0' | import only (12-word, no passphrase) |
| HDLegacyElectrumSeedP2PKHWallet | HD Legacy Electrum (BIP32 P2PKH) | import only (Electrum seed) |
| HDSegwitElectrumSeedP2WPKHWallet | HD Electrum (BIP32 P2WPKH) | import only (Electrum seed) |
| SLIP39LegacyP2PKH, SLIP39SegwitP2SH, SLIP39SegwitBech32 | SLIP39 on-chain | import only (multi-line shares) |
| LegacyWallet | Legacy (P2PKH) | import only (WIF); also deserialization fallback |
| SegwitP2SHWallet | SegWit (P2SH) | import only (WIF) |
| SegwitBech32Wallet | P2 WPKH | import only (WIF) |
| WatchOnlyWallet | Watch-only | effectively unavailable (discovery drops it; ImportSpeed backdoor only) |
| HDAezeedWallet | HD Aezeed | import disabled; loadable from storage; selftest only |
| MultisigHDWallet | Multisig Vault — Multi-Device Wallet | creatable (2-of-n) and importable |
| TaprootWallet | P2 TR | internal helper; not deserialized |
| LightningCustodianWallet | Lightning (LNDHub) | legacy / Lightning area |
| LightningLdsWallet | Lightning (lightning.space) | Lightning recovery / Lightning area |
| TaprootLdsWallet | Taproot (CHF Taproot) | Lightning area (`AddLightning`, LDS DEV flag) |
| SparkWallet | Lightning (Spark) | home Lightning Add or import recovery; Lightning area |

## W-01 Create on-chain wallet

**Routes:** AddWallet, ProvideEntropy
**Entry:** First launch; after deleting the main wallet
**Tier:** Critical

**Inputs.** No user seed input on the default path. Create always builds an `HDSegwitBech32Wallet` (BIP84 native SegWit, `m/84'/0'/0'`) from 16 random bytes → a 12-word BIP39 mnemonic. In Advanced mode, Provide Entropy accepts coin (1 bit), d6, or d20 rolls; missing bits are filled from the system RNG and yield a 24-word mnemonic (32 bytes). Button labels use "N bytes of generated entropy…" (`wallets.add_entropy_remain` / `add_entropy_generated`).

**Options.** Disclaimer text ("Please note that by using this self-custodial wallet you automatically accept the disclaimer.") opens `REACT_APP_DISCLAIMER_URL` when configured. "Create" and "Import wallet" (opens ScanImport). Advanced mode shows a wallet-type picker (HD SegWit BIP84, SegWit P2SH, HD SegWit BIP49 P2SH) and the entropy link — the picker has no effect: `selectedIndex` is never read by create, so BIP84 is always created. The LNDHub / off-chain branch is dead (`ButtonSelected` only has ONCHAIN).

**Behavior.** After create: signs a DFX address-ownership proof with the first receive address, saves the wallet, and replaces the stack with `WalletsRoot` / `WalletTransactions`. There is no forced backup gate; the home backup banner prompts later. Errors surface as `alert(e.toString())` and unlock the screen. Entry is first-run when no wallets exist, or after deleting the main wallet (app resets to `AddWalletRoot`). The only other `navigate('AddWalletRoot')` callers live in dead `drawerList.js`.

**Not supported.** Choosing a non-BIP84 type on create; creating an LNDHub wallet from this screen; forced backup before leaving create.

**Depends on.** DFX auth sign-message (ownership proof). No Electrum call at create.

**Known issues.** None recorded.

**Tests.** `tests/unit/wallets-add.test.js`, `tests/unit/provide-entropy.test.js`, `tests/unit/wallet-created-route.test.js`; CF-01.

**Source.** screen/wallets/add.js, screen/wallets/provideEntropy.js, class/wallets/abstract-hd-electrum-wallet.ts, helpers/wallet-created-route.ts, navigation/AddWalletStack.tsx

## W-02 Import wallet

**Routes:** ScanImport, ImportWallet, ImportWalletDiscovery, ImportCustomDerivationPath, ImportSpeed
**Entry:** Add wallet, Import wallet
**Tier:** Critical

**Inputs.** ScanImport: camera, image picker, or keyboard → ImportWallet text screen. Multi-line input with whitespace normalisation on blur; Import disabled when empty. Explanation: "Please enter your seed words, public key, WIF, or anything you’ve got. DFX Bitcoin Wallet will do its best to guess the correct format and import your wallet." Advanced mode: "Passphrase" and "Search accounts" switches. Hidden: tap the explanation label five times → ImportSpeed (free-text type `HDsegwitBech32` or `watchOnly`, optional passphrase; fetches balance before save). Scanned values (including animated BC-UR with "Loading x/y") go straight to discovery without passphrase/search options. Privacy blur is on for the text screen.

**Options.** Detection order in `startImport`: optional passphrase prompt (BIP39, SLIP39 multi-line, or Electrum seed); BIP39 formats (account 0 from `bip39_wallet_formats_bluewallet.json`, or with Search accounts the 14-entry `bip39_wallet_formats.json` trying accounts 0–9); WIF → SegWit Bech32 / SegWit P2SH / Legacy; uncompressed WIF → Legacy; Electrum seed P2WPKH then P2PKH; SLIP39 shares (P2SH, P2PKH if used, always Bech32); BC-UR JSON accounts → watch-only (then dropped by discovery). Unused BIP39 paths are not offered; if none was used, a fresh BIP84 wallet is proposed. BRD vs plain HD legacy for `m/0'` is decided by tx count (12 words, no passphrase). Custom derivation (BIP39 only): path field default `m/84'/0'/0'`, regex-validated; builds BIP44/BIP49/BIP84 and checks `wasEverUsed` (debounced 500 ms); statuses "found" / "not found" / "unknown" / "loading..."; invalid path shows "wrong derivation path".

**Behavior.** Discovery shows "Choose a discovered wallet" with type name and derivation path. Exactly one non-watch-only result auto-saves; otherwise the user picks and taps Import. No result: "No wallets were found." Errors: Alert "import error" plus message (hardcoded English). Cancelling the passphrase prompt goes back. After first-wallet save, waits up to 30 s for Lightning recovery (existing lightning.space account, else previously used Spark) with "Checking for an existing Lightning wallet…". Duplicates: haptic error and Alert "This wallet has been previously imported."; persistence failure rolls back. Imported wallets are marked backed up automatically (no home backup banner). Multisig backup text: first non-xpub cosigner seed becomes the single-sig main wallet; if exactly one wallet was found, the multisig is saved alongside it.

**Not supported.** BIP38 decrypt, AEZEED, multisig detection, LNDHub `lndhub://` / `blitzhub://`, and watch-only address/xpub branches are commented out. Discovery drops every `WatchOnlyWallet`, so address/xpub/descriptor/Cobo JSON watch-only cannot complete through the normal UI (ImportSpeed backdoor only). Watch-only/xpub deeplink into ImportWallet is commented out.

**Depends on.** Electrum (`wasEverUsed`, balance/transactions during discovery and custom path); lightning.space / Spark SDK for first-import Lightning recovery; camera, image picker, clipboard.

**Known issues.** #176 Wallet recovery broken on iOS 26.4.2 (import crash + multi-sig config mismatch); #246 Later import via custom derivation or speed import stacks a second WalletsRoot

**Tests.** `tests/unit/import-discovery.test.js`, `tests/unit/import-custom-derivation-path.test.js`, `tests/unit/lightning-recovery.test.js`, `tests/unit/storage-context.test.js`; `tests/integration/import.test.js` (stale vs commented paths, not in CI); CF-03, CF-08.

**Source.** screen/wallets/ScanImport.tsx, screen/wallets/import.js, screen/wallets/importDiscovery.js, screen/wallets/importCustomDerivationPath.js, screen/wallets/importSpeed.js, class/wallet-import.js, hooks/lightningRecovery.hook.ts, blue_modules/storage-context.js, navigation/AddWalletStack.tsx

## W-03 Recovery phrase backup

**Routes:** BackupExplanation, PleaseBackup, WalletExport
**Entry:** Home backup banner; Settings, wallet, Export
**Tier:** Critical

**Inputs.** BackupExplanation → PleaseBackup shows numbered words (`secret.js`). Checkbox "I understand that if I lose my recovery phrase, I will not be able to access my funds." must be ticked before Continue. WalletExport (from Details → Export/Backup): biometric unlock if enabled (otherwise goes back); shows numbered words and a QR of `getSecret()`; single-address wallets also show the address; SLIP39 shows each share; multisig shows the full-setup QR (may contain seeds) plus each cosigner’s secret.

**Options.** Explanation copy refers to "a list of 12 secret words" (a 24-word entropy wallet would show 24). Privacy blur while PleaseBackup or WalletExport is focused. WalletExport closes itself when the app backgrounds. Spark wallets first redirect to `SparkBackupNotice` (Lightning area), then derive the Spark phrase from the bound on-chain wallet or fail closed with "The linked on-chain wallet or its recovery phrase is unavailable. No Lightning recovery phrase was shown."

**Behavior.** Home backup banner always targets the main wallet (`wallets[0]`). Text "Backup your wallet", or with total balance > 0 "Backup not verified" plus warning icon. Continue on PleaseBackup sets `setUserHasBackedUpSeed(true)` and saves; hardware back sets it false. Viewing WalletExport sets `userHasSavedExport` but does **not** set `userHasBackedUpSeed`, so the home banner stays until PleaseBackup is confirmed. Imported wallets are auto-marked backed up. `PleaseBackupLNDHub` is registered but never navigated to (dead). Create registers PleaseBackup in AddWalletStack but does not navigate there after create.

**Not supported.** File export of the single-sig secret from WalletExport (CSV history is on Details; multisig coordination files are W-14). Skipping the confirmation checkbox.

**Depends on.** Biometrics when storage encryption / biometrics is enabled; share sheet not required for the seed view itself.

**Known issues.** None recorded.

**Tests.** No unit test for `pleaseBackup.js` or `backup-explanation.tsx` found; Maestro flow `tests/e2e-maestro/flows/01-onboarding-onchain-wallet.yaml` asserts the banner; `tests/unit/spark-wallet-export.test.js`, `tests/unit/spark-backup-notice.test.js` (Spark export path); CF-01.

**Source.** screen/wallets/dfx/backup-explanation.tsx, screen/wallets/pleaseBackup.js, screen/wallets/secret.js, screen/wallets/export.js, navigation/BackupSeedStack.tsx, navigation/WalletExportStack.tsx, screen/wallets/home.js

## W-04 Home overview

**Routes:** WalletTransactions
**Entry:** After unlock
**Tier:** Critical

**Inputs.** None for the overview itself. Floating Receive / Scan (NFC icon) / Send; long-press Send offers "Choose Photo", "Scan QR Code", and "Copy from Clipboard" (clipboard only when non-empty).

**Options.** Header total balance ("Total") sums all non-dummy wallets. Tap cycles BTC → sats → local fiat → hidden → BTC. Long-press: "Hide Balance" / "Show Balance" and "Copy". Hide balance is a global flag (`BlueApp.setIsHideBalanceEnabled`); revealing with biometrics enabled requires biometric unlock. RBF warning when the main wallet does not allow RBF ("Warning!", "You are using an outdated wallet without RBF function.") links to the public DFX FAQ. Backup banner (header-left on iOS, JS overlay on Android) while the main wallet is not backed up → BackupSeedRoot. External-services tiles (Buy, Sell, optional Swap / Point of Sale) when a DFX session is available — covered by DFX services. Three rows: "Multi-Device Wallet", "On-Chain Wallet" (`wallets[0]`), "Lightning"; each shows balance (masked by private-text); tap opens WalletAsset. Lightning Add restores lightning.space or creates Spark; failure shows "The existing Lightning account could not be checked. Nothing was added. Try again." with Retry.

**Behavior.** Initial route is `AddWalletRoot` when no wallets exist, else `WalletsRoot` / `WalletTransactions`. Receive prefers multisig, then Lightning (`LNDReceive` / `PosReceive`), then main. Send shows when the wallet allows sending or is HD watch-only. Scan/clipboard routes Boltcard tap → `TappedCardDetails`, PSBT → `PsbtMultisig` (if a multisig can sign), BIP21 with `lightning=`, LNURL, and other deeplinks. No pull-to-refresh; on focus, `revalidateBalancesInterval` skips if Electrum disabled, last refresh ≤40 s, or offline; otherwise refresh-all every 20 s. Android hides the native header and draws backup/settings in JS; iOS uses a transparent native header. Which `TransactionsNavigationHeader` file Metro bundles (.js vs .tsx) is not verified in code (Metro resolves `.js` first; Android edge-to-edge fix exists only in `.js`).

**Not supported.** Free wallet carousel / long-press reorder (`drawerList.js` is dead, not imported). "Coming soon" row variant is unreachable (`isActivated: true` on every row).

**Depends on.** Electrum for the refresh loop; DFX session for service tiles; biometrics for reveal-when-hidden; camera / NFC / clipboard for scan paths.

**Known issues.** None recorded.

**Tests.** `tests/unit/spark-home.test.js`, `tests/unit/dfx-services-buttons.test.js`; Maestro `tests/e2e-maestro/flows/01-onboarding-onchain-wallet.yaml`; CF-01.

**Source.** screen/wallets/home.js, components/TransactionsNavigationHeader.js, components/DfxServicesButtons.tsx, blue_modules/storage-context.js, navigation/WalletsStack.tsx, navigation/index.tsx

## W-05 Wallet screen

**Routes:** WalletAsset
**Entry:** Home, wallet row
**Tier:** Critical

**Inputs.** None beyond navigating from a home row.

**Options.** Per-wallet header (unit cycle and hide). "Pay card" (Boltcard) button only for `LightningLdsWallet`. DFX service tiles except for multisig. "Testnet" banner for a Lightning wallet pointing at the LDS DEV URL. Settings (…) opens Settings.

**Behavior.** Paginated transaction list: first 15, then page sizes 20, 40, and so on. Empty list: "Your transactions will appear here", or for off-chain wallets the Lightning empty copy (`list_empty_txs1_lightning`). Header title shows "Updating..." while this wallet refreshes. Receive: off-chain → `LNDReceive` / `PosReceive`; others → `ReceiveDetails`. If the wallet is deleted while the screen is open, it renders nothing.

**Not supported.** DFX tiles on multisig. Pay-card button on non-LDS Lightning wallets.

**Depends on.** Wallet refresh / Electrum (or Lightning provider) for the list; DFX session for tiles.

**Known issues.** None recorded.

**Tests.** `tests/unit/asset-dfx-services.test.js`; CF-01.

**Source.** screen/wallets/asset.js, navigation/WalletsStack.tsx

## W-06 Wallet details and delete

**Routes:** WalletDetails
**Entry:** Settings, wallet row
**Tier:** Important

**Inputs.** Delete confirmation; with a balance (main wallet, or any wallet with balance and `allowSend()`), the user must type the exact balance in sats. Biometric unlock if enabled.

**Options.** Shows address (single-address / non-HD watch-only), type (`typeReadable`), multisig "M / N (native segwit|wrapped segwit|legacy)" and "how many signatures can DFX Bitcoin Wallet make", Lightning "Connected to" base URI, Aezeed identity pubkey, transaction count. Advanced mode: master fingerprint (HD) and derivation path. "DFX Address Ownership Proof" for every wallet except multisig and Spark (generated on first open for the main wallet; tap to copy). Buttons: Show addresses (HD / HD watch-only), Export/Backup, Export History to CSV (≥1 tx; columns date, txid or payment_hash, amount BTC, memo; file `<label>-history.csv`), Export Coordination Setup / View Cosigners (multisig), Show Wallet XPUB (`allowXpub`: HD BIP44/49/84 and Aezeed only), Sign/Verify Message, Delete. Spark "Private mode" switch (reverts on failure with "Could not change private mode. Please try again."). LDS POS mode / cashier / Backup Pay Card Details (Lightning area). Hidden: tap "Transactions" 11 times purges cached transactions (debug).

**Behavior.** Entry from Settings: "On-Chain Wallet" (main), "Lightning" (disabled if none), "Multi-Device Wallet" (disabled if none), "CHF Taproot Wallet" (LDS DEV flag only). Delete confirm: "Are you sure?", or for main "Are you sure?\nIf you delete the on-chain wallet, the entire app will be reset…". Spark-bound source wallet (not main) blocked with "This wallet holds the recovery phrase of your Lightning wallet. Delete the Lightning wallet first." Balance mismatch: "The provided balance amount doesn’t match this wallet’s balance. Please try again." Deleting main deletes all wallets, resets DFX session, replaces stack with `AddWalletRoot`. Other wallets delete alone and pop to top. Push-notification subscriptions for the wallet’s addresses are removed.

**Not supported.** Rename (no label input; no `setLabel` outside create/import). Hide-in-list toggle (`hideTransactionsInWalletsList` is read but never toggled). "Use with Hardware Wallet" for HD watch-only only updates local React state and is never saved. BIP47 switch is unreachable (`backdoorBip47Pressed` has no setter) and unsaved.

**Depends on.** Biometrics; DFX ownership-proof generation; share sheet for CSV; push-notification unsubscribe on delete.

**Known issues.** None recorded.

**Tests.** `tests/unit/wallet-details-spark.test.js`; CF-01.

**Source.** screen/wallets/details.js, screen/settings/settings.js, navigation/WalletsStack.tsx

## W-07 Extended public key export

**Routes:** WalletXpub
**Entry:** Wallet details, Show XPUB
**Tier:** Important

**Inputs.** None beyond opening the screen (gated by biometrics when enabled).

**Options.** QR code, copyable xpub (zpub/ypub by type), Share via react-native-share. Apple Handoff activity `swiss.dfx.bitcoin.xpub` when Handoff is enabled.

**Behavior.** Biometric gate and privacy blur. Available when `allowXpub` is true: HD BIP44/49/84 and Aezeed only — not multisig or watch-only.

**Not supported.** Multisig XPUB from this screen; watch-only XPUB export here; file export beyond Share.

**Depends on.** Biometrics; react-native-share; Apple Handoff when enabled.

**Known issues.** None recorded.

**Tests.** None. (No unit test found for `xpub.js`.)

**Source.** screen/wallets/xpub.js, components/handoff.js, navigation/WalletXpubStack.tsx

## W-08 Addresses

**Routes:** WalletAddresses
**Entry:** Wallet details, Addresses
**Tier:** Important

**Inputs.** Native header search bar (substring match).

**Options.** Tabs "Receive" / "Change". Receive indices 0 … next_free + gap_limit; change 0 … next_free_change. Each row: balance (confirmed + unconfirmed), tx count, "Used" badge. Tap → `ReceiveDetails` for that address. Menu: Copy, Share, Sign/Verify (if the wallet allows).

**Behavior.** HD watch-only uses the inner HD instance. Privacy blur on. A failing derivation is skipped instead of crashing the list.

**Not supported.** Editing addresses; showing addresses for non-HD wallets that Details does not offer the button for.

**Depends on.** Wallet derivation / Electrum-backed balances; share sheet; Sign/Verify capability of the wallet type.

**Known issues.** None recorded.

**Tests.** `tests/unit/addresses.test.js`.

**Source.** screen/wallets/addresses.js, components/addresses/AddressItem.js, navigation/WalletsStack.tsx

## W-09 Sign and verify message

**Routes:** SignVerify
**Entry:** Wallet details; address list
**Tier:** Important

**Inputs.** Address (pre-filled with the first external address from Details, or from the address-row menu), signature, message.

**Options.** Sign calls `wallet.signMessage`; on success a Share action shares a public verification URL (`https://bluewallet.github.io/VerifySignature?a=&m=&s=`). Verify shows "Verification successful!" or "Verification failed!".

**Behavior.** Supported by Legacy, SegWit P2SH, SegWit Bech32, HD BIP44/49/84, and Aezeed.

**Not supported.** Multisig, watch-only, Lightning.

**Depends on.** Wallet `signMessage` / verify implementation; share sheet for the verification URL.

**Known issues.** None recorded.

**Tests.** None found for `signVerify.js`. Signing is covered at class level in wallet unit tests (Not verified in code.).

**Source.** screen/wallets/signVerify.js

## W-10 Payment codes (BIP47)

**Routes:** PaymentCode, PaymentCodesList
**Entry:** Not reachable in the current build
**Tier:** Nice

**Inputs.** None reachable through the UI.

**Options.** PaymentCode: QR plus copyable code ("Payment code not found" if empty). PaymentCodesList: "Who can pay me:" with sender codes.

**Behavior.** Not reachable in the current build. Both entries need `isBIP47Enabled()`: the Details list item and the header "Payment Code" button (the latter only in unused `TransactionsNavigationHeader.tsx`). `_enable_BIP47` defaults to false; no UI or code path calls `switchBIP47`. Whether any stored wallet has it true is not verified in code.

**Not supported.** Enabling BIP47 from the product UI.

**Depends on.** BIP47-enabled HD wallet state (unreachable).

**Known issues.** None recorded.

**Tests.** `tests/unit/bip47.test.ts`, `tests/integration/bip47.test.ts` (class level).

**Source.** navigation/PaymentCodeStack.tsx, class/wallets/abstract-hd-electrum-wallet.ts

## W-11 Wallet picker and reorder

**Routes:** SelectWallet, ReorderWallets
**Entry:** Used by other flows
**Tier:** Nice

**Inputs.** SelectWallet: filter by `chainType` and `allowSend()`, or an explicit `availableWallets` list. ReorderWallets: draggable list.

**Options.** SelectWallet is a generic picker used by `helpers/select-wallet.ts`, deeplink BIP21/Lightning choice, and (historically) Azteco and DefaultView.

**Behavior.** ReorderWallets is registered in InitStack but only navigated from dead `drawerList.js`, so it cannot be reached. Reordering would change which wallet is `wallets[0]` (the main wallet). Azteco’s deeplink is commented out and no navigate to `DefaultView` was found, so those SelectWallet callers look unreachable (Not verified in code.).

**Not supported.** Reaching ReorderWallets from the live home UI; free-list reorder of the three home rows.

**Depends on.** Callers that need a wallet choice (send/deeplink helpers).

**Known issues.** None recorded.

**Tests.** None.

**Source.** screen/wallets/selectWallet.js, screen/wallets/reorderWallets.js, helpers/select-wallet.ts, navigation/index.tsx

## W-12 Multi-device wallet: create

**Routes:** WalletsAddMultisig, WalletsAddMultisigStep2, WalletsAddMultisigHelp
**Entry:** Home, Multi-Device row, Add
**Tier:** Important

**Inputs.** Intro copy (`what_is_multidevice`, `prepare_devices`, `qr_flow`, `done_explanation` for 3 devices), then "Let’s start". Step 2: this device’s cosigner export as BC-UR QR (`{xfp, xpub, path}`) and a live camera to scan other cosigners. Accepted cosigner inputs: plain multisig xpub (Zpub/Ypub/xpub) with fingerprint prompt (default `00000000`) and path; animated BC-UR (`UR:CRYPTO-ACCOUNT`, `UR:CRYPTO-OUTPUT`, `UR:CRYPTO-PSBT`, multi-part `UR:BYTES`); Cobo/Keystone JSON; Coldcard JSON (format-matching entry); output descriptor strings.

**Options.** Quorum: m fixed at 2 (m chevrons commented out); n defaults to 3, range 2..7 in Advanced mode. Script type (Advanced): Native SegWit P2WSH (default, `m/48'/0'/0'/2'`), Wrapped SegWit P2SH-P2WSH (`m/48'/0'/0'/1'`), Legacy P2SH (`m/45'`). Default label "Multisig Vault". Only available while no multisig wallet exists. Key 1 is always the main wallet’s own seed. "Create" enabled only when all n keys are present.

**Behavior.** On create: fetches balance if Electrum enabled, saves, navigates to `WalletTransactions`. No backup gate for the multisig wallet itself. Validation: "This is not an XPUB from a multisignature wallet!", "Invalid cosigner data", "Incorrect cosigner: This is not a cosigner for {format} format."; duplicate or own-xpub scans ignored with haptic error; duplicate fingerprint → alert. `WalletsAddMultisigHelp` is registered but never navigated to (dead; help text describes upstream Vault behavior).

**Not supported.** Creating all keys on one device (no "add another own seed" here); m other than 2; more than one multisig wallet in the home/settings UI.

**Depends on.** Main on-chain wallet seed as cosigner 1; Electrum for balance on create (skipped when disabled); camera.

**Known issues.** None recorded.

**Tests.** `tests/unit/CosignerCamera.test.js`, `tests/unit/multisig-hd-wallet.test.js`, `tests/unit/multisig-hd-wallet-guard.test.js`.

**Source.** screen/wallets/addMultisig.js, screen/wallets/addMultisigStep2.js, screen/wallets/addMultisigHelp.js, class/wallets/multisig-hd-wallet.js, class/multisig-cosigner.js, navigation/WalletsStack.tsx, navigation/AddWalletStack.tsx

## W-13 Multi-device wallet: import

**Routes:** ImportMultisignature
**Entry:** Home, Multi-Device row, Import
**Tier:** Important

**Inputs.** Camera (animated QR; progress "Calculating {m} of {n} cosigners"), image picker, manual text modal ("Enter Descriptor"), clipboard. Parsed by `MultisigHDWallet.setSecret`: `UR:BYTES`, Coldcard JSON, Electrum multisig JSON (seed or xprv in keystores), Coldcard/Cobo coordination text, `sortedmulti(` descriptors (optionally wrapped in `sh(wsh(`, `wsh(`, `sh(`).

**Options.** Entry is WalletsAddMultisig → "Scan or import a file".

**Behavior.** M or N = 0 → "Invalid multisig descriptor". Main wallet seed (and passphrase) must match one cosigner by fingerprint or derived xpub; otherwise "Your wallet is not part of this multisig setup". Matched cosigner’s xpub is replaced by the local seed; other seeds in the file become xpubs (foreign private keys are not kept). Label forced to "Multisig Vault"; save and navigate to `WalletTransactions`.

**Not supported.** Importing a multisig that does not include this device’s main seed; keeping foreign seeds from the coordination file.

**Depends on.** Main on-chain wallet for cosigner match; camera / image picker / clipboard; Electrum optional for post-save balance.

**Known issues.** #176 Wallet recovery broken on iOS 26.4.2 (multi-sig config mismatch)

**Tests.** `tests/unit/multisig-hd-wallet.test.js` (includes cosigner-seed match helpers); no screen-level unit test found.

**Source.** screen/wallets/importMultisignature.tsx, class/wallets/multisig-hd-wallet.js, class/multisig-cosigner-match.ts, navigation/WalletsStack.tsx

## W-14 Multi-device wallet: cosigners and coordination export

**Routes:** ViewEditMultisigCosigners, ExportMultisigCoordinationSetup
**Entry:** Wallet details
**Tier:** Important

**Inputs.** None beyond opening from Details ("View Cosigners" / "Export Coordination Setup"). Biometric gate and blur on both screens.

**Options.** ViewEditMultisigCosigners: lists Vault Key 1..n and signatures required vs can make. "View" opens a modal with seed (own key) or xpub, fingerprint and path; BC-UR QR; Share exports `bw-cosigner-<fp>.json`. ExportMultisigCoordinationSetup: animated QR of hex-encoded public-only coordination text, plain text, Share writes `<label>.txt` (header, Name, Policy "M of N", Derivation, Format P2WSH / P2SH-P2WSH / P2SH, fingerprint:xpub lines).

**Behavior.** Despite the ViewEdit name, the screen is view-only: the "provide mnemonic" modal (replace xpub with seed, optional Advanced passphrase, "This mnemonic phrase doesn’t seem to be valid.") exists but nothing opens it; there is no save or "forget seed" action.

**Not supported.** Editing cosigners after creation; adding keys after creation; PSBT export here (Send area); more than one multisig wallet in the UI.

**Depends on.** Biometrics; share sheet; DynamicQRCode for coordination export.

**Known issues.** None recorded.

**Tests.** None.

**Source.** screen/wallets/viewEditMultisigCosigners.js, screen/wallets/exportMultisigCoordinationSetup.js, class/wallets/multisig-hd-wallet.js
