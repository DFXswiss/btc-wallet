import React, { useEffect, useState, useCallback, useContext, useRef, useMemo, useLayoutEffect } from 'react';
import {
  View,
  Text,
  Alert,
  TouchableOpacity,
  Keyboard,
  TouchableWithoutFeedback,
  Switch,
  StyleSheet,
  StatusBar,
  ScrollView,
  InteractionManager,
  ActivityIndicator,
  I18nManager,
} from 'react-native';
import { BlueCard, BlueLoading, BlueSpacing10, BlueSpacing20, BlueText, SecondButton, BlueListItem } from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import { LightningCustodianWallet } from '../../class/wallets/lightning-custodian-wallet';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import Biometric from '../../class/biometrics';
import {
  HDSegwitBech32Wallet,
  SegwitP2SHWallet,
  LegacyWallet,
  SegwitBech32Wallet,
  WatchOnlyWallet,
  MultisigHDWallet,
  HDAezeedWallet,
  LightningLdkWallet,
} from '../../class';
import loc, { formatBalanceWithoutSuffix } from '../../loc';
import { useTheme, useRoute, useNavigation, StackActions } from '@react-navigation/native';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import Notifications from '../../blue_modules/notifications';
import { AbstractHDElectrumWallet } from '../../class/wallets/abstract-hd-electrum-wallet';
import alert from '../../components/Alert';
import { BitcoinUnit, Chain } from '../../models/bitcoinUnits';
import { writeFileAndExport } from '../../blue_modules/fs';
import { useDfxSessionContext } from '../../api/dfx/contexts/session.context';
import { LightningLdsWallet } from '../../class/wallets/lightning-lds-wallet';
import Clipboard from '@react-native-clipboard/clipboard';
import { useWalletContext } from '../../contexts/wallet.context';

const prompt = require('../../helpers/prompt');

const styles = StyleSheet.create({
  scrollViewContent: {
    flexGrow: 1,
  },
  address: {
    alignItems: 'center',
    flex: 1,
  },
  textLabel1: {
    fontWeight: '500',
    fontSize: 14,
    marginVertical: 12,
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
  },
  textLabel2: {
    fontWeight: '500',
    fontSize: 14,
    marginVertical: 16,
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
  },
  textValue: {
    fontWeight: '500',
    fontSize: 14,
  },
  hardware: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  delete: {
    color: '#e73955',
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
  },
  marginRight16: {
    marginRight: 16,
  },
  addressProofContainer:{
    height: 52,
  },
});

