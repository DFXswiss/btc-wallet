const BlueApp = require('../BlueApp');
const Sentry = require('@sentry/react-native');

// Sentry.init() runs synchronously at import time (App.js), before this module loads,
// so a client already exists here. Toggling client.getOptions().enabled is the same
// mechanism the SDK itself uses internally (see Client.close()) to gate event sending.
const setSentryEnabled = enabled => {
  const client = Sentry.getClient();
  if (client) {
    client.getOptions().enabled = enabled;
  }
};

// Apply the persisted opt-out choice as soon as it's read, closing the gap that made
// upstream BlueWallet remove Sentry entirely (opt-out toggle didn't stop network calls,
// BlueWallet/BlueWallet#3309/#3621): until this resolves, Sentry stays at its init default.
BlueApp.isDoNotTrackEnabled().then(doNotTrack => setSentryEnabled(!doNotTrack));

const A = async event => {};

A.ENUM = {
  INIT: 'INIT',
  GOT_NONZERO_BALANCE: 'GOT_NONZERO_BALANCE',
  GOT_ZERO_BALANCE: 'GOT_ZERO_BALANCE',
  CREATED_WALLET: 'CREATED_WALLET',
  CREATED_LIGHTNING_WALLET: 'CREATED_LIGHTNING_WALLET',
  APP_UNSUSPENDED: 'APP_UNSUSPENDED',
  NAVIGATED_TO_WALLETS_HODLHODL: 'NAVIGATED_TO_WALLETS_HODLHODL',
};

A.setOptOut = value => {
  setSentryEnabled(!value);
};

A.logError = errorString => {
  console.error(errorString);
  Sentry.captureException(errorString instanceof Error ? errorString : new Error(String(errorString)));
};

module.exports = A;
