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
  it('keeps a saved wallet and removes a wallet whose save failed', () => {
    const removeSavedWallet = jest.fn();
    rollbackWalletIfSaveFailed(true, removeSavedWallet);
    expect(removeSavedWallet).not.toHaveBeenCalled();

    const removeFailedWallet = jest.fn();
    expect(() => rollbackWalletIfSaveFailed(false, removeFailedWallet)).toThrow(
      'Failed to save wallet to storage. The wallet was not added.',
    );
    expect(removeFailedWallet).toHaveBeenCalledTimes(1);
  });
});
