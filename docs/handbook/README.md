# DFX BTC Taro Wallet — Handbuch

Statische, **kundenzentrierte** Hilfe zur Wallet in **vier Sprachen** (DE/EN/FR/IT),
gegliedert nach Aufgaben (Wallet anlegen, senden, Backup, Lightning, …).
Ausgeliefert von nginx in einem Docker-Image **öffentlich** (ohne Anmeldewand)
unter [handbook.taro.dfx.swiss](https://handbook.taro.dfx.swiss).
Owner-Entscheid 2026-08-06 / Issue #211: alles im Handbuch ist ohnehin
öffentlich im Repository, die Seite soll ohne Anmeldung lesbar sein.

## Wie es funktioniert

Das Assembly-Script `scripts/handbook/build.js` **findet** die Artefakte selbst
(echte Discovery — keine handgepflegte Mapping-Tabelle):

| Quelle | Pfad | Inhalt |
|--------|------|--------|
| A | `docs/handbook/screenshots/**/*.png` | Screenshots (Discovery) |
| B | rekursiver Scan aller `*.md` ab Repo-Root | Markdown-Doku (gerendert mit `marked`) |
| C | `android/fastlane/metadata/android/**` und `ios/fastlane/metadata/**` | Store-Listing-Klartext |
| D | `img/dfx/**/*.png` und `img/icon*.png` | App- und Icon-Assets |
| E | `scripts/handbook/content/*.json` | Kapitel, UI-Texte, Captions je Sprache |
| F | `scripts/handbook/pod/` | Design Pod (tokens.css, Logos SVG, Fonts woff2) |

Bei Markdown-Discovery werden übersprungen: Verzeichnisse mit Basename beginnend
mit `.`, die Basenamen `node_modules`, `.git`, `_handbook-deps`, `build`, `dist`,
`coverage`, `blue_modules`, `ios`, `android`, `windows`, `macos`, `vendor`, sowie
die exakten Pfade `docs/handbook` und `scripts/handbook` (Selbstdoku, Pod, Content).

Bei Store-Discovery sind unter den beiden Metadata-Roots nur Locale-foermige
Verzeichnisse erlaubt (`de`, `de-DE`, `pt-BR`, `zh-Hans`, `es-419`); alles
andere bricht den Build ab. Grund: fastlane legt dort auch
`review_information/` an — Name, Telefonnummer und Demo-Zugang des
App-Review-Kontakts —, und Discovery veroeffentlicht jede `.txt` unter einem
akzeptierten Verzeichnis woertlich auf eine Seite ohne Anmeldewand.

Ausgabe pro Build:

```
<out>/
  index.html              # Deutsch (locale de)
  en/index.html
  fr/index.html
  it/index.html
  handbook.js
  manifest.json
  screenshots/…
  docs/…
  assets/…                # inkl. assets/fonts/*.woff2
```

Guards (Build bricht ab bei Verletzung):

- **Floor:** mindestens `MIN_SCREENSHOTS` (35) PNGs (aktuell 38 committiert;
  Boden bei Bestandszuwachs anheben)
- **Floor:** mindestens `MIN_DOCS` (8) Markdown-Dokumente (nach Ausschlussregeln)
- **Floor:** mindestens `MIN_STORE_FIELDS` (25) Store-Textfelder — der Boden
  liegt bewusst ueber "alles minus die kleinste Locale", sonst koennte ein
  ganzes Store-Listing verschwinden, ohne dass der Build es merkt
- **Floor:** mindestens `MIN_ASSETS` (20) PNGs unter Assets
- **Floor:** mindestens `MIN_CONTENT_LOCALES` (4) Sprachdateien unter
  `scripts/handbook/content/` (de/en/fr/it; Unterschreiten ist immer ein Fehler,
  Überschreiten nie)
- **PNG-Integrität:** Magic-Bytes `\x89PNG…`; Screenshots > 1000 Bytes,
  App-Assets > 100 Bytes (kleine 1×-Icons wie `telegram.png`/`twitter.png`
  sind im Repo unter 1000 Bytes und trotzdem gültige PNGs)
- **HTML-Integrität:** jedes Artefakt im Manifest muss im Ausgabeverzeichnis
  liegen; zusätzlich muss jedes lokale `src`/`href` in den gerenderten
  Markdown-Seiten auflösen
- **Ausgabepfad-Kollision:** beanspruchen zwei Quellen denselben `outputPath`
  (z. B. `README.md` und `docs/README.md` → `docs/README.html`), bricht der
  Build ab und nennt beide Quellpfade — stilles Überschreiben ist verboten
- **Anker-Kollision:** zwei Screenshots/Gruppen mit derselben Permalink-Id
  (verlustbehaftetes `slugify`) → Build-Fehler mit beiden Quellen (#217)
- **Kapitel-Doppelzuordnung:** ein Screenshot in zwei Kapiteln → Build-Fehler
  mit beiden Kapitel-Ids
- **Leeres Ausgabeverzeichnis:** jeder Lauf leert das Zielverzeichnis zuerst.
  Das Ziel muss **ausserhalb** des Repository-Baums liegen — jede Datei im Repo
  ist potenzielle Quelle (`listMarkdownFiles` scannt ab Repo-Root). Zusätzlich
  greifen sprechende Wächter für Repo-Root/Vorfahren, bekannte Discovery-
  Wurzeln, `.git`, `/` und Home — case-insensitiv verglichen (macOS/Windows),
  damit ein Pfad in anderer Groß-/Kleinschreibung keinen dieser Wächter
  umgeht. Falsche Argumente (z. B. ein Unterverzeichnis unter
  `docs/handbook/screenshots/` oder `scripts/handbook`) werden abgelehnt,
  bevor etwas gelöscht wird. CI und Docker schreiben nach `/out` bzw. unter
  `/tmp/…`.

Überschreitung der Mindestzahl ist **kein** Fehler — neue Dateien landen
automatisch.

### Inhaltsdateien und Kapitel

`scripts/handbook/content/<locale>.json` steuert pro Sprache Titel, Lede,
UI-Strings und die **Kapitel** (Aufgaben). Jede `*.json` im Ordner ist eine
Sprache (Discovery). Fehlt der Ordner, eine Datei ist ungültig, oder es fehlen
Pflichtfelder (`locale`, `chapters`), bricht der Build ab — es gibt keinen
stillen Fallback mehr.

Ein Kapitel listet `groups` (Verzeichnisnamen unter Screenshots) und/oder
`images` (`<gruppe>/<stem>`). Reihenfolge der Kapitel und der Bilder darin
bestimmt die Seitenreihenfolge. Ein Bild in **keinem** Kapitel erscheint unter
`ui.moreScreens` („Weitere Screens“) und erzeugt **eine Warnung** auf stderr.
Ein Bild in **zwei** Kapiteln bricht den Build ab.

### Design Pod

`scripts/handbook/pod/` ist eine **Kopie** des DFX Design Pod (siehe
`scripts/handbook/pod/README.md`). Der Build liest `tokens.css` **wörtlich**
in jede Seite, kopiert die woff2 nach `assets/fonts/`, bindet sie per
`@font-face` ein und bettet `logo-dark.svg` / `logo-white.svg` als Inline-SVG
ein (kein getippter Wortmarken-Text „DFX“ in der Kopfzeile). Theme-Klassen:
`theme-light` / `theme-dark` auf `<html>`; der Umschalter setzt die Klasse und
`localStorage`.

### Sprachen

`index.html` = Deutsch. Weitere Locales unter `<locale>/index.html`. Screenshots,
Assets, Fonts, Docs und `handbook.js` liegen einmal in der Wurzel; Unterseiten
rechnen relative Pfade aus der Verzeichnistiefe. Jede Seite hat
`rel="alternate" hreflang="…"` inkl. `x-default`. Die Sprachauswahl sind reine
Links (kein JS).

### Kunden- vs. Entwicklerbereich

Oben: Kapitel aus `content`. Unten, standardmäßig zugeklappt: Store-Listing,
App-Assets und Dokumentation (`ui.developerSection`).

### HTML-Sanitizer (Markdown-Body)

`marked` sanitisiert nicht. Vor dem Ausliefern entfernt der Build aktive
Vektoren im gerenderten Body (CSP in nginx ist die zweite Schicht):

- Blöcke: `script`, `iframe`, `object`, `embed`, `meta`, `form`, `base`, `link`
- Event-Handler `on*` — auch mit `/` als Attribut-Trenner und unzitierten Werten
  (z. B. `<img/onerror=…>`)
- Gefährliche Schemes in `href`/`src` (`javascript:`, `vbscript:`, nicht-Bild-
  `data:`) — zitiert und unzitiert
- `script`/`iframe`/`object`/`form`-Blöcke: ein gemeinsamer Stack prüft die
  Reihenfolge über alle vier Tag-Typen hinweg, nicht nur die Gesamtzahl je Typ
  — **Build bricht ab**, sobald ein Schließer ohne passenden Öffner auftaucht,
  ein Tag am Dokumentende offen bleibt, oder sich zwei verschiedene Tag-Typen
  überlappen statt sauber zu verschachteln (kein stilles Löschen bis zum
  nächsten Schließer irgendwo im Dokument)
- Selbstschließende Tags (`<script/>`) erkennt der Guard und der Entferner
  über **dieselbe** Prüfung, damit beide Seiten nie auseinanderlaufen

Die nginx-CSP setzt zusätzlich `form-action 'none'` (und `base-uri 'none'`,
`object-src 'none'`).

### Nicht auflösende Markdown-Links und Remote-Bilder

Die Repo-Markdown-Dateien verlinken teilweise auf Pfade, die nicht ins Handbook
kopiert werden (z. B. `scripts/…`, Plattformcode, GitHub-Relative). Solche
lokalen Links werden beim Rendern **nicht** still gelöscht und die Prüfung
wird **nicht** abgeschaltet: der Link wird in reinen Text umgewandelt
(Beschriftung bleibt, `href` entfällt), und jeder Fund wird einmal auf stderr
protokolliert. Relative Links auf andere entdeckte `*.md`-Dokumente werden auf
die gerenderte HTML-Seite umgeschrieben.

Externe **Bilder** (`<img src="https://…">` bzw. protokollrelativ `//…`)
werden ebenfalls nicht ausgeliefert: Die CSP erlaubt nur `img-src 'self' data:`.
Beim Rendern ersetzt das Build-Script solche Tags durch ihren `alt`-Text
(escaped; ohne `alt` entfällt das Bild ohne Ersatz) und protokolliert einmal
je Vorkommen auf stderr (`handbook: replaced remote image in <seite>: <url>`).
**Links** auf fremde Seiten (`<a href="https://…">`) bleiben unangetastet.

Metadaten in `scripts/handbook/metadata.json` sind **nur Anreicherung**
(Gruppen-Titel/-beschreibung und Captions als Fallback). Caption-Vorrang:

1. `content/<locale>.json` → `captions["<gruppe>/<stem>"]`
2. `metadata.json` → `screenshots.<gruppe>.captions.<stem>`
3. Ableitung aus dem Dateinamen (`NN-` → Badge, Rest humanisiert)

Fehlende Einträge sind kein Fehler; verwaiste Metadaten erzeugen Warnungen
auf stderr.

### Layout und Bedienelemente

Kundenseiten und Doc-Seiten teilen Pod-Tokens und Theme-Klassen. Sticky
Chrome: Inline-Logo, „BTC Taro Wallet“, Sprachlinks, Suche, Theme. Kapitel
als aufklappbare Sektionen mit Kacheln (Titel, Erklärtext, Permalink, Copy).
TOC: Kapitel und Gruppen. Entwicklerbereich zugeklappt.

Ohne JavaScript: Suche, Theme und Sidebar-Knöpfe mit `hidden`; alle Inhalte
und Sprachlinks bleiben nutzbar. Alle Screenshot- und Asset-Links
funktionieren als normale Links.

## Lokal bauen

`marked` wird **isoliert** installiert — nicht in `package.json` / Lockfile
des Repos:

```bash
npm install --prefix ./_handbook-deps --no-save --no-audit --no-fund marked@15.0.7
NODE_PATH=./_handbook-deps/node_modules node scripts/handbook/build.js /tmp/handbook-out
```

Anschliessend `/tmp/handbook-out/index.html` im Browser öffnen. Das
Ausgabeverzeichnis muss **ausserhalb** des Repos liegen (Löschschutz).

Das Scratch-Verzeichnis `_handbook-deps/` ist gitignored.

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
`handbook-check` vergleicht deshalb den gesamten Payload eines Host-Builds mit
dem des Images per SHA-256 und macht den Job bei jeder Abweichung rot. Beide
Builds bekommen dasselbe `GIT_SHA` — der einzige nicht-deterministische Input —,
die Bäume müssen also byte-identisch sein. Ein Zähl-Vergleich reichte dafür
nicht: eine Umbenennung oder ein Austausch innerhalb derselben Kategorie lässt
jede Zahl gleich.

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
   deutschen Titel/Beschreibung für den Gruppenschlüssel und unter
   `captions` lesbare Bildunterschriften pro Dateiname (ohne `.png`) ergänzen.
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
nicht-Draft-PR: Image-Build ohne Push, byte-identischer Payload-Vergleich
Host gegen Image, Content-Gate über alle veröffentlichten PNGs (QR plus
BIP39-OCR gegen Klartext-Seedphrasen), Container-Smoke (`/healthz` und `/`
jeweils **200 unauthentifiziert**, `/50x.html` **404**) und eine Stichprobe aus
`manifest.json` je Kategorie.

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
abgleicht (Soll: 38 Treffer, 0 verwaist, 0 ohne Flow). Wer den Satz erweitert,
haelt diese Zuordnung mit; sonst ist die Wiederholbarkeit nur behauptet.

`_setup.yaml` ist der gemeinsame Vorlauf fuer die meisten Flows: frischer
App-Start, Wallet anlegen und den Mitteilungs-Dialog einmal abraeumen. Die
Wallet-Anlage fuehrt direkt auf die Uebersicht — die Lightning-Wallet ist opt-in
und wird ueber „Hinzufuegen" in der Lightning-Zeile angelegt. Den Einstieg
zeigt `06b-wallet-lightning.yaml`, das Ergebnis `08b-lightning-spark.yaml`.
Zwei Flows starten selbst mit `launchApp: clearState` und ohne `_setup.yaml`:
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
# beim ersten Anlauf zwei Signaturen und zwei erweiterte Public Keys durchgelassen.
# Das Gate leitet den Satz aus dem gebauten Handbook ab, deckt also auch die
# Bilder aus img/dfx/ ab und prueft zusaetzlich per OCR auf Klartext-Seedphrasen.
NODE_PATH=./_handbook-deps/node_modules node scripts/handbook/build.js /tmp/handbook-out
NODE_PATH=./_handbook-deps/node_modules node scripts/handbook/content-gate.js /tmp/handbook-out
```

Voraussetzung: `zbarimg` (zbar-tools) und `tesseract` auf dem PATH sowie
`marked` und `bip39` unter `_handbook-deps/` — beide in EINEM `npm install`,
sonst raeumt der zweite Aufruf den ersten weg.

Erlaubt sind genau zwei Treffer: die On-Chain-Empfangsadresse in
`04-empfangen-senden/01-erhalten.png` und die Lightning-Rechnung in
`08-lightning/03-rechnung-erstellen.png`. Jeder weitere Treffer ist ein Fund.

Zusaetzlich geschwaerzt, weil sie Anmeldematerial bzw. dauerhaft gueltige
Schluessel zeigen: das Feld „DFX-Adressen-Besitznachweis" in
`03-einstellungen/03-wallet-einstellungen.png` (eine
Signatur ueber eine **statische Nachricht ohne Nonce**, siehe
`api/dfx/hooks/auth.hook.ts` — laeuft nie ab), der Account-`zpub` in
`02-wallet/07-xpub.png` und der Cosigner-QR in
`07-multi-device/01-erstellung-qr.png`.

Zwei der drei Klassen prueft `content-gate.js` inzwischen automatisch mit:
erweiterte Schluessel (`xpub`/`zpub`/`xprv` und Verwandte) fuehren zum Abbruch,
ebenso eine Folge von `SEED_RUN_LIMIT` (derzeit fuenf) aufeinanderfolgenden
BIP39-Woertern. Der aktuelle Satz kommt auf hoechstens drei; die
ungeschwaerzten Originale hatten zwoelf.

**Signatur bleibt Handarbeit** — dafuer hat das Gate
keine Regel, und es kann auch keine haben: sie ist fuer sich genommen
unauffaelliger Text. Beim Neuaufnehmen dieses Screens also weiter selbst
schwaerzen.

## Abdeckung — was fehlt und warum

Das Issue verlangt „jeden Screen, in jeder Variante, in jedem Szenario". Dieser
Stand erfuellt das **nicht**. Die Zahlen, damit die Luecke nachpruefbar ist statt
ungefaehr: `navigation/` registriert **109** Routen, davon 17 reine
Stack-Wrapper (Endung `Root`), bleiben **92 echte Screens**. Die **38**
committeten PNGs bilden davon **32 verschiedene Screens** ab — fünf Screens
sind mehrfach abgebildet, weil sie in mehreren Varianten vorkommen:
`WalletTransactions` (3 Bilder), `ReceiveDetails`,
`WalletAsset`, `WalletDetails` und `Tools` (je 2). **60 Screens fehlen ganz.**

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

