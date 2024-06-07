import React, { Component } from 'react';
import PropTypes from 'prop-types';
import BigNumber from 'bignumber.js';
import { Badge, Icon, Text } from 'react-native-elements';
import { Image, LayoutAnimation, StyleSheet, TextInput, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { useTheme } from '@react-navigation/native';
import confirm from '../helpers/confirm';
import { BitcoinUnit } from '../models/bitcoinUnits';
import loc, { formatBalanceWithoutSuffix, formatBalancePlain, removeTrailingZeros } from '../loc';
import { BlueText } from '../BlueComponents';
import dayjs from 'dayjs';
const currency = require('../blue_modules/currency');
dayjs.extend(require('dayjs/plugin/localizedFormat'));

class AmountInput extends Component {
  static propTypes = {
    isLoading: PropTypes.bool,
    /**
     * amount is a sting thats always in current unit denomination, e.g. '0.001' or '9.43' or '10000'
     */
    amount: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    /**
     * callback that returns currently typed amount, in current denomination, e.g. 0.001 or 10000 or $9.34
     * (btc, sat, fiat)
     */
    onChangeText: PropTypes.func.isRequired,
    /**
     * callback thats fired to notify of currently selected denomination, returns <BitcoinUnit.*>
     */
    onAmountUnitChange: PropTypes.func.isRequired,
    disabled: PropTypes.bool,
    colors: PropTypes.object.isRequired,
    pointerEvents: PropTypes.string,
    unit: PropTypes.string,
    onBlur: PropTypes.func,
    onFocus: PropTypes.func,
    inputStyle: PropTypes.object,
    unitStyle: PropTypes.object,
    showMaxButton: PropTypes.bool,
    onPressMax: PropTypes.func,
  };

  /**
   * cache of conversions  fiat amount => satoshi
   * @type {{}}
   */
  static conversionCache = {};

  static getCachedSatoshis = amount => {
    return AmountInput.conversionCache[amount + BitcoinUnit.LOCAL_CURRENCY] || false;
  };

  static setCachedSatoshis = (amount, sats) => {
    AmountInput.conversionCache[amount + BitcoinUnit.LOCAL_CURRENCY] = sats;
  };

  constructor() {
    super();
    this.state = { mostRecentFetchedRate: Date(), isRateOutdated: false, isRateBeingUpdated: false };
  }

  componentDidMount() {
    currency
      .mostRecentFetchedRate()
      .then(mostRecentFetchedRate => {
        this.setState({ mostRecentFetchedRate });
      })
      .finally(() => {
        currency.isRateOutdated().then(isRateOutdated => this.setState({ isRateOutdated }));
      });
  }

  /**
   * here we must recalculate old amont value (which was denominated in `previousUnit`) to new denomination `newUnit`
   * and fill this value in input box, so user can switch between, for example, 0.001 BTC <=> 100000 sats
   *
   * @param previousUnit {string} one of {BitcoinUnit.*}
   * @param newUnit {string} one of {BitcoinUnit.*}
   */
  onAmountUnitChange(previousUnit, newUnit) {
    const amount = this.props.amount || 0;
    const log = `${amount}(${previousUnit}) ->`;
    let sats = 0;
    switch (previousUnit) {
      case BitcoinUnit.BTC:
        sats = new BigNumber(amount).multipliedBy(100000000).toString();
        break;
      case BitcoinUnit.SATS:
        sats = amount;
        break;
      case BitcoinUnit.LOCAL_CURRENCY:
        sats = new BigNumber(currency.fiatToBTC(amount)).multipliedBy(100000000).toString();
        break;
    }
    if (previousUnit === BitcoinUnit.LOCAL_CURRENCY && AmountInput.conversionCache[amount + previousUnit]) {
      // cache hit! we reuse old value that supposedly doesnt have rounding errors
      sats = AmountInput.conversionCache[amount + previousUnit];
    }

    const newInputValue = formatBalancePlain(sats, newUnit, false);
    console.log(`${log} ${sats}(sats) -> ${newInputValue}(${newUnit})`);

    if (newUnit === BitcoinUnit.LOCAL_CURRENCY && previousUnit === BitcoinUnit.SATS) {
      // we cache conversion, so when we will need reverse conversion there wont be a rounding error
      AmountInput.conversionCache[newInputValue + newUnit] = amount;
    }
    this.props.onChangeText(newInputValue, newUnit);
    this.props.onAmountUnitChange(newUnit);
  }

  /**
   * responsible for cycling currently selected denomination, BTC->SAT->LOCAL_CURRENCY->BTC
   */
  changeAmountUnit = () => {
    let previousUnit = this.props.unit;
    let newUnit;
    if (previousUnit === BitcoinUnit.BTC) {
      newUnit = BitcoinUnit.SATS;
    } else if (previousUnit === BitcoinUnit.SATS) {
      newUnit = BitcoinUnit.LOCAL_CURRENCY;
    } else if (previousUnit === BitcoinUnit.LOCAL_CURRENCY) {
      newUnit = BitcoinUnit.BTC;
    } else {
      newUnit = BitcoinUnit.BTC;
      previousUnit = BitcoinUnit.SATS;
    }
    this.onAmountUnitChange(previousUnit, newUnit);
  };

  maxLength = () => {
    switch (this.props.unit) {
      case BitcoinUnit.BTC:
        return 11;
      case BitcoinUnit.SATS:
        return 15;
      default:
        return 15;
    }
  };

  textInput = React.createRef();

  handleTextInputOnPress = () => {
    this.textInput.current.focus();
  };

  handleChangeText = text => {
    text = text.trim();
    if (this.props.unit !== BitcoinUnit.LOCAL_CURRENCY) {
      text = text.replace(',', '.');
      const split = text.split('.');
      if (split.length >= 2) {
        text = `${parseInt(split[0], 10)}.${split[1]}`;
      } else {
        text = `${parseInt(split[0], 10)}`;
      }

      text = this.props.unit === BitcoinUnit.BTC ? text.replace(/[^0-9.]/g, '') : text.replace(/[^0-9]/g, '');

      if (text.startsWith('.')) {
        text = '0.';
      }
    } else if (this.props.unit === BitcoinUnit.LOCAL_CURRENCY) {
      text = text.replace(/,/gi, '.');
      if (text.split('.').length > 2) {
        // too many dots. stupid code to remove all but first dot:
        let rez = '';
        let first = true;
        for (const part of text.split('.')) {
          rez += part;
          if (first) {
            rez += '.';
            first = false;
          }
        }
        text = rez;
      }
      if (text.startsWith('0') && !(text.includes('.') || text.includes(','))) {
        text = text.replace(/^(0+)/g, '');
      }
      text = text.replace(/[^\d.,-]/g, ''); // remove all but numbers, dots & commas
      text = text.replace(/(\..*)\./g, '$1');
    }
    this.props.onChangeText(text);
  };

  resetAmount = async () => {
    if (await confirm(loc.send.reset_amount, loc.send.reset_amount_confirm)) {
      this.props.onChangeText();
    }
  };

  updateRate = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    this.setState({ isRateBeingUpdated: true }, async () => {
      try {
        await currency.updateExchangeRate();
        currency.mostRecentFetchedRate().then(mostRecentFetchedRate => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          this.setState({ mostRecentFetchedRate });
        });
      } finally {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        this.setState({ isRateBeingUpdated: false, isRateOutdated: await currency.isRateOutdated() });
      }
    });
  };

  renderSecondaryDisplay = (secondaryAmount, unit) => (
    <View style={styles.secondaryRoot}>
      <Text style={styles.secondaryText}>
        {unit === BitcoinUnit.LOCAL_CURRENCY ? removeTrailingZeros(secondaryAmount) : secondaryAmount}
        {unit === BitcoinUnit.LOCAL_CURRENCY ? ` ${loc.units[BitcoinUnit.BTC]}` : null}
      </Text>
    </View>
  );

  render() {
    const { colors, disabled, unit, inputStyle, unitStyle, onPressMax, showMaxButton } = this.props;
    const amount = this.props.amount || 0;
    let secondaryDisplayCurrency = formatBalanceWithoutSuffix(amount, BitcoinUnit.LOCAL_CURRENCY, false);
    const isMaxAvailable = showMaxButton && typeof onPressMax === 'function' && !disabled;

    // if main display is sat or btc - secondary display is fiat
    // if main display is fiat - secondary dislay is btc
    let sat;
    switch (unit) {
      case BitcoinUnit.BTC:
        sat = new BigNumber(amount).multipliedBy(100000000).toString();
        secondaryDisplayCurrency = formatBalanceWithoutSuffix(sat, BitcoinUnit.LOCAL_CURRENCY, false);
        break;
      case BitcoinUnit.SATS:
        secondaryDisplayCurrency = formatBalanceWithoutSuffix((isNaN(amount) ? 0 : amount).toString(), BitcoinUnit.LOCAL_CURRENCY, false);
        break;
      case BitcoinUnit.LOCAL_CURRENCY:
        secondaryDisplayCurrency = currency.fiatToBTC(parseFloat(isNaN(amount) ? 0 : amount));
        if (AmountInput.conversionCache[isNaN(amount) ? 0 : amount + BitcoinUnit.LOCAL_CURRENCY]) {
          // cache hit! we reuse old value that supposedly doesn't have rounding errors
          const sats = AmountInput.conversionCache[isNaN(amount) ? 0 : amount + BitcoinUnit.LOCAL_CURRENCY];
          secondaryDisplayCurrency = currency.satoshiToBTC(sats);
        }
        break;
    }

    const stylesHook = StyleSheet.create({
      center: { padding: 15 },
      localCurrency: { color: colors.alternativeTextColor2 },
      input: { color: disabled ? colors.buttonDisabledTextColor : colors.alternativeTextColor2, minWidth: disabled ? 0 : 130, fontSize: 32 },
      cryptoCurrency: { color: disabled ? colors.buttonDisabledTextColor : colors.alternativeTextColor2 },
    });

    return (
      <TouchableWithoutFeedback
        accessibilityRole="button"
        accessibilityLabel={loc._.enter_amount}
        disabled={this.props.pointerEvents === 'none'}
        onPress={() => this.textInput.focus()}
      >
        <>
          <View style={styles.root}>
            <View style={styles.flex}>
              <View style={styles.container}>
                {!disabled && (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={loc._.change_input_currency}
                    testID="changeAmountUnitButton"
                    style={styles.changeAmountUnit}
                    onPress={this.changeAmountUnit}
                  >
                    <Image source={require('../img/round-compare-arrows-24-px.png')} />
                  </TouchableOpacity>
                )}
                <View>
                  <TextInput
                    {...this.props}
                    testID="BitcoinAmountInput"
                    keyboardType="numeric"
                    adjustsFontSizeToFit
                    onChangeText={this.handleChangeText}
                    onBlur={() => {
                      if (this.props.onBlur) this.props.onBlur();
                    }}
                    onFocus={() => {
                      if (this.props.onFocus) this.props.onFocus();
                    }}
                    placeholder="0"
                    textAlign="center"
                    maxLength={this.maxLength()}
                    ref={textInput => (this.textInput = textInput)}
                    editable={!this.props.isLoading && !disabled}
                    value={parseFloat(amount) >= 0 ? String(amount) : undefined}
                    placeholderTextColor={disabled ? colors.buttonDisabledTextColor : colors.alternativeTextColor2}
                    style={[styles.input, stylesHook.input, inputStyle]}
                  />
                  {!disabled && this.renderSecondaryDisplay(secondaryDisplayCurrency, unit)}
                </View>
                {unit === BitcoinUnit.LOCAL_CURRENCY && (
                  <Text style={[styles.localCurrency, stylesHook.localCurrency]}>{currency.getCurrencySymbol() + ' '}</Text>
                )}
                {unit !== BitcoinUnit.LOCAL_CURRENCY && (
                  <Text style={[styles.cryptoCurrency, stylesHook.cryptoCurrency, unitStyle]}>{' ' + loc.units[unit]}</Text>
                )}
                {isMaxAvailable && (
                  <TouchableOpacity
                    style={[styles.maxButton, { borderColor: this.props.colors.mainColor }]}
                    onPress={onPressMax}
                  >
                    <Text style={{ color: this.props.colors.mainColor }}>
                      MAX
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              {disabled && this.renderSecondaryDisplay(secondaryDisplayCurrency, unit)}
            </View>
          </View>
          {this.state.isRateOutdated && (
            <View style={styles.outdatedRateContainer}>
              <Badge status="warning" />
              <View style={styles.spacing8} />
              <BlueText>
                {loc.formatString(loc.send.outdated_rate, { date: dayjs(this.state.mostRecentFetchedRate.LastUpdated).format('l LT') })}
              </BlueText>
              <View style={styles.spacing8} />
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={loc._.refresh}
                onPress={this.updateRate}
                disabled={this.state.isRateBeingUpdated}
                style={this.state.isRateBeingUpdated ? styles.disabledButton : styles.enabledButon}
              >
                <Icon name="sync" type="font-awesome-5" size={16} color={colors.buttonAlternativeTextColor} />
              </TouchableOpacity>
            </View>
          )}
        </>
      </TouchableWithoutFeedback>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 14,
  },
  center: {
    alignSelf: 'center',
  },
  flex: {
    flex: 1,
  },
  spacing8: {
    width: 8,
  },
  disabledButton: {
    opacity: 0.5,
  },
  enabledButon: {
    opacity: 1,
  },
  outdatedRateContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 8,
  },
  container: {
    flexDirection: 'row',
    alignContent: 'space-between',
    justifyContent: 'center',
    paddingTop: 16,
    paddingBottom: 2,
  },
  localCurrency: {
    fontSize: 22,
    marginTop: 8,
    marginHorizontal: 4,
    fontWeight: 'bold',
    alignSelf: 'flex-start',
    justifyContent: 'center',
    minWidth: 20,
  },
  input: {
    fontWeight: 'bold',
    paddingBottom: 10, 
    paddingTop:0, 
    marginTop: 0
  },
  cryptoCurrency: {
    fontSize: 20,
    marginTop: 8,
    marginHorizontal: 4,
    fontWeight: '600',
    alignSelf: 'flex-start',
    justifyContent: 'center',
    fontWeight: 'bold',
    minWidth: 20,
  },
  secondaryRoot: {
    alignItems: 'center',
    marginBottom: 22,
  },
  secondaryText: {
    fontSize: 16,
    color: '#B8C4D8',
    fontWeight: '600',
  },
  changeAmountUnit: {
    alignSelf: 'flex-start',
    marginTop: 12,
    marginRight: 16,
    paddingLeft: 16,
  },
  maxButton:{
    alignSelf: 'flex-start',
    justifyContent: 'center',
    padding: 4,
    marginTop: 8,
    marginLeft: 4,
    borderRadius: 4,
    borderWidth: 0.5,
  }
});

const AmountInputWithStyle = props => {
  const { colors } = useTheme();

  return <AmountInput {...props} colors={colors} />;
};

// expose static methods
AmountInputWithStyle.conversionCache = AmountInput.conversionCache;
AmountInputWithStyle.getCachedSatoshis = AmountInput.getCachedSatoshis;
AmountInputWithStyle.setCachedSatoshis = AmountInput.setCachedSatoshis;

export default AmountInputWithStyle;
