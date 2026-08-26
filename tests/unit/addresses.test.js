import assert from 'assert';
import { getAddress, sortByAddressIndex, totalBalance, filterByAddressType, buildWalletAddresses } from '../../screen/wallets/addresses';
import { TABS } from '../../components/addresses/AddressTypeTabs';

jest.mock('../../blue_modules/currency', () => {
  return {
    init: jest.fn(),
  };
});

jest.mock('../../blue_modules/BlueElectrum', () => {
  return {
    connectMain: jest.fn(),
  };
});

const mockAddressesList = [
  { index: 2, isInternal: false, key: 'third_external_address' },
  { index: 0, isInternal: true, key: 'first_internal_address' },
  { index: 1, isInternal: false, key: 'second_external_address' },
  { index: 1, isInternal: true, key: 'second_internal_address' },
  { index: 0, isInternal: false, key: 'first_external_address' },
];

describe('Addresses', () => {
  it('Sort by index', () => {
    const sortedList = mockAddressesList.sort(sortByAddressIndex);

    assert.strictEqual(sortedList[0].index, 0);
    assert.strictEqual(sortedList[2].index, 1);
    assert.strictEqual(sortedList[4].index, 2);
  });

  it('Have tabs defined', () => {
    const tabsEnum = {
      EXTERNAL: 'receive',
      INTERNAL: 'change',
    };

    assert.deepStrictEqual(TABS, tabsEnum);
  });

  it('Filter by type', () => {
    let currentTab = TABS.EXTERNAL;

    const externalAddresses = mockAddressesList.filter(address => filterByAddressType(TABS.INTERNAL, address.isInternal, currentTab));

    currentTab = TABS.INTERNAL;

    const internalAddresses = mockAddressesList.filter(address => filterByAddressType(TABS.INTERNAL, address.isInternal, currentTab));

    externalAddresses.forEach(address => {
      assert.strictEqual(address.isInternal, false);
    });

    internalAddresses.forEach(address => {
      assert.strictEqual(address.isInternal, true);
    });
  });

  it('Sum confirmed/unconfirmed balance', () => {
    const wallet1Balance = { c: 0, u: 0 };
    const wallet2Balance = { c: 7, u: 3 };
    const wallet3Balance = { c: 3, u: 7 };

    assert.strictEqual(totalBalance(wallet1Balance), 0);
    assert.strictEqual(totalBalance(wallet2Balance), 10);
    assert.strictEqual(totalBalance(wallet3Balance), 10);
  });

  it('buildWalletAddresses derives internal + external and tolerates a throwing derivation', () => {
    const wallet = {
      next_free_change_address_index: 1, // internal loop index 0..1 => 2 internal
      next_free_address_index: 1,
      gap_limit: 2, // external loop index 0..2 => 3 external (index 1 throws)
      _getInternalAddressByIndex: index => `internal_${index}`,
      _getExternalAddressByIndex: index => {
        if (index === 1) throw new Error('boom');
        return `external_${index}`;
      },
      _balances_by_internal_index: {},
      _balances_by_external_index: {},
      _txs_by_internal_index: {},
      _txs_by_external_index: {},
    };

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = buildWalletAddresses(wallet);
    const errorCalls = errorSpy.mock.calls.length;
    errorSpy.mockRestore();

    // the throwing external index 1 is skipped, everything else survives with its index intact
    assert.deepStrictEqual(
      result.map(a => a.address),
      ['internal_0', 'internal_1', 'external_0', 'external_2'],
    );
    assert.deepStrictEqual(
      result.filter(a => !a.isInternal).map(a => a.index),
      [0, 2],
    );
    assert.strictEqual(errorCalls, 1); // the failing derivation was caught, not rethrown
  });

  it('buildWalletAddresses returns an empty list when every derivation throws', () => {
    const wallet = {
      next_free_change_address_index: 0,
      next_free_address_index: 0,
      gap_limit: 1,
      _getInternalAddressByIndex: () => {
        throw new Error('bad');
      },
      _getExternalAddressByIndex: () => {
        throw new Error('bad');
      },
      _balances_by_internal_index: {},
      _balances_by_external_index: {},
      _txs_by_internal_index: {},
      _txs_by_external_index: {},
    };

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    assert.deepStrictEqual(buildWalletAddresses(wallet), []);
    errorSpy.mockRestore();
  });

  it('Returns AddressItem object', () => {
    const fakeWallet = {
      _getExternalAddressByIndex: index => `external_address_${index}`,
      _getInternalAddressByIndex: index => `internal_address_${index}`,
      _balances_by_external_index: [{ c: 0, u: 0 }],
      _balances_by_internal_index: [{ c: 0, u: 0 }],
      _txs_by_external_index: { 0: [{}] },
      _txs_by_internal_index: { 0: [{}, {}] },
    };

    const firstExternalAddress = getAddress(fakeWallet, 0, false);
    const firstInternalAddress = getAddress(fakeWallet, 0, true);

    assert.deepStrictEqual(firstExternalAddress, {
      address: 'external_address_0',
      balance: 0,
      index: 0,
      isInternal: false,
      key: 'external_address_0',
      transactions: 1,
    });

    assert.deepStrictEqual(firstInternalAddress, {
      address: 'internal_address_0',
      balance: 0,
      index: 0,
      isInternal: true,
      key: 'internal_address_0',
      transactions: 2,
    });
  });
});
