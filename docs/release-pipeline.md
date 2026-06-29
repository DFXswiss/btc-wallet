# Store-release pipeline (iOS + Android)

Full end-to-end, tag-driven store-release automation for **btc-wallet**, tracking
[issue #178](https://github.com/DFXswiss/btc-wallet/issues/178). Mirrors
[`RealUnitCH/app`](https://github.com/RealUnitCH/app)'s pipeline 1:1, adapted from
its Flutter stack to our React Native (BlueWallet-fork) stack.

> **Setting it up?** The one-time provisioning — every secret and exactly where to get it —
> is in the companion runbook [`release-pipeline-setup.md`](./release-pipeline-setup.md).

**Goal:** a single Git tag builds, signs, and uploads **both** the binary **and** the
store listing (texts, images, screenshots) to **App Store Connect / TestFlight** and the
**Google Play Store** — no manual upload steps beyond the final human "Submit/Promote"
click in the consoles. The existing reproducible + attested Android build
(`build-release-apk.sh`, code-transparency, `actions/attest`) is preserved; store
delivery is added **on top of** it.

Bundle/package id is unified on both platforms: `swiss.dfx.bitcoin`.

---

## Phases & status

All implemented in one PR ([#181](https://github.com/DFXswiss/btc-wallet/pull/181)). "Implemented" = code written + syntax/preflight validated locally; the store-upload lanes are **untested end-to-end** until the external prerequisites + secrets are provisioned (see below).

| Phase | Scope                                                                                  | Status                                                                  |
| ----- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1     | Versioning generator + `auto-tag` + `release` skeleton (guard + version + concurrency) | ✅ done, validated (`v9.9.9` test tag)                                  |
| 2     | iOS lane: `match` + `gym` + `upload_to_testflight` + staged `deliver`                  | ✅ implemented (needs certs repo + ASC)                                 |
| 3     | Android lane: `supply` → Play `internal`, on the attested AAB                              | ✅ implemented (needs Play service account)                             |
| 4     | metadata (de-DE/en-US) + `check-store-metadata.sh` + `store-metadata.yml`              | ✅ scaffolded (real copy + legal URLs are `FIXME-`, gated by preflight) |
| 5     | Cleanup: remove placeholder `custom_lane`; remove legacy CircleCI / App Center         | ✅ done (both deleted; BlueWallet upstream had already removed them)    |

> Superseded: the earlier `push: develop` → APK-artifact + TestFlight workflow (PR #180)
> was replaced by this tag-driven design. Its iOS fastlane scaffolding carries over.

---

## Architecture

### 1. Versioning (single source of truth)

- **`scripts/release-version.sh`** turns a tag into the version used by both platforms:
  - `marketing_version` = `X.Y.Z`
  - `version_code` = `MAJOR*10000000 + MINOR*100000 + PATCH*1000 + 999` (identical iOS/Android, deterministic)
  - segments must be `0..99`; any suffix (`-`, `+`) is rejected (old `-beta.N` tags can't re-enter)
  - no/`dev` tag → **dev sentinel** (`version_code=0`); store lanes hard-fail on this so a tagless build is never shipped
- **`android/app/build.gradle`** `releaseVersionName` is the **version baseline** — the DFX `MAJOR.MINOR.PATCH` (`2.0.5`). In CI `versionName`/`versionCode` come from the generator; the literal is the local-build fallback **and** the line `auto-tag` reads to choose the version.
- **iOS**: `CFBundleShortVersionString` + build number set from the generator at build time (phase 2).

### 2. Trigger model (two lanes)

- **`auto-tag.yml`** — push to `develop` → next `vX.Y.Z` tag. Takes `MAJOR.MINOR` from `build.gradle` `releaseVersionName` (the DFX line) and bumps the **patch** from the highest existing tag on that line — **ignoring the inherited BlueWallet `v6.x` tags**. Pushed via **`TAG_DEPLOY_KEY`** so the tag actually triggers the release workflow (a `GITHUB_TOKEN` push would not).
- Manual **`vX.Y.0`** tag (MAJOR/MINOR) = **production candidate**.
- **`release.yml`** — on `push: tags: v*`:
  - **guard** validates the strict `vX.Y.Z` shape and routes the lane: `PATCH==0` → production candidate (GitHub release, `prerelease: false`); `PATCH>=1` → internal release (`prerelease: true`).
  - both lanes ship to the **test tracks** (TestFlight + Play `internal`); production promotion stays a manual console action.
  - `concurrency: store-release`, `cancel-in-progress: false` — serialises store uploads so back-to-back tags can't race the same slot.

### Day-to-day: how to ship a version

- **Patch** (the common case): just **merge to `develop`**. `auto-tag` creates the next tag (`v2.0.5 → v2.0.6 → …`) and `release.yml` ships it. No edits.
- **Minor/major**: edit one line — `releaseVersionName` in `android/app/build.gradle` (e.g. `2.1.0`) — in a normal PR, **merge to `develop`**; the next auto-tag jumps to `v2.1.0`, then auto-increments from there. This stays manual on purpose (a merge shouldn't silently decide a release is "a 2.1").
- **Production**: stays a **manual console action** — cut/route a `vX.Y.0` tag, then click **Submit/Promote** in App Store Connect / Play Console. Nothing auto-publishes to the public store.
- **`master`/`main` is not part of the flow** — nothing runs on it; every release goes through `develop` + tags.

### 3. iOS lane (phase 2)

`ios/fastlane/Fastfile` `beta` lane:

1. **Signing via `fastlane match`** (`sync_code_signing`, type `appstore`) — certs/profiles in a **dedicated private repo** (`DFXswiss/btc-wallet-certificates`); SSH deploy key + `MATCH_PASSWORD`.
2. Marketing version + build number from the generator.
3. **`gym`** → signed `.ipa` (Xcode workspace build of the `BlueWallet` prod scheme → `.env.prd`).
4. **`upload_to_testflight`** (ASC API key), `skip_waiting_for_build_processing: true`.
5. **`deliver`** (best-effort) stages listing texts + screenshots; `Deliverfile`: `submit_for_review false`, `automatic_release false` (a human clicks Submit). Best-effort because the first App Store version must be created once manually.

- Real `Appfile` (`app_identifier "swiss.dfx.bitcoin"`, `apple_id`, `itc_team_id`, `team_id` `Y4QBY6387T`).

### 4. Android lane (phase 3)

`android/fastlane/` (`Fastfile` + `Appfile` + `credentials.json` from a base64 secret) `beta` lane, on top of the existing signed/attested AAB:

1. Build the signed AAB (reuse `build-release-apk.sh` + `KEYSTORE_*` / `TRANSPARENCY_*`).
2. **`upload_to_play_store`** track `internal` (Internal Testing) — AAB **+ changelog**, `skip_upload_metadata/images/screenshots: true`.
3. A **second** `upload_to_play_store` pushing **only** metadata + images + screenshots (no changelog).

- `Appfile`: `package_name("swiss.dfx.bitcoin")`, `json_key_file("./credentials.json")` (Play service account).

### 5. Metadata & screenshots (phase 4)

- Replace stale BlueWallet metadata with DFX listings; trim to **`de-DE` + `en-US`** (drop unmaintained inherited locales).
- iOS texts: `ios/fastlane/metadata/<locale>/` (`name`, `subtitle`, `description`, `keywords`, `promotional_text`, `release_notes`, URLs, `copyright`).
- Android texts: `fastlane/metadata/android/<locale>/` (`title`, `short_description`, `full_description`, `changelogs/default.txt`).
- Screenshots: committed/versioned in-repo (`ios/fastlane/screenshots/...`, `fastlane/metadata/android/<locale>/images/...`); automated capture deferred.
- **`store-metadata.yml`** — triggers on `**/fastlane/metadata/**` changes (+ `workflow_dispatch` `ios`/`android`/`both`); runs metadata-only lanes (binary uploads skipped) so listing changes ship without a new build.
- **`store_metadata`** lane per platform (metadata-only; Android pinned to a non-production track defensively).
- **`scripts/check-store-metadata.sh`** preflight (gates both the metadata and release workflows): reject unresolved `FIXME-` placeholders; enforce char limits (iOS name/subtitle 30, keywords 100, description 4000; Android title 50, short 80, full 4000; URLs ≤ 255).

---

## Secrets (CI)

| Secret                        | Platform | Purpose                                                    |
| ----------------------------- | -------- | ---------------------------------------------------------- |
| `TAG_DEPLOY_KEY`              | tagging  | SSH deploy key so `auto-tag`'s push triggers `release.yml` |
| `APP_STORE_CONNECT_KEY`       | iOS      | App Store Connect API key (`.p8` contents)                 |
| `APP_STORE_CONNECT_KEY_ID`    | iOS      | ASC API key ID                                             |
| `APP_STORE_CONNECT_ISSUER_ID` | iOS      | ASC API key issuer ID                                      |
| `MATCH_SSH_KEY`               | iOS      | deploy key for the private `match` certs repo              |
| `MATCH_PASSWORD`              | iOS      | `match` encryption passphrase                              |
| `PLAY_STORE_JSON_BASE64`      | Android  | Play Console service-account JSON (base64)                 |
| `KEYSTORE_*`                  | Android  | app signing (already present)                              |
| `TRANSPARENCY_*`              | Android  | code-transparency signing (already present)                |

No secret **values** live in this repo — only names. Provision them in repo/org settings.

## One-time console prerequisites (DFX)

- Create the private `match` certs repo (`DFXswiss/btc-wallet-certificates`) and seed it (`fastlane match appstore`).
- App Store Connect: create the API key; **create the first app version manually** (bootstraps `deliver`).
- Google Play: create a service account with release permissions; ensure the app exists on the Play console.
- Add all secrets above.
- Provide/approve the real store listing texts + screenshots.

---

## Decisions (defaults from #178, professional/consistent)

1. **`match` certs repo:** dedicated private repo `DFXswiss/btc-wallet-certificates`.
2. **Languages:** trim to `de-DE` + `en-US`; drop unmaintained inherited locales.
3. **Android track:** `internal` (Internal Testing) for the automated lane; production promotion manual.
4. **Screenshots:** committed/versioned set in-repo for the first cut; automated capture deferred.

## RN ≠ Flutter deltas (don't blindly copy RealUnit's Flutter commands)

- Build: `gym` (Xcode workspace) + gradle/`react-native` AAB — **not** `flutter build`.
- Version injection: gradle `versionName`/`versionCode` + Xcode build settings — **not** a Dart-generated file.
- Drop RealUnit's `build_runner` / Drift / golden steps.
- Keep our **code-transparency + attestation** steps (RealUnit has none).

---

## Acceptance criteria (from #178)

- [x] Single-source version generator drives both platforms from the Git tag; tagless build hard-fails. _(phase 1)_
- [x] `auto-tag` on `develop` produces internal-release tags; `vX.Y.0` = production candidate. _(phase 1)_
- [ ] One `release` workflow on `v*` builds **and uploads** iOS (TestFlight) **and** Android (Play `internal`) from a single tag.
- [ ] iOS listing (texts + screenshots) staged via `deliver` (never auto-submitted).
- [ ] Android listing (texts + images + screenshots) via `supply`, separate from the binary/changelog upload.
- [ ] `store-metadata.yml` syncs listing-only changes on demand and on metadata changes.
- [ ] `check-store-metadata.sh` preflight blocks FIXME placeholders + oversize fields, gating both workflows.
- [ ] Stale BlueWallet metadata replaced with DFX listings; languages trimmed.
- [ ] All required secrets documented and provisioned; one-time console prerequisites completed.
- [x] Existing Android attestation/code-transparency preserved. _(unchanged)_
- [ ] Green end-to-end dry run: push a test tag → binary on both test tracks + listing staged, no manual upload steps.

---

## Validation log

- **Phase 1**: pushed a `v9.9.9` test tag → `release.yml` guard routed it (`PATCH=9 → internal`) and derived `marketing_version=9.9.9`, `version_code=90909999`. Green. Test tag deleted.
