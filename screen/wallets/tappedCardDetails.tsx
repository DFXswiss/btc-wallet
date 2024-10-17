import React, { useEffect, useState, useCallback, useContext, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Keyboard,
  TouchableWithoutFeedback,
  StyleSheet,
  StatusBar,
  ScrollView,
  I18nManager,
  Platform,
} from 'react-native';
import { BlueCard, BlueLoading, BlueSpacing20, BlueText, SecondButton } from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import loc from '../../loc';
import { useTheme, useRoute, useNavigation } from '@react-navigation/native';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import { LightningLdsWallet } from '../../class/wallets/lightning-lds-wallet';
import Clipboard from '@react-native-clipboard/clipboard';
import { BolcardSecrets, BoltCardModel } from '../../models/boltcard';
import BoltCard from '../../class/boltcard';
import Lnurl from '../../class/lnurl';
import useLdsBoltcards from '../../api/boltcards/hooks/bolcards.hook';
import { useNtag424 } from '../../api/boltcards/hooks/ntag424.hook';
import { HoldCardModal } from '../../components/HoldCardModal';
import alert from '../../components/Alert';

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
    marginVertical: 8,
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
  },
  textLabel2: {
    fontWeight: '500',
    fontSize: 14,
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
    color: '#81868e',
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
  fieldValueContainer: {
    marginBottom: 12,
    position: 'relative',
  },
  copiedTextContainer: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    zIndex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

const CopyField = ({ value }: { value: string }) => {
  const [isCopied, setIsCopied] = useState(false);
  const { colors } = useTheme();

  const onCopyToClipboard = () => {
    if (!value) return;
    setIsCopied(true);
    Clipboard.setString(value);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <View style={styles.fieldValueContainer}>
      {isCopied && (
        <View style={[styles.copiedTextContainer, { backgroundColor: colors.background }]}>
          <BlueText style={styles.textLabel2}>{loc.wallets.xpub_copiedToClipboard}</BlueText>
        </View>
      )}
      <BlueText onPress={onCopyToClipboard}>{value}</BlueText>
    </View>
  );
};

interface TappedCardDetails {
  uid?: string;
  lnurlw_base: string;
  version?: any;
  k0Version: string;
  k1Version: string;
  k2Version: string;
  k3Version: string;
  k4Version: string;
  secrets?: BolcardSecrets;
}

const TappedCardDetails = () => {
  const { wallets, saveToDisk } = useContext(BlueStorageContext);
  const lnWallet = wallets.find(w => w.type === LightningLdsWallet.type);
  const { tappedCardDetails } = useRoute().params as { tappedCardDetails: TappedCardDetails };
  const { navigate, replace, goBack } = useNavigation();
  const [uid, setUid] = useState('');
  const [lnurlw, setLnurlw] = useState('');
  const [minWithdraw, setMinWithdraw] = useState(0);
  const [maxWithdraw, setMaxWithdraw] = useState(0);
  const [lnurlp, setLnurlp] = useState('');
  const [minPay, setMinPay] = useState<number | undefined>(0);
  const [maxPay, setMaxPay] = useState<number | undefined>(0);
  const [secrets, setSecrets] = useState<BolcardSecrets>();
  const [isEmptyCard, setIsEmptyCard] = useState(false);
  const [isAllKeysWritten, setIsAllKeysWritten] = useState(false);
  const [isCardDerivatedFromMyWallet, setIsCardDerivatedFromMyWallet] = useState(false);
  const [isCardWrittenWithErrors, setIsCardWrittenWithErrors] = useState(false);
  const [isRegisteredInServer, setIsRegisteredInServer] = useState(false);
  const [serverDetails, setServerDetails] = useState<BoltCardModel>();
  const [isLoading, setIsLoading] = useState(false);
  const [holdCardModalVisible, setHoldCardModalVisible] = useState(false);
  const { getBoltcards, deleteBoltcard } = useLdsBoltcards();
  const { wipeCard, stopNfcSession } = useNtag424();
  const { colors } = useTheme();

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      try {
        if (tappedCardDetails) {
          setUid(tappedCardDetails.uid ?? '');
          setSecrets(tappedCardDetails.secrets);
          const { k0Version, k1Version, k2Version, k3Version, k4Version } = tappedCardDetails;
          const keyVersions = [k0Version, k1Version, k2Version, k3Version, k4Version];
          const hasVersion0Keys = keyVersions.some(version => version === '00');
          const hasVersion1Keys = keyVersions.some(version => version === '01');
          const allKeysAreVersion0 = keyVersions.every(version => version === '00');
          const allKeysAreVersion1 = keyVersions.every(version => version === '01');

          setIsEmptyCard(allKeysAreVersion0);
          setIsAllKeysWritten(allKeysAreVersion1);
          setIsCardWrittenWithErrors(hasVersion0Keys && hasVersion1Keys);
          setIsCardDerivatedFromMyWallet(Boolean(tappedCardDetails.secrets) && hasVersion1Keys);

          const _lnurlw = tappedCardDetails.lnurlw_base;
          setLnurlw(_lnurlw);
          if (_lnurlw) {
            try {
              const { payLink, minWithdrawable, maxWithdrawable, ...rest } = await BoltCard.queryWidthdrawDetails(_lnurlw);
              setMinWithdraw(minWithdrawable);
              setMaxWithdraw(maxWithdrawable);
              setLnurlp(payLink);
              const { minSendable, maxSendable } = await BoltCard.queryPayDetails(payLink);
              setMinPay(minSendable);
              setMaxPay(maxSendable);

              setIsRegisteredInServer(true);
            } catch (_) {}
          }

          
          if (lnWallet && _lnurlw && tappedCardDetails.secrets) {
            try {
              const boltcards = await getBoltcards(lnWallet.getInvoiceId());
              const [urlPart] = _lnurlw.split('?');
              const externalId = urlPart.split('/').pop();
              const currCard = boltcards.find(card => card.external_id === externalId);
              const uidIsCorrect = currCard?.uid === tappedCardDetails.uid;
              const k0IsCorrect = currCard?.k0 === tappedCardDetails.secrets.k0;
              const k1IsCorrect = currCard?.k1 === tappedCardDetails.secrets.k1 && currCard?.k1 === tappedCardDetails.secrets.k3;
              const k2IsCorrect = currCard?.k2 === tappedCardDetails.secrets.k2 && currCard?.k2 === tappedCardDetails.secrets.k4;
              setIsRegisteredInServer(uidIsCorrect && k0IsCorrect && k1IsCorrect && k2IsCorrect);
              setServerDetails(currCard);
            } catch (_) {
              console.log(_);
              setIsRegisteredInServer(false);
            }
          }
        }
      } catch (error: any) {
        alert(error.message);
      }
      setIsLoading(false);
    })();
  }, []);

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

  const navigateToCreate = () => replace('AddBoltcard');

  const navigateToSend = () => {
    const prefixedUrl = lnurlp.includes('lightning=') ? lnurlp : 'lightning=' + lnurlp;
    const encodedUrl = Lnurl.encode(prefixedUrl);
    navigate('SendDetailsRoot', {
      screen: 'ScanLndInvoice',
      params: {
        uri: encodedUrl,
      },
    });
  };

  const navigateToBackup = () => navigate('BackupBoltcard');

  const handleOnCancelHoldCard = () => {
    setHoldCardModalVisible(false);
    stopNfcSession();
  };

  const onPressWipeCard = async () => {
    if (Platform.OS === 'android') setHoldCardModalVisible(true);
    await wipeCard(secrets as BolcardSecrets);
    handleOnCancelHoldCard();
    goBack();
  };

  const unregisterAndWipe = async () => {
    if (!lnWallet || !secrets || !serverDetails) return;
    if (Platform.OS === 'android') setHoldCardModalVisible(true);
    try {
      await wipeCard(secrets as BolcardSecrets);
    } catch (_) {}

    try {
      deleteBoltcard(lnWallet.getAdminKey(), serverDetails);
    } catch (_) {}

    lnWallet.deleteBoltcard(serverDetails);
    handleOnCancelHoldCard();
    saveToDisk();
    goBack();
  };

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" centerContent={isLoading} contentContainerStyle={styles.scrollViewContent}>
      {isLoading ? (
        <BlueLoading />
      ) : (
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View>
            <BlueCard style={styles.address}>
              <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
              <Text style={[styles.textLabel1, stylesHook.textLabel1]}>UID</Text>
              <CopyField value={uid} />

              <Text style={[styles.textLabel1, stylesHook.textLabel1]}>{loc.boltcard.card_state}</Text>
              <BlueText>
                {isEmptyCard
                  ? loc.boltcard.card_state_empty
                  : isCardWrittenWithErrors
                  ? loc.boltcard.card_written_error
                  : loc.boltcard.card_state_written}
              </BlueText>
              <BlueSpacing20 />

              {!isEmptyCard && (
                <>
                  <Text style={[styles.textLabel1, stylesHook.textLabel1]}>{loc.boltcard.is_it_my_card}</Text>
                  <BlueText>
                    {isCardDerivatedFromMyWallet ? loc.boltcard.derivated_from_wallet : loc.boltcard.not_derivated_from_wallet}
                  </BlueText>
                  <BlueSpacing20 />
                </>
              )}

              {!isEmptyCard && (
                <>
                  <Text style={[styles.textLabel1, stylesHook.textLabel1]}>{loc.boltcard.server_status}</Text>
                  <BlueText>{isRegisteredInServer ? loc.boltcard.active : loc.boltcard.unregitered}</BlueText>
                  <BlueSpacing20 />
                </>
              )}

              {Boolean(lnurlw) && (
                <>
                  <Text style={[styles.textLabel1, stylesHook.textLabel1]}>LNURLw</Text>
                  <CopyField value={lnurlw} />
                </>
              )}

              {(Boolean(minWithdraw) || Boolean(maxWithdraw)) && (
                <>
                  <Text style={[styles.textLabel1, stylesHook.textLabel1]}>{'Min and Max widhtdrawable'}</Text>
                  <BlueText>
                    {minWithdraw} - {maxWithdraw} sats
                  </BlueText>
                  <BlueSpacing20 />
                </>
              )}

              {Boolean(lnurlp) && (
                <>
                  <Text style={[styles.textLabel1, stylesHook.textLabel1]}>LNURLp</Text>
                  <CopyField value={lnurlp} />
                </>
              )}

              {(Boolean(minPay) || Boolean(maxPay)) && (
                <>
                  <Text style={[styles.textLabel1, stylesHook.textLabel1]}>{'Min and Max payable'}</Text>
                  <BlueText>
                    {minPay} - {maxPay} sats
                  </BlueText>
                  <BlueSpacing20 />
                </>
              )}

              {Boolean(secrets) && (
                <>
                  <Text style={[styles.textLabel1, stylesHook.textLabel1]}>Lock key (K0)</Text>
                  <CopyField value={secrets?.k0} />
                  <Text style={[styles.textLabel1, stylesHook.textLabel1]}>Meta key (K1)</Text>
                  <CopyField value={secrets?.k1} />
                  <Text style={[styles.textLabel1, stylesHook.textLabel1]}>File Key (K2)</Text>
                  <CopyField value={secrets?.k2} />
                  <Text style={[styles.textLabel1, stylesHook.textLabel1]}>Meta key (K3)</Text>
                  <CopyField value={secrets?.k3} />
                  <Text style={[styles.textLabel1, stylesHook.textLabel1]}>File Key (K4)</Text>
                  <CopyField value={secrets?.k4} />
                </>
              )}
            </BlueCard>
            <BlueCard style={styles.address}>
              <View>
                {isEmptyCard && (
                  <>
                    <SecondButton onPress={navigateToCreate} title={loc.boltcard.title_create} />
                    <BlueSpacing20 />
                  </>
                )}
                {Boolean(lnurlp) && Boolean(lnWallet) && (
                  <>
                    <SecondButton onPress={navigateToSend} title={loc.boltcard.send_to_card} />
                    <BlueSpacing20 />
                  </>
                )}
                {isCardDerivatedFromMyWallet && isAllKeysWritten && (
                  <>
                    <SecondButton onPress={navigateToBackup} title={loc.boltcard.keys_backup} />
                    <BlueSpacing20 />
                  </>
                )}
                {isCardDerivatedFromMyWallet && !isRegisteredInServer && (
                  <>
                    <SecondButton onPress={onPressWipeCard} title={loc.boltcard.wipe_card} />
                    <BlueSpacing20 />
                  </>
                )}
                {isCardDerivatedFromMyWallet && isRegisteredInServer && (
                  <>
                    <BlueSpacing20 />
                    <TouchableOpacity accessibilityRole="button" onPress={unregisterAndWipe}>
                      <Text textBreakStrategy="simple" style={styles.delete}>
                        {loc.boltcard.unregister_and_wipe}
                      </Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </BlueCard>
          </View>
        </TouchableWithoutFeedback>
      )}
      <HoldCardModal isHoldCardModalVisible={holdCardModalVisible} onCancelHoldCard={handleOnCancelHoldCard} />
    </ScrollView>
  );
};

TappedCardDetails.navigationOptions = navigationStyle({}, opts => ({ ...opts, headerTitle: loc.boltcard.title_details }));

export default TappedCardDetails;
