import React, { createContext, PropsWithChildren, useContext, useState } from 'react';
import { BlueStorageContext } from '../blue_modules/storage-context';

interface WalletInterface {
  walletID?: string;
  address?: string;
  discover: () => Promise<void>;
  signMessage: (message: string, address: string) => Promise<string>;
}

const WalletContext = createContext<WalletInterface>(undefined as any);

export function useWalletContext(): WalletInterface {
  return useContext(WalletContext);
}

export function WalletContextProvider(props: PropsWithChildren<any>): JSX.Element {
  const { wallets } = useContext(BlueStorageContext);
  const [address, setAddress] = useState<string>();

  function getWallet(): any {
    return wallets?.[0];
  }

  async function discoverAddress(): Promise<string> {
    if (address) return address;
    const wallet = getWallet();
    return wallet._getExternalAddressByIndex(0);
  }

  async function signMessage(message: string, address: string): Promise<string> {
    try {
      return await getWallet().signMessage(message, address);
    } catch (e: any) {
      // TODO (Krysh): real error handling
      console.error(e.message, e.code);
      throw e;
    }
  }

  async function discover(): Promise<void> {
    if (!getWallet()) return;
    return discoverAddress().then(setAddress);
  }

  const context: WalletInterface = {
    walletID: wallets?.[0]?.getID(),
    address,
    discover,
    signMessage,
  };

  return <WalletContext.Provider value={context}>{props.children}</WalletContext.Provider>;
}
