import { ApiError } from '../definitions/error';
import { CallConfig, useApi } from './api.hook';
import { useDfxSessionContext } from '../contexts/session.context';
import { useMemo } from 'react';

export interface ApiAuthInterface {
  call: <T>(walletId: string, config: CallConfig) => Promise<T>;
}

export function useApiAuth(): ApiAuthInterface {
  const { call: apiCall } = useApi();
  const { getAccessToken, resetAccessToken } = useDfxSessionContext();

  async function call<T>(walletId: string, config: CallConfig): Promise<T> {
    return getAccessToken(walletId).then(a =>
      apiCall<T>(config, a).catch((error: ApiError) => {
        if (error.statusCode === 401) {
          resetAccessToken(walletId);
        }

        throw error;
      }),
    );
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({ call }), [apiCall]);
}
