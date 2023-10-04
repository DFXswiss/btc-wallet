import { useMemo } from 'react';
import { useApi } from './api.hook';
import { Language, LanguageUrl } from '../definitions/language';

export interface LanguageInterface {
  getLanguages: () => Promise<Language[]>;
  getDefaultLanguage: (languages?: Language[]) => Language | undefined;
}

export function useLanguage(): LanguageInterface {
  const { call } = useApi();

  async function getLanguages(): Promise<Language[]> {
    return call<Language[]>({ url: LanguageUrl.get, method: 'GET' });
  }

  return useMemo(
    () => ({
      getLanguages,
      getDefaultLanguage: (languages: Language[] = []) => languages.find(f => f.symbol === 'EN'),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [call],
  );
}
