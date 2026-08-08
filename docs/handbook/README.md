# DFX BTC Taro Wallet — Handbuch

Statische, deutschsprachige Übersichtsseite aller committeten Screenshots,
Store-Listing-Texte, App-Assets und Markdown-Dokumentation dieses Repos.
Ausgeliefert von nginx in einem Docker-Image **öffentlich** (ohne Anmeldewand)
unter [handbook.taro.dfx.swiss](https://handbook.taro.dfx.swiss).
Owner-Entscheid 2026-08-06 / Issue #211: alles im Handbuch ist ohnehin
öffentlich im Repository, die Seite soll ohne Anmeldung lesbar sein.

## Wie es funktioniert

Das Assembly-Script `scripts/handbook/build.js` **findet** die Artefakte selbst
(echte Discovery — keine handgepflegte Mapping-Tabelle):

| Quelle | Pfad | Inhalt |
|--------|------|--------|
| A | `docs/handbook/screenshots/**/*.png` | Screenshots, gruppiert nach Unterverzeichnis (Wurzel → Gruppe `allgemein`) |
| B | rekursiver Scan aller `*.md` ab Repo-Root | Markdown-Doku (gerendert mit `marked`) |
| C | `android/fastlane/metadata/android/**` und `ios/fastlane/metadata/**` | Store-Listing-Klartext (Locales und Felder per Discovery) |
| D | `img/dfx/**/*.png` und `img/icon*.png` | App- und Icon-Assets |

Bei Markdown-Discovery werden übersprungen: Verzeichnisse mit Basename beginnend
mit `.`, die Basenamen `node_modules`, `.git`, `_handbook-deps`, `build`, `dist`,
`coverage`, `blue_modules`, `ios`, `android`, `windows`, `macos`, `vendor`, sowie
der exakte Pfad `docs/handbook` (Selbstdoku und lokales Build-Output).

Ausgabe pro Build:

```
<out>/
  index.html
  manifest.json
  screenshots/…
  docs/…
  assets/…
```

Guards (Build bricht ab bei Verletzung):

- **Floor:** mindestens `MIN_SCREENSHOTS` (35) PNGs (aktuell 41 committiert;
  Boden bei Bestandszuwachs anheben)
- **Floor:** mindestens `MIN_DOCS` (8) Markdown-Dokumente (nach Ausschlussregeln)
- **Floor:** mindestens `MIN_STORE_FIELDS` (12) Store-Textfelder
- **Floor:** mindestens `MIN_ASSETS` (20) PNGs unter Assets
- **PNG-Integrität:** Magic-Bytes `\x89PNG…`; Screenshots > 1000 Bytes,
  App-Assets > 100 Bytes (kleine 1×-Icons wie `telegram.png`/`twitter.png`
  sind im Repo unter 1000 Bytes und trotzdem gültige PNGs)
- **HTML-Integrität:** jedes Artefakt im Manifest muss im Ausgabeverzeichnis
  liegen; zusätzlich muss jedes lokale `src`/`href` in den gerenderten
  Markdown-Seiten auflösen
- **Ausgabepfad-Kollision:** beanspruchen zwei Quellen denselben `outputPath`
  (z. B. `README.md` und `docs/README.md` → `docs/README.html`), bricht der
  Build ab und nennt beide Quellpfade — stilles Überschreiben ist verboten
- **Leeres Ausgabeverzeichnis:** jeder Lauf leert das Zielverzeichnis zuerst
  (Wächter gegen Repo-Root, Discovery-Quellen wie `docs/handbook/screenshots`
  und `img/dfx`, `.git`, `/` und Home), damit keine veralteten Dateien und
  keine Quellbäume gelöscht werden

Überschreitung der Mindestzahl ist **kein** Fehler — neue Dateien landen
automatisch.

### Nicht auflösende Markdown-Links

Die Repo-Markdown-Dateien verlinken teilweise auf Pfade, die nicht ins Handbook
kopiert werden (z. B. `scripts/…`, Plattformcode, GitHub-Relative). Solche
lokalen Links werden beim Rendern **nicht** still gelöscht und die Prüfung
wird **nicht** abgeschaltet: der Link wird in reinen Text umgewandelt
(Beschriftung bleibt, `href` entfällt), und jeder Fund wird einmal auf stderr
protokolliert. Relative Links auf andere entdeckte `*.md`-Dokumente werden auf
die gerenderte HTML-Seite umgeschrieben.

Metadaten in `scripts/handbook/metadata.json` sind **nur Anreicherung**:

```json
{
  "screenshots": { "<gruppenschlüssel>": { "title": "…", "description": "…" } },
  "docs": { "<repo-relativer-md-pfad>": { "title": "…" } }
}
```

Fehlende Einträge sind kein Fehler; verwaiste Einträge erzeugen nur eine
Warnung auf stderr. Unter `screenshots` sind derzeit acht Gruppen mit
Titel und Beschreibung gepflegt; neue Gruppen ohne Eintrag nutzen den
Verzeichnisnamen als Titel.

## Lokal bauen

`marked` wird **isoliert** installiert — nicht in `package.json` / Lockfile
des Repos:

```bash
npm install --prefix ./_handbook-deps --no-save --no-audit --no-fund marked@15.0.7
NODE_PATH=./_handbook-deps/node_modules node scripts/handbook/build.js docs/handbook/build
```

Anschliessend `docs/handbook/build/index.html` im Browser öffnen.

Das Scratch-Verzeichnis `_handbook-deps/` und `docs/handbook/build/` sind
gitignored.

Optional: `GIT_SHA=…` (oder `HANDBOOK_GIT_SHA`) setzt den Stand im Seitenkopf.
Optional: `HANDBOOK_REPO_ROOT=/pfad/zum/repo` überschreibt die Root-Erkennung
(Standard: zwei Ebenen über dem Script).

**Hinweis Screenshots:** Der Floor `MIN_SCREENSHOTS` (derzeit 35) bricht den
Build ab, wenn zu wenige PNG unter `docs/handbook/screenshots/` liegen. Bei
Bestandszuwachs den Wert in `scripts/handbook/build.js` anheben.

## Docker-Build-Kontext und Discovery

`Dockerfile.handbook` speist den Builder nur mit den Quellen, die `build.js`
entdeckt. **Ganze Verzeichnisse** (`docs/`, `scripts/handbook/`, Store-Metadaten,
`img/dfx/`) kommen per `COPY …/`. **Top-Level-Markdown und Icons** kommen per
Glob (`COPY *.md ./`, `COPY img/icon*.png ./img/`) — nicht als namentliche Liste.
Eine Namensliste im Dockerfile bricht das Discovery-Versprechen: `build.js` würde
eine neue Datei lokal mitzählen, das Image sie aber still weglassen (ohne
Build-Fehler; Floor-Guards greifen oft nicht). Der PR-Workflow
`handbook-check` vergleicht deshalb die Artefaktzahlen je Kategorie aus einem
Host-Build mit dem `manifest.json` im Image und macht den Job bei Abweichung rot.

## Docker-Image lokal

```bash
# _handbook-deps darf nicht im Build-Kontext liegen
rm -rf _handbook-deps

docker build -f Dockerfile.handbook \
  --build-arg GIT_SHA="$(git rev-parse HEAD)" \
  -t dfx-taro-handbook:local .

# Keine Credentials — das Handbuch ist öffentlich
docker run --rm -p 8080:8080 dfx-taro-handbook:local
```

- `http://127.0.0.1:8080/healthz` → `200 OK`
- `http://127.0.0.1:8080/` → `200` ohne Anmeldung

## Screenshot hinzufügen

1. PNG unter `docs/handbook/screenshots/<gruppe>/` ablegen und committen
   (Beispiel: `docs/handbook/screenshots/onboarding/03-seed.png`).
2. Konvention `NN-kurzname.png` (zweistelliger Schritt-Präfix) ist empfohlen
   für die Sortierung, aber **nicht** erzwungen.
3. Nächster Handbook-Build nimmt die Datei automatisch auf — **keine**
   Mapping-Tabelle und **keinen** Count anpassen.
4. Optional: in `scripts/handbook/metadata.json` unter `screenshots` einen
   deutschen Titel/Beschreibung für den Gruppenschlüssel ergänzen.
5. Optional: Maestro-Flow unter `scripts/handbook/screenshots/` mit passendem
   `takeScreenshot: shots/<pfad>` ergänzen (genau ein Erzeuger pro PNG).

## Markdown-Dokument hinzufügen

1. `*.md` im Repo ablegen (ausserhalb der Ausschlussliste).
2. Nächster Build nimmt es auf — kein Code-Edit nötig.
3. Optional: Titel-Override in `metadata.json` → `docs`.

## Deployment

Bei Push auf `develop` (relevante Pfade) baut
`.github/workflows/handbook-deploy.yaml` das Image
`dfxswiss/dfx-taro-handbook:latest` (linux/arm64), pusht es, löst den
serverseitigen Deploy-Hook aus und pollt anschliessend
`https://handbook.taro.dfx.swiss/healthz`. Manuell: `workflow_dispatch`.

Solange DNS, Reverse-Proxy oder der Service `dfx-taro-handbook` auf dem
Deploy-Host noch fehlen, kann der Job nach erfolgreichem Image-Push am SSH-
oder Smoke-Schritt scheitern — laut Issue #211 bewusst (Image zuerst, Server
danach).

