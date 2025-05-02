import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, View, StatusBar, ScrollView, StyleSheet } from 'react-native';
import { RouteProp, useNavigation, useRoute, useTheme, NavigationProp } from '@react-navigation/native';
import { BlueButton, BlueCard, BlueDismissKeyboardInputAccessory, SafeBlueArea, BlueFormInput, BlueText } from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import AmountInput from '../../components/AmountInput';
import { BitcoinUnit, Chain } from '../../models/bitcoinUnits';
import loc from '../../loc';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import { OpenCryptoPayPaymentLink } from '../../class/open-crypto-pay';
import { HDSegwitBech32Wallet, MultisigHDWallet } from '../../class';
import { AbstractHDElectrumWallet } from '../../class/wallets/abstract-hd-electrum-wallet';
import BigNumber from 'bignumber.js';
import { useWalletContext } from '../../contexts/wallet.context';

interface OpenCryptoPaySendParams {
  plDetails: any;
  walletID?: string;
}

const OpenCryptoPaySend = () => {
  const { wallets } = useContext(BlueStorageContext);
  const { wallet: mainWallet } = useWalletContext();
  const [isLoading, setIsLoading] = useState(false);
  const {
    params: { plDetails, walletID },
  } = useRoute<RouteProp<{ params: OpenCryptoPaySendParams }>>();
  const { navigate, goBack } = useNavigation<NavigationProp<any>>();
  const [utxosPromise, setUtxosPromise] = useState<Promise<any> | null>(null);
  const [isNextButtonDisabled, setIsNextButtonDisabled] = useState(false);
  const { colors } = useTheme();

  const paymentLink = useRef(OpenCryptoPayPaymentLink.getInstanceFromResponse(plDetails));

  const selectedWallet = useMemo(() => {
    return wallets.find((w: any) => w.getID() === walletID);
  }, [wallets, walletID]);

  // Eagerly fetch utxos to save time on the payment
  useEffect(() => {
    if (mainWallet && mainWallet?.fetchUtxo) {
      const _utxosPromise = mainWallet.fetchUtxo().then(() => setUtxosPromise(null));
      setUtxosPromise(_utxosPromise);
    }
  }, [mainWallet]);

  const stylesHook = StyleSheet.create({
    root: {
      backgroundColor: colors.elevated,
    },
    expiresIn: {
      color: colors.feeText,
      fontSize: 12,
      marginBottom: 5,
      marginHorizontal: 20,
    },
    fee: {
      fontSize: 14,
      color: colors.feeText,
    },
  });

  useEffect(() => {
    if (!plDetails) {
      goBack();
    }
  }, []);

  const handleOffChainPaymen = async () => {
    const { amountSat, description } = paymentLink.current.getLightningPaymentRequestDetails();
    const { invoice } = await paymentLink.current.getLightningRecipientDetails();

    return navigate('SendDetailsRoot', {
      screen: 'LnurlPay',
      params: {
        invoice,
        amountSat,
        amountUnit: BitcoinUnit.SATS,
        description,
        walletID: selectedWallet.getID(),
      },
    });
  };

  const handleOnChainPayment = async () => {
    if (!paymentLink.current.isOnChainPaymentRequestAvailable()) {
      throw new Error('Onchain payment request not available');
    }

    const { amountSats, minFee } = paymentLink.current.getOnChainPaymentRequestDetails() as { amountSats: number; minFee: number };
    const { address, options } = await paymentLink.current.getOnchainRecipientDetails();
    if (!address) {
      throw new Error('Failed to get onchain recipient details');
    }

    const changeAddress =
      selectedWallet instanceof AbstractHDElectrumWallet
        ? selectedWallet._getInternalAddressByIndex(selectedWallet.getNextFreeChangeAddressIndex())
        : selectedWallet.getAddress();

    if (!changeAddress) {
      throw new Error('Failed to get change address');
    }

    if (utxosPromise) await utxosPromise;
    const utxos = await selectedWallet.getUtxo();

    const feeRate = Math.ceil(Number(minFee));
    const targets = [{ value: parseInt(amountSats.toString(), 10), address }];

    const { tx, outputs, fee } = selectedWallet.createTransaction(
      utxos,
      targets,
      feeRate,
      changeAddress,
      HDSegwitBech32Wallet.finalRBFSequence,
    );

    const nonChangeOutputs = outputs.filter(({ address }: any) => address !== changeAddress);
    const recipients = nonChangeOutputs.length > 0 ? nonChangeOutputs : outputs;

    navigate('OpenCryptoPayCommitOnchain', {
      fee: new BigNumber(fee).dividedBy(100000000).toNumber(),
      memo: options?.label,
      walletID: selectedWallet.getID(),
      tx: tx.toHex(),
      recipients,
      satoshiPerByte: feeRate,
      paymentLinkDetails: plDetails,
    });
  };

  const next = () => {
    setIsLoading(true);

    setTimeout(async () => {
      try {
        if (selectedWallet.chain === Chain.OFFCHAIN) {
          await handleOffChainPaymen();
        } else {
          await handleOnChainPayment();
        }
      } catch (error) {
        console.error(error);
      } finally {
        setIsLoading(false);
        setTimeout(() => setIsNextButtonDisabled(true), 1000);
      }
    }, 100);
  };

  const getAmount = () => {
    if (!selectedWallet) return;
    if (selectedWallet.chain === Chain.OFFCHAIN) {
      return paymentLink.current.getLightningPaymentRequestDetails().amountSat;
    } else {
      return paymentLink.current.getOnChainPaymentRequestDetails()?.amountSats || 0;
    }
  };

  const getFee = () => {
    if (!selectedWallet) return;
    if (selectedWallet.chain === Chain.OFFCHAIN) {
      const maxFee = Math.ceil(Number(paymentLink.current.getLightningPaymentRequestDetails().amountSat) * 0.03);
      return `0 - ${maxFee} sats`;
    } else {
      return `${paymentLink.current.getOnChainPaymentRequestDetails()?.minFee || 0} sats/vbyte`;
    }
  };

  const isInsufficientFunds = selectedWallet?.getBalance() < getAmount();

  return (
    <SafeBlueArea style={stylesHook.root}>
      <StatusBar barStyle="light-content" />
      <View style={[styles.root, stylesHook.root]}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <KeyboardAvoidingView enabled behavior="position" keyboardVerticalOffset={20}>
            <View>
              <AmountInput
                isLoading={isLoading}
                amount={getAmount()}
                onAmountUnitChange={() => {}}
                onChangeText={() => {}}
                unit={BitcoinUnit.SATS}
                inputAccessoryViewID={BlueDismissKeyboardInputAccessory.InputAccessoryViewID}
                showMaxButton
                onPressMax={() => {}}
                disabled={true}
              />
            </View>
            <BlueText style={styles.label}>To:</BlueText>
            <BlueText style={styles.staticField}>{paymentLink.current.getRecipientContactDetails()?.name}</BlueText>
            <BlueText style={styles.label}>From your wallet:</BlueText>
            <BlueText style={styles.staticField}>{selectedWallet?.getLabel()}</BlueText>
            <BlueText style={styles.label}>Note</BlueText>
            <View style={styles.noteContainer}>
              <BlueFormInput value={paymentLink.current.getMemo()} onChangeText={() => {}} editable={false} color={colors.feeText} />
            </View>
            <View style={styles.fee}>
              <BlueText style={stylesHook.fee}>{loc.send.create_fee}</BlueText>
              <BlueText style={stylesHook.fee}>{getFee()}</BlueText>
            </View>
          </KeyboardAvoidingView>
          <BlueCard>
            <View>
              {isInsufficientFunds && <BlueText style={styles.insufficientFunds}>{loc.send.insufficient_funds}</BlueText>}
              {isNextButtonDisabled && <BlueText style={styles.insufficientFunds}>{loc.send.server_error}</BlueText>}
              <BlueButton title={loc.lnd.next} onPress={next} disabled={isInsufficientFunds || isNextButtonDisabled} isLoading={isLoading} />
            </View>
          </BlueCard>
        </ScrollView>
      </View>
      <BlueDismissKeyboardInputAccessory />
    </SafeBlueArea>
  );
};

export default OpenCryptoPaySend;
OpenCryptoPaySend.navigationOptions = navigationStyle(
  {
    closeButton: true,
    headerBackVisible: false,
  },
  opts => ({ ...opts, title: loc.send.header }),
);

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingIndicator: {
    flex: 1,
    justifyContent: 'center',
  },
  root: {
    flex: 1,
  },
  scroll: {
    flex: 1,
    justifyContent: 'space-between',
  },
  label: {
    marginHorizontal: 20,
    marginTop: 20,
  },
  pickerContainer: {
    marginHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  noteContainer: { marginHorizontal: 20 },
  staticField: {
    marginHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    color: '#818181',
    fontSize: 16,
  },
  fee: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 8,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  insufficientFunds: {
    alignSelf: 'center',
    marginBottom: 8,
    color: 'red',
    fontSize: 14,
  },
});
