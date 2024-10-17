import { useMemo } from 'react';
import { User, UserUrl } from '../definitions/user';
import { useApi } from './api.hook';

export interface LdsInterface {
  getUser: (address: string, signMessage: (message: string) => Promise<string>) => Promise<User>;
}

export function useLds(): LdsInterface {
  const { call } = useApi();
  const getMessage = (address: string) => `By_signing_this_message,_you_confirm_to_lightning.space_that_you_are_the_sole_owner_of_the_provided_Blockchain_address._Your_ID:_${address}`;

  async function createSession(address: string, signature: string): Promise<string> {
    const data = { address, signature, wallet: 'DFX Bitcoin' };

    return call<{ accessToken: string }>({ method: 'POST', url: 'auth', data })
      .then(r => r.accessToken);
  }

  async function getUser(address: string, signMessage: (message: string) => Promise<string>): Promise<User> {    
    // sign up/in
    const message  = getMessage(address);
    const signature = await signMessage(message);
    const token = await createSession(address, signature);

    // get user
    return call<User>({ method: 'GET', url: UserUrl.get, token });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({ getUser }), [call]);
}
