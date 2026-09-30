# Critical flows

These flows must pass before a release. Each flow names the inventory rows it proves. The Automation field tells whether a script runs it and what remains manual; the Detox specs it cites run on an Android emulator in the `Tests e2e Android` workflow: job `detox` runs the suites without funds on pull requests that are not drafts (on a draft only with the `ci:full` label), and job `detox-funded` runs the funded suites when the `e2e:funded` label is added and a reviewer releases the protected `e2e-funded` environment. Neither job blocks a merge yet. Funded flows need real sats and are run by a person with the team's test funds.

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
   **Automation.** `tests/e2e/onchain.spec.js` (Detox on Android): self-test, wallet survives a restart, mainnet receive address, BIP21 with amount and label, deleting the only wallet resets the app.

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
   **Automation.** `tests/e2e/transactions.spec.js` (skipped for now: the first load of its public wallet from a random public Electrum server takes from 20 s to over 5 minutes) checks the list order and each row's value, fee and confirmations against a public explorer on a public wallet's confirmed history, and `tests/e2e/onchain-send.spec.js` (funded) does the same for the newest transaction of the funded wallet; receiving a new payment and watching it confirm stays manual.

## CF-03 Restore from a recovery phrase and send on-chain

**Covers:** W-02, S-01, S-02, T-01, A-08
**Tier:** Critical
**Funding:** on-chain sats on the test phrase
**Preconditions.** A known recovery phrase that holds on-chain sats; Electrum reachable.
**Steps.**

1. From Add wallet, choose Import wallet and enter the recovery phrase (or scan it via the QR scanner).
2. Complete import discovery and land on Home with the restored balance.
3. From Home or the wallet screen, tap Send.
4. Scan a destination QR code, or type the address by hand.
5. Enter an amount and choose a fee, then continue.
6. On the confirm screen check the recipient, the amount and the fee; Details shows the signed transaction.
7. Tap Send now; the success screen shows amount and fee; confirm the outgoing row appears in the transaction list.
   **Expected.** The restored wallet shows its balance; a signed send shows the correct amount and fee; after broadcast, the history lists the outgoing payment.
   **Automation.** `tests/e2e/onchain-send.spec.js` (funded) builds and signs the transaction and checks amount and fee, but never broadcasts; the broadcast step is manual.

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
   **Automation.** `tests/e2e/encrypted-storage.spec.js`: the password is asked on launch, a wrong one is rejected, the same wallet is restored, and a plausible-deniability password opens separate storage while the real wallet stays intact. The spec is skipped until the Android prompt fix from pull request #281 is in the base; until then this flow is checked by hand.

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
   **Automation.** `tests/e2e/spark.spec.js`: adds Spark from the home row, creates an invoice for a typed amount and description, and exports the BIP-85 child phrase only after the notice is accepted.

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
   **Automation.** `tests/e2e/spark-receive.spec.js` (funded): a second team Spark wallet, run from the test, pays an invoice the app created; the receive screen turns to paid and the balance grows by exactly the amount; the shown Lightning address resolves to LNURL-pay. Receiving to the static address and the preimage view stay manual.

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
   **Automation.** `tests/e2e/spark-send.spec.js` (funded, quotes only) and `tests/e2e/spark-pay.spec.js` (funded, spends sats to a team-controlled address).

## CF-08 Restore a phrase that already has a Spark wallet

**Covers:** W-02, L-03
**Tier:** Critical (DFX)
**Funding:** sats on the Spark side so the recovered balance is visible
**Preconditions.** A recovery phrase tied to an existing Spark identity with a known balance; build with the Breez API key.
**Steps.**

1. Start with no wallet (or delete the current wallet) and open Import wallet.
2. Enter the recovery phrase that already has a Spark wallet.
3. Complete import discovery and confirm the on-chain wallet is restored; the Lightning row shows Add.
4. On Home, tap Add in the Lightning row; the Spark wallet of that phrase reappears in the Lightning slot.
5. Open the Lightning wallet and check the balance against the known funded amount.
6. Confirm Home shows both the restored on-chain and Spark wallets.
   **Expected.** Import restores the phrase; Add on the Lightning row brings back the existing Spark wallet with its balance.
   **Automation.** `tests/e2e/spark-receive.spec.js` (funded) imports the Spark test phrase, taps Add and checks that balance and Lightning address equal what the Spark SDK reports for that wallet; `tests/e2e-maestro/_setup-import.yaml` does the same import and Add for the Maestro flows.

## CF-09 Log in to DFX with LNURL-auth

**Covers:** L-14, L-15, S-06
**Tier:** Critical (DFX)
**Funding:** none
**Preconditions.** Only a Spark Lightning wallet is present (no lightning.space or LNDHub wallet: for domains other than DFX the app signs in with that wallet instead of Spark); a DFX LNURL-auth code and an LNURL-auth code from another domain to scan.
**Steps.**

