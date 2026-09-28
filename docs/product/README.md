# Product feature inventory

This inventory lists every user-facing capability of the app. Each row is one capability, with a matching details entry under `docs/product/features/`.

It is the product view of what the app does, and the base for the release-critical flows in [critical-flows.md](critical-flows.md).

## How to read it

IDs use the form `<PREFIX>-<NN>` (two digits). Prefixes: A app shell, W wallets, R receive, T transactions, S send, L lightning, B boltcard, D DFX services, O OpenCryptoPay, X settings. The Lightning prefix spans two areas: L-01 to L-08 are Lightning wallets and L-10 to L-18 Lightning payments; L-09 is not used. Critical flows use `CF-<NN>`.

Columns:

| Column | Meaning |
| --- | --- |
| ID | Stable identifier for the capability |
| Capability | Short name of what the user can do |
| Entry point | Where the user starts this capability in the UI |
| Tier | Release priority (see Tiers) |
| Flows | Critical flows that cover this row, or `—` if none |
| Details | Link to the full entry in the area file |

"Not reachable in the current build" means the screen is still registered in navigation, but there is no path from the UI to open it.

The Flows column lists the critical flows that name the row under Covers.

## Tiers

- **Critical:** a release must not ship if it is broken.
- **Critical (DFX):** same, but DFX specific; marked separately so it is never dropped as "covered upstream".
- **Important:** tested before a release, may ship with a known defect if documented.
- **Nice:** best effort.

## App shell

