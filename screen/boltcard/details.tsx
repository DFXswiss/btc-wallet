import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { Icon, Text } from 'react-native-elements';
import navigationStyle from '../../components/navigationStyle';
import { BlueButton, BlueDismissKeyboardInputAccessory } from '../../BlueComponents';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import { LightningLdsWallet } from '../../class/wallets/lightning-lds-wallet';
import useLdsBoltcards from '../../api/boltcards/hooks/bolcards.hook';
import { AbstractWallet } from '../../class';
import { useNavigation, useRoute, useTheme } from '@react-navigation/native';
import loc from '../../loc';
import BoltcardTransactionList from '../../components/BoltcardTransactionList';
import BoltCard from '../../class/boltcard';
import { Hit } from '../../api/boltcards/definitions/apiDtos';
import useInputAmount from '../../hooks/useInputAmount';
import alert from '../../components/Alert';
import BoltCardsCarousel from './BoltCardsCarousel';

const BoltcardDetails: React.FC = () => {
  const { colors } = useTheme();
  const { wallets, saveToDisk } = useContext(BlueStorageContext);
  const ldsWallet = wallets.find((w: AbstractWallet) => w.type === LightningLdsWallet.type) as LightningLdsWallet;
  const params = useRoute().params as { boltcardUid?: string };
  const defaultCard = useMemo(
    () =>
      params?.boltcardUid ? ldsWallet.getBoltcards().find((c: BoltCard) => c.uid === params.boltcardUid) : ldsWallet.getBoltcards()[0],
    [params],
  ) as BoltCard;
  const [card, setCard] = useState(defaultCard);
  const { navigate } = useNavigation();
  const [isEditCard, setIsEditCard] = useState(false);
  const [hits, setHits] = useState<Hit[]>(ldsWallet.cachedHits || []);
  const { getHits, enableBoltcard, updateBoltcard } = useLdsBoltcards();
  const [isPolling, setIsPolling] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const pollInterval = useRef<NodeJS.Timeout>();
  const [cardName, setCardName] = useState('');
  const { amountSats: dailySats, formattedUnit: dailyUnit, inputProps: dailyInputProps, resetInput: resetDaily } = useInputAmount();
  const { amountSats: txLimitSats, formattedUnit: txLimitUnit, inputProps: txLimitInputProps, resetInput: resetTxLimit } = useInputAmount();

  const initPolling = useCallback(async () => {
    try {
      pollInterval.current = setInterval(async () => {
        if (isPolling) return;
        setIsPolling(true);
        const latestHits = await getHits(ldsWallet.getInvoiceId());
        ldsWallet.cachedHits = latestHits;
        setHits(latestHits);
        setIsPolling(false);
      }, 5000);
    } catch (_) {
      console.log(_);
    }
  }, [card]);

  const stopPolling = () => {
    if (pollInterval.current) {
      clearInterval(pollInterval.current);
    }
  };

  useEffect(() => {
    (async () => initPolling())();
    return () => stopPolling();
  }, []);

  // For handling going back to this screen from creation or deletion
  useEffect(() => {
    if (params?.boltcardUid) {
      const newCard = ldsWallet.getBoltcards().find((c: BoltCard) => c.uid === params.boltcardUid);
      if (newCard) {
        setCard(newCard);
      }
    }
  }, [params]);

  const stylesHooks = StyleSheet.create({
    root: {
      backgroundColor: colors.elevated,
      flex: 1,
      paddingTop: 15,
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
  };

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
  };
  const navigateToDelete = () => navigate('DeleteBoltcard', { boltcardUid: card.uid });
  const toggleCardActive = async () => {
    const newState = !card.enable;
    const { enable } = await enableBoltcard(ldsWallet.getAdminKey(), card, newState);
    card.enable = enable;
    setCard(card);
    await saveToDisk();
  };

  const addNewCard = () => navigate('AddBoltcard');

  const OptionButton = (title: string, icon: string, onPress: () => void) => {
    return (
      <TouchableOpacity onPress={onPress} style={styles.optionButton}>
        <Icon name={icon} size={24} color={colors.foregroundColor} />
        <Text style={[stylesHooks.optionText]}>{title}</Text>
      </TouchableOpacity>
    );
  };

  const cardTxs = useMemo(() => hits.filter(hit => hit.card_id === card.id), [hits, card]);

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
    <View style={stylesHooks.root}>
      <KeyboardAvoidingView
        behavior="position"
        style={styles.flex}
        contentContainerStyle={styles.flex}
        keyboardVerticalOffset={Platform.select({ ios: 20, android: -70 })}
      >
        <View style={styles.carouselContainer}>
          <BoltCardsCarousel cards={ldsWallet.getBoltcards()} selectedCard={card} onCardChange={newSelected => setCard(newSelected)} />
        </View>
        <View>
          <View style={styles.optionsContainer}>
            {OptionButton('Add', 'add', addNewCard)}
            {isEditCard ? OptionButton('Txs', 'format-list-bulleted', toggleTx) : OptionButton('Edit', 'edit', toggleEditCard)}
            {card.enable ? OptionButton('Pause', 'pause', toggleCardActive) : OptionButton('Activate', 'play-arrow', toggleCardActive)}
            {OptionButton('Delete', 'delete', navigateToDelete)}
          </View>
        </View>
        <View style={[styles.detailsContainer, stylesHooks.detailsContainer]}>
          {isEditCard ? renderEditCard() : <BoltcardTransactionList transactions={cardTxs} />}
        </View>
      </KeyboardAvoidingView>
    </View>
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
    fontSize: 16,
    marginRight: 10,
    marginLeft: 10,
  },
  inputLabel: {
    color: '#81868e',
  },
  walletDetails: {
    paddingLeft: 12,
    paddingVertical: 12,
  },
  carouselContainer: {
    flexDirection: 'row',
  },
});

BoltcardDetails.navigationOptions = navigationStyle({}, (options, { navigation, route }) => ({
  ...options,
  title: loc.boltcard.title_details,
  headerRight: () => (
    <TouchableOpacity
      accessibilityRole="button"
      style={styles.walletDetails}
      onPress={() =>
        navigation.navigate('Settings', {
          walletID: route?.params?.walletID,
        })
      }
    >
      <Icon name="more-horiz" type="material" size={22} color="#FFFFFF" />
    </TouchableOpacity>
  ),
}));
export default BoltcardDetails;
