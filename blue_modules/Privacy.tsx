import { useContext, useEffect } from 'react';
import { CaptureProtection, ContentMode } from 'react-native-capture-protection';
import { BlueStorageContext } from './storage-context';

interface PrivacyComponent extends React.FC {
  enableBlur: () => void;
  disableBlur: () => void;
}

// Module-level mirror of the user setting so Privacy.enableBlur() (called from
// screens outside the React tree) can honor the toggle without changing the
// long-standing call-site API. Defaults to enabled (safe) until <Privacy />
// mounts and syncs the real value from BlueStorageContext.
let isPrivacyBlurEnabledRef = true;

const Privacy: PrivacyComponent = () => {
  const { isPrivacyBlurEnabled } = useContext(BlueStorageContext);

  useEffect(() => {
    isPrivacyBlurEnabledRef = isPrivacyBlurEnabled;
    if (!isPrivacyBlurEnabled) {
      CaptureProtection.allow().catch(() => {});
    }
  }, [isPrivacyBlurEnabled]);

  return null;
};

Privacy.enableBlur = () => {
  if (!isPrivacyBlurEnabledRef) return;
  // Show the branded splash (matching the native LaunchScreen) instead of the library's default
  // white cover. screenshot/record are passed explicitly because prevent() only defaults them to
  // true when called with NO argument — with a partial option they default to false.
  const cover = { image: require('../img/dfx/splash.png'), backgroundColor: '#072440' as const, contentMode: ContentMode.center };
  CaptureProtection.prevent({ screenshot: true, record: cover, appSwitcher: cover }).catch(() => {});
};

Privacy.disableBlur = () => {
  CaptureProtection.allow().catch(() => {});
};

export default Privacy;
