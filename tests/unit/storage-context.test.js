const BlueApp = require('../../BlueApp');
const { rollbackWalletIfSaveFailed } = require('../../blue_modules/storage-context-helpers');

const AppStorage = BlueApp.AppStorage;

jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));

const prepareStorage = () => {
  const storage = new AppStorage();
  const realmKeyValue = {
    close: jest.fn(),
    create: jest.fn(),
    write: jest.fn(),
  };

  jest.spyOn(storage, 'getRealm').mockResolvedValue(null);
  jest.spyOn(storage, 'openRealmKeyValue').mockResolvedValue(realmKeyValue);
  jest.spyOn(storage, 'setItem').mockResolvedValue(undefined);

  return storage;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('AppStorage.saveToDisk', () => {
  it('returns true when the wallet data is persisted', async () => {
    const storage = prepareStorage();

    await expect(storage.saveToDisk()).resolves.toBe(true);
    expect(storage.setItem).toHaveBeenCalledTimes(2);
  });

  it('returns false instead of rejecting when persistence fails', async () => {
    const storage = prepareStorage();
    const persistenceError = new Error('storage unavailable');
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    storage.setItem.mockRejectedValueOnce(persistenceError);

    await expect(storage.saveToDisk()).resolves.toBe(false);
    expect(consoleError).toHaveBeenCalledWith('saveToDisk: failed to persist wallet data', persistenceError);
  });
});

describe('rollbackWalletIfSaveFailed', () => {
  it('keeps a saved wallet and removes a wallet whose save failed', async () => {
    const persist = jest.fn().mockResolvedValue(true);
    const removeSavedWallet = jest.fn();
    await rollbackWalletIfSaveFailed(true, removeSavedWallet, persist);
    expect(removeSavedWallet).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();

    const removeFailedWallet = jest.fn();
    await expect(rollbackWalletIfSaveFailed(false, removeFailedWallet, persist)).rejects.toThrow(
      'Failed to save wallet to storage. The wallet was not added.',
    );
    expect(removeFailedWallet).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('drops the wallet from the persisted store when the first save fails after writing data', async () => {
    const storage = prepareStorage();
    const persisted = {};
    let failFlagWrite = false;
    storage.setItem.mockImplementation(async (key, value) => {
      if (failFlagWrite && key === AppStorage.FLAG_ENCRYPTED) {
        failFlagWrite = false;
        throw new Error('flag write failed');
      }
      persisted[key] = value;
    });

    const wallet = {
      getID: () => 'w1',
      prepareForSerialization() {},
      type: 'stub',
    };
    storage.wallets.push(wallet);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    failFlagWrite = true;
    const saved = await storage.saveToDisk();
    expect(saved).toBe(false);
    expect(JSON.parse(persisted.data).wallets).toHaveLength(1);

    await expect(
      rollbackWalletIfSaveFailed(
        saved,
        () => storage.deleteWallet(wallet),
        () => storage.saveToDisk(),
      ),
    ).rejects.toThrow('The wallet was not added.');

    expect(JSON.parse(persisted.data).wallets).toHaveLength(0);
    expect(storage.wallets).toHaveLength(0);
    expect(consoleError).toHaveBeenCalled();
  });

  it('does not claim the wallet was not added when the rollback save also fails', async () => {
    const removeWallet = jest.fn();
    const persist = jest.fn().mockResolvedValue(false);
    await expect(rollbackWalletIfSaveFailed(false, removeWallet, persist)).rejects.toThrow(/^Failed to save wallet to storage\.$/);
    expect(removeWallet).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('does not claim the wallet was not added when the rollback save throws', async () => {
    const persist = jest.fn().mockRejectedValue(new Error('disk full'));
    await expect(rollbackWalletIfSaveFailed(false, jest.fn(), persist)).rejects.toThrow(/^Failed to save wallet to storage\.$/);
  });
});
