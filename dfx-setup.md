# DFX setup

## iOS

Prerequesites:
https://reactnative.dev/docs/environment-setup

1. npm i
1. sudo gem install cocoapods
1. (Macbook M1 chip) sudo arch -x86_64 gem install ffi
    sudo gem pristine ffi --version 1.15.5
1. bundle install
1. cd ios && pod install
1. arch -x86_64 pod install
1. cd ..
1. npx react-native start
1. open another terminal (for M1 with Rosetta support)
1. npx react-native run-ios

If it is not working please try again with following guide
https://medium.com/@kailin8591/get-started-with-react-native-on-mac-m1-7e19915b85ab

Yoga Issue
https://github.com/facebook/react-native/issues/36758
 => replace | with ||

### Change environment
touch node_modules/react-native-config/ios/ReactNativeConfig/BuildDotenvConfig.rb

### Build for store
1. Build in XCode (any iOS device)
    - Product -> Archive
1. Upload to store (app store connect)
    - Not manage build numbers
    - Auto signing

## Android

Prerequesites:
https://reactnative.dev/docs/environment-setup

follow through blue wallet README android points.
Important to have a JDK installed and environment variables set in your bash profile of choice (zsh, bashrc, ...)
Also make sure to have enough space reserved for your emulator. Default is 800 MB which is too less. For an explanation how to change the size, please see https://stackoverflow.com/questions/54461288/installation-failed-with-message-error-android-os-parcelableexception-java-io
Only after Android emulator is running.
1. npx react-native start
1. npx react-native run-android

### Build for store
1. cd android
1. ./gradlew bundleRelease
    - npx react-native build-android --mode=release (builds APK)
1. Internal testing -> create new release
1. Upload from android/app/build/outputs/bundle/release/app-release.aab