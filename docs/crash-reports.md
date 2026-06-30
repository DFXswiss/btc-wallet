# Crash reports (Apple native, no third-party tools)

The app ships **no crash-reporting SDK** and sends no telemetry. We rely on Apple's built-in
crash collection, which surfaces in **Xcode → Window → Organizer → Crashes** (and the crash
section of App Store Connect) for the app id `swiss.dfx.bitcoin`.

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
