import React, { createContext, PropsWithChildren, useContext } from 'react';
import { BlueStorageContext } from '../blue_modules/storage-context';

interface WalletInterface {
  address?: string;
  signMessage: (message: string, address: string) => Promise<string>;
}

const WalletContext = createContext<WalletInterface>(undefined as any);

export function useWalletContext(): WalletInterface {
  return useContext(WalletContext);
}

export function WalletContextProvider(props: PropsWithChildren<any>): JSX.Element {
  const { wallets, selectedWallet } = useContext(BlueStorageContext);
  const wallet = wallets.find((w: { getID: () => any }) => w.getID() === selectedWallet);
  const address = wallet ? wallet.external_addresses_cache[0] : undefined;

  async function signMessage(message: string, address: string): Promise<string> {
    try {
      return await wallet.signMessage(message, address);
    } catch (e: any) {
      // TODO (Krysh): real error handling
      console.error(e.message, e.code);
      throw e;
    }
  }

  const context: WalletInterface = {
    address,
    signMessage,
  };

  return <WalletContext.Provider value={context}>{props.children}</WalletContext.Provider>;
}
