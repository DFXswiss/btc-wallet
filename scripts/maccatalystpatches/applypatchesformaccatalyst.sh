echo "Removing existing release notes"
rm release-notes.txt release-notes.json
echo "Applying patch for package.json"
sed -i '' '/react-native-tor/d' ./package.json
sed -i '' 's/"patches": "patch -p1 < scripts\/react-native-tor.patch",/"patches":/g' ./package.json
rm -fr node_modules
echo "Re-installing node_modules"
npm i
echo "Deleting torrific.js content"
cp scripts/maccatalystpatches/torrific.js blue_modules/torrific.js
echo "Updating Podfile"
cd ios && pod update && cd ..
echo "Remove Settings.bundle from Xcode project as its only meant for iOS"
rm -rf /ios/Settings.bundle
sed -i '' '/Settings.bundle/d' ios/BlueWallet.xcodeproj/project.pbxproj
echo ""
echo "NOTE: react-native-tor is not currently compatible with Mac Catalyst."