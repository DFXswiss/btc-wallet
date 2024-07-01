import React, { useContext, useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { Icon, Text } from 'react-native-elements';
import navigationStyle from '../../components/navigationStyle';
import { BlueButton, BlueDismissKeyboardInputAccessory } from '../../BlueComponents';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import { LightningLdsWallet } from '../../class/wallets/lightning-lds-wallet';
import useLdsBoltcards from '../../api/boltcards/hooks/bolcards.hook';
import { AbstractWallet } from '../../class';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useTheme } from '@react-navigation/native';
import loc from '../../loc';
import BoltCardUI from '../../components/BoltCardUI';
import BoltcardTransactionList from '../../components/BoltcardTransactionList';
import BoltCard from '../../class/boltcard';
import { Hit } from '../../api/boltcards/definitions/apiDtos';
import useInputAmount from '../../hooks/useInputAmount';
import alert from '../../components/Alert';

const BoltcardDetails: React.FC = () => {
  const { colors } = useTheme();
  const { wallets, saveToDisk } = useContext(BlueStorageContext);
  const ldsWallet = wallets.find((w: AbstractWallet) => w.type === LightningLdsWallet.type) as LightningLdsWallet;
  const [card, setCard] = useState(ldsWallet.getBoltcard() as BoltCard);
  const { navigate } = useNavigation();
  const [isEditCard, setIsEditCard] = useState(false);
  const [hits, setHits] = useState<Hit[]>(ldsWallet.getBoltcard()?.cachedHits || []);
  const { getHits, enableBoltcard, updateBoltcard } = useLdsBoltcards();
  const [isPolling, setIsPolling] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const pollInterval = useRef<NodeJS.Timeout>();
  const [cardName, setCardName] = useState('');
  const { amountSats: dailySats, formattedUnit: dailyUnit, inputProps: dailyInputProps, resetInput: resetDaily } = useInputAmount();
  const { amountSats: txLimitSats, formattedUnit: txLimitUnit, inputProps: txLimitInputProps, resetInput: resetTxLimit } = useInputAmount();

  useEffect(() => {
    (async () => {
      try {
        pollInterval.current = setInterval(async () => {
          if (isPolling) return;
          setIsPolling(true);
          const latestHits = await getHits(ldsWallet.getInvoiceId());
          card.cachedHits = latestHits;
          setCard(card);
          setHits(latestHits);
          setIsPolling(false);
        }, 5000);
      } catch (_) {
        console.log(_);
      }
    })();
    return () => {
      if (pollInterval.current) {
        clearInterval(pollInterval.current);
      }
    };
  }, []);

  const stylesHooks = StyleSheet.create({
    root: {
      backgroundColor: colors.elevated,
      flex: 1,
    },
    optionText: {
      color: colors.foregroundColor,
    },
    textdesc: {
      color: colors.alternativeTextColor,
    },
    textInputContainer: {
      borderColor: colors.formBorder,
      borderBottomColor: colors.formBorder,
      backgroundColor: colors.inputBackgroundColor,
    },
    inputTitle: {
      color: colors.foregroundColor,
    },
    textInput: {
      color: colors.foregroundColor,
    },
    detailsContainer: {
      backgroundColor: colors.background,
    },
  });

  const resetInputs = () => {
    resetDaily();
    resetTxLimit();
    setCardName('');
  }

  const handleOnPressUpdate = async () => {
    try {
      if (isUpdating) return;
      Keyboard.dismiss();
      setIsUpdating(true);
      const updatedCard = await updateBoltcard(ldsWallet.getAdminKey(), {
        ...card,
        ...(cardName && { card_name: cardName }),
        ...(dailySats > 0 && { daily_limit: dailySats }),
        ...(txLimitSats > 0 && { tx_limit: txLimitSats }),
      });
      card.card_name = updatedCard.card_name;
      card.daily_limit = updatedCard.daily_limit;
      card.tx_limit = updatedCard.tx_limit;
      setCard(card);
      await saveToDisk();
      setIsUpdating(false);
      setIsEditCard(false);
      resetInputs();
    } catch (error) {
      setIsUpdating(false);
      alert(error);
    }
  };

  const toggleEditCard = () => setIsEditCard(true);
  const toggleTx = () => {
    setIsEditCard(false);
    resetInputs();
  }
  const navigateToBackup = () => navigate('BackupBoltcard');
  const navigateToDelete = () => navigate('DeleteBoltcard');
  const toggleCardActive = async () => {
    const newState = !card.enable;
    const { enable } = await enableBoltcard(ldsWallet.getAdminKey(), card, newState);
    card.enable = enable;
    setCard(card);
    await saveToDisk();
  };

  const OptionButton = (title: string, icon: string, onPress: () => void) => {
    return (
      <TouchableOpacity onPress={onPress} style={styles.optionButton}>
        <Icon name={icon} size={24} color={colors.foregroundColor} />
        <Text style={[stylesHooks.optionText]}>{title}</Text>
      </TouchableOpacity>
    );
  };

  const renderEditCard = () => {
    return (
      <View style={[styles.editContainer, stylesHooks.detailsContainer]}>
        <View>
          <View style={styles.inputField}>
            <Text style={styles.inputLabel}>Card Name</Text>
            <View style={[styles.textInputContainer, stylesHooks.textInputContainer]}>
              <TextInput
                value={cardName}
                onChangeText={text => setCardName(text)}
                style={[styles.textInput, stylesHooks.textInput]}
                placeholderTextColor="#81868e"
                placeholder={card.card_name}
                inputAccessoryViewID={BlueDismissKeyboardInputAccessory.InputAccessoryViewID}
              />
            </View>
          </View>
          <View style={styles.inputField}>
            <Text style={styles.inputLabel}>Tx Limit</Text>
            <View style={[styles.textInputContainer, stylesHooks.textInputContainer]}>
              <TextInput
                style={[styles.textInput, stylesHooks.textInput]}
                placeholderTextColor="#81868e"
                placeholder={card.tx_limit.toString()}
                inputAccessoryViewID={BlueDismissKeyboardInputAccessory.InputAccessoryViewID}
                {...txLimitInputProps}
              />
              <Text style={styles.inputUnit}>{txLimitUnit}</Text>
            </View>
          </View>
          <View style={styles.inputField}>
            <Text style={styles.inputLabel}>Daily Limit</Text>
            <View style={[styles.textInputContainer, stylesHooks.textInputContainer]}>
              <TextInput
                style={[styles.textInput, stylesHooks.textInput]}
                placeholderTextColor="#81868e"
                placeholder={card.daily_limit.toString()}
                inputAccessoryViewID={BlueDismissKeyboardInputAccessory.InputAccessoryViewID}
                {...dailyInputProps}
              />
              <Text style={styles.inputUnit}>{dailyUnit}</Text>
            </View>
          </View>
        </View>
        <View style={styles.buttonContiner}>
          <BlueButton title="Update" onPress={handleOnPressUpdate} isLoading={isUpdating} />
        </View>
        <BlueDismissKeyboardInputAccessory onPress={Keyboard.dismiss} />
      </View>
    );
  };

  return (
    <SafeAreaView style={stylesHooks.root}>
      <KeyboardAvoidingView
        behavior="position"
        style={styles.flex}
        contentContainerStyle={styles.flex}
        keyboardVerticalOffset={Platform.select({ ios: 20, android: -70 })}
      >
        <View>
          <BoltCardUI cardholder={card.card_name} txLimit={card.tx_limit} dailyLimit={card.daily_limit} isActive={card.enable} />
          <View style={styles.optionsContainer}>
            {isEditCard ? OptionButton('Txs', 'format-list-bulleted', toggleTx) : OptionButton('Edit', 'edit', toggleEditCard)}
            {card.enable ? OptionButton('Pause', 'pause', toggleCardActive) : OptionButton('Activate', 'play-arrow', toggleCardActive)}
            {OptionButton('Backup', 'save', navigateToBackup)}
            {OptionButton('Delete', 'delete', navigateToDelete)}
          </View>
        </View>
        <View style={[styles.detailsContainer, stylesHooks.detailsContainer]}>
          {isEditCard ? renderEditCard() : <BoltcardTransactionList transactions={hits} />}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  optionsContainer: {
    flexDirection: 'row',
    paddingVertical: 16,
    justifyContent: 'center',
  },
  optionButton: {
    alignSelf: 'flex-start',
    marginHorizontal: 17,
  },
  flex: {
    flex: 1,
  },
  detailsContainer: {
    flex: 1,
    alignContent: 'center',
    justifyContent: 'center',
  },
  buttonContiner: {
    paddingHorizontal: 24,
    marginVertical: 18,
  },
  editContainer: {
    flexGrow: 1,
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  inputField: {
    marginHorizontal: 20,
    marginBottom: 6,
  },
  textInputContainer: {
    flexDirection: 'row',
    borderWidth: 1.0,
    borderBottomWidth: 0.5,
    minHeight: 44,
    height: 44,
    alignItems: 'center',
    marginVertical: 8,
    borderRadius: 4,
  },
  textInput: {
    flex: 1,
    marginHorizontal: 8,
    minHeight: 33,
  },
  inputUnit: {
    color: '#81868e',
    fontSize: 16,
    marginRight: 10,
    marginLeft: 10,
  },
  inputLabel: {
    color: '#81868e',
  },
});

BoltcardDetails.navigationOptions = navigationStyle({}, options => ({
  ...options,
  title: loc.boltcard.title_details,
}));

export default BoltcardDetails;
