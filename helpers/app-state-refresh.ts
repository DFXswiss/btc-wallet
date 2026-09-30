type AppStateRefreshOptions = {
  initialState: string;
  getWalletCount: () => number;
  updateExchangeRate: () => void;
  startRefresh: () => void;
  stopRefresh: () => void;
};

/**
 * Returns the AppState change handler that starts the balance refresh at launch (called with `undefined`) and on
 * return to the foreground, and stops it whenever the app enters the background (on iOS through `inactive`). The
 * wallet count is read on every call: the handler is registered once, before the wallets reach the React state. The
 * app state is tracked even while there are no wallets, so the first change after they load is judged correctly.
 */
export function createAppStateRefreshHandler({
  initialState,
  getWalletCount,
  updateExchangeRate,
  startRefresh,
  stopRefresh,
}: AppStateRefreshOptions): (nextState?: string) => void {
  let currentState = initialState;
  return nextState => {
    const previousState = currentState;
    if (nextState) currentState = nextState;
    // Stopping does not depend on the wallets: a refresh started before the last wallet was deleted still runs.
    if (previousState !== 'background' && nextState === 'background') {
      stopRefresh();
      return;
    }
    if (getWalletCount() === 0) return;
    if ((/inactive|background/.test(previousState) && nextState === 'active') || nextState === undefined) {
      updateExchangeRate();
      startRefresh();
    }
  };
}
