/**
 * Helper function that navigates to ScanQR screen, and returns promise that will resolve with the result of a scan,
 * and then navigates back. If QRCode scan was closed, promise resolves to null.
 *
 * @param navigateFunc {function} - navigation function from @react-navigation/native
 * @param currentScreen {string | function} - name of the current screen or function that navigates to the current screen
 * @param showFileImportButton {boolean} - whether to show file import button on the ScanQR screen
 *
 * @return {Promise<string>}
 */
function scanQrHelper(
  navigateFunc: (scr: string, params?: any) => void,
  currentScreen: string | (() => void),
  showFileImportButton = true,
): Promise<string | null> {
  return new Promise(resolve => {
    const params = {
      showFileImportButton: Boolean(showFileImportButton),
      onBarScanned: (data: any) => {},
      onDismiss: () => {},
    };

    params.onBarScanned = function (data: any) {
      setTimeout(() => resolve(data.data || data), 1);
      if (typeof currentScreen === 'function') {
        return currentScreen();
      }
      navigateFunc(currentScreen);
    };

    params.onDismiss = function () {
      setTimeout(() => resolve(null), 1);
    };

    navigateFunc('ScanQRCodeRoot', {
      screen: 'ScanQRCode',
      params,
    });
  });
};

export default scanQrHelper;
