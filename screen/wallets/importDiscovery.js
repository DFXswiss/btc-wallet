import React, { useContext, useEffect, useState, useRef, useMemo } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, View } from 'react-native';
import { StackActions, useNavigation, useRoute, useTheme } from '@react-navigation/native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { BlueButton, BlueButtonLink, BlueFormLabel, BlueSpacing10, BlueSpacing20, SafeBlueArea } from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import WalletToImport from '../../components/WalletToImport';
import loc from '../../loc';
import { HDSegwitBech32Wallet, MultisigHDWallet, WatchOnlyWallet } from '../../class';
import startImport from '../../class/wallet-import';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import prompt from '../../helpers/prompt';
import { walletCreatedRoute } from '../../helpers/wallet-created-route';

const ImportWalletDiscovery = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const route = useRoute();
  const { importText, askPassphrase, searchAccounts } = route.params;
  const task = useRef();
  const { addAndSaveWallet } = useContext(BlueStorageContext);
  const [loading, setLoading] = useState(true);
  const [wallets, setWallets] = useState([]);
  const [password, setPassword] = useState();
  const [selected, setSelected] = useState(0);
  const [progress, setProgress] = useState();
  const importing = useRef(false);
  const bip39 = useMemo(() => {
    const hd = new HDSegwitBech32Wallet();
    hd.setSecret(importText);
    return hd.validateMnemonic();
  }, [importText]);

  const stylesHook = StyleSheet.create({
    root: {
      backgroundColor: colors.elevated,
    },
    center: {
      backgroundColor: colors.elevated,
    },
  });

  const saveWallet = async (mainWallet, multisigWallet) => {
    if (importing.current) return;
    importing.current = true;

    await addAndSaveWallet(mainWallet);

    if (multisigWallet) {
      await addAndSaveWallet(multisigWallet);
    }

    navigation.dispatch(StackActions.replace(...walletCreatedRoute()));
  };

  const tryMultisigBackup = backupText => {
    const ms = new MultisigHDWallet();
    ms.setSecret(backupText);
    if (ms.getN() > 0 && ms.getM() > 0) {
      return ms;
    }
    return null;
  };

  useEffect(() => {
    const onProgress = data => setProgress(data);

    const onWallet = wallet => {
      if (wallet.type === WatchOnlyWallet.type) return;

      const id = wallet.getID();
      let subtitle;
      try {
        subtitle = wallet.getDerivationPath?.();
      } catch (e) {}
      setWallets(w => [...w, { wallet, subtitle, id }]);
    };

    const onPassword = async (title, subtitle) => {
      try {
        const pass = await prompt(title, subtitle);
        setPassword(pass);
        return pass;
      } catch (e) {
        if (e.message === 'Cancel Pressed') {
          navigation.goBack();
        }
        throw e;
      }
    };

    const multisig = tryMultisigBackup(importText);
    const [firstPrivateKey] = multisig?.getCosigners().filter(c => typeof c === 'string' && !MultisigHDWallet.isXpubString(c)) || [];
    const possibleSecret = firstPrivateKey || importText;

    task.current = startImport(possibleSecret, askPassphrase, searchAccounts, onProgress, onWallet, onPassword);

    task.current.promise
      .then(({ cancelled, wallets }) => {
        const w = wallets.filter(w => w.type !== WatchOnlyWallet.type);

        if (cancelled) return;
        if (w.length === 1) {
          saveWallet(w[0], multisig);
          if (multisig) onWallet(multisig);
        }
        if (w.length === 0) {
          ReactNativeHapticFeedback.trigger('impactLight', { ignoreAndroidSystemSettings: false });
        }
      })
      .catch(e => {
        console.warn('import error', e);
        Alert.alert('import error', e.message);
      })
      .finally(() => {
        setLoading(false);
      });

    return () => task.current.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCustomDerivation = () => {
    task.current.stop();
    navigation.navigate('ImportCustomDerivationPath', { importText, password });
  };

  const renderItem = ({ item, index }) => (
    <WalletToImport
      key={item.id}
      title={item.wallet.typeReadable}
      subtitle={item.subtitle}
      active={selected === index}
      onPress={() => {
        setSelected(index);
        ReactNativeHapticFeedback.trigger('selection', { ignoreAndroidSystemSettings: false });
      }}
    />
  );

  const keyExtractor = w => w.id;

  return (
    <SafeBlueArea style={[styles.root, stylesHook.root]}>
      <BlueSpacing20 />
      <BlueFormLabel>{loc.wallets.import_discovery_subtitle}</BlueFormLabel>
      <BlueSpacing20 />

      {!loading && wallets.length === 0 ? (
        <View style={styles.noWallets}>
          <BlueFormLabel>{loc.wallets.import_discovery_no_wallets}</BlueFormLabel>
        </View>
      ) : (
        <FlatList contentContainerStyle={styles.flatListContainer} data={wallets} keyExtractor={keyExtractor} renderItem={renderItem} />
      )}

      <View style={[styles.center, stylesHook.center]}>
        {loading && (
          <>
            <BlueSpacing10 />
            <ActivityIndicator testID="Loading" />
            <BlueSpacing10 />
            <BlueFormLabel>{progress}</BlueFormLabel>
            <BlueSpacing10 />
          </>
        )}
        {bip39 && (
          <BlueButtonLink
            title={loc.wallets.import_discovery_derivation}
            testID="CustomDerivationPathButton"
            onPress={handleCustomDerivation}
          />
        )}
        <BlueSpacing10 />
        <View style={styles.buttonContainer}>
          <BlueButton
            disabled={wallets.length === 0}
            title={loc.wallets.import_do_import}
            onPress={() => saveWallet(wallets[selected].wallet)}
          />
        </View>
      </View>
    </SafeBlueArea>
  );
};

const styles = StyleSheet.create({
  root: {
    paddingTop: 40,
  },
  flatListContainer: {
    marginHorizontal: 16,
  },
  center: {
    marginHorizontal: 16,
    alignItems: 'center',
  },
  buttonContainer: {
    height: 45,
    marginBottom: 16,
  },
  noWallets: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

ImportWalletDiscovery.navigationOptions = navigationStyle({}, opts => ({ ...opts, title: loc.wallets.import_discovery_title }));

export default ImportWalletDiscovery;
