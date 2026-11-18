/**
 * The RBF bump and cancel screens check on mount whether the transaction can be replaced.
 * When that check fails (e.g. the transaction data cannot be verified), they show the
 * transaction as not replaceable instead of loading forever, like the CPFP screen does.
 */
import assert from 'assert';

import { HDSegwitBech32Transaction, HDSegwitBech32Wallet } from '../../class';
import RBFBumpFee from '../../screen/transactions/RBFBumpFee';
import RBFCancel from '../../screen/transactions/RBFCancel';

function mountScreen(Screen) {
  const screen = new Screen({ route: { params: { txid: 'aa'.repeat(32), wallet: new HDSegwitBech32Wallet() } } });
  screen.setState = update => {
    screen.state = { ...screen.state, ...update };
  };
  return screen;
}

beforeEach(() => {
  jest.spyOn(HDSegwitBech32Transaction.prototype, 'isOurTransaction').mockResolvedValue(true);
  jest.spyOn(HDSegwitBech32Transaction.prototype, 'getRemoteConfirmationsNum').mockResolvedValue(0);
  jest.spyOn(HDSegwitBech32Transaction.prototype, 'isSequenceReplaceable').mockResolvedValue(true);
  jest.spyOn(HDSegwitBech32Transaction.prototype, 'canCancelTx').mockResolvedValue(true);
  jest
    .spyOn(HDSegwitBech32Transaction.prototype, 'getInfo')
    .mockRejectedValue(new Error('Fetched transaction does not match the requested txid'));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('RBF screens when the replaceability check fails', () => {
  for (const Screen of [RBFBumpFee, RBFCancel]) {
    it(`${Screen.name} stops loading and shows the transaction as not replaceable`, async () => {
      const screen = mountScreen(Screen);
      await screen.componentDidMount();
      assert.strictEqual(screen.state.isLoading, false);
      assert.strictEqual(screen.state.nonReplaceable, true);
    });
  }
});
