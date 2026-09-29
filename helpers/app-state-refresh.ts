type AppStateRefreshOptions = {
  initialState: string;
  getWalletCount: () => number;
  updateExchangeRate: () => void;
  startRefresh: () => void;
  stopRefresh: () => void;
};

/**
 * Returns the AppState change handler that starts the balance refresh at launch (called with `undefined`) and on
 * return to the foreground, and stops it in the background. The wallet count is read on every call: the handler is
 * registered once, before the wallets reach the React state.
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
    if (getWalletCount() === 0) return;
    if ((/inactive|background/.test(currentState) && nextState === 'active') || nextState === undefined) {
      updateExchangeRate();
      startRefresh();
    }
    if (currentState === 'active' && nextState && /background/.test(nextState)) stopRefresh();
    if (nextState) currentState = nextState;
  };
}
