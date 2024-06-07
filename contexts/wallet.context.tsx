import React, { createContext, PropsWithChildren, useContext, useMemo } from 'react';
import { BlueStorageContext } from '../blue_modules/storage-context';
import { useAuth } from '../api/dfx/hooks/auth.hook';

interface WalletInterface {
  walletID?: string;
  address?: string;
  signMessage: (message: string, address: string) => Promise<string>;
  getOwnershipProof: () => Promise<string>;
}

const WalletContext = createContext<WalletInterface>(undefined as any);

export function useWalletContext(): WalletInterface {
  return useContext(WalletContext);
}

export function WalletContextProvider(props: PropsWithChildren<any>): JSX.Element {
  const { wallets, walletsInitialized, saveToDisk } = useContext(BlueStorageContext);
  const { getSignMessage } = useAuth();

  function getAddress(): string | undefined {
    const wallet = wallets?.[0];
    if (!wallet) return undefined;
    if (wallet.type.startsWith('HD')) {
      return wallet._getExternalAddressByIndex?.(0);
    } else {
      return wallet.getAddress?.();
    }
  }

  const getOwnershipProof = async (): Promise<string> => {
    const wallet = wallets?.[0];
    if (!wallet) return '';

    if (!wallet.addressOwnershipProof) {
      const mainAddress = getAddress();
      const m = getSignMessage(mainAddress as string);
      const proof = await wallet.signMessage(m, mainAddress);
      wallet.addressOwnershipProof = proof;
      await saveToDisk();
    }

    return wallet.addressOwnershipProof
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
      getOwnershipProof
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets, walletsInitialized]);

  return <WalletContext.Provider value={context}>{props.children}</WalletContext.Provider>;
}
