import { useContext, useMemo } from 'react';
import Config from 'react-native-config';
import { BlueStorageContext } from '../../../blue_modules/storage-context';

export interface ApiInterface {
  call: <T>(config: CallConfig) => Promise<T>;
}

export interface CallConfig {
  url: string;
  method: 'GET' | 'PUT' | 'POST' | 'DELETE';
  data?: any;
  token?: string;
}

export function useApi(): ApiInterface {
  const { ldsDEV } = useContext(BlueStorageContext);

  function buildInit(method: 'GET' | 'PUT' | 'POST' | 'DELETE', accessToken?: string | null, data?: any): RequestInit {
    return {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: accessToken ? `Bearer ${accessToken}` : '',
      },
      body: JSON.stringify(data),
    };
  }

  async function call<T>(config: CallConfig): Promise<T> {
    const baseUrl = ldsDEV ? Config.REACT_APP_LDS_DEV_URL : Config.REACT_APP_LDS_URL;
    return fetch(`${baseUrl}/${config.url}`, buildInit(config.method, config.token, config.data)).then(response => {
      if (response.ok) {
        return response.json().catch(() => undefined);
      }
      return response.json().then(body => {
        throw body;
      });
    });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({ call }), []);
}
