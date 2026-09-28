# Critical flows

These flows must pass before a release. Each flow names the inventory rows it proves. The Automation field tells whether a script runs it and what remains manual. Funded flows need real sats and are run by a person with the team's test funds.

## Preconditions for every flow

- A build of the current branch on a device or simulator
- Mainnet only (the app has no test network)
- Electrum reachable
- For Spark flows: a build with the Breez API key
- For DFX flows: a tradable account on a local DFX stack
- Funded flows: the amounts from the Funding line

## CF-01 Create a wallet, back it up, show a receive address

**Covers:** A-01, W-01, W-03, W-04, W-05, W-06, R-01
**Tier:** Critical
**Funding:** none
**Preconditions.** Cold start with no wallet on the device.
**Steps.**
1. Launch the app with no wallet present; the add-wallet screen opens.
2. Tap Create; the app lands on Home with the new on-chain wallet.
3. Open the backup banner (or Settings, wallet, Export) and complete recovery phrase backup.
4. Confirm Home shows the new wallet overview after unlock.
5. Open the wallet row to the wallet screen.
6. Tap Receive and confirm a mainnet on-chain address and QR are shown (BIP21 with amount and label if offered).
7. From Settings, open the wallet row (wallet details) and confirm the wallet can be deleted; deleting the only wallet resets the app to first launch.
**Expected.** A receive address is visible; the wallet survives a restart; deleting the only wallet returns the app to the add-wallet screen.
**Automation.** `tests/e2e/onchain.spec.js` (Detox on Android, pull request #280): self-test, wallet survives a restart, mainnet receive address, BIP21 with amount and label, deleting the only wallet resets the app.

## CF-02 Receive on-chain and watch the transaction confirm

**Covers:** R-01, T-01, T-02, A-08
**Tier:** Critical
**Funding:** on-chain sats from an external wallet
**Preconditions.** An on-chain wallet with a receive address; Electrum reachable; an external wallet that can send mainnet sats.
**Steps.**
1. Open the wallet screen and tap Receive; copy or show the on-chain address.
2. From an external wallet, send a small amount of on-chain sats to that address.
3. Return to the wallet screen and wait for Electrum to report the incoming transaction.
4. Confirm the transaction appears in the transaction list with the expected amount.
5. Open the transaction row and watch status move from unconfirmed toward confirmed.
6. Confirm Electrum stays connected (or recovers) while the status updates.
**Expected.** The incoming payment is listed with the correct amount; transaction status and details update as confirmations arrive.
**Automation.** Manual until an automated flow receives real coins. A person checks the list row, amount, and confirmation progress on device.

## CF-03 Restore from a recovery phrase and send on-chain

**Covers:** W-02, S-01, S-02, S-06, T-01, A-08
**Tier:** Critical
**Funding:** on-chain sats on the test phrase
**Preconditions.** A known recovery phrase that holds on-chain sats; Electrum reachable.
**Steps.**
1. From Add wallet, choose Import wallet and enter the recovery phrase (or scan it via the QR scanner).
2. Complete import discovery and land on Home with the restored balance.
3. From Home or the wallet screen, tap Send.
4. Scan a destination QR code, or type the address by hand.
5. Enter an amount, choose a fee, and review the confirm screen.
6. Build and sign the transaction; check amount and fee on the success or create-transaction screen.
7. Tap Send now and confirm the outgoing row appears in the transaction list.
**Expected.** The restored wallet shows its balance; a signed send shows the correct amount and fee; after broadcast, the history lists the outgoing payment.
**Automation.** `tests/e2e/onchain-send.spec.js` (#280, funded lane) builds and signs the transaction and checks amount and fee, but never broadcasts; the broadcast step is manual.

## CF-04 Encrypt storage, relaunch, unlock, use the decoy password

**Covers:** X-08, X-09, A-02
**Tier:** Critical
**Funding:** none
**Preconditions.** An existing wallet; storage not yet encrypted (or encryption can be reconfigured for the test).
**Steps.**
1. Open Home, tap the more icon, open Settings, then Security.
2. Enable storage encryption and set a primary password.
3. While encrypted, open Plausible deniability and set a decoy password as documented in that screen.
4. Force-quit and cold-start the app.
5. On the unlock screen, enter the primary password and confirm the real wallet appears.
6. Force-quit again, unlock with the decoy password, and confirm the decoy vault is shown instead of the real wallet.
**Expected.** Cold start requires unlock; the primary password opens the real vault; the decoy password opens the deniable vault.
**Automation.** `tests/e2e/encrypted-storage.spec.js` (#280).

## CF-05 Add a Spark Lightning wallet, create an invoice, export its recovery phrase

**Covers:** L-01, L-02, L-06, L-10
**Tier:** Critical (DFX)
**Funding:** none; needs a build with the Breez API key
**Preconditions.** Build includes the Breez API key; Home is available with an on-chain wallet.
**Steps.**
1. On Home, open the Lightning row and tap Add to create a Spark wallet.
2. Confirm Home shows Spark in the Lightning slot with the expected provider precedence.
3. From Home Receive or the Lightning wallet Receive path, create an invoice with an amount.
4. Confirm the invoice QR and payment request are shown.
5. Open Settings, Lightning, Export; accept the notice and continue.
6. Confirm the 12-word Spark recovery phrase is displayed.
**Expected.** Spark is the active Lightning wallet; an amount invoice is creatable; the Spark recovery phrase can be exported.
**Automation.** `tests/e2e/spark.spec.js` (#280).

## CF-06 Receive Lightning on Spark

**Covers:** L-10, L-11, L-12, L-18
**Tier:** Critical (DFX)
**Funding:** Lightning sats from an external payer
**Preconditions.** Spark wallet present; external payer that can pay a Lightning invoice or address.
**Steps.**
1. Open Lightning receive and create an invoice with an amount; copy or show the invoice.
2. Have an external payer settle that invoice.
3. Open the Lightning transaction row and confirm paid state (and preimage when shown).
4. Open Lightning receive without an amount and show the static address QR.
5. Optionally receive a second payment to the static address from the external payer.
6. On the wallet screen, confirm Lightning rows appear in history with the received amounts.
**Expected.** Paid invoice shows paid state; static receive works; history lists the Lightning receives.
**Automation.** Manual. A person pays from an external wallet and checks paid state, preimage, and history rows on device.

## CF-07 Pay a Lightning invoice and a Lightning address from Spark

**Covers:** L-13, L-18
**Tier:** Critical (DFX)
**Funding:** a few hundred sats on the Spark wallet
**Preconditions.** Spark wallet funded with a few hundred sats; a Lightning invoice and a Lightning address under team control.
**Steps.**
1. From Send with a Lightning destination, scan or paste a Lightning invoice.
2. Review the quote (amount and fee) and confirm payment.
3. Confirm the outgoing Lightning row appears in history.
4. Start Send again and enter a Lightning address (or LNURL-pay destination).
5. Complete the pay flow to a team-controlled address.
6. Confirm the second outgoing row and the reduced Spark balance.
**Expected.** Both payments succeed; history shows the Lightning spends; balance drops by the spent amounts.
**Automation.** `tests/e2e/spark-send.spec.js` (#280, quotes only) and `tests/e2e/spark-pay.spec.js` (#280, spends sats to a team-controlled address).

## CF-08 Restore a phrase that already has a Spark wallet

**Covers:** W-02, L-03
**Tier:** Critical (DFX)
**Funding:** sats on the Spark side so the recovered balance is visible
**Preconditions.** A recovery phrase tied to an existing Spark identity with a known balance; build with the Breez API key.
**Steps.**
1. Start with no wallet (or delete the current wallet) and open Import wallet.
2. Enter the recovery phrase that already has a Spark wallet.
3. Complete import discovery and confirm the on-chain wallet is restored.
4. Confirm Lightning recovery runs and the Spark wallet reappears in the Lightning slot.
5. Open the Lightning wallet and check the recovered balance against the known funded amount.
6. Confirm Home shows both the restored on-chain and Spark wallets.
**Expected.** Import restores the phrase; Spark balance is visible after Lightning recovery.
**Automation.** `tests/e2e-maestro/_setup-import.yaml` imports a fixed Spark identity; the balance check is manual.

## CF-09 Log in to DFX with LNURL-auth

**Covers:** L-14, L-15
**Tier:** Critical (DFX)
**Funding:** none
**Preconditions.** Spark (or Lightning) available for LNURL handling; a DFX LNURL-auth challenge available to scan.
**Steps.**
1. Scan a DFX LNURL-auth code from Send/scan.
2. Confirm the login prompt names the DFX domain.
3. Approve the login prompt for the DFX domain.
4. Scan or open an LNURL that is not a DFX domain and confirm Spark rejects non-DFX domains as expected.
5. Scan an LNURL-pay code and confirm it opens the Lightning pay screen instead.
**Expected.** The DFX LNURL-auth prompt is shown; non-DFX domains are rejected by Spark; routing still hands off other LNURL types.
**Automation.** `tests/e2e-maestro/flows/10-lnurl-auth.yaml` (asserts the prompt and the Spark rejection of non-DFX domains; a successful login is not asserted).

## CF-10 Buy through DFX until the Spark payout arrives

**Covers:** D-01, D-02, L-18
**Tier:** Critical (DFX)
**Funding:** none in the wallet; a tradable account on a local DFX stack
**Preconditions.** Local DFX stack with a tradable account; Spark wallet present; DFX session available on Home.
**Steps.**
1. Open Home and confirm the Buy tile is shown, which means the DFX session is established.
2. Tap Buy. The DFX web app opens in the browser with the Spark wallet as the target.
3. Enter a small amount and confirm; the payment information with IBAN and BIC is shown.
4. Settle the incoming bank payment on the local DFX stack (simulated, no real transfer).
5. Wait until DFX pays out to the Spark wallet, then reopen the app.
6. Confirm the Lightning history row for the payout and that the Spark balance increased.
**Expected.** The buy completes on the DFX side; Spark receives the payout; history shows the Lightning credit.
**Automation.** `tests/e2e-maestro/flows/16-dfx-buy-to-payment.yaml`.

## CF-11 Sell through DFX from Spark

**Covers:** D-01, D-03, L-13
**Tier:** Critical (DFX)
**Funding:** the Spark payout from CF-10
**Preconditions.** Same identity as CF-10; Spark holds the payout from CF-10; local DFX stack reachable.
**Steps.**
1. On Home, confirm the Sell tile is shown.
2. Tap Sell. The DFX web app opens; enter the amount to sell from Spark and the bank account.
3. The web app returns to the wallet through the sell link; the wallet shows the confirmation with amount, IBAN and currency.
4. Tap "Cash out to bank account"; the wallet pays the DFX deposit over Lightning from Spark.
5. Confirm the Spark balance decreased by the sold amount plus fee.
6. Confirm the sell reaches completed on the local DFX stack.
**Expected.** The sell pays from Spark; the balance drops; the sell completes on DFX.
**Automation.** `tests/e2e-maestro/flows/17-dfx-sell-to-payment.yaml` (runs after CF-10 on the same identity).

## Coverage

| Row | Tier | Flows |
| --- | --- | --- |
| A-01 | Critical | CF-01 |
| A-02 | Critical | CF-04 |
| A-08 | Critical | CF-02, CF-03 |
| W-01 | Critical | CF-01 |
| W-02 | Critical | CF-03, CF-08 |
| W-03 | Critical | CF-01 |
| W-04 | Critical | CF-01 |
| W-05 | Critical | CF-01 |
| R-01 | Critical | CF-01, CF-02 |
| T-01 | Critical | CF-02, CF-03 |
| T-02 | Critical | CF-02 |
| S-01 | Critical | CF-03 |
| S-02 | Critical | CF-03 |
| S-06 | Critical | CF-03 |
| L-01 | Critical (DFX) | CF-05 |
| L-02 | Critical (DFX) | CF-05 |
| L-03 | Critical (DFX) | CF-08 |
| L-06 | Critical (DFX) | CF-05 |
| L-10 | Critical (DFX) | CF-05, CF-06 |
| L-13 | Critical (DFX) | CF-07, CF-11 |
| L-14 | Critical (DFX) | CF-09 |
| D-01 | Critical (DFX) | CF-10, CF-11 |
| D-02 | Critical (DFX) | CF-10 |
| D-03 | Critical (DFX) | CF-11 |
| X-08 | Critical | CF-04 |

Every Critical row above is covered by at least one flow, and the checker enforces it.
