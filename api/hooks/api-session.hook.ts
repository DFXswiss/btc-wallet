import { useAuthContext } from '../contexts/auth.context';
import { useAuth } from './auth.hook';

export interface ApiSessionInterface {
  getSignMessage: (address: string) => Promise<string>;
  createSession: (address: string, signature: string, isSignUp: boolean) => Promise<string>;
  deleteSession: () => Promise<void>;
}

export function useApiSession(): ApiSessionInterface {
  const { setAuthenticationToken } = useAuthContext();
  const { getSignMessage, signIn, signUp } = useAuth();

  async function createSession(address: string, signature: string, isSignUp: boolean): Promise<string> {
    return (isSignUp ? signUp(address, signature) : signIn(address, signature)).then(session => {
      setAuthenticationToken(session.accessToken);
      return session.accessToken;
    });
  }

  async function deleteSession(): Promise<void> {
    setAuthenticationToken(undefined);
  }

  return { getSignMessage, createSession, deleteSession };
}
