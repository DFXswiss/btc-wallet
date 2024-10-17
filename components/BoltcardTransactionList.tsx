import React from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-elements';
import loc, { transactionTimeToReadable } from '../loc';
import { useTheme } from '@react-navigation/native';
import { BlueListItem } from '../BlueComponents';
import TransactionOffchainIcon from './icons/TransactionOffchainIcon';
import { Hit } from '../api/boltcards/definitions/apiDtos';

const BoltcardTransactionList: React.FC<{transactions: Hit[]}> = ({ transactions = [] }) => {
  const { colors } = useTheme();

  const stylesHook = StyleSheet.create({
    listHeaderText: {
      color: colors.foregroundColor,
    },
    list: {
      backgroundColor: colors.background,
    },
    dfxContainer: {
      backgroundColor: '#0A345A',
      alignItems: 'center',
      height: 110,
    },
    dfxButtonContainer: {
      flexGrow: 1,
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      marginVertical: 10,
      gap: 10,
    },
  });

  const renderListHeaderComponent = () => {
    return (
      <View style={styles.flex}>
        <View style={styles.listHeaderTextRow}>
          <Text style={[styles.listHeaderText, stylesHook.listHeaderText]}>{loc.transactions.list_title}</Text>
        </View>
      </View>
    );
  };

  const renderListEmptyComponent = () => {
    return (
      <ScrollView style={styles.flex} contentContainerStyle={styles.scrollViewContent}>
        <Text numberOfLines={0} style={styles.emptyTxs}>
          {loc.wallets.list_empty_txs1_lightning}
        </Text>
      </ScrollView>
    );
  };

  const renderItem = ({ item }: { item: any }) => {
    return (
      <BlueListItem
        leftAvatar={<TransactionOffchainIcon />}
        title={transactionTimeToReadable(item.time * 1000)}
        Component={View}
        rightTitle={String(item.amount)}
        rightTitleStyle={{ color: colors.foregroundColor }}
      />
    );
  };

  return (
    <View style={[styles.list, stylesHook.list]}>
      <FlatList
        data={transactions}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        ListHeaderComponent={renderListHeaderComponent}
        ListEmptyComponent={renderListEmptyComponent}
      />
    </View>
  );
};

export default BoltcardTransactionList;

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scrollViewContent: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  listHeaderTextRow: {
    flex: 1,
    marginTop: 12,
    marginHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  listHeaderText: {
    marginTop: 8,
    marginBottom: 8,
    fontWeight: 'bold',
    fontSize: 24,
  },
  list: {
    flex: 1,
  },
  emptyTxs: {
    fontSize: 18,
    color: '#9aa0aa',
    textAlign: 'center',
    marginVertical: 16,
  },
});
