# Spark-Wallet-E2E mit Maestro

Diese Suite faehrt die 13 in `coverage.md` aufgefuehrten Nutzerpfade einzeln
auf einem iOS-Simulator. Jeder Flow startet die App mit geleertem Zustand,
durchlaeuft das Onboarding selbst und prueft mindestens einen sichtbaren
Zustand. Ein vorheriger Flow liefert keinen Zustand fuer den naechsten.

## Voraussetzungen

- Ein gebooteter iOS-Simulator, auf dem die zu pruefende App mit der App-ID
  `swiss.dfx.bitcoin` laufen kann, sowie der Pfad zum bereits gebauten
  `.app`-Bundle. Der Runner baut die App nicht.
- Die App muss deutsch darstellen. Die Selektoren entsprechen der Sprache des
  vorhandenen Simulator-Builds und der bereits gefahrenen Handbuch-Flows.
- Maestro muss als `maestro` auf `PATH` liegen.
- Homebrew OpenJDK muss unter
  `/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home` installiert
  sein. Der Runner setzt `JAVA_HOME` und erweitert `PATH`; fehlt Java, bricht er
  mit Exit 2 ab.
- Netzwerkzugriff auf Spark/Breez und die DFX-API. P9 verwendet die vom frisch
  erzeugten Spark-Wallet registrierte `@breez.tips`-Adresse statt eines
  fremden LNURL-Testdienstes. P11/P12 brauchen einen erreichbaren DFX-Webflow.
- Der angegebene Simulator darf keinen schutzwuerdigen Wallet-Zustand
  enthalten. Vor jedem Flow terminiert und deinstalliert der Runner die App,
  setzt die Simulator-Keychain zurueck und installiert das angegebene Bundle
  neu. Zusaetzlich verwendet jeder Flow `clearState: true`.

## Ausfuehren

Alle Flows auf einem bestimmten gebooteten Simulator:

```sh
bash scripts/e2e/run-maestro.sh \
  --device '<SIMULATOR-UDID>' \
  --app '<PATH-TO-APP-BUNDLE>'
```

Nur passende Flow-Dateien fahren; der Filter ist ein Basename-Glob:

```sh
bash scripts/e2e/run-maestro.sh \
  --device '<SIMULATOR-UDID>' \
  --app '<PATH-TO-APP-BUNDLE>' \
  --flow '05-*'
```

Die Werte werden auch positional als `UDID APP_BUNDLE [FLOW_GLOB]` akzeptiert.
UDID und App-Pfad sind Pflicht; ohne sie bricht der Runner ab, weil der
Frischzustand sonst nicht garantiert werden kann. Der Runner setzt den
Simulator vor jedem Treffer zurueck, installiert das Bundle und startet danach
einen eigenen `maestro test`. Nach Fehlern faehrt er mit den restlichen Flows
fort. Ein fehlgeschlagener Reset wird als Flow-Exit 125 aufgezeichnet. Danach
schreibt er `tests/e2e-maestro/last-run.json` mit Name, Exit-Code und Dauer jedes
Flows. Er endet mit Exit 1, wenn mindestens ein Flow fehlgeschlagen ist, und
mit Exit 2 bei einem Konfigurationsfehler oder leerem Filter.

## Bewusste Grenzen

- P8–P10 senden kein Geld. P8 prueft mit einem reproduzierbaren, abgelaufenen
  BOLT11-Vektor Parsing, Betrag, Empfaengerdarstellung und den erwarteten
  Ablauf-Fehler. P9 kopiert die in demselben Flow erzeugte Lightning-Adresse,
  fuegt sie als LNURL-Pay-Ziel ein und endet bei der Betragseingabe. P10 prueft
  den Authentifizierungs-Prompt und die fuer Spark erwartete Ablehnung.
- Die DFX-Weboberflaeche und ihre API sind nicht Teil dieses Repositories. P11
  und P12 pruefen positiv die sichtbare Kaufen- beziehungsweise
  Verkaufen-Oberflaeche. Im Lauf vom 2026-08-31 erreichten beide stattdessen
  `Something went wrong` / `Invalid signature` und bleiben deshalb rot.
  Bankauszahlung, Kauf, Swap-Abschluss und der Deep-Link mit einer echten
  DFX-Route bleiben ausserhalb der Suite.
- Die QR-Komponente besitzt weder `testID` noch `accessibilityLabel`. Deshalb
  pruefen P5–P7 den sichtbaren Payload, der im gleichen Render-Zweig wie der QR
  liegt, nicht die Pixel oder deren Dekodierbarkeit.
- Persistenz ueber App-Neustarts, Keychain-Entitlements, NFC, Kamera-QR-Reads,
  Hardware-Wallets, Multi-Device und erfolgreiche Zahlungen mit Guthaben
  gehoeren nicht zu diesen 13 Pfaden.
- Dynamische Spark- und DFX-Antworten koennen die Suite rot machen. Das
  ist beabsichtigt; der Runner behandelt fehlende externe Voraussetzungen nicht
  als Erfolg.

## Letzter gemessener Stand

Der Lauf vom 2026-08-31 gegen Head `9cde627127` war mit 8 von 13 Flows gruen.
P8–P10 scheiterten, weil der alte Koordinaten-Tap das manuelle Textfeld nicht
fokussierte. Die danach eingebaute relative Adressierung unter
`Textadresse oder Rechnung`, die Aktivierungs- und Eingabeassertionen sowie das neue
app-eigene Ziel von P9 sind noch nicht ausgefuehrt. P11/P12 bleiben wegen des
gemessenen Spark-Fehlers `Invalid signature` bewusst rot auf dem korrekten
Zielzustand. Details und Vergleichsmessungen stehen in `coverage.md`.

Die genaue Zuordnung von Pfad, Flow und Assertion steht in `coverage.md`.
