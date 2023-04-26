import React, { createContext, PropsWithChildren, useContext, useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { ApiError } from '../api/definitions/error';
import { useApiSession } from '../api/hooks/api-session.hook';
import { useWalletContext } from './wallet.context';
import Config from 'react-native-config';
import { useAuthContext } from '../api/contexts/auth.context';

export interface SessionInterface {
  address?: string;
  isLoggedIn: boolean;
  needsSignUp: boolean;
  isNotAllowedInCountry: boolean;
  isProcessing: boolean;
  openServices: (balance: string) => Promise<void>;
  login: () => Promise<string>;
  signUp: () => Promise<string>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionInterface>(undefined as any);

export function useSessionContext(): SessionInterface {
  return useContext(SessionContext);
}

export function SessionContextProvider(props: PropsWithChildren<any>): JSX.Element {
  const { isLoggedIn, authenticationToken } = useAuthContext();
  const { getSignMessage, createSession, deleteSession } = useApiSession();
  const { address, signMessage } = useWalletContext();
  const [needsSignUp, setNeedsSignUp] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [signature, setSignature] = useState<string>();
  const [isNotAllowedInCountry, setIsNotAllowedInCountry] = useState(false);

  async function createApiSession(address: string): Promise<string> {
    if (isLoggedIn) return '';
    const message = await getSignMessage(address);
    const signature = await signMessage(message, address);
    setIsProcessing(true);
    return createSession(address, signature, false)
      .catch((error: ApiError) => {
        if (error.statusCode === 403) {
          setIsNotAllowedInCountry(true);
        }

        if (error.statusCode === 404) {
          setSignature(signature);
          setNeedsSignUp(true);
        }
        return '';
      })
      .finally(() => setIsProcessing(false));
  }

  useEffect(() => {
    if (address) {
      createApiSession(address);
    } else {
      deleteSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  async function login(): Promise<string> {
    if (!address) throw new Error('No address found');
    return createApiSession(address);
  }

  async function signUp(): Promise<string> {
    if (!address || !signature) return ''; // TODO (Krysh) add real error handling
    setIsProcessing(true);
    return createSession(address, signature, true).finally(() => {
      setSignature(undefined);
      setNeedsSignUp(false);
      setIsProcessing(false);
    });
  }

  async function logout(): Promise<void> {
    setNeedsSignUp(false);
    await deleteSession();
  }

  async function retrieveToken(): Promise<string | null | undefined> {
    let token = authenticationToken;
    if (!authenticationToken) {
      token = await login();
    }
    return token;
  }

  async function openServices(balance: string): Promise<void> {
    const token = await retrieveToken();
    if (!token) return;
    return Linking.openURL(
      encodeURI(`${Config.REACT_APP_SRV_URL}?session=${token}&blockchain=Bitcoin&balances=${balance}@BTC&redirect-uri=bitcoindfx://`),
    );
  }

  const context = {
    address,
    isLoggedIn,
    needsSignUp,
    isNotAllowedInCountry,
    isProcessing,
    openServices,
    login,
    signUp,
    logout,
  };

  return <SessionContext.Provider value={context}>{props.children}</SessionContext.Provider>;
}
