# Settings

Settings covers the settings menu, general and privacy options, currency and language, network and Electrum, notifications, storage encryption and biometrics, plausible deniability, tools, feature flags, and About (including self-test, licensing, and release notes).

## X-01 Settings menu

**Routes:** Settings
**Entry:** Home, more icon
**Tier:** Important

**Inputs.** None. The screen is a list of navigation rows.

**Options.** Rows, in order:
- General → `GeneralSettings`
- On-Chain Wallet → `WalletDetails` for the current context wallet
- Lightning → `WalletDetails` of the Lightning/Spark wallet; disabled when none exists
- Multi-Device Wallet → `WalletDetails` of a multisig wallet; disabled when none exists
- CHF Taproot Wallet → existing CHF TaprootLds wallet details, or `AddLightning` with asset CHF when none exists; shown only when the LDS DEV API feature flag is on
- Currency → `Currency`
- Language → `Language`
- Security → `EncryptStorage`
- Network → `NetworkSettings`
- Tools → `Tools`
- "Feature Flags" → `FeatureFlags` (hardcoded English label; always visible, no build gate)
- About → `About`

**Behavior.** Opens from the home header more icon (and from the wallet asset screen; iOS can also open Settings via the native `openSettings` event). Android shows an in-page subheader "Settings"; iOS puts the title in the navigation header. Wallet detail rows for Lightning and Multi-Device are disabled when the matching wallet is missing.

**Not supported.** `DefaultView` and `LightningSettings` are registered elsewhere but have no menu entry from this screen.

**Depends on.** Presence of Lightning and multisig wallets for those rows; LDS DEV API flag for the CHF Taproot row.

**Known issues.** None recorded.
**Tests.** tests/unit/settings-lightning-wallet.test.js, tests/unit/settings-chf-taproot.test.js.
**Source.** screen/settings/settings.js, navigation/WalletsStack.tsx

## X-02 General and privacy settings

**Routes:** GeneralSettings, SettingsPrivacy
**Entry:** Settings, General
**Tier:** Important

**Inputs.** None beyond the switches and buttons on these screens.

**Options.**
- General → Privacy opens `SettingsPrivacy`.
- Continuity (Handoff), iOS only: AsyncStorage `HandOff`, default off. When on, Handoff is rendered on receive details, transaction details, transaction status, and xpub. Explanation: "When enabled, you will be able to view selected wallets, and transactions, using your other Apple iCloud connected devices."
- Advanced Mode (`AdvancedMode`): AsyncStorage `advancedmodeenabled`, default off. Explanation covers different wallet types, LNDHub instance, and custom entropy.
- "Legacy URv1 QR" (hardcoded English): toggles URv1 QR encoding; default off. Not verified in code for the underlying key’s default value.
- "Clear AsyncStorage" (hardcoded English): removes only `lang`, `preferredCurrency`, cached exchange rates `currency`, and `LAST_UPDATED`. No confirmation or success message. Does not clear wallets, feature flags, or Electrum settings.
- Privacy → Prevent Screenshots: AsyncStorage `privacy_blur_enabled`, persisted default off ("Off by default"). A read error fails closed to on; a failed save reverts the switch. When on, sensitive screens call `Privacy.enableBlur()` (export, xpub, backup, import, addresses, send/create, multisig cosigner and export). Until the setting has loaded, protection is assumed on.
- Read Clipboard: AsyncStorage `ClipboardReadAllowed`, default false. When off, clipboard reads return empty.
- Wallet Shortcuts: AsyncStorage `DeviceQuickActionsEnabled`, default true; hidden when storage is encrypted.
- Widgets → Total Balance: iOS only, hidden when storage is encrypted; default true. Widget shows 0 when encrypted or when this is off.
- Disable Analytics: AsyncStorage `donottrack`, default off; toggles Sentry opt-out.
- System Settings opens the OS app settings.

**Behavior.** Privacy is reached from General. Biometrics are not on these screens (see Security). Continuity is iOS-only.

**Not supported.** Biometric unlock/toggle lives under Security, not Privacy.

**Depends on.** AsyncStorage for preferences; `react-native-capture-protection` for screenshot blocking; Sentry via analytics when Do Not Track is off.

**Known issues.** None recorded.
**Tests.** tests/unit/settings-lightning-wallet.test.js, tests/unit/storage-context.test.js, tests/unit/blue-app.test.js
**Source.** screen/settings/GeneralSettings.tsx, screen/settings/SettingsPrivacy.js, blue_modules/Privacy.tsx, blue_modules/clipboard.ts, class/quick-actions.js, blue_modules/WidgetCommunication.ios.js, blue_modules/analytics.js

