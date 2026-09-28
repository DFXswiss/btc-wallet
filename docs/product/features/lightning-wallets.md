# Lightning wallets

This area covers Lightning wallet types in the app: self-custodial Spark, custodial lightning.space (LNDHub and Taproot assets), the home Lightning slot, recovery on import, Lightning address registration, Spark on-chain deposit handling, Spark recovery-phrase export, and the legacy generic LNDHub path.

## L-01 Spark wallet (self-custodial Lightning)

**Routes:** none
**Entry:** Home, Lightning row, Add
**Tier:** Critical (DFX)

**Inputs.** Creation uses the main on-chain wallet (`wallets[0]`) when it is a BIP39 HD type (HDSegwitBech32, HDSegwitP2SH, HDLegacyP2PKH, or HDLegacyBreadwallet). Other types (multisig, watch-only, Aezeed, Electrum seeds, single keys) cannot supply a phrase. The Spark identity is a BIP-85 child: English 12 words at index 0, path `m/83696968'/39'/0'/12'/0'`; only that child phrase goes to the SDK (on-chain phrase and passphrase never leave the device for Spark). The Spark identity key is at `m/8797555'/1'/0'` of the child (mainnet). Accepted payment formats include Spark identity `spark1…` (bech32m, lowercase) and `spark:` URIs with optional `?amount=`, plus Lightning addresses of the form `<16 hex>@<domain>`.

**Options.** None on the home Add path: there is no provider or source-wallet picker. Private mode is available later on Wallet Details when the SDK is connected (`"Private mode"`, hint that it hides transfers from public explorers; SDK default off for new wallets).

**Behavior.** The home list always shows a Lightning row. An empty row shows Add (or a spinner while creating). Add first checks lightning.space with up to three login addresses (wallet first address, then first BIP84 and first BIP49 of the same seed, skipping duplicates) via sign-in only; a 404 means no account and nothing is created there. If a BTC LNDHub wallet exists on lightning.space, a `LightningLdsWallet` is added instead of Spark. Otherwise `createSparkWallet` derives the child phrase, connects, optionally registers a Lightning address, saves, and refreshes. Creation is deterministic: the same seed yields the same Spark wallet. Concurrent creates are ignored; an existing Spark wallet is returned. Type string is `sparkWallet`; user-facing label is `"Lightning"`. Unit is sats, chain OFFCHAIN; `secret` is always empty. Persisted fields include `lnAddress`, `sparkAddress`, `identityPubkey`, `sourceWalletId`, `sourceWalletLabel`, and payment lists. Wallet ID is sha256 of type + identityPubkey + empty secret. Balance comes from the SDK; a session whose identity differs fails with `"Lightning could not be started. ({kind})"` style handling and session-mismatch messaging. History is Bitcoin-asset payments, paged 50 per page up to 100 pages (max 5000), split pending/completed and de-duplicated. Memo fallbacks include Lightning payment/invoice, Deposit, Withdraw, Token payment/receive, Spark payment/receive. `weOwnAddress()` is always false. Wallet Details shows the connection as "Breez Spark". Delete uses the standard confirm, biometrics if enabled, and a balance-typing prompt when balance is greater than zero; deleting a non-main on-chain source of Spark is blocked until Spark is deleted first; deleting the main wallet deletes all wallets including Spark. After delete the SDK disconnects; Add again re-derives the same identity. Connect requires config key `BREEZ_API_KEY` (mainnet only); optional `BREEZ_LNURL_DOMAIN`. Sync runs on app start when a Spark wallet exists, on identity change, and on return to foreground (no polling). Failed connect shows Alert titled `"Lightning"` with `"Lightning could not be started. ({kind})"` and Cancel / retry. Missing source wallet after bind shows that Lightning belongs to the labelled wallet and that wallet must be restored.

**Not supported.** Choosing a provider or source from the home row. Token invoices. Tip invoices / amountless-with-free-amount. No on-chain (bc1) receive address is exposed. Spark does not waive domain fees for lightning.space/DFX addresses. Testnet/regtest Spark is not available.

**Depends on.** `@breeztech/breez-sdk-spark-react-native` 0.19.2; config keys `BREEZ_API_KEY` (required) and optional `BREEZ_LNURL_DOMAIN`; a BIP39 HD main wallet for derivation; SDK storage under the app document directory `breezSdkSpark`.

**Known issues.** #221 Spark integration: one-tap self-custodial Lightning wallet

