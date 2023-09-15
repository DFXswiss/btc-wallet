import AsyncStorage from '@react-native-async-storage/async-storage';

export interface StoreInterface {
  dfxSession: {
    get: () => Promise<Record<string, string>>;
    set: (sessions: Record<string, string>) => Promise<void>;
    remove: () => Promise<void>;
  };
}

enum StoreKey {
  DFX_SESSION = 'dfx.session',
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
    dfxSession: {
      get: () =>
        get(StoreKey.DFX_SESSION)
          .then(r => (r ? JSON.parse(r) : {}))
          .catch(() => ({})),
      set: (sessions: Record<string, string>) => set(StoreKey.DFX_SESSION, JSON.stringify(sessions)),
      remove: () => remove(StoreKey.DFX_SESSION),
    },
  };
}
