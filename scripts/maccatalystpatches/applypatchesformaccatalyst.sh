echo "Removing existing release notes"
rm release-notes.txt release-notes.json
rm -fr node_modules
echo "Re-installing node_modules"
npm i
echo "Updating Podfile"
cd ios && pod update && cd ..
echo "Remove Settings.bundle from Xcode project as its only meant for iOS"
rm -rf /ios/Settings.bundle
sed -i '' '/Settings.bundle/d' ios/BlueWallet.xcodeproj/project.pbxproj
