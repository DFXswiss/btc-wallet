import AsyncStorage from '@react-native-async-storage/async-storage';

export interface StoreInterface {
  authenticationToken: {
    get: () => Promise<string | null>;
    set: (token: string) => Promise<void>;
    remove: () => Promise<void>;
  };
}

enum StoreKey {
  AUTH_TOKEN = 'authenticationToken',
}

export function useStore(): StoreInterface {
  function set(key: StoreKey, value: string): Promise<void> {
    return AsyncStorage.setItem(key, value);
  }

  function get(key: StoreKey): Promise<string | null> {
    return AsyncStorage.getItem(key) ?? undefined;
  }

  function remove(key: StoreKey): Promise<void> {
    return AsyncStorage.removeItem(key);
  }

  return {
    authenticationToken: {
      get: () => get(StoreKey.AUTH_TOKEN),
      set: (value: string) => set(StoreKey.AUTH_TOKEN, value),
      remove: () => remove(StoreKey.AUTH_TOKEN),
    },
  };
}
