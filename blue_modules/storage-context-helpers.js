export const rollbackWalletIfSaveFailed = (saved, removeWallet) => {
  if (saved) return;

  removeWallet();
  throw new Error('Failed to save wallet to storage. The wallet was not added.');
};
