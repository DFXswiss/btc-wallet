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

jest.mock('../../blue_modules/storage-context', () => {
  const PropTypes = require('prop-types');
  function BlueStorageProvider(props) {
    return props.children;
  }
  BlueStorageProvider.propTypes = { children: PropTypes.node };
  return { BlueStorageProvider };
});
jest.mock('../../contexts/wallet.context', () => {
  const PropTypes = require('prop-types');
  function WalletContextProvider(props) {
    return props.children;
  }
  WalletContextProvider.propTypes = { children: PropTypes.node };
  return { WalletContextProvider };
});
jest.mock('../../api/dfx/contexts/language.context', () => {
  const PropTypes = require('prop-types');
  function LanguageContextProvider(props) {
    return props.children;
  }
  LanguageContextProvider.propTypes = { children: PropTypes.node };
  return { LanguageContextProvider };
});
jest.mock('../../api/dfx/contexts/session.context', () => {
  const PropTypes = require('prop-types');
  function DfxSessionContextProvider(props) {
    return props.children;
  }
  DfxSessionContextProvider.propTypes = { children: PropTypes.node };
  return { DfxSessionContextProvider };
});
jest.mock('../../api/spark/contexts/spark.context', () => {
  const PropTypes = require('prop-types');
  function SparkContextProvider(props) {
    return props.children;
  }
  SparkContextProvider.propTypes = { children: PropTypes.node };
  return { SparkContextProvider };
});

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
    expect(screen.getByTestId('app-root').props.children).toBe('app');
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