**Tests.** tests/unit/spark-wallet.test.js, tests/unit/spark-sdk.test.js, tests/unit/spark-seed.test.js, tests/unit/spark-context.test.js, tests/unit/spark-home.test.js, tests/unit/wallet-details-spark.test.js, tests/unit/lnd-receive-spark.test.js, tests/unit/payment-seeds.test.js, tests/unit/outgoing-payment.test.js, tests/unit/lightning-recovery.test.js, tests/unit/release-native-env.test.js; CF-05

**Source.** class/wallets/spark-wallet.ts, api/spark/spark-seed.ts, api/spark/spark-sdk.ts, api/spark/contexts/spark.context.tsx, hooks/lightningRecovery.hook.ts, screen/wallets/home.js, helpers/wallet-created-route.ts, screen/wallets/details.js, package.json

## L-02 Lightning slot and provider precedence

**Routes:** none
**Entry:** Home
**Tier:** Critical (DFX)

**Inputs.** The set of wallets already in the app. No separate form.

**Options.** None.

**Behavior.** `getLightningWallet` fills the home Lightning slot in type order: `lightningLdsWallet`, then `lightningCustodianWallet`, then `sparkWallet`. The first match wins; if both LNDHub and Spark exist, LNDHub wins. Taproot asset wallets never occupy the slot. The row subtitle is always `"Lightning"` regardless of type. Balance uses the preferred unit and private-text masking. Home Receive prefers the multi-device wallet, else the Lightning wallet (`PosReceive` in POS mode, otherwise `LNDReceive`), else on-chain. Settings > Lightning opens Wallet Details for the same choice and is disabled when none exists. Only LNDHub types (custodian or LDS) waive domain fees for lightning.space/DFX addresses; Spark does not.

**Not supported.** Putting a Taproot asset wallet in the Lightning slot. Changing precedence from the UI.

**Depends on.** helpers/lightning-wallet.ts type ordering; home and settings screens that call `getLightningWallet`.

**Known issues.** None recorded.

**Tests.** tests/unit/lightning-wallet-helper.test.js, tests/unit/settings-lightning-wallet.test.js, tests/unit/spark-home.test.js; CF-05

**Source.** helpers/lightning-wallet.ts, screen/wallets/home.js, screen/settings/settings.js

## L-03 Lightning recovery on import

**Routes:** none
**Entry:** Import wallet
**Tier:** Critical (DFX)

**Inputs.** Runs only when the imported wallet is the first wallet in the app (`isFirstWallet`) and is a BIP39 HD type. Uses the same three lightning.space login address candidates as Add.

**Options.** None. The user cannot skip or choose provider during recovery; the continue/select control stays disabled while the check runs.

**Behavior.** On `ImportWalletDiscovery` and `ImportCustomDerivationPath`, a spinner shows `"Checking for an existing Lightning wallet…"`. Recovery races a 30 s wait; after 30 s the screen continues and recovery may finish in the background. Order: (1) lightning.space account via sign-in only — if found, add `LightningLdsWallet` (init, authorize, fetch transactions, invoices, pending, balance); (2) otherwise try Spark — connect, sync, read info, one payment and Lightning address, and restore only if the seed was used (balance > 0, or at least one payment, or an existing Lightning address); unused seeds create nothing and disconnect. Any failed check stops recovery without guessing; errors go to crash reporting only, with no user alert. A restored Spark wallet without a Lightning address gets one registration attempt after connect (attempted, not guaranteed). Result: the home Lightning row is already filled, or it shows Add.

**Not supported.** Recovery when the imported wallet is not the first wallet. Creating a lightning.space account during import (sign-in only).

**Depends on.** BIP39 HD first wallet; lightning.space sign-in; Spark SDK and `BREEZ_API_KEY` for the Spark path.

**Known issues.** None recorded.

**Tests.** tests/unit/lightning-recovery.test.js, tests/unit/import-discovery.test.js, tests/unit/import-custom-derivation-path.test.js, tests/e2e-maestro/_setup-import.yaml; CF-08

**Source.** hooks/lightningRecovery.hook.ts, api/spark/contexts/spark.context.tsx, api/lds/lightning-lds-wallet-factory.ts, screen/wallets/importDiscovery.js, screen/wallets/importCustomDerivationPath.js

## L-04 Lightning address

**Routes:** none
**Entry:** Spark receive
**Tier:** Important

**Inputs.** Username is the first 16 hex characters of sha256(identityPubkey); retries append attempt number + 1 (up to 5 attempts). Each attempt checks availability then registers with description `"Lightning"`. Domain is `BREEZ_LNURL_DOMAIN` when set, otherwise the SDK default Breez server.

**Options.** None; registration is automatic and optional for wallet usability.

