import React, { useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, TouchableOpacity, View, Dimensions, ListRenderItemInfo } from 'react-native';
import BoltCardUI from '../../components/BoltCardUI';
import BoltCard from '../../class/boltcard';

const screenWidth = Dimensions.get('window').width
const cardWidth = Dimensions.get('window').width -20;

interface BoltCardsCarouselProps {
  cards: BoltCard[];
  selectedCard: BoltCard;
  onCardChange: (card: BoltCard) => void;
}

const BoltCardsCarousel: React.FC<BoltCardsCarouselProps> = ({ cards, selectedCard, onCardChange }) => {
  const [cardIndex, setCardIndex] = useState(cards.findIndex(c => c.uid === selectedCard.uid));
  const flatListRef = useRef<FlatList<BoltCard>>(null);

  useEffect(() => {
    const selected = cards.findIndex(c => c.uid === selectedCard.uid);
    if (flatListRef.current && cardIndex !== selected) {
      flatListRef.current.scrollToIndex({ index: selected, animated: true});
    }
  }, [selectedCard]);

  const renderItem = ({ item }: ListRenderItemInfo<BoltCard>) => {
    return (
      <View style={styles.boltCardUIContainer}>
        <View style={styles.boltcardContent}>
          <BoltCardUI
            uid={item.uid}
            cardholder={item.card_name}
            txLimit={item.tx_limit}
            dailyLimit={item.daily_limit}
            isActive={item.enable}
          />
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={cards}
        renderItem={renderItem}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={item => item.uid}
        onScroll={event => {
          const index = Math.round(event.nativeEvent.contentOffset.x / screenWidth);
          setCardIndex(index);
          onCardChange(cards[index]);
        }}
        getItemLayout={(_, index) => ({ length: screenWidth, offset: screenWidth * index, index })}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  boltCardUIContainer: {
    width: screenWidth,
    alignItems: 'center',
  },
  boltcardContent: {
    width: cardWidth,
    paddingHorizontal: 5,
  }
});

export default BoltCardsCarousel;
