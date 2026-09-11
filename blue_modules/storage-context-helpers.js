export const rollbackWalletIfSaveFailed = async (saved, removeWallet, persist) => {
  if (saved) return;

  removeWallet();
  let persisted = false;
  try {
    persisted = await persist();
  } catch (_e) {
    persisted = false;
  }

  if (persisted) {
    throw new Error('Failed to save wallet to storage. The wallet was not added.');
  }
  throw new Error('Failed to save wallet to storage.');
};