## X-03 Currency

**Routes:** Currency
**Entry:** Settings, Currency
**Tier:** Important

**Inputs.** A list of 55 fiat currencies from `models/fiatUnits.json`, filterable through the native header search bar (matches `endPointKey`).

**Options.** Each currency has a price `source` (CoinGecko 32, CoinDesk 13, Bitstamp 3, Yadio 3, Exir 2, YadioConvert 1, wazirx 1). USD, EUR and GBP use Bitstamp; CHF uses CoinGecko.

**Behavior.** Default is the saved preference; otherwise the device’s first locale currency when it is in the list, else USD. Selecting a currency fetches a live rate first. On success it persists `preferredCurrency`, re-inits and refreshes. On failure it shows "There was an error while obtaining the rate for the selected currency." and keeps the previous choice. The footer shows "Price is obtained from" plus the provider name, the rate, and last updated. Rates are refetched at most every 30 minutes and count as stale after 31 minutes or after a fetch error.

**Not supported.** Custom or user-defined currency codes outside the list.

**Depends on.** The currency’s configured price provider endpoints.

**Known issues.** None recorded.
**Tests.** tests/unit/currency.test.js, tests/integration/Currency.test.js
**Source.** screen/settings/currency.js, models/fiatUnits.json, models/fiatUnit.ts, blue_modules/currency.js

## X-04 Language

**Routes:** Language
**Entry:** Settings, Language
**Tier:** Important

**Inputs.** A list of 46 languages from `AvailableLanguages`, English first. RTL languages: Arabic, Farsi, Hebrew.

**Options.** Selecting a language saves it immediately.

**Behavior.** Default is the saved `lang`; otherwise the device’s first supported locale, else `en`. The choice is stored in AsyncStorage `lang` and applies immediately. Switching into or out of an RTL language shows "Restarting DFX Bitcoin Wallet is required for the language orientation to take effect."

**Not supported.** Languages outside `AvailableLanguages`.

**Depends on.** Locale files under `loc/`.

**Known issues.** None recorded.
**Tests.** tests/unit/loc.test.js
**Source.** screen/settings/language.js, loc/languages.ts, loc/index.ts

## X-05 Default view on launch

**Routes:** DefaultView
**Entry:** Not reachable in the current build
**Tier:** Nice

**Inputs.** Switch "View All Wallets" (`default_wallets`), disabled when there are no wallets. When off, a wallet is chosen via `SelectWallet`.

**Options.** Stored value key: AsyncStorage `ONAPP_LAUNCH_SELECTED_DEFAULT_WALLET_KEY` ("View All Wallets" default on).

**Behavior.** Not reachable in the current build: the route is registered but no navigation entry exists. If reached, the switch controls whether launch opens the wallet list or a selected wallet. At launch, `App.js` still honours a stored selection and opens `WalletTransactions` for that wallet when there is no deeplink.

**Not supported.** Changing this preference from the Settings UI (no entry point).

**Depends on.** `class/on-app-launch.js` and the launch path in `App.js`.

**Known issues.** None recorded.
**Tests.** None.
**Source.** screen/settings/defaultView.js, class/on-app-launch.js, App.js

## X-06 Network and Electrum server

**Routes:** NetworkSettings, ElectrumSettings
**Entry:** Settings, Network
**Tier:** Important

**Inputs.** Electrum host (trimmed text), port (number pad), Use SSL switch. Optional QR of `host:port:s|t` or a `bluewallet:setelectrumserver?server=` string. Offline Mode switch.

