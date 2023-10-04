export const LanguageUrl = { get: 'language' };

export interface Language {
  id: number;
  name: string;
  symbol: string;
  foreignName: string;
  enable: boolean;
}
