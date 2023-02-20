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
  isProcessing: boolean;
  openPayment: (action: (text: string) => Promise<void>) => Promise<void>;
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

  async function createApiSession(address: string): Promise<string> {
    if (isLoggedIn) return '';
    const message = await getSignMessage(address);
    const signature = await signMessage(message, address);
    setIsProcessing(true);
    return createSession(address, signature, false)
      .catch((error: ApiError) => {
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

  async function login(openAlert?: (text: string) => void): Promise<string> {
    openAlert?.(`Step 2 of 4\naddress: ${address}`);
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
    await deleteSession();
  }

  async function openPayment(openAlert: (text: string) => void): Promise<void> {
    openAlert?.(`Step 0 of 4\nconfig url: ${Config.REACT_APP_PAY_URL}`);
    openAlert?.(`Step 1 of 4\nauthenticationToken: ${authenticationToken}`);
    let token = authenticationToken;
    if (!authenticationToken) {
      token = await login(openAlert);
      openAlert?.(`Step 3 of 4\nreceived token from login: ${token}`);
    }
    if (!token) return;
    openAlert?.(`Step 4 of 4\ncalling openURL`);
    return Linking.openURL(`${Config.REACT_APP_PAY_URL}login?token=${token}`);
  }

  const context = {
    address,
    isLoggedIn,
    needsSignUp,
    isProcessing,
    openPayment,
    login,
    signUp,
    logout,
  };

  return <SessionContext.Provider value={context}>{props.children}</SessionContext.Provider>;
}
