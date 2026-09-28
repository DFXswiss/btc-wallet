# App shell

Cold start, unlock, deep links, home-screen shortcuts, push notifications, screenshot protection, Continuity/Watch/widgets, and Electrum connectivity that wrap every wallet flow.

## A-01 First launch and onboarding

**Routes:** none
**Entry:** Cold start with no wallet
**Tier:** Critical

**Inputs.** Creating a wallet produces one `HDSegwitBech32Wallet` labelled for on-chain use. Advanced mode can collect optional user entropy. Import is offered from the same add-wallet screen via scanner or manual text.

**Options.** With advanced mode on, the create screen shows a wallet-type picker and an entropy link; the picker has no effect, a native SegWit wallet is always created (see W-01). Whether those advanced controls appear on a true first run: Not verified in code.

**Behavior.** With no wallets, the root stack opens Add Wallet. On create, the app signs an address-ownership proof for address index 0, saves the wallet, and replaces navigation to the home overview. Disclaimer text "Please note that by using this self-custodial wallet you automatically accept the disclaimer." opens the URL from config key `REACT_APP_DISCLAIMER_URL`. After the first wallet exists, home shows the backup banner "Backup your wallet" / "Backup not verified". There is no separate intro carousel or tutorial.

**Not supported.** Intro or tutorial screens.

**Depends on.** Config key `REACT_APP_DISCLAIMER_URL` for the disclaimer link. No external service is required to create the first on-chain wallet.

**Known issues.** None recorded.
**Tests.** `tests/unit/wallet-created-route.test.js`, `tests/unit/wallets-add.test.js`, `tests/e2e-maestro/flows/01-onboarding-onchain-wallet.yaml`, CF-01.
**Source.** navigation/index.tsx, screen/wallets/add.js, helpers/wallet-created-route.ts, screen/wallets/home.js

## A-02 Unlock at launch (password, biometrics)

**Routes:** UnlockWithScreen
**Entry:** Cold start with encrypted storage
**Tier:** Critical

**Inputs.** When storage is encrypted, unlock prompts "Enter password" under title "Your storage is encrypted. Password is required to decrypt it." A wrong password shows "Incorrect password. Please try again." Encryption setup (Settings, Security) asks for a password twice: "Create the password you will use to decrypt the storage." and "Re-type password"; mismatch shows "Passwords do not match."

**Options.** Storage encryption switch "Encrypted and Password Protected". Biometrics toggle (Face ID / Touch ID / Biometrics) with prompt "Please confirm your identity." Explanation: "{type} will be used to confirm your identity before making a transaction, unlocking, exporting, or deleting a wallet. {type} will not be used to unlock encrypted storage." Plausible deniability is offered only while storage is encrypted.

**Behavior.** Every cold start opens UnlockWithScreen. If storage is encrypted, `startAndDecrypt` loops until a non-empty password succeeds. After 10 failed attempts on iOS it offers a keychain wipe with "You have attempted to enter your password 10 times. Would you like to reset your storage? This will remove all wallets and decrypt your storage."; Android retries without that offer. The wipe path requires device biometrics or passcode ("Your device does not have a passcode. In order to proceed, please configure a passcode in the Settings app."), then confirm "All your wallets will be removed and your storage will be decrypted. Are you sure you want to proceed?", clears keystore entries, and returns to the wallets root. At launch the unlock screen takes the password/key path because biometric type is not loaded when the splash animation finishes; whether a biometric prompt can appear automatically at launch on a device: Not verified in code. Biometrics, when enabled, gate send confirm, PSBT multisig/hardware, OpenCryptoPay commit, LNURL pay, export, xpub, multisig cosigner/coordination export, wallet delete, and the transaction header. Turning encryption on clears quick actions and zeroes the widget balance; those privacy switches are then hidden.

**Not supported.** Using biometrics as the unlock for encrypted storage (password is required for that).

**Depends on.** Device keychain / biometrics (`react-native-biometrics` with device credentials allowed). Face ID usage string is declared in the iOS Info.plist.

**Known issues.** None recorded.
**Tests.** `tests/unit/storage.test.js`, `tests/unit/storage-context.test.js`, `tests/unit/blue-app.test.js`, `tests/unit/send-biometric-abort.test.js`, `tests/unit/send-confirm-branches.test.js`, `tests/unit/spark-wallet-export.test.js`, `tests/unit/wallet-details-spark.test.js`, CF-04.
**Source.** UnlockWith.js, BlueApp.js, class/biometrics.js, screen/settings/encryptStorage.js, screen/plausibledeniability.js

## A-03 Deep links and URI schemes

**Routes:** none
**Entry:** Opening bitcoin:, lightning:, LNURL or dfxtaro:// links
**Tier:** Important

**Inputs.** Recognized scheme prefixes: `bitcoin:`, `lightning:`, `blue:`, `bluewallet:`, `lapp:`, `dfxtaro:`, `spark:`. Also plain Bitcoin addresses, BIP21 URIs, `lnbc…` / `lntb…` invoices, Spark addresses and payment URIs, LNURL payloads, and Lightning addresses (`user@domain`). Widget actions use `bluewallet://widget?action=openSend` or `openReceive`. DFX hosts `buy`, `sell`, and `swap` under `bluewallet:`, `lapp:`, `blue:`, or `dfxtaro:`.