**Options.**
- Network → Electrum Server → `ElectrumSettings`; Notifications → `NotificationSettings` only when `isNotificationsCapable` (iOS, or Android with Google or Huawei services).
- Offline Mode: stores AsyncStorage `electrum_disabled`='1', force-disconnects, and hides the server form. Off clears the key and reconnects. Persisted default is off (key absent). While offline, balance refresh is skipped and self-test is blocked with "Self-testing is not available with Electrum Offline Mode. Please disable offline mode and try again."
- Status card: Connected / Not Connected, polled every 500 ms, plus current `host:port`. Tapping the host shows raw `serverFeatures()` JSON. "Last Connection:" (hardcoded English) shows the last successful balance refresh time.
- A host typed by hand that ends in `.onion` switches SSL off and forces TCP; a server restored from the history or scanned from a QR code keeps its saved SSL setting. On desktop (Catalyst), `.onion` is rejected with "Tor connections are not supported."
- Save: empty fields clear the custom server (built-in pool again) and show the saved message. Otherwise `testConnection` (5 s timeout, `server.version` and `server.ping`); failure shows "Can’t connect to the provided Electrum server" and saves nothing. Success persists `electrum_host`, `electrum_tcp_port`, `electrum_ssl_port`, appends to history, and on iOS mirrors values to the app-group for widgets. Message: "Your changes have been saved successfully. Restarting DFX Bitcoin Wallet may be required for the changes to take effect."
- Reset to default clears fields and saves. Server history supports Select (re-tests and saves) and Clear with confirmation.
- An optional `route.params.server` can prefill and ask to set that server as default; the deeplink that supplied it is commented out, so the param is effectively unused today.

**Behavior.** There is no user-facing preset list. The built-in pool is 8 public Electrum servers; the app picks one at random and rotates on failure, and also rotates peers every 30 minutes. A saved custom server replaces the whole pool: every reconnect uses it. If it becomes unreachable, the app retries the same server repeatedly and does not fall back to the built-in pool; balances and history stop updating and Electrum-dependent sends fail. No Tor transport is bundled; whether `.onion` hosts work on mobile is not verified in code.

**Not supported.** Lightning (LNDHub) settings row on this screen (removed relative to upstream; that screen is unreachable). Automatic fallback from a bad custom server to the built-in pool.

**Depends on.** Electrum connectivity (`BlueElectrum.js`); app-group `group.swiss.dfx.bitcoin` on iOS for widget mirroring of host/ports.

**Known issues.** None recorded.
**Tests.** tests/integration/BlueElectrum.test.js, tests/unit/electrumBatchingDetection.test.js, tests/unit/storage-context.test.js
**Source.** screen/settings/NetworkSettings.js, screen/settings/electrumSettings.js, blue_modules/BlueElectrum.js

## X-07 Notification settings

**Routes:** NotificationSettings
**Entry:** Settings, Network, Notifications
**Tier:** Important

**Inputs.** Push Notifications switch; GroundControl URI field (placeholder = default URI). Hidden debug: tap the footer text nine times to show push token, permissions and stored notifications, with a copy button.

**Options.** Push Notifications (`NotificationsSwitch`): on clears the opt-out flag and sets server levels or requests permission; off calls `setLevels(false)`, which stores the don’t-ask flag. Effective state requires not opted out, a device token, and server `level_all`. Empty GroundControl URI restores the default; save checks `${uri}/ping` for a `description` field ("Saved" / "Invalid URI").

**Behavior.** Entry appears only when notifications are capable (iOS, or Android with Google or Huawei services). Provider is GroundControl (BlueWallet’s open-source push relay); the default server is BlueWallet’s public GroundControl instance, not a DFX server. The wallet registers on-chain addresses, Lightning payment hashes and txids for paid/confirmed pushes on wallet add, receive/invoice creation, and send/broadcast/CPFP/PSBT flows. Nothing is sent without a push token or when the user chose don’t ask. The OS permission prompt can also be triggered from receive flows. On Android below API 33 a rationale uses "Would you like to receive notifications when you get incoming payments?" / "No, and don’t ask me again".

**Not supported.** Notifications on Android without Google or Huawei services (no menu row).

**Depends on.** `react-native-notifications` (APNs/FCM); GroundControl URI (default from `groundControlUri`, overridable).

**Known issues.** None recorded.
**Tests.** tests/integration/notifications.test.js
**Source.** screen/settings/notificationSettings.tsx, blue_modules/notifications.ts, blue_modules/constants.js

## X-08 Storage encryption and biometrics

**Routes:** EncryptStorage
**Entry:** Settings, Security
**Tier:** Critical

**Inputs.** Biometrics switch "Use {type}" (Face ID / Touch ID / Biometrics), shown only if the device is biometric-capable. Encrypted and Password Protected switch: password and retype when enabling; password when disabling.

