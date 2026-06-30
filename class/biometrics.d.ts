import { FC } from 'react';

/**
 * Type declarations for the untyped `class/biometrics.js`.
 *
 * The default export is a React function component (`<Biometric />` renders
 * `null`) that additionally carries a set of static helper methods/constants
 * attached to the function object. The signatures below mirror the exact
 * runtime behaviour of `biometrics.js` (return values are derived from the
 * implementation, e.g. `biometricType()` resolves to one of the string
 * constants or `false`).
 */
interface BiometricStatics {
  /** AsyncStorage key under which the "biometrics enabled" flag is persisted. */
  STORAGEKEY: string;
  FaceID: string;
  TouchID: string;
  Biometrics: string;

  /** Whether the device has a usable biometric sensor. */
  isDeviceBiometricCapable(): Promise<boolean>;

  /** Resolves to one of the `FaceID`/`TouchID`/`Biometrics` constants, or `false`. */
  biometricType(): Promise<string | false>;

  /** Whether the user has enabled biometric unlock in the app. */
  isBiometricUseEnabled(): Promise<boolean>;

  /** Whether biometrics are both enabled by the user and supported by the device. */
  isBiometricUseCapableAndEnabled(): Promise<boolean>;

  /** Persists the "biometrics enabled" flag. */
  setBiometricUseEnabled(value: boolean): Promise<void>;

  /** Prompts the user to authenticate; resolves to `true` on success. */
  unlockWithBiometrics(): Promise<boolean>;

  /** Wipes the secure keychain and navigates back to the wallets root. */
  clearKeychain(): Promise<void>;

  /** Requests the device passcode and, on success, offers to wipe the keychain. */
  requestDevicePasscode(): Promise<void>;

  /** Shows the iOS keychain-wipe alert (no-op on other platforms). */
  showKeychainWipeAlert(): void;
}

type BiometricComponent = FC & BiometricStatics;

declare const Biometric: BiometricComponent;

export default Biometric;