**Options.** none

**Behavior.** The same router handles OS link events, the initial URL, and in-app scanned or typed input. Nested `bluewallet:bitcoin:` / `dfxtaro:lightning:` style links are stripped to the inner payload. Valid on-chain destinations open send details; Lightning invoices, Spark payments, and Lightning addresses open the Lightning invoice scanner; LNURL opens Lightning invoice creation (which can forward to LNURL-pay). Host `buy` opens the home overview; `sell` and `swap` open the DFX sell/swap screens. OS registration covers those schemes on iOS and Android; Android also registers `bankid`, `swish`, `http`, and `https` filters and `.psbt` / image file intents. Commented-out branches disable signed-PSBT file open, Azteco redeem, watch-only import, Lapp browser, Electrum server set, and LNDHub URL set, so those file intents have no router path. DFX services open in an external browser with a `dfxtaro://` redirect that has an empty host and routes nowhere; which host the service calls back: Not verified in code. Purpose of the Android `http`/`https`/`bankid`/`swish` filters: Not verified in code. Opening a widget action with zero wallets would throw on `wallet.chain`: Not verified in code.

**Not supported.** Active routing for Azteco redeem, watch-only import via deep link, Lapp browser, `setelectrumserver`, `setlndhuburl`, and signed-PSBT file open (all commented out).

**Depends on.** OS URL / intent registration; `react-native` Linking.

**Known issues.** None recorded.
**Tests.** `tests/unit/deeplink-schema-match.test.js`, `tests/unit/scan-lnd-invoice-spark.test.js`, `tests/unit/spark-home.test.js`, `tests/unit/asset-dfx-services.test.js`, `tests/e2e-maestro/flows/10-lnurl-auth.yaml`.
**Source.** class/deeplink-schema-match.js, App.js, ios/BlueWallet/Info.plist, android/app/src/main/AndroidManifest.xml

## A-04 Quick actions

**Routes:** none
**Entry:** Long press on the app icon
**Tier:** Nice

**Inputs.** none

**Options.** Settings, Privacy switch "Wallet Shortcuts" (explanation: "Touch and hold the DFX Bitcoin Wallet app icon on your Home Screen to quickly view your wallet’s balance."), default on. Hidden when storage is encrypted.

**Behavior.** Up to four wallets appear as shortcuts: title is the wallet label, subtitle is the formatted balance unless balances are hidden or the balance is ≤ 0. Tapping opens the home overview for that wallet via payload `bluewallet://wallet/<id>`. Encryption clears the shortcuts.

**Not supported.** Windows (stub implementation). Shortcuts while storage is encrypted.

**Depends on.** `react-native-quick-actions`.

**Known issues.** None recorded.
**Tests.** Mocked in `tests/setup.js`; `tests/e2e/bluewallet.spec.js` toggles the switch (Detox suite not in CI workflows).
**Source.** class/quick-actions.js, App.js, screen/settings/SettingsPrivacy.js

## A-05 Push notifications

**Routes:** none
**Entry:** Tap on a system notification
**Tier:** Important

**Inputs.** Permission prompt: "Would you like to receive notifications when you get incoming payments?" with "No, and don’t ask me again". NotificationSettings accepts a GroundControl base URI (validated with `/ping`); invalid URI shows "Invalid URI", success shows "Saved".

**Options.** Custom GroundControl URI in Settings, Network, Notifications. Explanation describes GroundControl as a free open-source push server and that a blank value uses the default. Leave blank to use the built-in default `groundControlUri`.

**Behavior.** After wallets initialize, the app subscribes wallet external addresses on wallet add, transaction ids after broadcast, and Lightning payment hashes after invoice creation. Tap handling: payload types 2/3 match by address, types 1/4 by txid/hash; tap opens the home overview, or on-chain Receive for type 3. Android needs Google or Huawei services; FCM auto-init is disabled in the manifest. iOS badge and delivered-notification APIs are iOS-only. Android permission rationale is shown only below API 33.

**Not supported.** Push on Android devices without Google or Huawei services.

**Depends on.** BlueWallet GroundControl protocol; `react-native-notifications`, `react-native-permissions`.

**Known issues.** None recorded.
**Tests.** `tests/integration/notifications.test.js`.
**Source.** blue_modules/notifications.ts, hooks/useCompanionListeners.ts, screen/settings/notificationSettings.tsx, blue_modules/constants.js

## A-06 Screenshot protection on sensitive screens

**Routes:** none
**Entry:** Automatic
**Tier:** Important

**Inputs.** none

**Options.** Settings, Privacy switch "Prevent Screenshots" (explanation: "Block screenshots and screen recording on sensitive screens, such as your backup phrase, keys and addresses. Off by default."). Stored default is off; read errors fail closed to protected. Related privacy controls on the same screen: clipboard reading, quick actions, widget total balance (iOS), "Disable Analytics" ("Performance and reliability information will not be submitted for analysis."), and a link to OS app settings.

