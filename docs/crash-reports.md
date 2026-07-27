# Crash reports

The app ships the Sentry SDK (`@sentry/react-native`, self-hosted at `sentry.dfxserve.com`),
which is now the primary way JS and native crashes/errors reach us — see `App.js` for the
`Sentry.init()` config and `blue_modules/analytics.js` for how it respects the in-app
Do Not Track toggle.

What is reported, when Do Not Track is off:

- **Crashes and uncaught errors**, as before.
- **Caught errors that reach `console.error`**, filed as issues by the `captureConsole`
  integration (error level only — `console.warn` stays a breadcrumb and a log). Without
  this a handled error was recorded but never alerted on.
- **The device support id** shown on the About screen, set as the Sentry user id so it
  appears on both error events and log records. Without it a log row carries no user at
  all, and one device failing repeatedly cannot be told apart from many devices failing
  once.

  Note what this id is: `react-native-device-info`'s `getUniqueIdSync()` — `identifierForVendor`
  on iOS, `ANDROID_ID` on Android. It is more durable than what the SDK reports on its own
  (a random per-install UUID that resets on reinstall): `ANDROID_ID` is stable per device and
  signing key and survives reinstalling the app. It is used deliberately, because it is the
  id the About screen offers the user to copy for support — using anything else means a
  support request cannot be matched to its telemetry.

No PII beyond that id is collected (`sendDefaultPii: false` — no IP address, cookies, or
user profile). Turning Do Not Track on stops event delivery and clears the id from the
JS and native scopes; turning it back off re-attaches it and re-registers the console
capture without needing a restart.

The Apple-native flow below (Organizer/App Store Connect crash reports, no SDK involved)
still works as a fallback — for example for a user who's opted out of Sentry via Do Not
Track, or for pre-Sentry builds. It only covers iOS; Android crash triage goes through Sentry.

## Apple-native fallback (no third-party tools)

Apple's built-in crash collection surfaces in **Xcode → Window → Organizer → Crashes** (and the
crash section of App Store Connect) for the app id `swiss.dfx.bitcoin`.

For a crash to appear there, readable, four things must line up:

1. **dSYMs are generated.** Release/Archive builds set `DEBUG_INFORMATION_FORMAT = dwarf-with-dsym`
   (project-level Release config in `ios/BlueWallet.xcodeproj`). dSYMs are the symbol files Apple
   needs to turn raw addresses into function names + line numbers.
2. **dSYMs are uploaded with the build.** Automatic on Xcode Archive → upload ("Upload your app's
   symbols" is on by default) and via fastlane `upload_to_testflight` (default). Don't disable
   symbol upload in the release lane.
3. **The user shared analytics.** Crashes only reach Apple from users who have
   *Settings → Privacy & Security → Analytics & Improvements → Share With App Developers* enabled.
4. **You look in the right place.** Organizer → Crashes, filtered to `swiss.dfx.bitcoin`.

No code in the app is involved — this is enabled purely by being a TestFlight/App Store build under
our team with symbols uploaded.

> Note: this captures **native** crashes well. A pure-JS error escalated to a native abort will point
> into Hermes / `RCTFatal` without the JS line — reading that needs JS source maps, which is a
> separate setup not covered here.

## Getting a crash from a specific customer (no SDK, works on any build)

The crash log already exists on the customer's device:

**Customer side**
1. Settings → Privacy & Security → Analytics & Improvements → **Analytics Data**
2. Scroll to an entry named like `Bitcoin-<date>` (or the process name) around the crash time
3. Tap it → Share → send the `.ips` file

**Our side — symbolicate it**
1. Get the **dSYM for the exact build** the customer runs:
   - App Store Connect → the app → the specific build → **Download dSYM**, or
   - Xcode → Organizer → the matching Archive → **Download Debug Symbols** / show in Finder
2. Symbolicate with the matching dSYM:
   - Easiest: open the `.ips` in Xcode with the matching archive present, or
   - `atos -arch arm64 -o <App>.app.dSYM/Contents/Resources/DWARF/<App> -l <loadAddr> <addr>`

Even **before** symbolicating, the report's header is informative:

- **Exception Type / Termination Reason** — e.g. `0x8badf00d` = watchdog timeout (app hung),
  `EXC_BAD_ACCESS` = bad memory access, `EXC_CRASH (SIGABRT)` = an assertion / uncaught exception.
- **Binary Images / faulting frame** — names the framework or library at the top of the crashing
  thread, which often localizes the cause immediately.

## Keeping dSYMs

Archive every store/TestFlight build (Xcode keeps them under *Organizer → Archives*) and/or keep the
`.xcarchive` from CI, so a dSYM is always available to symbolicate a crash from that exact build.
