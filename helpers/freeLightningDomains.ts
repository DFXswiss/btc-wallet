export const isFreeDomain = (domain: string) => {
  if (!domain || typeof domain !== 'string') return false;

  const freeDomains = ['lightning.space', 'dev.lightning.space'];
  return freeDomains.includes(domain.toLowerCase());
};
