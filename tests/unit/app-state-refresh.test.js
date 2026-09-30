import { createAppStateRefreshHandler } from '../../helpers/app-state-refresh';

describe('createAppStateRefreshHandler', () => {
  let walletCount;
  let actions;

  const createHandler = initialState => createAppStateRefreshHandler({ initialState, getWalletCount: () => walletCount, ...actions });

  beforeEach(() => {
    walletCount = 1;
    actions = { updateExchangeRate: jest.fn(), startRefresh: jest.fn(), stopRefresh: jest.fn() };
  });

  it('starts the refresh at launch when the wallets load after the handler was created', () => {
    walletCount = 0;
    const handle = createHandler('active');
    walletCount = 2;

    handle(undefined);

    expect(actions.updateExchangeRate).toHaveBeenCalledTimes(1);
    expect(actions.startRefresh).toHaveBeenCalledTimes(1);
  });

  it('does nothing while there are no wallets', () => {
    walletCount = 0;
    const handle = createHandler('background');

    handle(undefined);
    handle('active');
    handle('background');

    expect(actions.updateExchangeRate).not.toHaveBeenCalled();
    expect(actions.startRefresh).not.toHaveBeenCalled();
    expect(actions.stopRefresh).not.toHaveBeenCalled();
  });

  it('restarts the refresh when the app returns to the foreground', () => {
    const handle = createHandler('background');

    handle('active');

    expect(actions.updateExchangeRate).toHaveBeenCalledTimes(1);
    expect(actions.startRefresh).toHaveBeenCalledTimes(1);
    expect(actions.stopRefresh).not.toHaveBeenCalled();
  });

  it('stops the refresh in the background and restarts it after an inactive phase', () => {
    const handle = createHandler('active');

    handle('background');
    expect(actions.stopRefresh).toHaveBeenCalledTimes(1);
    expect(actions.startRefresh).not.toHaveBeenCalled();

    handle('active');
    handle('inactive');
    handle('active');
    expect(actions.startRefresh).toHaveBeenCalledTimes(2);
    expect(actions.stopRefresh).toHaveBeenCalledTimes(1);
  });

  it('stops the refresh when iOS moves to the background through the inactive state', () => {
    const handle = createHandler('active');

    handle('inactive');
    handle('background');

    expect(actions.stopRefresh).toHaveBeenCalledTimes(1);
    expect(actions.startRefresh).not.toHaveBeenCalled();
  });

  it('keeps track of the app state while there are no wallets', () => {
    walletCount = 0;
    const handle = createHandler('active');
    handle('background');
    walletCount = 1;

    handle('active');

    expect(actions.startRefresh).toHaveBeenCalledTimes(1);
  });

  it('does not restart the refresh on a change between two foreground states', () => {
    const handle = createHandler('active');

    handle('active');

    expect(actions.startRefresh).not.toHaveBeenCalled();
    expect(actions.stopRefresh).not.toHaveBeenCalled();
  });
});
