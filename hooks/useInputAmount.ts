import { useState, useEffect } from 'react';
import { TextInputProps } from 'react-native';
import { BitcoinUnit } from '../models/bitcoinUnits';
import BigNumber from 'bignumber.js';
import loc, { formatBalancePlain } from '../loc';
const currency = require('../blue_modules/currency');

const maxLengthByUnit = (unit: BitcoinUnit) => {
  switch (unit) {
    case BitcoinUnit.BTC:
      return 11;
    case BitcoinUnit.SATS:
      return 15;
    default:
      return 15;
  }
};

const inputPropsFixed: TextInputProps = {
  keyboardType: 'numeric',
  numberOfLines: 1
};

interface UseInputAmountResult {
  inputProps: TextInputProps;
  unit: BitcoinUnit;
  formattedUnit: string;
  amountSats: number;
  inputAmount: string;
  changeToNextUnit: () => void;
}

const useInputAmount = (initialUnit?: BitcoinUnit): UseInputAmountResult => {
  const [inputAmount, setInputAmount] = useState('');
  const [amountSats, setAmountSats] = useState(0);
  const [unit, setUnit] = useState(initialUnit || BitcoinUnit.SATS);

  useEffect(() => {
    currency.mostRecentFetchedRate();
  }, [inputAmount]);

  const recalculateAmountSats = (textAmount: string) => {
    let sats;
    switch (unit) {
      case BitcoinUnit.BTC:
        sats = new BigNumber(textAmount).multipliedBy(100000000).toString();
        break;
      case BitcoinUnit.SATS:
        sats = textAmount;
        break;
      case BitcoinUnit.LOCAL_CURRENCY:
        sats = new BigNumber(currency.fiatToBTC(textAmount)).multipliedBy(100000000).toString();
        break;
    }
    const satsNumber = parseFloat(sats as string);
    setAmountSats(satsNumber);
  };

  const onChangeText = (text: string) => {
    text = text.trim();
    if (unit !== BitcoinUnit.LOCAL_CURRENCY) {
      text = text.replace(',', '.');
      const split = text.split('.');
      if (split.length >= 2) {
        text = `${parseInt(split[0], 10)}.${split[1]}`;
      } else {
        text = `${parseInt(split[0], 10)}`;
      }
      text = unit === BitcoinUnit.BTC ? text.replace(/[^0-9.]/g, '') : text.replace(/[^0-9]/g, '');
      if (text.startsWith('.')) {
        text = '0.';
      }
    } else if (unit === BitcoinUnit.LOCAL_CURRENCY) {
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
    recalculateAmountSats(text);
    setInputAmount(text);
  };

  const changeToNextUnit = () => {
    let newUnit;
    switch (unit) {
      case BitcoinUnit.BTC:
        newUnit = BitcoinUnit.SATS;
        break;
      case BitcoinUnit.SATS:
        newUnit = BitcoinUnit.LOCAL_CURRENCY;
        break;
      case BitcoinUnit.LOCAL_CURRENCY:
        newUnit = BitcoinUnit.BTC;
        break;
      default:
        newUnit = BitcoinUnit.BTC;
        break;
    }
    setUnit(newUnit);
    const newInputValue = formatBalancePlain(amountSats, newUnit, false);
    setInputAmount(newInputValue);
  };

  const formattedUnit = unit === BitcoinUnit.LOCAL_CURRENCY ? currency.getCurrencySymbol() :  loc.units[unit];

  const inputProps: TextInputProps = {
    ...inputPropsFixed,
    maxLength: maxLengthByUnit(unit),
    value: parseFloat(inputAmount) >= 0 ? String(inputAmount) : undefined,
    onChangeText,
  };

  return { unit, formattedUnit, amountSats, inputAmount, inputProps, changeToNextUnit };
};

export default useInputAmount;
