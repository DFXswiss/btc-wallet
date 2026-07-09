import React from 'react';
import PropTypes from 'prop-types';
import { Camera } from 'react-native-camera-kit-no-google';

// Renders the cosigner-scanning camera only while the screen is focused, so the
// camera session is released (and its scan callback stops firing) once the user
// navigates away from add-multisig step 2. Mirrors every other scanner screen
// in the repo (ScanQRCode, ScanCodeSend, importMultisignature).
export const CosignerCamera = ({ isFocused, scanBarcode, onReadCode, style }) => {
  if (!isFocused) return null;
  return <Camera scanBarcode={scanBarcode} scanThrottleDelay={0} onReadCode={onReadCode} style={style} />;
};

CosignerCamera.propTypes = {
  isFocused: PropTypes.bool,
  scanBarcode: PropTypes.bool,
  onReadCode: PropTypes.func,
  style: PropTypes.any,
};
