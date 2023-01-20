import jwtDecode from 'jwt-decode';
import React, { createContext, PropsWithChildren, useContext, useEffect, useState } from 'react';
import { useStore } from '../../hooks/store.hook';
import { Jwt } from '../definitions/jwt';

interface AuthInterface {
  authenticationToken?: string | null;
  setAuthenticationToken: (authenticationToken?: string) => void;
  isLoggedIn: boolean;
}

const AuthContext = createContext<AuthInterface>(undefined as any);

export function useAuthContext(): AuthInterface {
  return useContext(AuthContext);
}

export function AuthContextProvider(props: PropsWithChildren<any>): JSX.Element {
  const [token, setToken] = useState<string | null>();
  const { authenticationToken } = useStore();

  function isExpired(): boolean {
    if (!token) return true;
    const jwt = jwtDecode<Jwt>(token);
    return jwt?.exp != null && Date.now() > new Date(jwt?.exp * 1000).getTime();
  }

  const isLoggedIn = token !== undefined && !isExpired();

  useEffect(() => {
    authenticationToken.get().then(setToken);
  }, [authenticationToken]);

  function setAuthenticationToken(token?: string) {
    token ? authenticationToken.set(token) : authenticationToken.remove();
    setToken(token);
  }

  const context: AuthInterface = {
    authenticationToken: token,
    setAuthenticationToken,
    isLoggedIn,
  };

  return <AuthContext.Provider value={context}>{props.children}</AuthContext.Provider>;
}