const WalletDetails = () => {
  const { saveToDisk, wallets, deleteWallet, setSelectedWallet, txMetadata } = useContext(BlueStorageContext);
  const { reset } = useDfxSessionContext();
  const { walletID } = useRoute().params;
  const [isLoading, setIsLoading] = useState(false);
  const [backdoorPressed, setBackdoorPressed] = useState(0);
  const [backdoorBip47Pressed] = useState(0);
  const wallet = useRef(wallets.find(w => w.getID() === walletID)).current;
  const [useWithHardwareWallet, setUseWithHardwareWallet] = useState(wallet.useWithHardwareWalletEnabled());
  const { isAdvancedModeEnabled } = useContext(BlueStorageContext);
  const [isAdvancedModeEnabledRender, setIsAdvancedModeEnabledRender] = useState(false);
  const [isBIP47Enabled, setIsBIP47Enabled] = useState(wallet.isBIP47Enabled());
  const [hideTransactionsInWalletsList] = useState(!wallet.getHideTransactionsInWalletsList());
  const { navigate, dispatch } = useNavigation();
  const { colors } = useTheme();
  const [masterFingerprint, setMasterFingerprint] = useState();
  const walletTransactionsLength = useMemo(() => wallet.getTransactions().length, [wallet]);
  const derivationPath = useMemo(() => {
    try {
      const path = wallet.getDerivationPath();
      return path.length > 0 ? path : null;
    } catch (e) {
      return null;
    }
  }, [wallet]);
  const [lightningWalletInfo, setLightningWalletInfo] = useState({});
  const { walletID: mainWalletId, getOwnershipProof } = useWalletContext();
  const [ownershipProof, setOwnershipProof] = useState(wallet.addressOwnershipProof);
  const [isCopied, setIsCopied] = useState(false);
  const isMainWallet = useMemo(() => mainWalletId === walletID , [wallets]);

  useEffect(() => {
    if (isAdvancedModeEnabledRender && wallet.allowMasterFingerprint()) {
      InteractionManager.runAfterInteractions(() => {
        setMasterFingerprint(wallet.getMasterFingerprintHex());
      });
    }
  }, [isAdvancedModeEnabledRender, wallet]);
  const stylesHook = StyleSheet.create({
    textLabel1: {
      color: colors.feeText,
    },
    textLabel2: {
      color: colors.feeText,
    },
    textValue: {
      color: colors.outputValue,
    },
  });
  useEffect(() => {
    if (wallet.type === LightningLdkWallet.type) {
      wallet.getInfo().then(setLightningWalletInfo);
    }
  }, [wallet]);
  useLayoutEffect(() => {
    isAdvancedModeEnabled().then(setIsAdvancedModeEnabledRender);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, colors, useWithHardwareWallet, hideTransactionsInWalletsList, isBIP47Enabled]);

  useEffect(() => {
    if (wallets.some(w => w.getID() === walletID)) {
      setSelectedWallet(walletID);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletID]);

  useEffect(() => {
    if (isMainWallet && !ownershipProof) {
      setTimeout(() => {
        getOwnershipProof().then(setOwnershipProof).catch(console.error);
      }, 1);
    }
  }, []);

  const deleteAllWallets = () => {
    dispatch(StackActions.replace('AddWalletRoot'));
    for (const w of wallets) {
      deleteWallet(w);
    }
    saveToDisk(true);
    reset();
  }

  const deleteCurrentWallet = () => {
    dispatch(StackActions.pop());
    deleteWallet(wallet);
    saveToDisk();
  };

  const navigateToOverviewAndDeleteWallet = () => {
    setIsLoading(true);
    let externalAddresses = [];
    try {
      externalAddresses = wallet.getAllExternalAddresses();
    } catch (_) {}
    Notifications.unsubscribe(externalAddresses, [], []);
    if(isMainWallet){
      deleteAllWallets();
    }else{
      deleteCurrentWallet();
    }
    ReactNativeHapticFeedback.trigger('notificationSuccess', { ignoreAndroidSystemSettings: false });
  };

  const presentWalletHasBalanceAlert = useCallback(async () => {
    ReactNativeHapticFeedback.trigger('notificationWarning', { ignoreAndroidSystemSettings: false });
    const balanceToConfirm = isMainWallet ? wallets.reduce((acc, w) => acc + w.getBalance(), 0) : wallet.getBalance();
    try {
      const walletBalanceConfirmation = await prompt(
        loc.wallets.details_delete_wallet,
        loc.formatString(loc.wallets.details_del_wb_q, { balance: balanceToConfirm }),
        true,
        'plain-text',
        true,
        loc.wallets.details_delete,
      );
      if (Number(walletBalanceConfirmation) === balanceToConfirm) {
        navigateToOverviewAndDeleteWallet();
      } else {
        ReactNativeHapticFeedback.trigger('notificationError', { ignoreAndroidSystemSettings: false });
        setIsLoading(false);
        alert(loc.wallets.details_del_wb_err);
      }
    } catch (_) {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigateToWalletExport = () => {
    navigate('WalletExportRoot', {
      screen: 'WalletExport',
      params: {
        walletID: wallet.getID(),
      },
    });
  };
  const navigateToMultisigCoordinationSetup = () => {
    navigate('ExportMultisigCoordinationSetupRoot', {
      screen: 'ExportMultisigCoordinationSetup',
      params: {
        walletId: wallet.getID(),
      },
    });
  };
  const navigateToViewEditCosigners = () => {
    navigate('ViewEditMultisigCosignersRoot', {
      screen: 'ViewEditMultisigCosigners',
      params: {
        walletId: wallet.getID(),
      },
    });
  };
  const navigateToXPub = () =>
    navigate('WalletXpubRoot', {
      screen: 'WalletXpub',
      params: {
        walletID,
      },
    });
  const navigateToSignVerify = () =>
    navigate('SignVerifyRoot', {
      screen: 'SignVerify',
      params: {
        walletID: wallet.getID(),
        address: wallet.getAllExternalAddresses()[0], // works for both single address and HD wallets
      },
    });
  const navigateToLdkViewLogs = () => {
    navigate('LdkViewLogs', {
      walletID,
    });
  };

  const navigateToAddresses = () =>
    navigate('WalletAddresses', {
      walletID: wallet.getID(),
    });

  const navigateToPaymentCodes = () =>
    navigate('PaymentCodeRoot', {
      screen: 'PaymentCodesList',
      params: {
        walletID: wallet.getID(),
      },
    });

  const purgeTransactions = async () => {
    if (backdoorPressed < 10) return setBackdoorPressed(backdoorPressed + 1);
    setBackdoorPressed(0);
    const msg = 'Transactions purged. Pls go to main screen and back to rerender screen';

    if (wallet.type === HDSegwitBech32Wallet.type) {
      wallet._txs_by_external_index = {};
      wallet._txs_by_internal_index = {};
      alert(msg);
    }

    if (wallet._hdWalletInstance) {
      wallet._hdWalletInstance._txs_by_external_index = {};
      wallet._hdWalletInstance._txs_by_internal_index = {};
      alert(msg);
    }
  };

  const onExportHistoryPressed = async () => {
    let csvFile = [
      loc.transactions.date,
      loc.transactions.txid,
      `${loc.send.create_amount} (${BitcoinUnit.BTC})`,
      loc.send.create_memo,
    ].join(','); // CSV header
    const transactions = wallet.getTransactions();

    for (const transaction of transactions) {
      const value = formatBalanceWithoutSuffix(transaction.value, BitcoinUnit.BTC, true);

      let hash = transaction.hash;
      let memo = txMetadata[transaction.hash]?.memo?.trim() ?? '';

      if (wallet.chain === Chain.OFFCHAIN) {
        hash = transaction.payment_hash;
        memo = transaction.description;

        if (hash?.type === 'Buffer' && hash?.data) {
          const bb = Buffer.from(hash);
          hash = bb.toString('hex');
        }
      }
      csvFile += '\n' + [new Date(transaction.received).toString(), hash, value, memo].join(','); // CSV line
    }

    await writeFileAndExport(`${wallet.label.replace(' ', '-')}-history.csv`, csvFile);
  };

  const handleDeleteButtonTapped = () => {
    ReactNativeHapticFeedback.trigger('notificationWarning', { ignoreAndroidSystemSettings: false });
    const warningMessage = isMainWallet ? loc.wallets.details_are_you_sure_main_wallet : loc.wallets.details_are_you_sure;
    Alert.alert(
      loc.wallets.details_delete_wallet,
      warningMessage,
      [
        {
          text: loc.wallets.details_yes_delete,
          onPress: async () => {
            const isBiometricsEnabled = await Biometric.isBiometricUseCapableAndEnabled();

            if (isBiometricsEnabled) {
              if (!(await Biometric.unlockWithBiometrics())) {
                return;
              }
            }
            const walletHasBalance = isMainWallet ? wallets.some(w => w.getBalance() > 0) : wallet.getBalance() > 0;
            if (walletHasBalance && wallet.allowSend()) {
              presentWalletHasBalanceAlert();
            } else {
              navigateToOverviewAndDeleteWallet();
            }
          },
          style: 'destructive',
        },
        { text: loc.wallets.details_no_cancel, onPress: () => {}, style: 'cancel' },
      ],
      { cancelable: false },
    );
  };

  const onCopyToClipboard = () => {
    setIsCopied(true)
    Clipboard.setString(ownershipProof);
    setTimeout(() => setIsCopied(false), 2000)
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      centerContent={isLoading}
      contentContainerStyle={styles.scrollViewContent}
      testID="WalletDetailsScroll"
    >
      {isLoading ? (
        <BlueLoading />
      ) : (
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View>
            <BlueCard style={styles.address}>
              <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

              {(() => {
                if (
                  [LegacyWallet.type, SegwitBech32Wallet.type, SegwitP2SHWallet.type].includes(wallet.type) ||
                  (wallet.type === WatchOnlyWallet.type && !wallet.isHd())
                ) {
                  return (
                    <>
                      <Text style={[styles.textLabel1, stylesHook.textLabel1]}>{loc.wallets.details_address}</Text>
                      <Text style={[styles.textValue, stylesHook.textValue]}>{wallet.getAddress()}</Text>
                    </>
                  );
                }
              })()}
              <Text style={[styles.textLabel1, stylesHook.textLabel1]}>{loc.wallets.details_type}</Text>
              <Text style={[styles.textValue, stylesHook.textValue]}>{wallet.typeReadable}</Text>

              {wallet.type === LightningLdkWallet.type && (
                <>
                  <Text style={[styles.textLabel2, stylesHook.textLabel2]}>{loc.wallets.identity_pubkey}</Text>
                  {lightningWalletInfo?.identityPubkey ? (
                    <>
                      <BlueText>{lightningWalletInfo.identityPubkey}</BlueText>
                    </>
                  ) : (
                    <ActivityIndicator />
                  )}
                </>
              )}
              {wallet.type === MultisigHDWallet.type && (
                <>
                  <Text style={[styles.textLabel2, stylesHook.textLabel2]}>{loc.wallets.details_multisig_type}</Text>
                  <BlueText>
                    {`${wallet.getM()} / ${wallet.getN()} (${
                      wallet.isNativeSegwit() ? 'native segwit' : wallet.isWrappedSegwit() ? 'wrapped segwit' : 'legacy'
                    })`}
                  </BlueText>
                </>
              )}
              {wallet.type === MultisigHDWallet.type && (
                <>
                  <Text style={[styles.textLabel2, stylesHook.textLabel2]}>{loc.multisig.how_many_signatures_can_bluewallet_make}</Text>
                  <BlueText>{wallet.howManySignaturesCanWeMake()}</BlueText>
                </>
              )}

              {[LightningCustodianWallet.type, LightningLdsWallet.type].includes(wallet.type) && (
                <>
                  <Text style={[styles.textLabel1, stylesHook.textLabel1]}>{loc.wallets.details_connected_to}</Text>
                  <BlueText>{wallet.getBaseURI()}</BlueText>
                </>
              )}

              {wallet.type === HDAezeedWallet.type && (
                <>
                  <Text style={[styles.textLabel1, stylesHook.textLabel1]}>{loc.wallets.identity_pubkey}</Text>
                  <BlueText>{wallet.getIdentityPubkey()}</BlueText>
                </>
              )}
              <BlueSpacing20 />
              <>
                <Text onPress={purgeTransactions} style={[styles.textLabel2, stylesHook.textLabel2]}>
                  {loc.transactions.transactions_count}
                </Text>
                <BlueText>{wallet.getTransactions().length}</BlueText>
              </>

              {backdoorBip47Pressed >= 10 && wallet.allowBIP47() ? (
                <>
                  <Text style={[styles.textLabel2, stylesHook.textLabel2]}>{loc.bip47.payment_code}</Text>
                  <View style={styles.hardware}>
                    <BlueText>{loc.bip47.purpose}</BlueText>
                    <Switch value={isBIP47Enabled} onValueChange={setIsBIP47Enabled} />
                  </View>
                </>
              ) : null}

              <View>
                {wallet.type === WatchOnlyWallet.type && wallet.isHd() && (
                  <>
                    <BlueSpacing10 />
                    <Text style={[styles.textLabel2, stylesHook.textLabel2]}>{loc.wallets.details_advanced}</Text>
                    <View style={styles.hardware}>
                      <BlueText>{loc.wallets.details_use_with_hardware_wallet}</BlueText>
                      <Switch value={useWithHardwareWallet} onValueChange={setUseWithHardwareWallet} />
                    </View>
                  </>
                )}
                {isAdvancedModeEnabledRender && (
                  <View style={styles.row}>
                    {wallet.allowMasterFingerprint() && (
                      <View style={styles.marginRight16}>
                        <Text style={[styles.textLabel2, stylesHook.textLabel2]}>{loc.wallets.details_master_fingerprint}</Text>
                        <BlueText>{masterFingerprint ?? <ActivityIndicator />}</BlueText>
                      </View>
                    )}

                    {derivationPath && (
                      <View>
                        <Text style={[styles.textLabel2, stylesHook.textLabel2]}>{loc.wallets.details_derivation_path}</Text>
                        <BlueText testID="DerivationPath">{derivationPath}</BlueText>
                      </View>
                    )}
                  </View>
                )}
              </View>
              {wallet.type !== MultisigHDWallet.type && (
                <>
                  <Text style={[styles.textLabel2, stylesHook.textLabel2]}>{loc.wallets.ownership_proof}</Text>
                  <View style={styles.addressProofContainer}>
                    {isCopied ? (
                      <View style={styles.address}>
                        <BlueText style={stylesHook.textLabel2}>{loc.wallets.xpub_copiedToClipboard}</BlueText>
                      </View>
                    ) : ownershipProof ? (
                      <BlueText onPress={onCopyToClipboard}>{ownershipProof}</BlueText>
                    ) : (
                      <ActivityIndicator />
                    )}
                  </View>
                </>
              )}
            </BlueCard>
            {(wallet instanceof AbstractHDElectrumWallet || (wallet.type === WatchOnlyWallet.type && wallet.isHd())) && (
              <BlueListItem onPress={navigateToAddresses} title={loc.wallets.details_show_addresses} chevron />
            )}
            {wallet.allowBIP47() && isBIP47Enabled && <BlueListItem onPress={navigateToPaymentCodes} title="Show payment codes" chevron />}
            <BlueCard style={styles.address}>
              <View>
                <BlueSpacing20 />
                {wallet.type !== MultisigHDWallet.type && (
                  <SecondButton onPress={navigateToWalletExport} testID="WalletExport" title={loc.wallets.details_export_backup} />
                )}
                {walletTransactionsLength > 0 && (
                  <>
                    <BlueSpacing20 />
                    <SecondButton onPress={onExportHistoryPressed} title={loc.wallets.details_export_history} />
                  </>
                )}
                {wallet.type === MultisigHDWallet.type && (
                  <>
                    <BlueSpacing20 />
                    <SecondButton
                      onPress={navigateToMultisigCoordinationSetup}
                      testID="MultisigCoordinationSetup"
                      title={loc.multisig.export_coordination_setup.replace(/^\w/, c => c.toUpperCase())}
                    />
                  </>
                )}

                {wallet.type === MultisigHDWallet.type && (
                  <>
                    <BlueSpacing20 />
                    <SecondButton
                      onPress={navigateToViewEditCosigners}
                      testID="ViewEditCosigners"
                      title={loc.multisig.view_edit_cosigners}
                    />
                  </>
                )}

                {wallet.allowXpub() && (
                  <>
                    <BlueSpacing20 />
                    <SecondButton onPress={navigateToXPub} testID="XPub" title={loc.wallets.details_show_xpub} />
                  </>
                )}
                {wallet.allowSignVerifyMessage() && (
                  <>
                    <BlueSpacing20 />
                    <SecondButton onPress={navigateToSignVerify} testID="SignVerify" title={loc.addresses.sign_title} />
                  </>
                )}
                {wallet.type === LightningLdkWallet.type && (
                  <>
                    <BlueSpacing20 />
                    <SecondButton onPress={navigateToLdkViewLogs} testID="LdkLogs" title={loc.lnd.view_logs} />
                  </>
                )}
                <BlueSpacing20 />
                <BlueSpacing20 />
                <TouchableOpacity accessibilityRole="button" onPress={handleDeleteButtonTapped} testID="DeleteButton">
                  <Text textBreakStrategy="simple" style={styles.delete}>{`${loc.wallets.details_delete}${'  '}`}</Text>
                </TouchableOpacity>
              </View>
            </BlueCard>
          </View>
        </TouchableWithoutFeedback>
      )}
    </ScrollView>
  );
};

WalletDetails.navigationOptions = navigationStyle({}, opts => ({ ...opts, headerTitle: loc.wallets.details_title }));

export default WalletDetails;
