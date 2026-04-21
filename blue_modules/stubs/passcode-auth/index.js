// No-op stub pending Phase 4 native-module replacement.
const PasscodeAuth = {
  authenticate: () => Promise.reject(new Error('passcode-auth stubbed')),
};

module.exports = PasscodeAuth;
module.exports.default = PasscodeAuth;
