import assert from 'assert';
import { resolveWalletChange, resetReceiveState } from '../../screen/receive/details';
import { Chain } from '../../models/bitcoinUnits';

// details.js pulls in BlueElectrum (which otherwise opens a long-lived
// peer-rotation timer and keeps jest from exiting) and currency; mock them the
// same way addresses.test.js does, since these pure helpers use neither.
jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));
jest.mock('../../blue_modules/currency', () => ({ init: jest.fn() }));

const fakeWallet = (id, chain, isPosMode = false) => ({ getID: () => id, chain, isPosMode });

// Logic behind the receive screen's wallet selector (PR #200): switching wallets
// must reset the pending-payment watcher for onchain wallets and hand off to the
// LN/POS screens for offchain ones.
describe('ReceiveDetails wallet switch', () => {
  describe('resolveWalletChange', () => {
    it('is a no-op when the picked wallet is the current one', () => {
      assert.deepStrictEqual(resolveWalletChange(fakeWallet('a', Chain.ONCHAIN), 'a'), { action: 'none' });
    });

    it('is a no-op when the picked wallet cannot be found', () => {
      assert.deepStrictEqual(resolveWalletChange(undefined, 'a'), { action: 'none' });
    });

    it('resets when switching to another onchain wallet', () => {
      assert.deepStrictEqual(resolveWalletChange(fakeWallet('b', Chain.ONCHAIN), 'a'), { action: 'reset' });
    });

    it('hands off to LNDReceive for a lightning wallet', () => {
      assert.deepStrictEqual(resolveWalletChange(fakeWallet('b', Chain.OFFCHAIN), 'a'), {
        action: 'navigate',
        target: { name: 'LNDReceive', params: { walletID: 'b' } },
      });
    });

    it('hands off to PosReceive for a POS-mode wallet', () => {
      assert.deepStrictEqual(resolveWalletChange(fakeWallet('b', Chain.OFFCHAIN, true), 'a'), {
        action: 'navigate',
        target: { name: 'PosReceive', params: { walletID: 'b' } },
      });
    });
  });

  describe('resetReceiveState', () => {
    it('clears every watcher flag, baseline and input field', () => {
      const setters = {
        setShowAddress: jest.fn(),
        setShowPendingBalance: jest.fn(),
        setShowConfirmedBalance: jest.fn(),
        setDisplayBalance: jest.fn(),
        setEta: jest.fn(),
        setInitialConfirmed: jest.fn(),
        setInitialUnconfirmed: jest.fn(),
        setIntervalMs: jest.fn(),
        setBip21encoded: jest.fn(),
        setCustomLabel: jest.fn(),
        resetInput: jest.fn(),
      };

      resetReceiveState(setters);

      expect(setters.setShowAddress).toHaveBeenCalledWith(false);
      expect(setters.setShowPendingBalance).toHaveBeenCalledWith(false);
      expect(setters.setShowConfirmedBalance).toHaveBeenCalledWith(false);
      expect(setters.setDisplayBalance).toHaveBeenCalledWith('');
      expect(setters.setEta).toHaveBeenCalledWith('');
      expect(setters.setInitialConfirmed).toHaveBeenCalledWith(0);
      expect(setters.setInitialUnconfirmed).toHaveBeenCalledWith(0);
      expect(setters.setIntervalMs).toHaveBeenCalledWith(5000);
      expect(setters.setBip21encoded).toHaveBeenCalledWith(undefined);
      expect(setters.setCustomLabel).toHaveBeenCalledWith('');
      expect(setters.resetInput).toHaveBeenCalledTimes(1);
    });
  });
});
