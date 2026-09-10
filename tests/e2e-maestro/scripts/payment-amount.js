/* global E2E_PAYMENT_SAT, TREASURY_HASH, output */
// Derives the sat amounts the payment flows type and assert.
// Default 10, overridable through E2E_PAYMENT_SAT. Send is 1/10 of that
// (same ratio as the previous 100-of-1000 send) so the Spark fee still fits.

function readPaymentSat() {
  var raw = '';
  try {
    if (typeof E2E_PAYMENT_SAT !== 'undefined' && E2E_PAYMENT_SAT !== null) {
      raw = String(E2E_PAYMENT_SAT).trim();
    }
  } catch (error) {}
  if (!raw) raw = '10';
  var sat = Number(raw);
  if (!Number.isInteger(sat) || sat <= 0) {
    throw new Error('E2E_PAYMENT_SAT must be a positive integer');
  }
  return sat;
}

function readOptionalBinding(name) {
  try {
    if (name === 'TREASURY_HASH' && typeof TREASURY_HASH !== 'undefined' && TREASURY_HASH !== null) {
      return String(TREASURY_HASH).trim();
    }
  } catch (error) {}
  return '';
}

var paymentSat = readPaymentSat();
var sendSat = Math.max(1, Math.floor(paymentSat / 10));
var walletBalanceText = String(paymentSat).replace(/\B(?=(\d{3})+(?!\d))/g, '[.,]') + ' sats';
var preservedHash = readOptionalBinding('TREASURY_HASH');

output.paymentSat = String(paymentSat);
output.sendSat = String(sendSat);
output.walletBalanceText = walletBalanceText;
output.walletBalanceRegex = '^' + walletBalanceText + '$';
if (preservedHash) output.paymentHash = preservedHash;