**Behavior.** Registration is attempted during Spark create when no address is returned, and once per mounted Spark identity for a wallet without an address (including recovered wallets); the attempt is repeated only after a stale session or when a new identity is mounted, not on every refresh. Failure does not abort create: the wallet stays usable without `lnAddress`, with only a logged warning. Receive falls back to the Spark address `spark1…`. If neither exists, receive shows `"No receive address is available yet. Check that the wallet is connected, then try again."` with a try-again control. Display and copy appear on Lightning receive (QR, copy, share) until an amount is entered (then the invoice). Production readiness of the address domain is not verified in code. Do not treat an `@lightning.space` address as available until production LNURL availability and payment routes are verified.

**Not supported.** Guaranteed address registration. User-chosen username.

**Depends on.** Connected Spark session; optional config key `BREEZ_LNURL_DOMAIN`.

**Known issues.** None recorded.

**Tests.** tests/unit/spark-context.test.js, tests/unit/lnd-receive-spark.test.js

**Source.** api/spark/contexts/spark.context.tsx, api/spark/spark-sdk.ts, screen/lnd/lndReceive.tsx, screen/lnd/lndCreateInvoice.js

## L-05 Spark on-chain deposits

**Routes:** none
**Entry:** Automatic
**Tier:** Important

**Inputs.** None from the user. Deposits are handled by the Spark SDK.

**Options.** None.

**Behavior.** No UI requests a Spark on-chain (bc1) deposit address; nothing calls Bitcoin-address receive, claim, or refund APIs. Auto-claim of on-chain deposits is capped at `maxDepositClaimFee` 10 sat/vB. SDK events NewDeposits, ClaimedDeposits, and UnclaimedDeposits trigger a refresh. History rows use memo `"Deposit"`. `weOwnAddress` is always false for Spark.

**Not supported.** Manual claim or refund of deposits above the fee cap. There is no UI for unclaimed deposits. Whether the SDK later claims capped-out deposits is not verified in code. Spark receive does not show On-Chain or bc1.

**Depends on.** Spark SDK connection and auto-claim settings.

**Known issues.** None recorded.

**Tests.** tests/e2e-maestro/flows/07-receive-spark-onchain-address.yaml

**Source.** api/spark/spark-sdk.ts, api/spark/contexts/spark.context.tsx, class/wallets/spark-wallet.ts

## L-06 Spark recovery phrase export

**Routes:** SparkBackupNotice
**Entry:** Settings, Lightning wallet, Export
**Tier:** Critical (DFX)

**Inputs.** Export/Backup from Wallet Details (testID WalletExport). The 12-word Spark child phrase is derived at reveal time from the single bound source wallet matched by `sourceWalletId`; it is never stored on the Spark wallet.

**Options.** Notice checkbox `"I understand"` must be checked before Continue. If biometrics are capable and enabled, unlock must succeed or the screen goes back; if biometrics are disabled, the phrase appears with no extra gate.

**Behavior.** WalletExport for Spark replaces itself with SparkBackupNotice unless `noticeAccepted` is set. The notice title is `"Do you need these words?"`; it explains that this app does not need these words because the Bitcoin wallet recovery phrase is enough, that the words are only for use in a different app and do not restore Lightning in this app, and gates Continue on the confirm checkbox. After accept, capture protection turns on when the privacy-blur setting is on. The export screen shows the Spark recovery explanation, backup info, the 12 words (testID WalletExportSecret), and a QR of the phrase. If the source is missing or ambiguous, it shows that no Lightning recovery phrase was shown and omits the phrase. The screen closes when the app backgrounds; the phrase is cleared on blur.

**Not supported.** Using the Spark child phrase to restore Lightning inside this app. Export when the bound on-chain source is missing or ambiguous.

**Depends on.** Bound BIP39 source wallet still present; optional biometrics; privacy-blur setting for capture protection.

**Known issues.** None recorded.

**Tests.** tests/unit/spark-wallet-export.test.js, tests/unit/spark-backup-notice.test.js, tests/e2e-maestro/flows/19-spark-recovery-export.yaml; CF-05

**Source.** navigation/WalletExportStack.tsx, screen/wallets/sparkBackupNotice.js, screen/wallets/export.js, screen/wallets/details.js, blue_modules/Privacy.tsx

## L-07 lightning.space wallet and provider picker

**Routes:** AddLightning
**Entry:** Settings, CHF Taproot Wallet (LDS DEV API flag)
**Tier:** Important

**Inputs.** Route param `asset` (default BTC). For Custom: Lightning address (`user@provider.domain`), `"DFX signature"`, and `"LNDHub admin URL"` (`lndhub://admin:...`); all three required, and the address must resolve to an LNURL. lightning.space path uses on-chain ownership signing against the account.

