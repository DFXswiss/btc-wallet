import { renderHook } from '@testing-library/react-native';
import Config from 'react-native-config';
import { useAuth } from '../../api/dfx/hooks/auth.hook';

jest.mock('react-native-config', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../../api/dfx/hooks/api.hook', () => ({
  useApi: () => ({ call: jest.fn() }),
}));

describe('useAuth getSignMessage', () => {
  afterEach(() => {
    delete Config.DFX_ENV;
  });

  it('builds the exact environment-specific messages', () => {
    const cases = [
      {
        environment: 'prd',
        expected: 'By_signing_this_message,_you_confirm_that_you_are_the_sole_owner_of_the_provided_Blockchain_address._Your_ID:_bc1qtestaddress',
      },
      {
        environment: 'dev',
        expected: '[dev]_By_signing_this_message,_you_confirm_that_you_are_the_sole_owner_of_the_provided_Blockchain_address._Your_ID:_bc1qtestaddress',
      },
      {
        environment: 'loc',
        expected: '[loc]_By_signing_this_message,_you_confirm_that_you_are_the_sole_owner_of_the_provided_Blockchain_address._Your_ID:_bc1qtestaddress',
      },
      {
        environment: undefined,
        expected: 'By_signing_this_message,_you_confirm_that_you_are_the_sole_owner_of_the_provided_Blockchain_address._Your_ID:_bc1qtestaddress',
      },
    ];

    for (const { environment, expected } of cases) {
      if (environment === undefined) {
        delete Config.DFX_ENV;
      } else {
        Config.DFX_ENV = environment;
      }

      const { result, unmount } = renderHook(() => useAuth());

      expect(result.current.getSignMessage('bc1qtestaddress')).toBe(expected);
      unmount();
    }
  });
});
