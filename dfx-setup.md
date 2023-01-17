# DFX setup

## iOS

Prerequesites:
https://reactnative.dev/docs/environment-setup

1. npm i
1. sudo gem install cocoapods
1. (Macbook M1 chip) sudo arch -x86_64 gem install ffi
1. bundle install
1. cd ios && pod install
1. arch -x86_64 pod install
1. cd ..
1. npx react-native start
1. open another terminal (for M1 with Rosetta support)
1. npx react-native run-ios

If it is not working please try again with following guide
https://medium.com/@kailin8591/get-started-with-react-native-on-mac-m1-7e19915b85ab

## Android

Prerequesites:
https://reactnative.dev/docs/environment-setup

follow through blue wallet README android points.
Important to have a JDK installed and environment variables set in your bash profile of choice (zsh, bashrc, ...)
Also make sure to have enough space reserved for your emulator. Default is 800 MB which is too less. For an explanation how to change the size, please see https://stackoverflow.com/questions/54461288/installation-failed-with-message-error-android-os-parcelableexception-java-io
Only after Android emulator is running.
1. npx react-native start
1. npx react-native run-android