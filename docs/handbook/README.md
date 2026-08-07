# DFX BTC Taro Wallet — Handbuch

Statische, deutschsprachige Übersichtsseite aller committeten Screenshots,
Store-Listing-Texte, App-Assets und Markdown-Dokumentation dieses Repos.
Ausgeliefert von nginx in einem Docker-Image hinter Basic Auth unter
[handbook.taro.dfx.swiss](https://handbook.taro.dfx.swiss).

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

- **Floor:** mindestens `MIN_SCREENSHOTS` (1) PNGs — **offen:** Wert bewusst
  niedrig, solange der Screenshot-Bestand noch wächst; nach dem ersten echten
  Set auf den Ist-Bestand (minus Puffer) anheben
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
  (mit Wächtern gegen Repo-Root, `.git`, `/` und Home), damit keine veralteten
  Dateien eines früheren Builds überleben

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
Warnung auf stderr. Der `screenshots`-Block ist zunächst leer — Gruppen
entstehen mit dem Screenshot-Set.

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

**Hinweis Screenshots:** Solange unter `docs/handbook/screenshots/` noch keine
PNG liegt (nur `.gitkeep`), greift der Floor-Guard `MIN_SCREENSHOTS=1` und der
Build bricht ab. Sobald echte Screenshots liegen, entfällt `.gitkeep` und der
Build läuft durch. Danach `MIN_SCREENSHOTS` anheben.

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

# Credentials nur zur lokalen Prüfung — echte Werte kommen von der Deployment-Umgebung
docker run --rm -p 8080:8080 \
  -e HANDBOOK_USER=local \
  -e HANDBOOK_PASSWORD=local \
  dfx-taro-handbook:local
```

- `http://127.0.0.1:8080/healthz` → `200 OK` ohne Auth
- `http://127.0.0.1:8080/` → `401` ohne Auth, `200` mit Basic Auth

Ohne `HANDBOOK_USER` / `HANDBOOK_PASSWORD` startet der Container **nicht**
(fail loud).

## Screenshot hinzufügen

1. PNG unter `docs/handbook/screenshots/<gruppe>/` ablegen und committen
   (Beispiel: `docs/handbook/screenshots/onboarding/03-seed.png`).
2. Konvention `NN-kurzname.png` (zweistelliger Schritt-Präfix) ist empfohlen
   für die Sortierung, aber **nicht** erzwungen.
3. Nächster Handbook-Build nimmt die Datei automatisch auf — **keine**
   Mapping-Tabelle und **keinen** Count anpassen.
4. Optional: in `scripts/handbook/metadata.json` unter `screenshots` einen
   deutschen Titel/Beschreibung für den Gruppenschlüssel ergänzen.
5. `.gitkeep` im Screenshots-Verzeichnis entfällt, sobald echte Dateien liegen.

## Markdown-Dokument hinzufügen

1. `*.md` im Repo ablegen (ausserhalb der Ausschlussliste).
2. Nächster Build nimmt es auf — kein Code-Edit nötig.
3. Optional: Titel-Override in `metadata.json` → `docs`.

## Deployment

Der Deploy-Workflow (`.github/workflows/handbook-deploy.yaml`) baut das Image
`dfxswiss/dfx-taro-handbook:latest` (linux/arm64), pusht es, löst den
serverseitigen Deploy-Hook aus und pollt anschliessend
`https://handbook.taro.dfx.swiss/healthz`.

**Derzeit nur manuell** (`workflow_dispatch`): automatischer Deploy auf Push
nach `develop` ist ausgesetzt, solange (1) `handbook.taro.dfx.swiss` nicht
auflöst, (2) der Reverse-Proxy fehlt und (3) auf dem Deploy-Host kein Service
`dfx-taro-handbook` existiert. Sonst würde jeder Merge mit handbook-relevanten
Pfaden (u. a. `*.md`, `docs/**`) auf `develop` rot enden, oft nach bereits
gepushtem Image. Der `push:`-Block mit den Pfadfiltern liegt auskommentiert im
Workflow und wird reaktiviert, sobald die drei Bedingungen erfüllt sind.

Der Deploy-Workflow verlangt die GitHub-Secrets `DOCKER_USERNAME`,
`DOCKER_PASSWORD`, `DEPLOY_PRD_HOST`, `DEPLOY_PRD_USER`, `DEPLOY_PRD_SSH_KEY`
und `DEPLOY_PRD_SSH_KNOWN_HOSTS`; fehlt oder leer ist eines davon, bricht er
sofort ab und nennt die fehlenden **Namen** (kein Build, kein Image-Push).

Image- und Service-Name stehen laut Issue #211 noch unter Bestätigung durch
@TaprootFreak.

Basic-Auth-Zugangsdaten werden **ausschliesslich** in der Deployment-Umgebung
als `HANDBOOK_USER` / `HANDBOOK_PASSWORD` gesetzt. Weder Klartext noch Hash
gehören in dieses öffentliche Repository.

Der PR-Check (`.github/workflows/handbook-check.yaml`) ist davon **unberührt**
und läuft weiter auf jedem nicht-Draft-PR: Image-Build ohne Push,
Container-Smoke (`/healthz`, Auth-Wand 401/200, Stichprobe aus
`manifest.json` je Kategorie, Host-vs-Image-Artefaktzahlen).

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

`_setup.yaml` ist der gemeinsame Vorlauf: frischer App-Start, Wallet anlegen,
LNDHub ueberspringen und den Mitteilungs-Dialog einmal abraeumen, damit er die
spaetere Navigation nicht verdeckt. Jeder Flow bindet ihn per `runFlow` ein,
weil der Simulator-Build ohne Code-Signing keine Keychain-Entitlements hat und
die Wallet einen App-Neustart deshalb nicht ueberlebt.

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
zbarimg -q --raw docs/handbook/screenshots/02-wallet/06-export-backup.png   # muss leer sein
```

Zusaetzlich laeuft ueber den ganzen Satz eine OCR-Probe: keine Folge von vier
aufeinanderfolgenden BIP39-Woertern (die ungeschwaerzten Originale hatten zwoelf).

## Abdeckung — was fehlt und warum

Das Issue verlangt „jeden Screen, in jeder Variante, in jedem Szenario". Dieser
Stand erfuellt das **nicht**. Die Zahlen, damit die Luecke nachpruefbar ist statt
ungefaehr: `navigation/` registriert **109** Routen, davon 17 reine
Stack-Wrapper (Endung `Root`), bleiben **92 echte Screens**. Abgebildet sind
**42**.

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

