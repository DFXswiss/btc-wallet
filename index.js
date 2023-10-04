import React, { useEffect } from 'react';
import './shim.js';
import { AppRegistry } from 'react-native';
import App from './App';
import { BlueStorageProvider } from './blue_modules/storage-context';
import { WalletContextProvider } from './contexts/wallet.context';
import { DfxSessionContextProvider } from './api/dfx/contexts/session.context';
import { LanguageContextProvider } from './api/dfx/contexts/language.context';

const A = require('./blue_modules/analytics');
if (!Error.captureStackTrace) {
  // captureStackTrace is only available when debugging
  Error.captureStackTrace = () => {};
}

const BlueAppComponent = () => {
  useEffect(() => {
    A(A.ENUM.INIT);
  }, []);

  return (
    <BlueStorageProvider>
      <WalletContextProvider>
        <LanguageContextProvider>
          <DfxSessionContextProvider>
            <App />
          </DfxSessionContextProvider>
        </LanguageContextProvider>
      </WalletContextProvider>
    </BlueStorageProvider>
  );
};

AppRegistry.registerComponent('BlueWallet', () => BlueAppComponent);
