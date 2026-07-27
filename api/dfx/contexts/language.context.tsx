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

export function LanguageContextProvider(props: PropsWithChildren): React.JSX.Element {
  const [languages, setLanguages] = useState<Language[]>();
  const { getLanguages } = useLanguage();

  useEffect(() => {
    getLanguages()
      .then(setLanguages)
      .catch(e => console.error('LanguageContext: failed to load languages', e));
  }, [getLanguages]);

  const context: LanguageInterface = useMemo(() => ({ languages: languages?.filter(l => l.enable) }), [languages]);

  return <LanguageContext.Provider value={context}>{props.children}</LanguageContext.Provider>;
}