Der Deploy-Workflow verlangt die GitHub-Secrets `DOCKER_USERNAME`,
`DOCKER_PASSWORD`, `DEPLOY_PRD_HOST`, `DEPLOY_PRD_USER`, `DEPLOY_PRD_SSH_KEY`
und `DEPLOY_PRD_SSH_KNOWN_HOSTS` (Docker Hub und SSH — **nicht** App-Auth);
fehlt oder leer ist eines davon, bricht er sofort ab und nennt die fehlenden
**Namen** (kein Build, kein Image-Push). Runtime-Zugangsdaten für das Handbuch
gibt es nicht: die Seite ist öffentlich.

Der PR-Check (`.github/workflows/handbook-check.yaml`) läuft auf jedem
nicht-Draft-PR: Image-Build ohne Push, Container-Smoke (`/healthz` und `/`
jeweils **200 unauthentifiziert**), Stichprobe aus `manifest.json` je
Kategorie, Host-vs-Image-Artefaktzahlen.

## Screenshots erzeugen

Der committete Satz unter `docs/handbook/screenshots/` stammt aus einem
iOS-Simulator-Lauf, nicht aus einer CI-Visual-Regression. Die verwendeten
Maestro-Flows liegen unter `scripts/handbook/screenshots/` und sind damit
nachvollziehbar und wiederholbar.

