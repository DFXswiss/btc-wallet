import React from 'react';
import { render } from '@testing-library/react-native';

const mockRegisterComponent = jest.fn();
const mockAnalytics = jest.fn();

jest.mock('react', () => jest.requireActual('react'));

jest.mock('../../blue_modules/analytics', () => {
  mockAnalytics.ENUM = { INIT: 'INIT', CREATED_WALLET: '' };
  return mockAnalytics;
});

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  return new Proxy(RN, {
    get(target, prop, receiver) {
      if (prop === 'AppRegistry') {
        return new Proxy(target.AppRegistry, {
          get(appRegistry, key, appReceiver) {
            if (key === 'registerComponent') return mockRegisterComponent;
            return Reflect.get(appRegistry, key, appReceiver);
          },
        });
      }
      return Reflect.get(target, prop, receiver);
    },
  });
});

jest.mock('../../shim.js', () => ({}));

jest.mock('../../App', () => {
  const RN = require('react');
  const { Text } = require('react-native');
  return function App() {
    return RN.createElement(Text, { testID: 'app-root' }, 'app');
  };
});

function mockProvider(name) {
  const PropTypes = require('prop-types');
  function Provider(props) {
    const { View } = require('react-native');
    return require('react').createElement(View, { testID: name }, props.children);
  }
  Provider.propTypes = { children: PropTypes.node };
  return Provider;
}

jest.mock('../../blue_modules/storage-context', () => ({ BlueStorageProvider: mockProvider('BlueStorageProvider') }));
jest.mock('../../contexts/wallet.context', () => ({ WalletContextProvider: mockProvider('WalletContextProvider') }));
jest.mock('../../api/dfx/contexts/language.context', () => ({ LanguageContextProvider: mockProvider('LanguageContextProvider') }));
jest.mock('../../api/dfx/contexts/session.context', () => ({ DfxSessionContextProvider: mockProvider('DfxSessionContextProvider') }));
jest.mock('../../api/spark/contexts/spark.context', () => ({ SparkContextProvider: mockProvider('SparkContextProvider') }));

function loadIndex() {
  mockRegisterComponent.mockClear();
  jest.isolateModules(() => {
    require('../../index');
  });
  expect(mockRegisterComponent).toHaveBeenCalledWith('BlueWallet', expect.any(Function));
  const factory = mockRegisterComponent.mock.calls[mockRegisterComponent.mock.calls.length - 1][1];
  return factory();
}

describe('index.js', () => {
  const originalCapture = Object.getOwnPropertyDescriptor(Error, 'captureStackTrace');

  afterEach(() => {
    if (originalCapture) {
      Object.defineProperty(Error, 'captureStackTrace', originalCapture);
    }
    mockAnalytics.mockClear();
  });

  it('registers BlueAppComponent as BlueWallet, wraps App in the context providers, and records INIT on mount', () => {
    const sentinel = jest.fn();
    Object.defineProperty(Error, 'captureStackTrace', { configurable: true, writable: true, value: sentinel });

    const Component = loadIndex();
    expect(Error.captureStackTrace).toBe(sentinel);
    expect(sentinel).not.toHaveBeenCalled();

    const screen = render(React.createElement(Component));
    const providers = [];
    for (let node = screen.getByTestId('app-root').parent; node; node = node.parent) {
      if (typeof node.type === 'string' && node.props.testID) providers.unshift(node.props.testID);
    }
    expect(providers).toEqual([
      'BlueStorageProvider',
      'WalletContextProvider',
      'LanguageContextProvider',
      'DfxSessionContextProvider',
      'SparkContextProvider',
    ]);
    expect(mockAnalytics).toHaveBeenCalledWith('INIT');
  });

  it('installs a no-op Error.captureStackTrace when the host does not provide one', () => {
    Object.defineProperty(Error, 'captureStackTrace', { configurable: true, writable: true, value: undefined });

    loadIndex();

    expect(typeof Error.captureStackTrace).toBe('function');
    expect(Error.captureStackTrace()).toBeUndefined();
    expect(() => Error.captureStackTrace({ dummy: true }, () => {})).not.toThrow();
  });
});