**Behavior.** When protection is on, sensitive screens call blur/capture prevention for screenshots, recording, and the app switcher, with a branded splash cover. Screens that enable it include wallet export, cosigner view, import, LNDHub backup, addresses, multisig coordination export, PleaseBackup, xpub, and send/create. The module reference starts protected until the setting is mounted.

**Not supported.** None.

**Depends on.** `react-native-capture-protection`.

**Known issues.** None recorded.
**Tests.** `tests/unit/blue-app.test.js`, `tests/unit/storage-context.test.js`, `tests/unit/spark-wallet-export.test.js`; Maestro flows 19, 23, 24 mention privacy; Detox `tests/e2e/bluewallet.spec.js`.
**Source.** blue_modules/Privacy.tsx, BlueApp.js, screen/settings/SettingsPrivacy.js

## A-07 Handoff, Apple Watch and widgets

**Routes:** none
**Entry:** Not shipped
**Tier:** Nice

**Inputs.** Widget-action URLs `bluewallet://widget?action=openSend` or `openReceive` (handled by the deep-link router when present).

**Options.** Settings, Privacy "Total Balance" / "Display the total balance of all your wallets on your home screen widgets." (iOS only; hidden when storage is encrypted). Settings, General "Continuity" (iOS only).

**Behavior.** These surfaces are not shipped in the current native project. Apple Watch connectivity code can push wallets/transactions and handle watch messages, but the Xcode project has no watchOS application target (only a leftover ComplicationController source), so no Watch app ships from this project; whether a built IPA differs: Not verified in code. Widget Swift sources exist, but there is no widget extension target in the Xcode project and no Android AppWidgetProvider, so widgets are not built; Not verified in code against an IPA. When encryption is on or balance display is disabled, the iOS widget communication path writes a zero balance. The handoff component the bundler resolves (`components/handoff.js`) declares activity types under `swiss.dfx.bitcoin.*`, and the two that Info.plist lists (`receiveonchain`, `xpub`) match; the unused `.tsx` twin still carries the upstream `io.bluewallet.bluewallet.*` strings. Whether Continuity works on a device: Not verified in code.

**Not supported.** Shipping Apple Watch or home-screen widgets from this project’s current native targets.

**Depends on.** `react-native-widget-center`, `react-native-default-preference`; WatchConnectivity JS path on iOS only.

**Known issues.** None recorded.
**Tests.** `tests/unit/watch-connectivity.test.js`.
**Source.** WatchConnectivity.ios.js, blue_modules/WidgetCommunication.ios.js, components/handoff.js, screen/settings/SettingsPrivacy.js, screen/settings/GeneralSettings.tsx, ios/BlueWallet.xcodeproj/project.pbxproj

## A-08 Electrum connection and offline behaviour

**Routes:** none
**Entry:** Automatic
**Tier:** Critical

**Inputs.** Optional custom Electrum host and port in Settings, Network, Electrum Server. Status shows "Connected" or "Not Connected".

**Options.** User-configured server overrides the built-in peer list. "Offline Mode" ("When enabled, your Bitcoin wallets will not attempt to fetch balances or transactions.") disables every Electrum fetch. On desktop, Tor/onion hosts are refused with "Tor connections are not supported."; on mobile a .onion host typed by hand is accepted and switched to TCP without SSL (a server restored from the history or scanned from a QR code keeps its saved SSL setting); no Tor transport is bundled, and whether such a host can connect is not verified in code.

**Behavior.** A hard-coded list of eight public Electrum servers starts at a random index and rotates on failure; after a successful connection the peer rotates every 30 minutes. Socket errors close and reconnect; handshake timeout is 10 s; `waitTillConnected` rejects after 5 s with "Electrum connection timed out". NetInfo marks the device offline (connect returns immediately) and reconnects on each offline→online transition. App foreground refreshes exchange rate and balance polling; background stops polling. In Offline Mode, receive derives the next address locally without a server lookup, CPFP/RBF "Send now" is disabled, and self-test is refused ("Self-testing is not available with Electrum Offline Mode. Please disable offline mode and try again."). When the server is unreachable without Offline Mode: receive falls back after 1 s to a locally derived address that may already be used (no warning); incoming-payment polling fails silently; the transaction list keeps cached rows; TransactionStatus confirmation polling fails silently and RBF/CPFP actions stay hidden; broadcast shows the error. Wallet, list, receive, and status screens have no offline banner—connectivity is visible only on the Electrum settings screen.

**Not supported.** Tor transport for Electrum: a .onion host is refused on desktop and accepted on mobile without a Tor transport (connection not verified in code). Offline banners on wallet or receive screens.

**Depends on.** Electrum peers (built-in list or user server); device network state via NetInfo.

**Known issues.** None recorded.
**Tests.** `tests/unit/storage-context.test.js`, `tests/unit/electrumBatchingDetection.test.js`, `tests/unit/fetchUtxoBatching.test.js`, `tests/integration/BlueElectrum.test.js`, CF-02, CF-03.
**Source.** blue_modules/BlueElectrum.js, App.js, screen/settings/electrumSettings.js, screen/receive/details.js, blue_modules/storage-context.js