```bash
# App fuer den Simulator bauen (Sentry-Upload braucht Credentials, die es
# lokal nicht gibt -> abschalten, sonst scheitert die Bundling-Phase)
SENTRY_DISABLE_AUTO_UPLOAD=true xcodebuild \
  -workspace ios/BlueWallet.xcworkspace -scheme BlueWallet \
  -configuration Release -sdk iphonesimulator -derivedDataPath ios/build \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build

xcrun simctl boot 'iPhone 17'
xcrun simctl install booted ios/build/Build/Products/Release-iphonesimulator/Bitcoin.app

# Flows fahren (Maestro braucht ein JDK)
export JAVA_HOME=/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home
maestro test scripts/handbook/screenshots/01-onboarding.yaml
```

Jedes committete PNG hat genau einen erzeugenden `takeScreenshot:`-Schritt, und
kein Flow zielt auf einen Namen, den es im Satz nicht gibt — nachpruefbar, indem
man alle `takeScreenshot: shots/<pfad>` gegen `docs/handbook/screenshots/**.png`
abgleicht (Soll: 41 Treffer, 0 verwaist, 0 ohne Flow). Wer den Satz erweitert,
haelt diese Zuordnung mit; sonst ist die Wiederholbarkeit nur behauptet.

`_setup.yaml` ist der gemeinsame Vorlauf fuer die meisten Flows: frischer
App-Start, Wallet anlegen und den Mitteilungs-Dialog einmal abraeumen. Die
Wallet-Anlage fuehrt direkt auf die Uebersicht — die Lightning-Wallet ist opt-in
und wird ueber „Hinzufuegen" in der Lightning-Zeile angelegt; genau das macht
`_setup-lightning.yaml`, das die Lightning-Flows einbinden. Zwei
Flows starten selbst mit `launchApp: clearState` und ohne `_setup*`:
`01-onboarding.yaml` und `16-import.yaml` (sie brauchen den frischen
Onboarding-/Import-Zustand). Der Simulator-Build ohne Code-Signing hat keine
Keychain-Entitlements; die Wallet ueberlebt einen App-Neustart deshalb nicht.