1. On Home, tap Scan and scan the DFX LNURL-auth code with the shared QR scanner.
2. Confirm the login prompt names the DFX domain.
3. Approve the login prompt for the DFX domain.
4. Scan the LNURL-auth code from the other domain and confirm the message "This wallet cannot sign in with that code."
5. Scan an LNURL-pay code and confirm it opens the Lightning pay screen instead.
   **Expected.** The DFX login prompt names the DFX domain; a login for another domain is refused by the Spark wallet; other LNURL types still route to their screens.
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
   **Automation.** `tests/e2e-maestro/flows/16-dfx-buy-to-payment.yaml`: imports a fixed Spark identity, drives the buy mask, simulates the incoming bank payment on the local stack, and after a restart asserts the backend state and the Spark balance; the history row (step 6) is checked manually.

## CF-11 Sell through DFX from Spark

**Covers:** D-01, D-03, L-13
**Tier:** Critical (DFX)
**Funding:** the Spark payout from CF-10
**Preconditions.** Same identity as CF-10; Spark holds the payout from CF-10; local DFX stack reachable with the repository's settlement helper. Issue #260 is still open: the sell ramp of the production API is not ready, so this flow proves the wallet path against the local DFX stack only.
**Steps.**

1. On Home, confirm the Sell tile is shown.
2. Tap Sell. The DFX web app opens; enter the amount to sell from Spark and the bank account.
3. For a Spark sell the web app hands a `spark:` payment link back to the wallet instead of returning through the sell link; by code that link opens the Lightning send screen with the DFX deposit address filled in; the amount in the link is not applied, so enter it by hand (what is in the foreground right after the hand-over varies at runtime and is not verified on a device).
4. Confirm the payment from Spark on that screen.
5. Confirm the Spark balance decreased by the sold amount plus fee.
6. Confirm the sell reaches completed on the local DFX stack.
   **Expected.** The sell pays from Spark; the balance drops; the sell completes on the local DFX stack.
   **Automation.** `tests/e2e-maestro/flows/17-dfx-sell-to-payment.yaml` (runs after CF-10 on the same identity): pays the sell deposit address from a fixture through the wallet send path, settles the sell on the local stack, then checks the sell mask and the balance after a restart; the hand-over and the payment confirmation (steps 3 and 4) are not automated; the flow pays the deposit address itself through the wallet's send path before that point.

## Coverage

| Row  | Tier           | Flows        |
| ---- | -------------- | ------------ |
| A-01 | Critical       | CF-01        |
| A-02 | Critical       | CF-04        |
| A-08 | Critical       | CF-02, CF-03 |
| W-01 | Critical       | CF-01        |
| W-02 | Critical       | CF-03, CF-08 |
| W-03 | Critical       | CF-01        |
| W-04 | Critical       | CF-01        |
| W-05 | Critical       | CF-01        |
| R-01 | Critical       | CF-01, CF-02 |
| T-01 | Critical       | CF-02, CF-03 |
| T-02 | Critical       | CF-02        |
| S-01 | Critical       | CF-03        |
| S-02 | Critical       | CF-03        |
| S-06 | Critical       | CF-09        |
| L-01 | Critical (DFX) | CF-05        |
| L-02 | Critical (DFX) | CF-05        |
| L-03 | Critical (DFX) | CF-08        |
| L-06 | Critical (DFX) | CF-05        |
| L-10 | Critical (DFX) | CF-05, CF-06 |
| L-13 | Critical (DFX) | CF-07, CF-11 |
| L-14 | Critical (DFX) | CF-09        |
| D-01 | Critical (DFX) | CF-10, CF-11 |
| D-02 | Critical (DFX) | CF-10        |
| D-03 | Critical (DFX) | CF-11        |
| X-08 | Critical       | CF-04        |

Every Critical row above is covered by at least one flow, and the checker enforces it.

## Manual release checks

The Detox suites run on Android only and cannot reach everything. Before a release, check these by hand on an iPhone and an Android phone:

- Run the flows above on an iPhone (no iOS automation exists).
- lightning.space regression with a seed that has a funded lightning.space wallet: Lightning row, balance and history; receive to its address and to an invoice (paid invoice view without a "0 sats" fee line); pay an invoice, an external and a lightning.space Lightning address (fee range and Free); send max keeps the 3% reserve; LNURL-withdraw; DFX sell paid as LNURL.
- An existing lightning.space user updates from the store version: the Lightning row, Receive and Settings still open the lightning.space wallet and Add is not offered.
- Add recovers a lightning.space account created before May 2023 (BIP49 addresses) and one whose seed was imported on a custom derivation path.
- A Spark payment force-closed right after Pay and retried after reopening is not sent twice.
- Send max from Spark to a Lightning address leaves the wallet near 0.
- Cancelling the biometric prompt on the send confirm screen broadcasts nothing.
- Boltcard on receive (NFC) and the Apple Watch app behave as in the store version.
