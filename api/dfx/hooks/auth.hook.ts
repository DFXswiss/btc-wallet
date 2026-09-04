import { useMemo } from 'react';
import Config from 'react-native-config';
import { Auth, AuthUrl } from '../definitions/auth';
import { useApi } from './api.hook';

export interface AuthInterface {
  getSignMessage: (address: string) => string;
  auth: (address: string, signature: string) => Promise<Auth>;
}

export function useAuth(): AuthInterface {
  const { call } = useApi();
  const message = 'By_signing_this_message,_you_confirm_that_you_are_the_sole_owner_of_the_provided_Blockchain_address._Your_ID:_';
  // Keep this PRD whitelist aligned with the API's signMessagePrefix configuration.
  const messagePrefix = Config.DFX_ENV === 'prd' ? '' : `[${Config.DFX_ENV}]_`;

  function getSignMessage(address: string): string {
    return `${messagePrefix}${message}${address}`;
  }

  async function auth(address: string, signature: string): Promise<Auth> {
    return await call({
      url: AuthUrl.auth,
      method: 'POST',
      data: { address, signature, wallet: 'DFX Bitcoin' },
    });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({ getSignMessage, auth }), [call]);
}