**Options.**
- Biometrics: stored in the secure key store under `Biometrics`, default off. Changing the switch either way requires a successful biometric prompt; the prompt allows the device passcode as fallback. Explanation: "{type} will be used to confirm your identity before making a transaction, unlocking, exporting, or deleting a wallet. {type} will not be used to unlock encrypted storage."
- Encrypted and Password Protected: turning on prompts "Password" / "Create the password you will use to decrypt the storage.", then "Re-type password"; mismatch shows "Passwords do not match." Any non-empty string is accepted (no strength rules). Turning off confirms "Are you sure you want to decrypt your storage? This will allow your wallets to be accessed without a password.", then requires the unlock password; wrong password shows "Incorrect password. Please try again."
- Plausible Deniability row appears only while storage is encrypted → `PlausibleDeniability`.

**Behavior.** Title is "Security". Wallet JSON is encrypted with CryptoJS AES passphrase mode (OpenSSL-style key derivation; no PBKDF2/scrypt found). Storage holds a JSON array of encrypted buckets; flag `data_encrypted`='1'. Wallet data lives in the platform secure store (key `data`, accessibility `WHEN_UNLOCKED_THIS_DEVICE_ONLY`), with a Realm `keyvalue.realm` fallback copy encrypted by a random key held in the keychain. Settings and flags remain in plain AsyncStorage. At unlock, encrypted storage prompts "Enter password" / "Your storage is encrypted. Password is required to decrypt it." and rejects empty input. Wrong password re-prompts; on iOS after 10 failures, "You have attempted to enter your password 10 times…" can wipe secure-store `data`, `data_encrypted` and `Biometrics` after biometric/passcode confirmation; Android re-prompts indefinitely. Encryption clears quick actions and zeroes the widget balance; those privacy switches are hidden while encrypted. Whether the launch biometric gate fires automatically for unencrypted storage is not verified in code (code reading suggests the mount path skips it). Whether the iOS wipe also removes the Realm fallback copy is not verified in code.

**Not supported.** Using biometrics to unlock encrypted storage. Password strength rules. A dedicated “reset app” / delete-all-data setting (deletion paths are delete main wallet, iOS wipe after failed passwords, or Clear AsyncStorage for language/currency cache only).

**Depends on.** Platform secure store / keychain; CryptoJS encryption; `react-native-biometrics` for gated actions (send confirm, PSBT flows, LNURL-pay, OpenCryptoPay commit, export, xpub, multisig screens, wallet details/delete, and related headers).

**Known issues.** None recorded.
**Tests.** tests/unit/encryption.test.js, tests/unit/blue-app.test.js, tests/unit/storage.test.js, tests/e2e/encrypted-storage.spec.js, CF-04
**Source.** screen/settings/encryptStorage.js, blue_modules/encryption.js, BlueApp.js, class/biometrics.js

## X-09 Plausible deniability

**Routes:** PlausibleDeniability
**Entry:** Settings, Security, while encrypted
**Tier:** Important

**Inputs.** Button "Create Encrypted Storage"; password and retype for the decoy storage.

**Options.** Help text explains creating another encrypted storage with a different password so a coerced disclosure unlocks empty “fake” storage while the main storage stays sealed.

**Behavior.** Shown only while storage is encrypted. Create prompts "Create a password" / "Password for the fake storage should not match the password for your main storage." If the password equals the current one or decrypts any existing bucket: "Password is currently in use. Please try a different password." Retype mismatch: "Passwords do not match. Please try again." On success it appends a new encrypted bucket with empty wallets, switches the running session into that empty storage (fake password cached), refreshes the wallet list, shows "Success" and pops to top. At the next launch, whichever password decrypts a bucket opens that bucket; return to the real wallets by restarting and entering the main password. Several decoys can be created (one bucket each).

**Not supported.** Listing or deleting decoy buckets in the UI.

**Depends on.** Encrypted storage (X-08) and the multi-bucket decrypt path in `BlueApp.js`.

**Known issues.** None recorded.
**Tests.** tests/unit/blue-app.test.js, tests/e2e/encrypted-storage.spec.js, CF-04
**Source.** screen/plausibledeniability.js, BlueApp.js

## X-10 Tools

**Routes:** Tools
**Entry:** Settings, Tools
**Tier:** Nice

**Inputs.** None on the Tools menu itself; each row opens a separate tool screen owned by the send area.

**Options.**
- "Is it my address?" → address check tool (strips `bitcoin:` / query; typed or scanned; reports which loaded wallet owns the address, or that none do; match can open receive QR).
- "Broadcast Transaction" → raw tx hex (or scan/open a file; scanned base64 PSBT is finalized and extracted), broadcast via Electrum, with pending/success/error status and a mempool.space link on success.

