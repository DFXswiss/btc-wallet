import React, { useEffect } from 'react';
import './shim.js';
import { AppRegistry } from 'react-native';
import App from './App';
import { BlueStorageProvider } from './blue_modules/storage-context';
import { AuthContextProvider } from './api/dfx/contexts/auth.context';
import { UserContextProvider } from './api/dfx/contexts/user.context';
import { WalletContextProvider } from './contexts/wallet.context';
import { SessionContextProvider } from './contexts/session.context';
import { AssetContextProvider } from './api/dfx/contexts/asset.context';
import { BuyContextProvider } from './api/dfx/contexts/buy.context';

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
      <AuthContextProvider>
        <UserContextProvider>
          <WalletContextProvider>
            <SessionContextProvider>
              <AssetContextProvider>
                <BuyContextProvider>
                  <App />
                </BuyContextProvider>
              </AssetContextProvider>
            </SessionContextProvider>
          </WalletContextProvider>
        </UserContextProvider>
      </AuthContextProvider>
    </BlueStorageProvider>
  );
};

AppRegistry.registerComponent('BlueWallet', () => BlueAppComponent);