**Screenshot-gesperrte Seiten.** `blue_modules/Privacy.tsx` ruft auf sensiblen
Seiten `CaptureProtection.prevent({ screenshot: true })` auf — Wiederherstellungs-
phrase, Adressliste, Export/Backup, xPub und der Import-Pfad. Die Sperre wirkt auf
den **iOS-Screenshot-Pfad**; Maestros `takeScreenshot` liefert dort ein schwarzes
Bild.

Der Framebuffer des Simulators ist davon nicht betroffen. Gemessen am selben
Bildschirm im selben Moment: Maestro `mean=0.0014` (schwarz),
`xcrun simctl io <udid> screenshot` `mean=0.583` (echter Inhalt). Fuer diese
Seiten also mit Maestro **navigieren** und mit `simctl` **aufnehmen** — das ist
der einfachere Weg und aendert im Gegensatz zum Easter Egg in
`SettingsPrivacy.js` keine App-Einstellung. Der Flow
`09-geschuetzte-screens.yaml` nutzt noch den Easter-Egg-Weg; beide fuehren zum
selben Bild. Ob die Sperre auf echter Hardware ebenso umgehbar ist, wurde
**nicht** geprueft.

Auf `02-wallet/06-export-backup.png` und `02-wallet/08-wiederherstellungsphrase.png`
sind die zwoelf Woerter und der Export-QR-Code **nachtraeglich geschwaerzt**. Die
Wallet stammt aus einem Wegwerf-Simulatorlauf und wurde nie benutzt, aber eine
lesbare Phrase gehoert nicht in ein oeffentliches Repository. Gegenprobe nach
jeder Aenderung an diesen Bildern:

```bash
# ueber den GANZEN Satz, nicht ueber eine Datei — genau diese Verkuerzung hat
# beim ersten Anlauf zwei Signaturen und zwei erweiterte Public Keys durchgelassen
for f in docs/handbook/screenshots/**/*.png; do zbarimg -q --raw "$f"; done
```

Erlaubt ist genau ein Treffer: die On-Chain-Empfangsadresse in
`04-empfangen-senden/01-erhalten.png` — sie ist der Inhalt dieses Screens und eine
einzelne Wegwerf-Adresse. Jeder weitere Treffer ist ein Fund.

Zusaetzlich geschwaerzt, weil sie Anmeldematerial bzw. dauerhaft gueltige
Schluessel zeigen: das Feld „DFX-Adressen-Besitznachweis" in
`03-einstellungen/03-wallet-einstellungen.png` und `19-lightning-wallet.png` (eine
Signatur ueber eine **statische Nachricht ohne Nonce**, siehe
`api/dfx/hooks/auth.hook.ts` — laeuft nie ab), der Account-`zpub` in
`02-wallet/07-xpub.png`, der Cosigner-QR in `07-multi-device/01-erstellung-qr.png`
und die Lightning-Adresse in `08-lightning/03-rechnung-erstellen.png`.

