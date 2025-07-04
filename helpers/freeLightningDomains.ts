export const isFreeDomain = (domain: string) => {
  if (!domain || typeof domain !== 'string') return false;

  const freeDomains = ['lightning.space', 'dev.lightning.space'];
  return freeDomains.includes(domain.toLowerCase());
};

export const isInternalDomain = (domain: string) => {
  if (!domain || typeof domain !== 'string') return false;

  const internalDomains = ['dfx.swiss', 'api.dfx.swiss', 'dev.dfx.swiss', 'dev.api.dfx.swiss'];
  return internalDomains.some(d => domain.toLowerCase().includes(d));
};
