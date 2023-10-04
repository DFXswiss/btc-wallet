import React, { createContext, PropsWithChildren, useContext, useMemo } from 'react';
import { BlueStorageContext } from '../blue_modules/storage-context';

interface WalletInterface {
  walletID?: string;
  address?: string;
  signMessage: (message: string, address: string) => Promise<string>;
}

const WalletContext = createContext<WalletInterface>(undefined as any);

export function useWalletContext(): WalletInterface {
  return useContext(WalletContext);
}

export function WalletContextProvider(props: PropsWithChildren<any>): JSX.Element {
  const { wallets, walletsInitialized } = useContext(BlueStorageContext);

  function getAddress(): string | undefined {
    const wallet = wallets?.[0];
    if (!wallet) return undefined;
    if (wallet.type.startsWith('HD')) {
      return wallet._getExternalAddressByIndex?.(0);
    } else {
      return wallet.getAddress?.();
    }
  }

  const context: WalletInterface = useMemo(() => {
    return {
      walletID: wallets?.[0]?.getID?.(),
      address: getAddress(),
      signMessage: async (message: string, address: string): Promise<string> => {
        try {
          return await wallets?.[0]?.signMessage(message, address);
        } catch (e: any) {
          console.error(e.message, e.code);
          throw e;
        }
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets, walletsInitialized]);

  return <WalletContext.Provider value={context}>{props.children}</WalletContext.Provider>;
}
