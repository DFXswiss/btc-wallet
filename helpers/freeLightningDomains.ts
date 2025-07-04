export const isFreeDomain = (domain: string) => {
  if (!domain || typeof domain !== 'string') return false;

  const freeDomains = ['lightning.space', 'dev.lightning.space'];
  return freeDomains.includes(domain.toLowerCase());
};

export const isInternalDomain = (domain: string) => {
  if (!domain || typeof domain !== 'string') return false;

  const internalDomains = ['dfx.swiss', 'dev.dfx.swiss'];
  return internalDomains.includes(domain.toLowerCase());
};