Gegenprobe zusaetzlich per OCR:

```bash
# darf nichts finden
grep -oiE "[zx]pub6[A-Za-z0-9]{20,}" <ocr-ausgabe>
```

Zusaetzlich laeuft ueber den ganzen Satz eine OCR-Probe: keine Folge von vier
aufeinanderfolgenden BIP39-Woertern (die ungeschwaerzten Originale hatten zwoelf).

## Abdeckung — was fehlt und warum

Das Issue verlangt „jeden Screen, in jeder Variante, in jedem Szenario". Dieser
Stand erfuellt das **nicht**. Die Zahlen, damit die Luecke nachpruefbar ist statt
ungefaehr: `navigation/` registriert **109** Routen, davon 17 reine
Stack-Wrapper (Endung `Root`), bleiben **92 echte Screens**. Die **41**
committeten PNGs bilden davon **33 verschiedene Screens** ab — sechs Screens
sind mehrfach abgebildet, weil sie in mehreren Varianten vorkommen:
`WalletTransactions` und `AddLightning` (je 3 Bilder), `ReceiveDetails`,
`WalletAsset`, `WalletDetails` und `Tools` (je 2). **59 Screens fehlen ganz.**

Die Luecke ist nicht zufaellig, sondern hat drei benennbare Ursachen:

**1. Kein Guthaben** — jeder Screen, der eine echte Transaktion voraussetzt:
`TransactionDetails`, `TransactionStatus`, `CreateTransaction`, `Confirm`,
`Success`, `CoinControl`, `CPFP`, `RBFBumpFee`, `RBFCancel`, `PsbtMultisig`,
`PsbtMultisigQRCode`, `PsbtWithHardwareWallet`, dazu die Lightning-Seiten
`LNDViewInvoice`, `LNDViewAdditionalInvoiceInformation`,
`LNDViewAdditionalInvoicePreImage`, `LnurlPay`, `LnurlPaySuccess`, `LnurlAuth`.

Der uebliche Umweg — eine Watch-only-Adresse mit vorhandener Historie
importieren — steht nicht offen: der entsprechende Zweig in
`class/wallet-import.js` ist seit dem Upstream-Commit `e56894628` (2021)
auskommentiert; ein Adress-Import endet in „Es wurden keine Wallets gefunden".
Ein Testnetz gibt es nicht, `bitcoin.networks.bitcoin` ist fest verdrahtet.
Diese Screens brauchen also echte Coins auf einer Wallet.

**2. Keine Hardware** — `AddBoltcard`, `BackupBoltcard`, `DeleteBoltcard`,
`BoltCardDetails`, `TappedCardDetails` brauchen NFC, das der iOS-Simulator nicht
hat. Ebenso die POS-Strecke (`PosReceive`, `CashierPos`, `CashierDfxPos`,
`ReceiveDfxPos`), soweit sie an einer Karte haengt.

**3. Kein zweites und drittes Geraet** — `ViewEditMultisigCosigners` und
`ExportMultisigCoordinationSetup` setzen eine fertig eingerichtete
Multi-Device-Wallet voraus, also drei parallel laufende Instanzen. Abgebildet ist
nur der erste Einrichtungsschritt.

Ausserdem kein App-Screen und deshalb bewusst nicht im Satz: die Kacheln
„Kaufen"/„Verkaufen" oeffnen einen externen Browser.

Wer die Luecke schliessen will, braucht in dieser Reihenfolge: eine Wallet mit
einem kleinen Betrag on-chain und ein paar Sats auf Lightning (deckt Ursache 1
ab), ein echtes Geraet mit NFC und eine Boltcard (Ursache 2), drei Geraete
(Ursache 3).

