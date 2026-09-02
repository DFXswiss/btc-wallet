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

## Lokaler DFX-Stack fuer P11/P12

Die unterscheidbaren Kauf- und Verkaufsmasken setzen einen vollstaendigen
lokalen Stack voraus. Der App-Build verwendet:

```text
REACT_APP_API_URL=http://127.0.0.1:3000/v1
REACT_APP_SRV_URL=http://127.0.0.1:3001
DFX_ENV=loc
```

Die Backend-Umgebung muss `FAUCET_LOW_BALANCE_THRESHOLD` setzen; der aktuelle
Backend-Stand verlangt die Variable beim Boot, waehrend die Harness in
DFXswiss/services sie nicht setzt. Fuer den Frontend-Build muessen Docker mehr
als 8 GB Speicher zur Verfuegung stehen, andernfalls kann der Build mit
`cannot allocate memory` abbrechen.

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
einen eigenen `maestro test`. Zwischen zwei Flows wartet er 12 Sekunden, damit
die wiederholten Simulator-Resets die CoreSimulator-Dienste nicht ueberlasten.
Vor und nach jedem Reset prueft `simctl bootstatus -b`, ob das Geraet gebootet
und bereit ist, und bootet einen abgestuerzten Simulator wieder; diese beiden
Schutzschritte duerfen wegen der reproduzierten Serienabstuerze nicht entfernt
werden.

Nach Fehlern faehrt der Runner mit den restlichen Flows fort. Ein
fehlgeschlagener Reset oder Bereitschaftscheck wird als Flow-Exit 125 und
`run-aborted` aufgezeichnet. Fuer jeden Flow enthaelt
`tests/e2e-maestro/last-run.json` Name, Exit-Code, Dauer und eines der Ergebnisse
`passed`, `assertion-failed` oder `run-aborted`. Die Unterscheidung der
beiden Fehlerarten liest das Flow-Log und ist damit eine Heuristik: Sie ordnet
den Fehler ein, entscheidet aber nicht ueber Erfolg. Beide Arten zaehlen als
Fehlschlag und setzen den Suite-Exit auf 1, eine Fehlklassifikation kann einen
roten Lauf also nicht gruen machen. Das Manifest und die
Schlusszeile zaehlen erfolgreiche Flows, fehlgeschlagene Assertions und
abgebrochene Laeufe getrennt. Sind alle Fehlschlaege Abbrueche, lautet das
Suite-Ergebnis ausdruecklich `environment-error`; Assertions und Abbrueche
zusammen ergeben `mixed-failure`. Der Runner endet mit Exit 1, sobald ein Flow
nicht erfolgreich war, und mit Exit 2 bei einem Konfigurationsfehler oder
leerem Filter.

## Bewusste Grenzen

- P8–P10 senden kein Geld. P8 prueft mit einem reproduzierbaren, abgelaufenen
  BOLT11-Vektor Parsing, Betrag, die Darstellung der Rechnung selbst
  (`lnbc2500u`) und den erwarteten Ablauf-Fehler. P9 erfasst die in demselben Flow erzeugte Lightning-Adresse,
  kodiert ihr LNURL-Pay-Ziel und endet bei der Betragseingabe. P10 prueft
  den Authentifizierungs-Prompt und die fuer Spark erwartete Ablehnung. Alle
  drei uebergeben den QR-Inhalt per `openLink` an den registrierten Deeplink;
  Kamera und optische QR-Erkennung werden im Simulator nicht getestet.
- Der Sendepfad wurde zusaetzlich manuell auf einem physischen iPhone mit
  iOS 26.6.1 und echtem Breez-Key belegt: Eine gescannte 10-sats-Rechnung wurde
  bezahlt; die Empfaenger-Wallet zeigte `10`, `sats`, `Erhalten` und
  `Geraetetest`. Die
  [Maestro-Dokumentation](https://docs.maestro.dev/platform-support/ios-uikit)
  schliesst Testausfuehrungen auf physischen iOS-Geraeten aus; diese Messung ist
  daher kein automatisiertes Suite-Ergebnis.
- Die DFX-Weboberflaeche und ihre API sind nicht Teil dieses Repositories. P11
  und P12 pruefen mit disjunkten Markern die erreichte Kauf- beziehungsweise
  Verkaufsmaske; der exakte DFX-Seitentitel belegt zusaetzlich den externen
  Uebergang. Produktion
  antwortet bei der Spark-Anmeldung mit `400 Invalid signature`. Mit
  `DFX_ENV=loc` gelingt die Anmeldung gegen eine lokale API auf Stand
  DFXswiss/backend#5179 (`POST /v1/auth/ 201`) und einer lokalen
  Services-Instanz wird die Session durchgereicht: P11 erreicht `Kaufen` und
  `Formular`, P12 `Deine IBAN hinzufügen oder auswählen`. Eingaben und
  Abschluesse werden nicht geprueft. Gegen Produktion bleibt die Seite im
  Schritt `Login bei DFX Services`, und die Spark-Anmeldung scheitert bis zur
  Auslieferung von #5179 weiterhin mit `400 Invalid signature`.
  Ein `DFX_ENV=prd`-Build scheitert gegen diese lokale API schon bei der
  On-Chain-Anmeldung, weil die Nicht-Produktions-API der signierten Nachricht
  ein `[env]_` voranstellt. Dann erhalten nicht alle Wallets einen Token und
  `session.context.tsx` blendet den gesamten Block `Externe Services` aus.
  Die lokale Datenbank besitzt 233 Assets, einschliesslich der kauf- und
  verkaufbaren Assets `BTC/Lightning` (id 236) und `BTC/Bitcoin` (id 113); der
  fruehere Seed-Verdacht ist widerlegt. Ein Kontrolllauf gegen `develop` ohne
  #5179 fehlt weiterhin. Produktion bleibt bis zur Auslieferung von #5179 rot.
  Bankauszahlung, Kaufabschluss, Swap-Abschluss und der Deep-Link mit einer echten
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

Die Fassungen dieses Stands - einschliesslich der modusspezifisch
verschaerften P11/P12 - wurden als vollstaendige Serie gegen die lokale API auf
Stand DFXswiss/backend#5179 und die lokale Services-Instanz mit `DFX_ENV=loc`
gemessen: `Flows: 13, passed: 13, assertion failures: 0, aborted: 0` und
`Suite outcome: passed`, jeder Flow einzeln `passed`. P11 erreicht dabei die
Kaufmaske, P12 die Verkaufsmaske mit der IBAN-Zeile. Gegen
Produktion bleiben P11/P12 wegen `400 Invalid signature` rot. Der Kontrolllauf
gegen einen Serverstand ohne #5179 fehlt weiterhin. Details und Grenzen stehen
in `coverage.md`.

Die genaue Zuordnung von Pfad, Flow und Assertion steht in `coverage.md`.
