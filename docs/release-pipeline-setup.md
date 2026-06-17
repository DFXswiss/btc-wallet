# Release pipeline — setup runbook (internal)

One-time provisioning for the tag-driven store-release pipeline (see
`docs/release-pipeline.md` for how it works). Do these once on the **`DFXswiss/btc-wallet`**
repo; afterwards every `vX.Y.Z` tag ships to TestFlight + Play beta automatically.

> No secret *values* belong in this file or the repo — this only says **where to get each key**.
> Add every secret under: GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**
> (or `gh secret set NAME --repo DFXswiss/btc-wallet`).

## Accounts / access you need first
- **Apple Developer Program** membership (paid) + admin on the DFX team `Y4QBY6387T`.
- **App Store Connect** access (Admin or App Manager) for the same team.
- **Google Play Console** admin for the `swiss.dfx.bitcoin` app.
- **GitHub admin** on `DFXswiss/btc-wallet` (to add secrets) and rights to create `DFXswiss/btc-wallet-certificates`.
- A **macOS machine** with Xcode + `bundle install` (in `ios/`) for the one-time `match` seed.

---

## Secrets

### Tagging
| Secret | What it is | Where to get it |
| --- | --- | --- |
| `TAG_DEPLOY_KEY` | SSH **private** key with write access, so `auto-tag`'s tag push triggers `release.yml` (a `GITHUB_TOKEN` push wouldn't). | `ssh-keygen -t ed25519 -C "btc-wallet auto-tag" -f tag_deploy_key -N ""`. Add `tag_deploy_key.pub` under repo **Settings → Deploy keys → Add deploy key** with **Allow write access** ticked. Put the **private** file's contents in this secret. |

### iOS — App Store Connect API key
Used by `upload_to_testflight`, `deliver`, and `match`.
| Secret | What it is | Where to get it |
| --- | --- | --- |
| `APP_STORE_CONNECT_KEY` | The `.p8` API key file **contents**. | App Store Connect → **Users and Access → Integrations → App Store Connect API** → **Generate API Key** (role **App Manager** or Admin). **Download the `.p8` (only offered once.)** Paste the whole file as the secret. |
| `APP_STORE_CONNECT_KEY_ID` | The key's ID. | Shown next to the key you just made (also in the `.p8` filename `AuthKey_<KEYID>.p8`). |
| `APP_STORE_CONNECT_ISSUER_ID` | The team's issuer ID. | Top of the same **Integrations / Keys** page ("Issuer ID"). |

### iOS — code signing (`match`)
| Secret | What it is | Where to get it |
| --- | --- | --- |
| `MATCH_SSH_KEY` | SSH **private** key that can read the certs repo. | `ssh-keygen -t ed25519 -C "btc-wallet match" -f match_key -N ""`. Add `match_key.pub` as a **deploy key** on **`DFXswiss/btc-wallet-certificates`** (write access). Private contents → this secret. |
| `MATCH_PASSWORD` | The passphrase `match` uses to encrypt/decrypt the certs. | **You invent it** when seeding (below). Store it in the password manager and as this secret. |

### Android — Play upload
| Secret | What it is | Where to get it |
| --- | --- | --- |
| `PLAY_STORE_JSON_BASE64` | Play **service-account** JSON, base64-encoded. | Google Play Console → **Setup → API access** → link/create a Google Cloud project → create a **service account** → in Play Console **Users & permissions** invite that service-account email and grant **release** rights. In Google Cloud, create a **JSON key** for it and download. Encode: `base64 -i service-account.json` → paste output as the secret. |

### Android — signing (already configured for the `v*` release flow)
`KEYSTORE_FILE_HEX`, `KEYSTORE_PASSWORD`, `KEYSTORE_KEY_PASSWORD`, `KEYSTORE_ALIAS`,
`TRANSPARENCY_KEYSTORE_HEX`, `TRANSPARENCY_PASSWORD`, `TRANSPARENCY_ALIAS`.
These already exist (used by `build-release-apk.yml`). The new pipeline reuses them — nothing to do.
(For reference, the `*_HEX` ones are `xxd -plain keystore.jks`.)

### Optional variable
| Name | When needed | Where |
| --- | --- | --- |
| `ASC_TEAM_ID` | Only if the Apple ID belongs to **several** App Store Connect teams. | App Store Connect → team picker / Membership. Add as a **variable** (not secret), read by `ios/fastlane/Appfile`. |

---

## One-time external setup

### 1. `match` certificates repo (iOS signing)
1. Create an **empty private** repo `DFXswiss/btc-wallet-certificates`.
2. Add the `match` deploy key public half to it (write) — see `MATCH_SSH_KEY` above.
3. On a Mac, from `ios/`, with the ASC API key env + `MATCH_PASSWORD` set, run:
   ```
   bundle install
   bundle exec fastlane match appstore
   ```
   This generates the **distribution certificate + App Store profile** in the Apple account, encrypts them with `MATCH_PASSWORD`, and commits them to the certs repo. (`Matchfile` already points at the repo + `swiss.dfx.bitcoin`.) CI runs `match` **read-only** afterwards.

### 2. App Store Connect
- Create the **API key** (see secrets above).
- **Create the app's first App Store version manually** in App Store Connect. `deliver` cannot create the very first version via API — until it exists, the listing push is skipped (best-effort) but the TestFlight upload still works. After the first version exists, every tag syncs the listing automatically.

### 3. Google Play Console
- Ensure the `swiss.dfx.bitcoin` app exists.
- Create the **service account** + grant release permissions (see `PLAY_STORE_JSON_BASE64`).
- Make sure an **Open Testing ("beta")** track exists.

### 4. Store listing content (unblocks the preflight)
The preflight (`scripts/check-store-metadata.sh`) blocks a release while any `FIXME-` remains. Fill these for **both** `de-DE` and `en-US`:
- iOS: `ios/fastlane/metadata/<locale>/{description,promotional_text,marketing_url,privacy_url,support_url}.txt`
- Android: `android/fastlane/metadata/android/<locale>/full_description.txt`
- Screenshots: `ios/fastlane/screenshots/<locale>/` and `android/fastlane/metadata/android/<locale>/images/phoneScreenshots/`.
Limits enforced: iOS name/subtitle 30, keywords 100, promo 170, description 4000; Android title 50, short 80, full 4000; URLs ≤ 255.

---

## First run / dry run
1. Add all secrets; complete steps 1–4.
2. Push a test tag (e.g. `v0.0.1`) or merge to `develop` (auto-tag creates the next tag).
3. The `release` workflow runs: guard → preflight → iOS (TestFlight) + Android (Play beta) → GitHub release.
4. Expect the **iOS signing step may need a small first-run tweak** (normal for CI iOS). Promotion to production stays a manual click in each console.
