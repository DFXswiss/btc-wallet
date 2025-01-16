import React, { useState, useCallback, useContext, useRef, useEffect } from 'react';
import {
  InteractionManager,
  ScrollView,
  ActivityIndicator,
  StatusBar,
  View,
  StyleSheet,
  AppState,
  Text,
  I18nManager
} from 'react-native';
import { useTheme, useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';
import { Icon } from 'react-native-elements';

import { BlueSpacing20, SafeBlueArea, BlueText, BlueCard } from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import Privacy from '../../blue_modules/Privacy';
import Biometric from '../../class/biometrics';
import { LegacyWallet, MultisigHDWallet, SegwitBech32Wallet, SegwitP2SHWallet } from '../../class';
import loc from '../../loc';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import QRCodeComponent from '../../components/QRCodeComponent';
import Secret from './secret';

const WalletExport = () => {
  const { wallets, saveToDisk } = useContext(BlueStorageContext);
  const { walletID } = useRoute().params;
  const [isLoading, setIsLoading] = useState(true);
  const { goBack } = useNavigation();
  const { colors } = useTheme();
  const wallet = wallets.find(w => w.getID() === walletID);
  const [qrCodeSize, setQRCodeSize] = useState(90);
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (!isLoading && nextAppState === 'background') {
        goBack();
      }

      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [goBack, isLoading]);

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
      const task = InteractionManager.runAfterInteractions(async () => {
        if (wallet) {
          const isBiometricsEnabled = await Biometric.isBiometricUseCapableAndEnabled();

          if (isBiometricsEnabled) {
            if (!(await Biometric.unlockWithBiometrics())) {
              return goBack();
            }
          }
          if (!wallet.getUserHasSavedExport()) {
            wallet.setUserHasSavedExport(true);
            saveToDisk();
          }
          setIsLoading(false);
        }
      });
      return () => {
        task.cancel();
        Privacy.disableBlur();
      };
    }, [goBack, saveToDisk, wallet]),
  );

  if (isLoading || !wallet)
    return (
      <View style={[styles.loading, stylesHook.loading]}>
        <ActivityIndicator />
      </View>
    );

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
