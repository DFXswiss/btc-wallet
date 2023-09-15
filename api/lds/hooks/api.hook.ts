import Config from 'react-native-config';

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
    return fetch(`${Config.REACT_APP_LDS_URL}/${config.url}`, buildInit(config.method, config.token, config.data)).then(response => {
      if (response.ok) {
        return response.json().catch(() => undefined);
      }
      return response.json().then(body => {
        throw body;
      });
    });
  }

  return { call };
}