**Behavior.** Header title is "Tools". Self-test and the performance test are not here; they live under About.

**Not supported.** Running self-test or performance test from Tools.

**Depends on.** Loaded wallets for address ownership; Electrum for broadcast.

**Known issues.** None recorded.
**Tests.** None.
**Source.** screen/settings/tools.js

## X-11 Feature flags

**Routes:** FeatureFlags
**Entry:** Settings, Feature Flags
**Tier:** Important

**Inputs.** Four switches with hardcoded English labels. All flags persist in AsyncStorage as `'1'`/`''` and default off. On a read error all are reset to off.

**Options.**
- LDS DEV API: switches lightning.space and Boltcard API base URLs from `REACT_APP_LDS_URL` to `REACT_APP_LDS_DEV_URL`; also shows the CHF Taproot wallet row in Settings.
- POS mode: shows the per-wallet POS-mode switch in Wallet details for lightning.space (`lightningLdsWallet`) wallets only; a wallet in POS mode receives via `PosReceive` instead of `LNDReceive`. Mutually exclusive with DFX Point of Sale (enabling one turns the other off).
- DFX Point of Sale: adds a Point of Sale tile to the DFX services buttons.
- DFX Swap: adds the Swap tile to the DFX services buttons.

**Behavior.** Always reachable from Settings; screen strings are not localized.

**Not supported.** Per-environment gating of the Feature Flags menu itself (always visible).

**Depends on.** AsyncStorage flag load/save; DFX services buttons and wallet details for flag effects; config keys `REACT_APP_LDS_URL` / `REACT_APP_LDS_DEV_URL`.

**Known issues.** None recorded.
**Tests.** tests/unit/settings-chf-taproot.test.js, tests/unit/storage-context.test.js, tests/unit/dfx-services-buttons.test.js
**Source.** screen/settings/FeatureFlags.tsx, blue_modules/storage-context.js, BlueApp.js

## X-12 About, self-test, licensing, release notes

**Routes:** About, Selftest, Licensing, ReleaseNotes
**Entry:** Settings, About
**Tier:** Nice

**Inputs.** About is mostly static content and navigation. Self-test runs after the user taps "Run self-test" / "Run self-test again" (hardcoded English). Performance test derives up to 1000 bech32 addresses within 10 s. Licensing is static MIT text. Release notes render bundled `release-notes.json`.

**Options.** About shows the DFX logo, "The DFX Bitcoin-only Wallet is a softfork from bluewallet.io with an integrated buy and sell option from DFX AG.", "Always backup your keys!", Leave us a review (Android only with Google Play services), Twitter/Telegram/GitHub links, Built with list, Release notes, MIT License, Run self-test, and "Test performance". Footer: app name, version, build and branch, build date, bundle id, window size, device Unique ID (copy as `userId:<id>`), and "Environment: X" when `DFX_ENV` is not prd. Licensing is MIT with "Copyright (c) 2018-2023 BlueWallet developers" and title "License" (no third-party dependency list). Release notes come from git log subjects/bodies since the previous tag (raw commit messages, not curated notes).

**Behavior.** Self-test is blocked when Offline Mode is on ("Self-testing is not available with Electrum Offline Mode. Please disable offline mode and try again."). Nothing runs on open until the user taps Run. A live step log shows ✓/✗ and timings; success shows "OK" plus "All internal tests have passed successfully. The wallet works well." Checks include key generation, Electrum connect/balance for a fixed address, Aezeed, signing, WIF, AES, BIP39/BIP32, HD wallets, scrypt, BIP38, SLIP39, `Linking.canOpenURL(https)`, multisig signing/import/export/cosign paths, and (in `__DEV__` only) Electrum history of a historical multisig withdrawal. Android only: "Test Save to Storage" writes/exports a storage save test file. Whether the Detox self-test assertion still matches the button-tap UI is not verified in code.

**Not supported.** Curated release notes (file lists raw commit messages). Third-party license inventory on the Licensing screen.

**Depends on.** Network for Electrum-backed self-test steps; Offline Mode must be off; `release-notes.json` bundled at build time; `DFX_ENV` for the environment footer line.

**Known issues.** None recorded.
**Tests.** tests/unit/settings-lightning-wallet.test.js, tests/integration/App.test.js, tests/e2e/onchain.spec.js (Detox: self-test passes)
**Source.** screen/settings/about.js, screen/selftest.js, screen/settings/licensing.js, screen/settings/releasenotes.js
