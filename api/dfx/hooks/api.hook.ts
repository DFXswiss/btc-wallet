import { useMemo } from 'react';
import Config from 'react-native-config';

export interface ApiInterface {
  call: <T>(config: CallConfig, accessToken?: string) => Promise<T>;
}

export interface CallConfig {
  url: string;
  method: 'GET' | 'PUT' | 'POST' | 'DELETE';
  data?: any;
  noJson?: boolean;
  specialHandling?: SpecialHandling;
}

interface SpecialHandling {
  action: () => void;
  statusCode: number;
}

export function useApi(): ApiInterface {
  function buildInit(method: 'GET' | 'PUT' | 'POST' | 'DELETE', accessToken?: string | null, data?: any, noJson?: boolean): RequestInit {
    return {
      method,
      headers: {
        ...(noJson ? undefined : { 'Content-Type': 'application/json' }),
        Authorization: accessToken ? `Bearer ${accessToken}` : '',
      },
      body: noJson ? data : JSON.stringify(data),
    };
  }

  async function call<T>(config: CallConfig, accessToken?: string): Promise<T> {
    return fetch(`${Config.REACT_APP_API_URL}/${config.url}`, buildInit(config.method, accessToken, config.data, config.noJson)).then(
      response => {
        if (response.status === config.specialHandling?.statusCode) {
          config.specialHandling?.action?.();
        }
        if (response.ok) {
          return response.json().catch(() => undefined);
        }
        return response.json().then(body => {
          throw body;
        });
      },
    );
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({ call }), []);
}
