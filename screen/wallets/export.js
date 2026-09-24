import React, { useState, useCallback, useContext, useEffect, useRef } from 'react';
import { InteractionManager, ScrollView, ActivityIndicator, StatusBar, View, StyleSheet, AppState, Text, I18nManager } from 'react-native';
import { useTheme, useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';
import { Icon } from 'react-native-elements';

import { BlueSpacing20, SafeBlueArea, BlueText, BlueCard } from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import Privacy from '../../blue_modules/Privacy';
import Biometric from '../../class/biometrics';
import {
  HDLegacyBreadwalletWallet,
  HDLegacyP2PKHWallet,
  HDSegwitBech32Wallet,
  HDSegwitP2SHWallet,
  LegacyWallet,
  MultisigHDWallet,
  SegwitBech32Wallet,
  SegwitP2SHWallet,
} from '../../class';
import loc from '../../loc';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import QRCodeComponent from '../../components/QRCodeComponent';
import Secret from './secret';
import { SparkWallet } from '../../class/wallets/spark-wallet';
import { deriveSparkMnemonic } from '../../api/spark/spark-seed';

const BIP39_HD_WALLET_TYPES = new Set([
  HDSegwitBech32Wallet.type,
  HDSegwitP2SHWallet.type,
  HDLegacyP2PKHWallet.type,
  HDLegacyBreadwalletWallet.type,
]);

function deriveBoundSparkMnemonic(sparkWallet, wallets) {
  const sourceWalletId = sparkWallet.sourceWalletId;
  if (typeof sourceWalletId !== 'string' || !sourceWalletId) throw new Error('Spark source wallet is unavailable');
  const sources = wallets.filter(candidate => {
    if (!BIP39_HD_WALLET_TYPES.has(candidate.type) || typeof candidate.getID !== 'function') return false;
    try {
      return candidate.getID() === sourceWalletId;
    } catch {
      return false;
    }
  });
  if (sources.length !== 1) throw new Error('Spark source wallet is unavailable');
  const source = sources[0];
  const onChainMnemonic = source.getSecret();
  if (typeof onChainMnemonic !== 'string' || !onChainMnemonic.trim()) throw new Error('Spark source wallet is unavailable');
  return deriveSparkMnemonic(onChainMnemonic, source.getPassphrase?.() || undefined);
}

const WalletExport = () => {
  const { wallets, saveToDisk } = useContext(BlueStorageContext);
  const { walletID } = useRoute().params;
  const [isLoading, setIsLoading] = useState(true);
  const { goBack } = useNavigation();
  const { colors } = useTheme();
  const wallet = wallets.find(w => w.getID() === walletID);
  const [qrCodeSize, setQRCodeSize] = useState(90);
  const [sparkMnemonic, setSparkMnemonic] = useState();
  const [sparkExportError, setSparkExportError] = useState(false);
  const isSparkWallet = wallet?.type === SparkWallet.type;
  const appState = useRef(AppState.currentState);
  const sparkRevealGeneration = useRef(0);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (isSparkWallet && (nextAppState === 'inactive' || nextAppState === 'background')) {
        sparkRevealGeneration.current += 1;
        setSparkMnemonic(undefined);
      }
      const wasSparkExportInterrupted = appState.current === 'inactive' || appState.current === 'background';
      if (isSparkWallet && wasSparkExportInterrupted && nextAppState === 'active') {
        goBack();
      }
      if (nextAppState === 'background' && (isSparkWallet || !isLoading)) {
        goBack();
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [goBack, isLoading, isSparkWallet]);

  const stylesHook = {
    loading: {
      backgroundColor: colors.elevated,
    },
    root: {
      backgroundColor: colors.elevated,
    },
    type: { color: colors.foregroundColor },
    secret: { color: colors.foregroundColor },
    warning: { color: colors.failedColor },
    infoText: {
      color: colors.brandingColor,
    },
  };

  useFocusEffect(
    useCallback(() => {
      Privacy.enableBlur();
      let isActive = true;
      const revealGeneration = sparkRevealGeneration.current;
      const task = InteractionManager.runAfterInteractions(async () => {
        if (wallet) {
          const isBiometricsEnabled = await Biometric.isBiometricUseCapableAndEnabled();

          if (isBiometricsEnabled) {
            if (!(await Biometric.unlockWithBiometrics())) {
              return goBack();
            }
          }
          const sparkRevealWasInvalidated = revealGeneration !== sparkRevealGeneration.current;
          const appIsActive = AppState.currentState === 'active';
          if (!isActive || (wallet.type === SparkWallet.type && (!appIsActive || sparkRevealWasInvalidated))) {
            return;
          }
          if (wallet.type === SparkWallet.type) {
            try {
              setSparkMnemonic({
                wallet,
                sourceWalletId: wallet.sourceWalletId,
                mnemonic: deriveBoundSparkMnemonic(wallet, wallets),
              });
              setSparkExportError(false);
            } catch {
              setSparkMnemonic(undefined);
              setSparkExportError(true);
            }
          } else {
            if (!wallet.getUserHasSavedExport()) {
              wallet.setUserHasSavedExport(true);
              saveToDisk();
            }
          }
          setIsLoading(false);
        }
      });
      return () => {
        isActive = false;
        task.cancel();
        setSparkMnemonic(undefined);
        Privacy.disableBlur();
      };
    }, [goBack, saveToDisk, wallet, wallets]),
  );

  if (isLoading || !wallet)
    return (
      <View style={[styles.loading, stylesHook.loading]}>
        <ActivityIndicator />
      </View>
    );

  if (isSparkWallet) {
    const visibleSparkMnemonic =
      sparkMnemonic?.wallet === wallet && sparkMnemonic?.sourceWalletId === wallet.sourceWalletId ? sparkMnemonic.mnemonic : undefined;
    return (
      <SafeBlueArea style={[styles.root, stylesHook.root]}>
        <StatusBar barStyle="light-content" />
        <ScrollView contentContainerStyle={styles.scrollViewContent} testID="WalletExportScroll">
          <BlueText style={[styles.type, stylesHook.type]}>{wallet.typeReadable}</BlueText>
          <BlueSpacing20 />
          <BlueCard>
            <Text style={[styles.infoText, stylesHook.infoText]}>{loc.wallets.lightning_spark_recovery_explanation}</Text>
            {sparkExportError ? (
              <Text style={[styles.infoText, stylesHook.warning]}>{loc.wallets.lightning_spark_recovery_unavailable}</Text>
            ) : visibleSparkMnemonic ? (
              <View testID="SparkRecoveryPhrase">
                <Secret secret={visibleSparkMnemonic} />
              </View>
            ) : null}
          </BlueCard>
        </ScrollView>
      </SafeBlueArea>
    );
  }

  // for SLIP39 we need to show all shares
  let secrets = wallet.getSecret();
  if (typeof secrets === 'string') {
    secrets = [secrets];
  }

  const onLayout = e => {
    const { height, width } = e.nativeEvent.layout;
    setQRCodeSize(height > width ? width - 40 : e.nativeEvent.layout.width / 1.8);
  };

  const renderCosigners = () => {
    if (wallet.type !== MultisigHDWallet.type) return null;
    const cosigners = [];
    for (let i = 1; i <= wallet.getN(); i++) {
      const cosigner = wallet.getCosigner(i);
      cosigners.push(<Secret secret={cosigner} key={i} />);
    }
    return cosigners;
  };

  return (
    <SafeBlueArea style={[styles.root, stylesHook.root]} onLayout={onLayout}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.scrollViewContent} testID="WalletExportScroll">
        <View>
          <BlueText style={[styles.type, stylesHook.type]}>{wallet.typeReadable}</BlueText>
        </View>

        {[LegacyWallet.type, SegwitBech32Wallet.type, SegwitP2SHWallet.type].includes(wallet.type) && (
          <BlueCard>
            <BlueText>{wallet.getAddress()}</BlueText>
          </BlueCard>
        )}
        <BlueSpacing20 />
        {secrets.map(s => (
          <React.Fragment key={s}>
            <View style={styles.infoContainer}>
              <Icon name="info-outline" type="material" color={colors.brandingColor} size={18} />
              <Text style={[styles.infoText, stylesHook.infoText]}>{loc.pleasebackup.info}</Text>
            </View>
            {wallet.type !== MultisigHDWallet.type && <Secret secret={s} />}
            <BlueSpacing20 />
            <QRCodeComponent isMenuAvailable={false} value={wallet.getSecret()} size={qrCodeSize} logoSize={70} />
            {renderCosigners()}
            <View style={styles.grow} />
          </React.Fragment>
        ))}
      </ScrollView>
    </SafeBlueArea>
  );
};

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
  },
  scrollViewContent: {
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1,
  },
  type: {
    fontSize: 17,
    fontWeight: '700',
  },
  infoContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 243, 137, 0.9)',
    borderRadius: 8,
    marginHorizontal: 20,
    marginBottom: 15,
    padding: 7,
    paddingRight: 20,
  },
  infoText: {
    backgroundColor: 'transparent',
    fontSize: 14,
    marginHorizontal: 5,
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
  },
  grow: {
    flexGrow: 1,
  },
});

WalletExport.navigationOptions = navigationStyle(
  {
    closeButton: true,
    headerBackVisible: false,
  },
  opts => ({ ...opts, title: loc.wallets.export_title }),
);

export default WalletExport;
