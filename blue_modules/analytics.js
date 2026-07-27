const BlueApp = require('../BlueApp');
const Sentry = require('@sentry/react-native');
const { getUniqueIdSync } = require('react-native-device-info');

// App.js defers Sentry.init() behind its own isDoNotTrackEnabled() read (so native
// crash handling, which can only be gated at init time, respects opt-out from the
// start) - Sentry.getClient() may not exist yet when this runs. Toggling
// client.getOptions().enabled is the same mechanism the SDK itself uses internally
// (see Client.close()) to gate event sending, and is a no-op if there's no client yet.
const setSentryEnabled = enabled => {
  const client = Sentry.getClient();
  if (client) {
    client.getOptions().enabled = enabled;
    if (enabled) {
      // Sentry.init() skips integration setup entirely on a disabled client, so a
      // user who launched with Do Not Track on has NONE installed - not just no
      // console capture, but no error handlers, no frame rewriting (so source maps
      // cannot match) and no dedupe. The resolved list is on the options either
      // way; installing a name that is already installed is a no-op. Integrations
      // that need the native SDK are absent from it, because enableNative was false
      // at init - native reporting only comes back on the next app start.
      client.getOptions().integrations.forEach(integration => Sentry.addIntegration(integration));
    }
  }
  // Identify the device on both error events and logs. Without a scope user the
  // native layer fills in its own install id, but only for error events - a log row
  // then carries no user at all, and the two ids are different values that cannot be
  // joined. Setting it here uses one id for both, the same one the About screen
  // offers to copy for support, and tracks the opt-out toggle live rather than only
  // at init. See docs/crash-reports.md for what this id is.
  Sentry.setUser(enabled ? { id: getUniqueIdSync() } : null);
};

// Re-applies the persisted opt-out choice independently of App.js's own init-time
// read (belt and suspenders for the JS side; App.js already gates both `enabled`
// and `enableNative` atomically from its own read), and is what handles it live if
// the user flips the toggle in Settings mid-session via A.setOptOut below. Closes
// the gap that made upstream BlueWallet remove Sentry entirely (opt-out toggle
// didn't stop network calls, BlueWallet/BlueWallet#3309/#3621).
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

// App.js's captureConsole integration already turns console.error into an issue,
// so capturing here as well would file every error twice. Passing an Error (not a
// string) is what makes that integration capture an exception with a stack rather
// than a bare message.
A.logError = errorString => {
  console.error(errorString instanceof Error ? errorString : new Error(String(errorString)));
};

module.exports = A;
