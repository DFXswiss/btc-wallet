import React, { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';
import { Language } from '../definitions/language';
import { useLanguage } from '../hooks/language.hook';

interface LanguageInterface {
  languages?: Language[];
}

const LanguageContext = createContext<LanguageInterface>(undefined as any);

export function useLanguageContext(): LanguageInterface {
  return useContext(LanguageContext);
}

export function LanguageContextProvider(props: PropsWithChildren): JSX.Element {
  const [languages, setLanguages] = useState<Language[]>();
  const { getLanguages } = useLanguage();

  useEffect(() => {
    getLanguages().then(setLanguages).catch(console.error);
  }, [getLanguages]);

  const context: LanguageInterface = useMemo(() => ({ languages: languages?.filter(l => l.enable) }), [languages]);

  return <LanguageContext.Provider value={context}>{props.children}</LanguageContext.Provider>;
}