| ID | Capability | Entry point | Tier | Flows | Details |
| --- | --- | --- | --- | --- | --- |
| A-01 | First launch and onboarding | Cold start with no wallet | Critical | CF-01 | [details](features/app-shell.md#a-01-first-launch-and-onboarding) |
| A-02 | Unlock at launch (password, biometrics) | Cold start with encrypted storage | Critical | CF-04 | [details](features/app-shell.md#a-02-unlock-at-launch-password-biometrics) |
| A-03 | Deep links and URI schemes | Opening bitcoin:, lightning:, LNURL or dfxtaro:// links | Important | — | [details](features/app-shell.md#a-03-deep-links-and-uri-schemes) |
| A-04 | Quick actions | Long press on the app icon | Nice | — | [details](features/app-shell.md#a-04-quick-actions) |
| A-05 | Push notifications | Tap on a system notification | Important | — | [details](features/app-shell.md#a-05-push-notifications) |
| A-06 | Screenshot protection on sensitive screens | Automatic | Important | — | [details](features/app-shell.md#a-06-screenshot-protection-on-sensitive-screens) |
| A-07 | Handoff, Apple Watch and widgets | Not shipped | Nice | — | [details](features/app-shell.md#a-07-handoff-apple-watch-and-widgets) |
| A-08 | Electrum connection and offline behaviour | Automatic | Critical | CF-02, CF-03 | [details](features/app-shell.md#a-08-electrum-connection-and-offline-behaviour) |

## Wallets

| ID | Capability | Entry point | Tier | Flows | Details |
| --- | --- | --- | --- | --- | --- |
| W-01 | Create on-chain wallet | First launch; after deleting the main wallet | Critical | CF-01 | [details](features/wallets.md#w-01-create-on-chain-wallet) |
| W-02 | Import wallet | Add wallet, Import wallet | Critical | CF-03, CF-08 | [details](features/wallets.md#w-02-import-wallet) |
| W-03 | Recovery phrase backup | Home backup banner; Settings, wallet, Export | Critical | CF-01 | [details](features/wallets.md#w-03-recovery-phrase-backup) |
| W-04 | Home overview | After unlock | Critical | CF-01 | [details](features/wallets.md#w-04-home-overview) |
| W-05 | Wallet screen | Home, wallet row | Critical | CF-01 | [details](features/wallets.md#w-05-wallet-screen) |
| W-06 | Wallet details and delete | Settings, wallet row | Important | CF-01 | [details](features/wallets.md#w-06-wallet-details-and-delete) |
| W-07 | Extended public key export | Wallet details, Show XPUB | Important | — | [details](features/wallets.md#w-07-extended-public-key-export) |
| W-08 | Addresses | Wallet details, Addresses | Important | — | [details](features/wallets.md#w-08-addresses) |
| W-09 | Sign and verify message | Wallet details; address list | Important | — | [details](features/wallets.md#w-09-sign-and-verify-message) |
| W-10 | Payment codes (BIP47) | Not reachable in the current build | Nice | — | [details](features/wallets.md#w-10-payment-codes-bip47) |
| W-11 | Wallet picker and reorder | Used by other flows | Nice | — | [details](features/wallets.md#w-11-wallet-picker-and-reorder) |
| W-12 | Multi-device wallet: create | Home, Multi-Device row, Add | Important | — | [details](features/wallets.md#w-12-multi-device-wallet-create) |
| W-13 | Multi-device wallet: import | Home, Multi-Device row, Import | Important | — | [details](features/wallets.md#w-13-multi-device-wallet-import) |
| W-14 | Multi-device wallet: cosigners and coordination export | Wallet details | Important | — | [details](features/wallets.md#w-14-multi-device-wallet-cosigners-and-coordination-export) |

## Receive

| ID | Capability | Entry point | Tier | Flows | Details |
| --- | --- | --- | --- | --- | --- |
| R-01 | Receive on-chain | Wallet screen, Receive (home Receive: multi-device wallet first, else the main wallet when no Lightning wallet exists) | Critical | CF-01, CF-02 | [details](features/receive.md#r-01-receive-on-chain) |
| R-02 | Azteco voucher redeem | Not reachable in the current build | Nice | — | [details](features/receive.md#r-02-azteco-voucher-redeem) |

## Transactions

| ID | Capability | Entry point | Tier | Flows | Details |
| --- | --- | --- | --- | --- | --- |
| T-01 | Transaction list | Wallet screen | Critical | CF-02, CF-03 | [details](features/transactions.md#t-01-transaction-list) |
| T-02 | Transaction status and details | Transaction row | Critical | CF-02 | [details](features/transactions.md#t-02-transaction-status-and-details) |
| T-03 | Fee bump and cancel (RBF, CPFP) | Transaction status | Important | — | [details](features/transactions.md#t-03-fee-bump-and-cancel-rbf-cpfp) |
| T-04 | Fiat rates and fee estimates | Automatic | Important | — | [details](features/transactions.md#t-04-fiat-rates-and-fee-estimates) |

## Send

| ID | Capability | Entry point | Tier | Flows | Details |
| --- | --- | --- | --- | --- | --- |
| S-01 | Send on-chain: destination | Home or wallet screen, Send | Critical | CF-03 | [details](features/send.md#s-01-send-on-chain-destination) |
| S-02 | Send on-chain: amount, fee, confirm, broadcast | After the destination | Critical | CF-03 | [details](features/send.md#s-02-send-on-chain-amount-fee-confirm-broadcast) |
| S-03 | Coin control | Send details, when coins are frozen | Important | — | [details](features/send.md#s-03-coin-control) |
| S-04 | Sign with a hardware or watch-only wallet (PSBT) | Send details of a watch-only wallet | Important | — | [details](features/send.md#s-04-sign-with-a-hardware-or-watch-only-wallet-psbt) |
| S-05 | Multi-device co-signing | Send from a multi-device wallet; scanned PSBT | Important | — | [details](features/send.md#s-05-multi-device-co-signing) |
| S-06 | QR scanner | Scan buttons | Critical | CF-09 | [details](features/send.md#s-06-qr-scanner) |
| S-07 | Broadcast raw transaction | Settings, Tools | Nice | — | [details](features/send.md#s-07-broadcast-raw-transaction) |
| S-08 | Is it my address | Settings, Tools | Nice | — | [details](features/send.md#s-08-is-it-my-address) |

## Lightning wallets

| ID | Capability | Entry point | Tier | Flows | Details |
| --- | --- | --- | --- | --- | --- |
| L-01 | Spark wallet (self-custodial Lightning) | Home, Lightning row, Add | Critical (DFX) | CF-05 | [details](features/lightning-wallets.md#l-01-spark-wallet-self-custodial-lightning) |
| L-02 | Lightning slot and provider precedence | Home | Critical (DFX) | CF-05 | [details](features/lightning-wallets.md#l-02-lightning-slot-and-provider-precedence) |
| L-03 | Lightning recovery on import | Import wallet | Critical (DFX) | CF-08 | [details](features/lightning-wallets.md#l-03-lightning-recovery-on-import) |
| L-04 | Lightning address | Spark receive | Important | — | [details](features/lightning-wallets.md#l-04-lightning-address) |
| L-05 | Spark on-chain deposits | Automatic | Important | — | [details](features/lightning-wallets.md#l-05-spark-on-chain-deposits) |
| L-06 | Spark recovery phrase export | Settings, Lightning wallet, Export | Critical (DFX) | CF-05 | [details](features/lightning-wallets.md#l-06-spark-recovery-phrase-export) |
| L-07 | lightning.space wallet and provider picker | Settings, CHF Taproot Wallet (LDS DEV API flag) | Important | — | [details](features/lightning-wallets.md#l-07-lightningspace-wallet-and-provider-picker) |
| L-08 | Generic LNDHub wallet (legacy) | Not reachable in the current build | Nice | — | [details](features/lightning-wallets.md#l-08-generic-lndhub-wallet-legacy) |

## Lightning payments

| ID | Capability | Entry point | Tier | Flows | Details |
| --- | --- | --- | --- | --- | --- |
| L-10 | Receive Lightning: invoice with amount | Home Receive when no multi-device wallet exists; Lightning wallet, Receive | Critical (DFX) | CF-05, CF-06 | [details](features/lightning-payments.md#l-10-receive-lightning-invoice-with-amount) |
| L-11 | Receive Lightning: static address QR | Lightning receive without an amount | Important | CF-06 | [details](features/lightning-payments.md#l-11-receive-lightning-static-address-qr) |
| L-12 | Invoice view, paid state, preimage | Lightning transaction row | Important | CF-06 | [details](features/lightning-payments.md#l-12-invoice-view-paid-state-preimage) |
| L-13 | Pay Lightning: invoice, address, LNURL-pay | Send with a Lightning destination | Critical (DFX) | CF-07, CF-11 | [details](features/lightning-payments.md#l-13-pay-lightning-invoice-address-lnurl-pay) |
| L-14 | LNURL-auth login | Scanned LNURL-auth code | Critical (DFX) | CF-09 | [details](features/lightning-payments.md#l-14-lnurl-auth-login) |
| L-15 | LNURL routing and LNURL-withdraw | Scanned LNURL | Important | CF-09 | [details](features/lightning-payments.md#l-15-lnurl-routing-and-lnurl-withdraw) |
| L-16 | Point of sale (LNDHub POS mode) | POS mode flag | Nice | — | [details](features/lightning-payments.md#l-16-point-of-sale-lndhub-pos-mode) |
| L-17 | LApp browser (WebLN) | Not reachable in the current build | Nice | — | [details](features/lightning-payments.md#l-17-lapp-browser-webln) |
| L-18 | Lightning rows in history | Wallet screen | Important | CF-06, CF-07, CF-10 | [details](features/lightning-payments.md#l-18-lightning-rows-in-history) |

## Boltcard

| ID | Capability | Entry point | Tier | Flows | Details |
| --- | --- | --- | --- | --- | --- |
| B-01 | Create and program a card | Wallet screen, Cards, Add | Important | — | [details](features/boltcard.md#b-01-create-and-program-a-card) |
| B-02 | Card details, limits, pause, delete | Wallet screen, card | Important | — | [details](features/boltcard.md#b-02-card-details-limits-pause-delete) |
| B-03 | Card backup | Wallet details | Nice | — | [details](features/boltcard.md#b-03-card-backup) |
| B-04 | Tap a card | Scanner, NFC button | Important | — | [details](features/boltcard.md#b-04-tap-a-card) |

## DFX services

| ID | Capability | Entry point | Tier | Flows | Details |
| --- | --- | --- | --- | --- | --- |
| D-01 | DFX session and login | Automatic on the home screen | Critical (DFX) | CF-10, CF-11 | [details](features/dfx-services.md#d-01-dfx-session-and-login) |
| D-02 | Buy | Home, Buy | Critical (DFX) | CF-10 | [details](features/dfx-services.md#d-02-buy) |
| D-03 | Sell | Home, Sell; return through the dfxtaro://sell link | Critical (DFX) | CF-11 | [details](features/dfx-services.md#d-03-sell) |
| D-04 | Swap | Home, Swap (DFX Swap flag) | Important | — | [details](features/dfx-services.md#d-04-swap) |
| D-05 | DFX point of sale | Home, POS (DFX Point of Sale flag) | Nice | — | [details](features/dfx-services.md#d-05-dfx-point-of-sale) |

## OpenCryptoPay

| ID | Capability | Entry point | Tier | Flows | Details |
| --- | --- | --- | --- | --- | --- |
| O-01 | Pay an OpenCryptoPay request | Scanned payment request | Important | — | [details](features/open-crypto-pay.md#o-01-pay-an-opencryptopay-request) |

## Settings

| ID | Capability | Entry point | Tier | Flows | Details |
| --- | --- | --- | --- | --- | --- |
| X-01 | Settings menu | Home, more icon | Important | — | [details](features/settings.md#x-01-settings-menu) |
| X-02 | General and privacy settings | Settings, General | Important | — | [details](features/settings.md#x-02-general-and-privacy-settings) |
| X-03 | Currency | Settings, Currency | Important | — | [details](features/settings.md#x-03-currency) |
| X-04 | Language | Settings, Language | Important | — | [details](features/settings.md#x-04-language) |
| X-05 | Default view on launch | Not reachable in the current build | Nice | — | [details](features/settings.md#x-05-default-view-on-launch) |
| X-06 | Network and Electrum server | Settings, Network | Important | — | [details](features/settings.md#x-06-network-and-electrum-server) |
| X-07 | Notification settings | Settings, Network, Notifications | Important | — | [details](features/settings.md#x-07-notification-settings) |
| X-08 | Storage encryption and biometrics | Settings, Security | Critical | CF-04 | [details](features/settings.md#x-08-storage-encryption-and-biometrics) |
| X-09 | Plausible deniability | Settings, Security, while encrypted | Important | CF-04 | [details](features/settings.md#x-09-plausible-deniability) |
| X-10 | Tools | Settings, Tools | Nice | — | [details](features/settings.md#x-10-tools) |
| X-11 | Feature flags | Settings, Feature Flags | Important | — | [details](features/settings.md#x-11-feature-flags) |
| X-12 | About, self-test, licensing, release notes | Settings, About | Nice | — | [details](features/settings.md#x-12-about-self-test-licensing-release-notes) |

## Keeping it current

A pull request that adds, renames or removes a screen must update the matching inventory row and its details entry. `npm run unit` runs `tests/unit/product-inventory.test.js`, which runs `scripts/product/check-inventory.js`. The checker fails on an unclaimed or double-claimed screen, a row without an entry or an entry without a row, a Critical row without a flow, a Flows column that does not match the flows file, or a broken details link. Run `node scripts/product/check-inventory.js` directly to check the same rules.

## Related documents

- [critical-flows.md](critical-flows.md): the eleven flows that must pass before a release
- Handbook screenshots under [docs/handbook](../handbook)
- Maestro suite under [tests/e2e-maestro](../../tests/e2e-maestro)
