import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { View, Linking, StyleSheet, Image, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  BlueButton,
  BlueButtonLink,
  BlueCard,
  BlueLoading,
  BlueSpacing20,
  BlueSpacing40,
  BlueText,
  SafeBlueArea,
} from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import Lnurl from '../../class/lnurl';
import loc from '../../loc';
import { SuccessView } from '../send/success';
import alert from '../../components/Alert';
import { reportError } from '../../helpers/errors';

/** Serializable success-screen fields. AES actions are decrypted here so the preimage never enters navigation params. */
export function lnurlPaySuccessDisplay(LN) {
  const display = {
    repeatable: !LN.getDisposable(),
  };

  const domain = LN.getDomain();
  if (domain) display.domain = domain;

  const description = LN.getDescription();
  if (description) display.description = description;

  const image = LN.getImage();
  if (image) display.image = image;

  const lnurl = LN.getLnurl();
  if (typeof lnurl === 'string' && lnurl) display.lnurl = lnurl;

  const successAction = LN.getSuccessAction();
  if (!successAction) return display;

  switch (successAction.tag) {
    case 'aes':
      display.preamble = successAction.description;
      try {
        display.message = Lnurl.decipherAES(successAction.ciphertext, LN.getPreimage(), successAction.iv);
      } catch (error) {
        reportError('lnurlPaySuccess: failed to decrypt success action', error);
      }
      break;
    case 'url':
      display.preamble = successAction.description;
      display.url = successAction.url;
      break;
    case 'message':
      display.message = successAction.message;
      break;
  }

  return display;
}

export default class LnurlPaySuccess extends Component {
  constructor(props) {
    super(props);

    const paymentHash = props.route.params.paymentHash;
    const fromWalletID = props.route.params.fromWalletID;
    const fee = props.route.params.fee;
    const justPaid = !!props.route.params.justPaid;

    this.state = {
      paymentHash,
      isLoading: true,
      fromWalletID,
      fee,
      justPaid,
    };
  }

  applySuccessfulPayment(LN) {
    this.setState({ isLoading: false, hasDisplay: true, ...lnurlPaySuccessDisplay(LN) });
  }

  applyFallbackDisplay(display) {
    this.setState({
      isLoading: false,
      hasDisplay: true,
      domain: display.domain,
      description: display.description,
      image: display.image,
      lnurl: display.lnurl,
      repeatable: display.repeatable,
      preamble: display.preamble,
      message: display.message,
      url: display.url,
    });
  }

  async componentDidMount() {
    try {
      const LN = new Lnurl(false, AsyncStorage);
      const loaded = await LN.loadSuccessfulPayment(this.state.paymentHash);
      if (loaded) {
        this.applySuccessfulPayment(LN);
        return;
      }

      const fallbackDisplay = this.props.route.params.lnurlPay;
      if (fallbackDisplay) {
        this.applyFallbackDisplay(fallbackDisplay);
        return;
      }

      this.setState({ isLoading: false });
    } catch (error) {
      reportError('lnurlPaySuccess: failed to load successful payment', error);
      alert(error.message);
      this.setState({ isLoading: false });
    }
  }

  render() {
    if (this.state.isLoading) {
      return <BlueLoading />;
    }

    if (!this.state.hasDisplay) {
      const { justPaid, fee } = this.state;
      return (
        <SafeBlueArea style={styles.root}>
          <ScrollView style={styles.container}>
            {justPaid && <SuccessView fee={fee} />}
            <BlueCard>
              <BlueButton
                onPress={() => {
                  this.props.navigation.getParent().popToTop();
                }}
                title={loc.send.success_done}
              />
            </BlueCard>
          </ScrollView>
        </SafeBlueArea>
      );
    }

    const { domain, description, image, lnurl, repeatable, preamble, message, url, justPaid, fee } = this.state;

    return (
      <SafeBlueArea style={styles.root}>
        <ScrollView style={styles.container}>
          {justPaid && <SuccessView fee={fee} />}

          <BlueSpacing40 />
          <BlueText style={styles.alignSelfCenter}>{domain}</BlueText>
          <BlueText style={[styles.alignSelfCenter, styles.description]}>{description}</BlueText>
          {image && <Image style={styles.img} source={{ uri: image }} />}
          <BlueSpacing20 />

          {(preamble || url || message) && (
            <BlueCard>
              <View style={styles.successContainer}>
                <BlueText style={styles.successText}>{preamble}</BlueText>
                {url ? (
                  <BlueButtonLink
                    title={url}
                    onPress={() => {
                      Linking.openURL(url);
                    }}
                  />
                ) : (
                  <BlueText selectable style={{ ...styles.successText, ...styles.successValue }}>
                    {message}
                  </BlueText>
                )}
              </View>
            </BlueCard>
          )}

          <BlueCard>
            {repeatable ? (
              <BlueButton
                onPress={() => {
                  this.props.navigation.navigate('SendDetailsRoot', {
                    screen: 'LnurlPay',
                    params: {
                      lnurl,
                      walletID: this.state.fromWalletID,
                    },
                  });
                }}
                title={loc._.repeat}
                icon={{ name: 'refresh', type: 'font-awesome', color: '#9aa0aa' }}
              />
            ) : (
              <BlueButton
                onPress={() => {
                  this.props.navigation.getParent().popToTop();
                }}
                title={loc.send.success_done}
              />
            )}
          </BlueCard>
        </ScrollView>
      </SafeBlueArea>
    );
  }
}

LnurlPaySuccess.propTypes = {
  navigation: PropTypes.shape({
    navigate: PropTypes.func,
    pop: PropTypes.func,
    getParent: PropTypes.func,
  }),
  route: PropTypes.shape({
    name: PropTypes.string,
    params: PropTypes.shape({
      paymentHash: PropTypes.string.isRequired,
      fromWalletID: PropTypes.string.isRequired,
      fee: PropTypes.number,
      justPaid: PropTypes.bool.isRequired,
      lnurlPay: PropTypes.shape({
        domain: PropTypes.string,
        description: PropTypes.string,
        image: PropTypes.string,
        lnurl: PropTypes.string,
        repeatable: PropTypes.bool,
        preamble: PropTypes.string,
        message: PropTypes.string,
        url: PropTypes.string,
      }),
    }),
  }),
};

const styles = StyleSheet.create({
  img: { width: 200, height: 200, alignSelf: 'center' },
  alignSelfCenter: {
    alignSelf: 'center',
  },
  root: {
    padding: 0,
  },
  container: {
    paddingHorizontal: 16,
  },
  successContainer: {
    marginTop: 10,
  },
  successText: {
    textAlign: 'center',
    margin: 4,
  },
  successValue: {
    fontWeight: 'bold',
  },
  description: {
    marginTop: 20,
  },
});

LnurlPaySuccess.navigationOptions = navigationStyle({
  title: '',
  closeButton: true,
  headerBackVisible: false,
  gestureEnabled: false,
  closeButtonFunc: ({ navigation }) => navigation.getParent().popToTop(),
});
