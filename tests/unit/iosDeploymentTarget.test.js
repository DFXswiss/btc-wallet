/**
 * Guards ios/BlueWallet.xcodeproj/project.pbxproj's IPHONEOS_DEPLOYMENT_TARGET
 * against drift. It is declared four times (Debug/Release at both the
 * BlueWallet target and the project level) with nothing keeping them in sync -
 * a partial bump is invisible until the next App Store Connect upload produces
 * an ITMS-90068 warning, which is how this floor was found to be stale
 * (target declared 13.0 while every pod already builds against React
 * Native's own 15.1 floor from ios/Podfile's `min_ios_version_supported`).
 *
 * ios/Podfile carries no literal (it follows RN's floor) and no checked-in
 * Info.plist declares a MinimumOSVersion, so pbxproj is the only source of
 * truth here.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PBXPROJ_PATH = path.resolve(__dirname, '../../ios/BlueWallet.xcodeproj/project.pbxproj');

// Apple rejects uploads with a floor below this from Spring 2027 on (ITMS-90068).
const APPLE_FLOOR_MAJOR = 15;
const APPLE_FLOOR_MINOR = 0;

// The floor actually targeted here: matches React Native 0.83.1's own
// min_ios_version_supported, so the app never advertises support its
// dependencies don't build for.
const TARGET_VERSION = '15.1';

// Debug/Release at the BlueWallet target, Debug/Release at the project level.
const EXPECTED_ENTRY_COUNT = 4;

function deploymentTargets() {
  const src = fs.readFileSync(PBXPROJ_PATH, 'utf8');
  return [...src.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([^;]+);/g)].map(m => m[1].trim());
}

/** '15.1' -> 1510, so plain integer comparison orders the versions. */
function comparable(version) {
  const m = /^(\d+)\.(\d+)$/.exec(version);
  assert.ok(m, `unexpected IPHONEOS_DEPLOYMENT_TARGET format "${version}" in ${PBXPROJ_PATH}`);
  return Number(m[1]) * 100 + Number(m[2]);
}

describe('unit - iOS deployment target', () => {
  it('declares IPHONEOS_DEPLOYMENT_TARGET exactly 4 times', () => {
    const targets = deploymentTargets();
    assert.strictEqual(
      targets.length,
      EXPECTED_ENTRY_COUNT,
      `expected ${EXPECTED_ENTRY_COUNT} IPHONEOS_DEPLOYMENT_TARGET entries in ${PBXPROJ_PATH} ` +
        `(Debug/Release x BlueWallet target/project level), found ${targets.length} - ` +
        'a build configuration was added or removed; give the new one a deployment target and update EXPECTED_ENTRY_COUNT',
    );
  });

  it('all entries agree on the same value', () => {
    const targets = deploymentTargets();
    assert.strictEqual(
      new Set(targets).size,
      1,
      `IPHONEOS_DEPLOYMENT_TARGET differs across build configurations in ${PBXPROJ_PATH}: ` +
        `${targets.join(', ')} - raise all of them together`,
    );
  });

  it('meets the App Store floor', () => {
    const floor = APPLE_FLOOR_MAJOR * 100 + APPLE_FLOOR_MINOR;
    for (const version of deploymentTargets()) {
      assert.ok(
        comparable(version) >= floor,
        `${PBXPROJ_PATH} declares ${version}, below the App Store floor ${APPLE_FLOOR_MAJOR}.${APPLE_FLOOR_MINOR} (ITMS-90068)`,
      );
    }
  });

  it("matches the version this app actually targets (React Native 0.83.1's own floor)", () => {
    for (const version of deploymentTargets()) {
      assert.strictEqual(
        version,
        TARGET_VERSION,
        `${PBXPROJ_PATH} declares ${version}, expected ${TARGET_VERSION} to match ` +
          "ios/Podfile's min_ios_version_supported (React Native's own floor) - " +
          'raising it further is fine, but keep this test in sync',
      );
    }
  });
});
