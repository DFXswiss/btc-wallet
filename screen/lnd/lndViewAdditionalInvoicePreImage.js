import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRoute } from '@react-navigation/native';

import { BlueText, BlueCopyToClipboardButton, BlueCard } from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import loc from '../../loc';
import QRCodeComponent from '../../components/QRCodeComponent';
import { ScrollView } from 'react-native-gesture-handler';

const LNDViewAdditionalInvoicePreImage = () => {
  const { invoice, preImageData } = useRoute().params;
  const { received, payment_hash: paymentHash, value, fee, memo, description } = invoice;
  const feeString = fee === 0 ? '0 sats' : `${fee} sats`;
  const [domain, setDomain] = useState();
  const [lnurl, setLnurl] = useState();

  const loadPossibleLNURL = async () => {
    try {
      const LN = new Lnurl(false, AsyncStorage);
      let localPaymentHash = paymentHash;
      if (typeof localPaymentHash === 'object') {
        localPaymentHash = Buffer.from(paymentHash.data).toString('hex');
      }
      const loaded = await LN.loadSuccessfulPayment(localPaymentHash);
      if (loaded) {
        setLnurl(LN.getLnurl());
        setDomain(LN.getDomain());
      }
    } catch (_) {}
  };

  useEffect(() => {
    loadPossibleLNURL();
  }, [paymentHash]);

  const hasValidPreimage = () => {
    const { payment_preimage } = invoice;
    return payment_preimage && typeof payment_preimage === 'string' && payment_preimage.split('').some(char => char !== '0');
  };

  return (
    <ScrollView style={styles.scroll} automaticallyAdjustContentInsets contentInsetAdjustmentBehavior="automatic">
      <BlueCard>
        {paymentHash && (
          <>
            <View style={styles.rowHeader}>
              <BlueText style={[styles.sectionTitle]}>{loc.lndViewInvoice.payment_hash}</BlueText>
              <BlueCopyToClipboardButton stringToCopy={paymentHash} />
            </View>
            <BlueText style={styles.rowValue}>{paymentHash}</BlueText>
            <View style={styles.marginBottom18} />
          </>
        )}
        {lnurl && (
          <>
            <View style={styles.rowHeader}>
              <BlueText style={[styles.sectionTitle]}>LNURL</BlueText>
              <BlueCopyToClipboardButton stringToCopy={lnurl} />
            </View>
            <BlueText style={styles.rowValue}>{lnurl}</BlueText>
            <View style={styles.marginBottom18} />
          </>
        )}
        {hasValidPreimage() && (
          <>
            <View style={styles.rowHeader}>
              <BlueText style={[styles.sectionTitle]}>{loc.lndViewInvoice.preimage}</BlueText>
              <BlueCopyToClipboardButton stringToCopy={preImageData} />
            </View>
            <BlueText style={styles.rowValue}>{preImageData}</BlueText>
            <View style={styles.qrCodeContainer}>
              <QRCodeComponent value={preImageData} size={200} logoSize={50} />
            </View>

            <View style={styles.marginBottom18} />
          </>
        )}
        {domain && (
          <>
            <View style={styles.rowHeader}>
              <BlueText style={[styles.sectionTitle]}>{loc.lndViewInvoice.domain}</BlueText>
            </View>
            <BlueText style={styles.rowValue}>{domain}</BlueText>
            <View style={styles.marginBottom18} />
          </>
        )}
        {memo && (
          <>
            <View style={styles.rowHeader}>
              <BlueText style={[styles.sectionTitle]}>{loc.lndViewInvoice.memo}</BlueText>
            </View>
            <BlueText style={styles.rowValue}>{memo}</BlueText>
            <View style={styles.marginBottom18} />
          </>
        )}
        {description && (
          <>
            <View style={styles.rowHeader}>
              <BlueText style={[styles.sectionTitle]}>{loc.lndViewInvoice.description}</BlueText>
            </View>
            <BlueText style={styles.rowValue}>{description}</BlueText>
            <View style={styles.marginBottom18} />
          </>
        )}
        {value && (
          <>
            <View style={styles.rowHeader}>
              <BlueText style={[styles.sectionTitle]}>{loc.lndViewInvoice.value}</BlueText>
            </View>
            <BlueText style={styles.rowValue}>{`${value} sats`}</BlueText>
            <View style={styles.marginBottom18} />
          </>
        )}
        {(fee || fee === 0) && (
          <>
            <View style={styles.rowHeader}>
              <BlueText style={[styles.sectionTitle]}>{loc.send.create_fee}</BlueText>
            </View>
            <BlueText style={styles.rowValue}>{feeString}</BlueText>
            <View style={styles.marginBottom18} />
          </>
        )}
        {received && (
          <>
            <View style={styles.rowHeader}>
              <BlueText style={[styles.sectionTitle]}>{loc.transactions.details_received}</BlueText>
            </View>
            <BlueText style={styles.rowValue}>{received}</BlueText>
            <View style={styles.marginBottom18} />
          </>
        )}
      </BlueCard>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  rowHeader: {
    flex: 1,
    flexDirection: 'row',
    marginBottom: 4,
    justifyContent: 'space-between',
  },
  rowValue: {
    color: 'grey',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '500',
  },
  marginBottom18: {
    marginBottom: 18,
  },
  qrCodeContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 24,
  },
});

export default LNDViewAdditionalInvoicePreImage;

LNDViewAdditionalInvoicePreImage.navigationOptions = navigationStyle({}, opts => ({ ...opts, title: loc.lndViewInvoice.additional_info }));
