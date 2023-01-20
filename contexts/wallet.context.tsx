import React, { createContext, PropsWithChildren, useContext, useEffect, useState } from 'react';
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
  const { wallets } = useContext(BlueStorageContext);
  const [address, setAddress] = useState<string>();

  useEffect(() => {
    if (wallets?.length === 0) return;
    setAddress(wallets[0]._address);
  }, [wallets]);

  async function signMessage(message: string, address: string): Promise<string> {
    try {
      console.log(message, address);
      return '';
      // return await sign(address, message);
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
