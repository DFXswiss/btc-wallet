import { useMemo } from 'react';
import { User, UserUrl } from '../definitions/user';
import { useApi } from './api.hook';
import { ApiError } from '../../dfx/definitions/error';

export interface LdsInterface {
  getUser: (address: string, signMessage: (message: string) => Promise<string>) => Promise<User>;
}

export function useLds(): LdsInterface {
  const { call } = useApi();

  async function createSession(address: string, signature: string): Promise<string> {
    const data = { address, signature, wallet: 'DFX Bitcoin' };

    return call<{ accessToken: string }>({ method: 'POST', url: 'auth/sign-in', data })
      .catch((e: ApiError) => {
        if (e.statusCode === 404) return call<{ accessToken: string }>({ method: 'POST', url: 'auth/sign-up', data });

        throw e;
      })
      .then(r => r.accessToken);
  }

  async function getUser(address: string, signMessage: (message: string) => Promise<string>): Promise<User> {
    // get sign message
    const url = new URL('auth/sign-message');
    url.searchParams.append('address', address);
    const { message } = await call<{ message: string }>({ method: 'GET', url: url.toString() });

    // sign up/in
    const signature = await signMessage(message);
    const token = await createSession(address, signature);

    // get user
    return call<User>({ method: 'GET', url: UserUrl.get, token });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({ getUser }), [call]);
}