**Options.** Providers: `"lightning.space"` (default); `"DFX.swiss"` (shows `"This service will be available soon"`, Continue disabled); `"Custom"` with the three fields above plus a docs FAQ link and disclaimer.

**Behavior.** The only live navigate to AddLightning is Settings > `"CHF Taproot Wallet"` when no CHF taproot wallet exists yet, and only when feature flag `ldsDEV` (LDS DEV API) is on. With lightning.space, the screen walks the account's Lightning wallets: a BTC wallet with admin URL becomes `LightningLdsWallet` when asset is BTC; a matching asset becomes `TaprootLdsWallet` labelled with the asset display name. Taproot asset enum: BTC, CHF, USD, EUR (value `EUC`). Taproot balance is shown in local currency; wallet ID is the lnbits wallet id. Home Add and import use sign-in only for lightning.space and can create `LightningLdsWallet` in place without this screen. LDS wallets store LNDHub admin credentials, `lnAddress`, ownership proof and invoice URL; they support LNURL-pay min/max, Boltcards, and POS mode controls on Wallet Details when the POS flag is on. Export shows the LNDHub URL (including admin key) via generic WalletExport. Errors show Alert `"Something went wrong"` with the message; Custom validation failure shows `"Invalid input"`.

**Not supported.** Creating a plain generic LNDHub wallet from this screen for everyday BTC Lightning (home Add prefers Spark when no lightning.space account). DFX.swiss provider is not available yet.

**Depends on.** Feature flag `ldsDEV` for the CHF Taproot entry; lightning.space account APIs for the default provider; on-chain key for ownership sign-in/up.

**Known issues.** None recorded.

**Tests.** tests/unit/add-lightning.test.js, tests/unit/settings-chf-taproot.test.js, tests/unit/lightning-lds-wallet-factory.test.js, tests/unit/lightning-recovery.test.js, tests/unit/settings-lightning-wallet.test.js

**Source.** screen/wallets/add-lightning.tsx, navigation/WalletsStack.tsx, screen/settings/settings.js, screen/settings/FeatureFlags.tsx, class/wallets/lightning-lds-wallet.ts, class/wallets/taproot-lds-wallet.ts, api/lds/lightning-lds-wallet-factory.ts, api/lds/hooks/lds.hook.ts

## L-08 Generic LNDHub wallet (legacy)

**Routes:** LightningSettings, PleaseBackupLNDHub
**Entry:** Not reachable in the current build
**Tier:** Nice

**Inputs.** LightningSettings: a single LNDHub URI field (placeholder like `"E.g., {example}"`), optional scan of `bluewallet:setlndhuburl?url=` or a raw URL, stored under AsyncStorage key for LNDHub (empty means use default). PleaseBackupLNDHub: shows the wallet secret (LNDHub URL) as QR and copy for a given `walletID`.

**Options.** LightningSettings: Scan QR, GitHub LndHub link, explanation that only wallets created after saving use the URL. PleaseBackupLNDHub: `"OK, I have saved it"` dismisses; Android hardware back also dismisses; capture protection while focused.

**Behavior.** Not reachable in the current build. `LightningCustodianWallet` uses secret form `lndhub://login:password@baseURI` and is the base of LDS/Taproot wallets; it refuses cross-network LN transfers and refreshes balance/transactions every 5 minutes. Creation and import paths for plain custodian wallets are commented out or unreachable: `lndhub://`/`blitzhub://` import, deeplinks `openlappbrowser` and `setlndhuburl`, and the wallet-add OFFCHAIN branch. LightningSettings has no in-app navigate; its deeplink entry is commented out. It does not affect Spark or lightning.space. PleaseBackupLNDHub is registered but never navigated to. Plain custodian wallets matter only if older stored data still exists; whether any exist in the field is not verified in code. URI validation GETs `<uri>/getinfo`; success shows the saved confirmation (`settings.lightning_saved`), failure shows `"Invalid LNDHub URI"`.

**Not supported.** Creating a new generic LNDHub wallet from current UI. Changing LNDHub default for Spark or lightning.space.

**Depends on.** Legacy stored custodian wallets if present; config key `REACT_APP_LDS_DEV_URL` for detecting the dev account on the custodian class.

**Known issues.** None recorded.

**Tests.** tests/integration/lightning-custodian-wallet.test.js, tests/unit/lightning-wallet-helper.test.js, tests/e2e/bluewallet.spec.js

**Source.** class/wallets/lightning-custodian-wallet.js, screen/settings/lightningSettings.tsx, screen/wallets/pleaseBackupLNDHub.js, navigation/WalletsStack.tsx, navigation/AddWalletStack.tsx, class/wallet-import.js, class/deeplink-schema-match.js
