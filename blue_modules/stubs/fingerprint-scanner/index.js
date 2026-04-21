// No-op stub pending Phase 4 native-module replacement (switch to react-native-biometrics).
const FingerprintScanner = {
  isSensorAvailable: () => Promise.reject(new Error('fingerprint-scanner stubbed')),
  authenticate: () => Promise.reject(new Error('fingerprint-scanner stubbed')),
  release: () => {},
};

module.exports = FingerprintScanner;
module.exports.default = FingerprintScanner;
