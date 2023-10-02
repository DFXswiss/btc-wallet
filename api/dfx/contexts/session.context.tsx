import React, { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';
import { Linking, Alert } from 'react-native';
import { ApiError } from '../definitions/error';
import { useWalletContext } from '../../../contexts/wallet.context';
import Config from 'react-native-config';
import jwtDecode from 'jwt-decode';
import { useStore } from '../../../hooks/store.hook';
import { Jwt } from '../definitions/jwt';
import { useAuth } from '../hooks/auth.hook';
import { BlueStorageContext } from '../../../blue_modules/storage-context';
import { LightningLdsWallet } from '../../../class/wallets/lightning-lds-wallet';
import Lnurl from '../../../class/lnurl';
import loc from '../../../loc';
import { useApi } from '../hooks/api.hook';
import { User, UserUrl } from '../definitions/user';
import { SignIn } from '../definitions/auth';
import { useLanguageContext } from './language.context';

export enum DfxService {
  BUY = 'buy',
  SELL = 'sell',
}

export interface SessionInterface {
  getAccessToken: (walletId: string) => Promise<string>;
  resetAccessToken: (walletId: string) => void;
  isProcessing: boolean;
  isAvailable: boolean;
  openServices: (walletId: string, balance: string, service: DfxService) => Promise<void>;
  reset: () => Promise<void>;
}

const DfxSessionContext = createContext<SessionInterface>(undefined as any);

export function useDfxSessionContext(): SessionInterface {
  return useContext(DfxSessionContext);
}

export function DfxSessionContextProvider(props: PropsWithChildren<any>): JSX.Element {
  const { wallets } = useContext(BlueStorageContext);
  const { walletID: mainWalletId, address: mainAddress, signMessage } = useWalletContext();
  const { getSignMessage, signIn, signUp } = useAuth();
  const { call } = useApi();
  const { dfxSession } = useStore();
  const { languages } = useLanguageContext();

  const [sessions, setSessions] = useState<Record<string, string>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);

  useEffect(() => {
    dfxSession.get().then(setSessions);
  }, [dfxSession]);

  function isExpired(token?: string): boolean {
    if (!token) return true;

    try {
      const jwt = jwtDecode<Jwt>(token);
      return jwt?.exp != null && Date.now() > new Date(jwt?.exp * 1000).getTime();
    } catch {
      return true;
    }
  }

  function isLoggedIn(token?: string): token is string {
    return !isExpired(token);
  }

  function updateSession(walletId: string, token?: string) {
    setSessions(s => {
      if (token) {
        s[walletId] = token;
      } else {
        delete s[walletId];
      }

      dfxSession.set(s);
      return s;
    });
  }

  function getAppLanguage(): string | undefined {
    return loc.getLanguage()?.split('_')[0]?.toUpperCase();
  }

  async function updateLanguage(token: SignIn): Promise<SignIn> {
    try {
      const language = languages?.find(l => l.symbol === getAppLanguage());
      if (language) {
        const update: Partial<User> = { language };
        await call({ url: UserUrl.change, method: 'PUT', data: update }, token.accessToken);
      }
    } catch (e) {
      console.error('Failed to update language:', e);
    }

    return token;
  }

  async function createSession(address: string, signature: string): Promise<string> {
    return await signIn(address, signature)
      .catch((e: ApiError) => {
        if (e.statusCode === 404) return signUp(address, signature).then(updateLanguage);

        throw e;
      })
      .then(r => r.accessToken);
  }

  async function createAccessToken(walletId: string): Promise<string> {
    if (walletId === mainWalletId) {
      if (!mainAddress) throw new Error('Address is not defined');

      const message = await getSignMessage(mainAddress);
      const signature = await signMessage(message, mainAddress);

      return await createSession(mainAddress, signature);
    } else {
      const wallet = wallets.find((w: any) => w.getID?.() === walletId);
      if (wallet.type === LightningLdsWallet.type) {
        const address = Lnurl.getLnurlFromAddress(wallet.lnAddress);
        if (!address) throw new Error('Address is not defined');

        return await createSession(address.toUpperCase(), wallet.addressOwnershipProof);
      }
    }

    throw new Error('TODO (david): taproot?');
  }

  async function getAccessToken(walletId: string): Promise<string> {
    let session = sessions[walletId];
    if (!isLoggedIn(session)) {
      setIsProcessing(true);

      session = await createAccessToken(walletId).finally(() => setIsProcessing(false));
      updateSession(walletId, session);
    }

    return session;
  }

  async function resetAccessToken(walletId: string) {
    updateSession(walletId);
  }

  async function connect(walletIds: string[]): Promise<void> {
    await Promise.all(walletIds.map(id => getAccessToken(id)))
      .then(() => setIsAvailable(true))
      .catch((e: ApiError) => {
        if (e.statusCode === 403) return setIsAvailable(false);

        throw e;
      });
  }

  async function openServices(walletId: string, balance: string, service: DfxService): Promise<void> {
    if (!isAvailable) return;

    const token = encodeURIComponent(await getAccessToken(walletId));
    const lang = getAppLanguage();
    const redirectUri = encodeURIComponent(`dfxtaro://?wallet-id=${walletId}`);

    const url = `${Config.REACT_APP_SRV_URL}/${service}?session=${token}&balances=${balance}@BTC&redirect-uri=${redirectUri}&lang=${lang}`;
    return Linking.openURL(url);
  }

  async function reset(): Promise<void> {
    dfxSession.remove();
  }

  useEffect(() => {
    if (!wallets?.length) return;

    !isAvailable &&
      !isProcessing &&
      connect(wallets.map((w: any) => w.getID())).catch(e =>
        Alert.alert('Something went wrong', e.message?.toString(), [
          {
            text: loc._.ok,
            onPress: () => {},
            style: 'default',
          },
        ]),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets]);

  const context = useMemo(
    () => ({
      getAccessToken,
      resetAccessToken,
      isAvailable,
      isProcessing,
      openServices,
      reset,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mainWalletId, mainAddress, signMessage, getSignMessage, signIn, signUp, dfxSession, sessions, isProcessing, isAvailable],
  );

  return <DfxSessionContext.Provider value={context}>{props.children}</DfxSessionContext.Provider>;
}
