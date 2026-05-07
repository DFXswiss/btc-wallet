const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://facebook.github.io/metro/docs/configuration
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  resolver: {
    extraNodeModules: {
      net: require.resolve('react-native-tcp-socket'),
      tls: require.resolve('react-native-tcp-socket'),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
