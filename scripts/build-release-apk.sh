#!/bin/bash


# Assumes the following env variables: 
#
#
# --> KEYSTORE_FILE_HEX : hex encoded keystore file
#
# PS. to turn file to hex and back:
#     $ xxd -plain test.txt > test.hex
#     $ xxd -plain -revert test.hex test2.txt
#
# --> KEYSTORE_PASSWORD : Password for the keystore
#
# --> KEYSTORE_KEY_PASSWORD : Password for the key
#
# --> KEYSTORE_ALIAS : Alias of the key
#

echo $KEYSTORE_FILE_HEX > bluewallet-release-key.keystore.hex
xxd -plain -revert bluewallet-release-key.keystore.hex > ./android/bluewallet-release-key.keystore
cp ./android/bluewallet-release-key.keystore ./android/app/bluewallet-release-key.keystore
rm bluewallet-release-key.keystore.hex

cd android
TIMESTAMP=$(date +%s | sed 's/...$//')
sed -i'.original'  "s/versionCode 1/versionCode $TIMESTAMP/g" app/build.gradle
./gradlew assembleRelease -P MYAPP_UPLOAD_STORE_FILE=./bluewallet-release-key.keystore -P MYAPP_UPLOAD_KEY_ALIAS=$KEYSTORE_ALIAS -P MYAPP_UPLOAD_STORE_PASSWORD=$KEYSTORE_PASSWORD -P MYAPP_UPLOAD_KEY_PASSWORD=$KEYSTORE_KEY_PASSWORD
./gradlew bundleRelease -P MYAPP_UPLOAD_STORE_FILE=./bluewallet-release-key.keystore -P MYAPP_UPLOAD_KEY_ALIAS=$KEYSTORE_ALIAS -P MYAPP_UPLOAD_STORE_PASSWORD=$KEYSTORE_PASSWORD -P MYAPP_UPLOAD_KEY_PASSWORD=$KEYSTORE_KEY_PASSWORD
$ANDROID_HOME/build-tools/33.0.2/apksigner sign --ks ./bluewallet-release-key.keystore   --ks-pass=pass:$KEYSTORE_PASSWORD ./app/build/outputs/apk/release/app-release.apk