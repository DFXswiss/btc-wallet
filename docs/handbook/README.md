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

Bei Push auf `develop` (relevante Pfade) baut
`.github/workflows/handbook-deploy.yaml` das Image
`dfxswiss/dfx-taro-handbook:latest` (linux/arm64), pusht es und löst den
serverseitigen Deploy-Hook aus. Anschliessend Smoke gegen
`https://handbook.taro.dfx.swiss/healthz`.

Image- und Service-Name stehen laut Issue #211 noch unter Bestätigung durch
@TaprootFreak.

Basic-Auth-Zugangsdaten werden **ausschliesslich** in der Deployment-Umgebung
als `HANDBOOK_USER` / `HANDBOOK_PASSWORD` gesetzt. Weder Klartext noch Hash
gehören in dieses öffentliche Repository.

Pull Requests (nicht-Draft) laufen durch
`.github/workflows/handbook-check.yaml`: Image-Build ohne Push,
Container-Smoke (`/healthz`, Auth-Wand 401/200, Stichprobe aus
`manifest.json` je Kategorie).

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
phrase, Adressliste, Export/Backup und xPub sind im Screenshot sonst schwarz.
Der Flow `09-geschuetzte-screens.yaml` schaltet den Schutz vorher ueber das
Easter Egg in `SettingsPrivacy.js` ab (Abschnitts-Header „Allgemein" auf der
Privatsphaere-Seite zwoelfmal tippen).

Auf `02-wallet/06-export-backup.png` und `02-wallet/08-wiederherstellungsphrase.png`
sind die zwoelf Woerter und der Export-QR-Code **nachtraeglich geschwaerzt**. Die
Wallet stammt aus einem Wegwerf-Simulatorlauf und wurde nie benutzt, aber eine
lesbare Phrase gehoert nicht in ein oeffentliches Repository. Gegenprobe nach
jeder Aenderung an diesen Bildern:

```bash
zbarimg -q --raw docs/handbook/screenshots/02-wallet/06-export-backup.png   # muss leer sein
```

**Weiterhin nicht abgebildet**, weil im Simulator nicht erreichbar: alles, was
echtes Guthaben voraussetzt (Transaktionsdetails, Gebuehrenwahl, RBF/CPFP,
PSBT-Signatur), die Bezahlkarte (Boltcard braucht NFC), die Cosigner-Verwaltung
einer fertig eingerichteten Multi-Device-Wallet (drei Geraete) sowie die Kacheln
„Kaufen"/„Verkaufen", die einen externen Browser oeffnen und damit kein
App-Screen sind.
