// Jest manual mock: the real package loads a TurboModule and crashes outside a device.

const PaymentType = { Send: 0, Receive: 1 };
const PaymentStatus = { Completed: 0, Pending: 1, Failed: 2 };
const PaymentDetails_Tags = {
  Spark: 'Spark',
  Token: 'Token',
  Lightning: 'Lightning',
  Withdraw: 'Withdraw',
  Deposit: 'Deposit',
};
const SdkEvent_Tags = {
  Synced: 'Synced',
  UnclaimedDeposits: 'UnclaimedDeposits',
  ClaimedDeposits: 'ClaimedDeposits',
  PaymentSucceeded: 'PaymentSucceeded',
  PaymentPending: 'PaymentPending',
  PaymentFailed: 'PaymentFailed',
  AutoOptimization: 'AutoOptimization',
  LightningAddressChanged: 'LightningAddressChanged',
  NewDeposits: 'NewDeposits',
};
const Network = { Mainnet: 0, Regtest: 1 };

function tagged(tag) {
  return function Ctor(inner) {
    if (!(this instanceof Ctor)) {
      return new Ctor(inner);
    }
    this.tag = tag;
    this.inner = inner;
  };
}

const Seed = {
  Mnemonic: tagged('Mnemonic'),
  Entropy: tagged('Entropy'),
};

const PaymentRequest = {
  Input: tagged('Input'),
  CrossChain: tagged('CrossChain'),
};

const ReceivePaymentMethod = {
  SparkAddress: tagged('SparkAddress'),
  SparkInvoice: tagged('SparkInvoice'),
  BitcoinAddress: tagged('BitcoinAddress'),
  Bolt11Invoice: tagged('Bolt11Invoice'),
};

const connect = jest.fn();
const defaultConfig = jest.fn(() => ({
  apiKey: undefined,
  network: Network.Mainnet,
  lnurlDomain: undefined,
}));

module.exports = {
  connect,
  defaultConfig,
  Network,
  Seed,
  PaymentType,
  PaymentStatus,
  PaymentDetails_Tags,
  PaymentRequest,
  ReceivePaymentMethod,
  SdkEvent_Tags,
  uniffiInitAsync: jest.fn().mockResolvedValue(undefined),
};
