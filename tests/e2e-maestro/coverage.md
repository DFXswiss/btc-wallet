# Abdeckungsnachweis

Die Suite wurde am 2026-08-31 auf einem iPhone-17-Simulator gegen den
ad-hoc-signierten Release-Build von Head `9cde627127` mit echtem Breez-Key und
Frischinstallation vor jedem Flow ausgefuehrt: 10 von 13 Flows waren gruen.
P1–P8, P10 und P13 waren gruen; P9, P11 und P12 waren rot. P9 endete bei
`Assert that "Betrag eingeben" is visible`, obwohl der Hierarchie-Dump den
LNURL-Pay-Screen bereits zeigte. Die neue Zustandsassertion ist noch ungefahren.
P11/P12 waren in diesem Produktionslauf rot, wurden danach aber einzeln gegen
eine lokale API auf Stand DFXswiss/backend#5179 mit `DFX_ENV=loc` gruen gefahren.

Der uebermittelte Gesamtlauf enthaelt keine Dauern. Die lokale `last-run.json`
wurde danach durch einen gefilterten P11/P12-Lauf ueberschrieben. Deshalb werden
fuer P8–P10 keine alten Dauern als Werte des neuen Laufs ausgegeben. Die bei
P1–P7 und P13 genannten Zeiten stammen aus den zuvor dokumentierten Laeufen.

P8–P10 pruefen ueber das registrierte Schema `dfxtaro:lightning:` die Verarbeitung
des Inhalts, den ein QR-Scan an `DeeplinkSchemaMatch.navigationRouteFor` uebergibt.
Die Kamera und die optische QR-Erkennung selbst sind im Simulator nicht geprueft.

| Pfad | Flow | Zustandspruefung | Gemessener Laufstand | Grenze / ungeprueft |
|---|---|---|---|---|
| P1 Onboarding bis On-Chain-Wallet | `flows/01-onboarding-onchain-wallet.yaml` | `Wallet Backup` und `On-Chain-Wallet` sichtbar | **gruen**, 25 s — 2026-08-31, `9cde627127` | Endet in der Wallet-Liste. Keine Persistenzpruefung nach Neustart. |
| P2 Spark-Wallet anlegen | `flows/02-create-spark-wallet.yaml` | Vollstaendige Wallet-Zeile `Bitcoin, Lightning (Spark), 0 sats, …` sichtbar; alte Hinzufuegen-Zeile nicht sichtbar | **gruen**, 25 s — 2026-08-31, `9cde627127` | Endet nach der Spark-Anlage. Die dialogfeste Positiv-Assertion ist im gemessenen Lauf gruen. |
| P3 Lightning-Adresse registriert | `flows/03-spark-lightning-address.yaml` | Sichtbare Zeichenfolge mit `@`; Meldung fuer fehlende Adresse nicht sichtbar | **gruen**, 30 s — 2026-08-31, `9cde627127`; eine Adresse `…@breez.tips` war sichtbar | Das konkrete Konto ist dynamisch. Die Registrierung wird ueber ihr UI-Ergebnis beobachtet. |
| P4 Spark-Wallet-Details aus Einstellungen | `flows/04-spark-wallet-details.yaml` | `Typ` und `Breez Spark` sichtbar | **gruen**, 29 s — 2026-08-31, `9cde627127`; `Breez Spark` war sichtbar | Endet im Wallet-Detail-Screen. |
| P5 Invoice mit Betrag und Beschreibung | `flows/05-receive-invoice-amount-description.yaml` | BOLT11-Payload, `1000` und `Maestro-E2E` sichtbar; Tastatur nicht sichtbar; kein Adressfehler | **gruen**, 41 s — 2026-08-31, `9cde627127` | Der Tap auf `sats` schloss den Ziffernblock erfolgreich. QR-Pixel werden mangels semantischem Selektor nicht dekodiert. |
| P6 Empfang ohne Betrag | `flows/06-receive-lightning-address.yaml` | Lightning-Adresse sichtbar, kein BOLT11 und kein Adressfehler | **gruen**, 35 s — 2026-08-31, `9cde627127` | Die Adresse ist zugleich Quelle des gerenderten QR. QR-Pixel werden nicht dekodiert. |
| P7 Spark-On-Chain-Empfang (#261) | `flows/07-receive-spark-onchain-address.yaml` | `bc1`-Adresse und Bestaetigungshinweis sichtbar; kein Adressfehler | **gruen**, 32 s — 2026-08-31, `9cde627127`; die On-Chain-Deposit-Adresse erschien | QR-Pixel und die spaetere Gutschrift nach Bestaetigungen werden nicht geprueft. |
| P8 BOLT11 senden | `flows/08-send-bolt11-to-confirmation.yaml` | `dfxtaro:lightning:` erreicht fuer den abgelaufenen BOLT11 `250000`, Empfaenger, `Abgelaufen` und danach `Rechnung verfallen` | **gruen**, 2026-08-31, `9cde627127`; Dauer im uebermittelten Gesamtlauf nicht enthalten | Der `openLink`-Pfad und alle genannten Zielassertions wurden erreicht. Eine Zahlung wird mit dem absichtlich abgelaufenen Vektor nicht ausgefuehrt. |
| P9 LNURL-Pay | `flows/09-send-lnurl-pay.yaml` | Gekuerztes Ziel `lnurl1dp68gurn8ghj…`, `Lightning (Spark)`, `Senden`, `Gebühr`, `MAX`, `Note` und `Weiter` gemeinsam sichtbar | **rot**, 2026-08-31, `9cde627127`; der alte Text `Betrag eingeben` fehlte, der Hierarchie-Dump belegte aber den erreichten LNURL-Pay-Screen | Die neue Kombination sichtbarer Zielmerkmale ist ungefahren. Der Flow endet in der Betragseingabe des LNURL-Pay-Screens; die Zahlung selbst wird nicht ausgefuehrt. |
| P10 LNURL-Auth | `flows/10-lnurl-auth.yaml` | `dfxtaro:lightning:` erreicht Domain, Authentifizierungsfrage und definierte Spark-Ablehnung | **gruen**, 2026-08-31, `9cde627127`; Dauer im uebermittelten Gesamtlauf nicht enthalten | Der `openLink`-Pfad, der Authentifizierungs-Prompt und die definierte Spark-Ablehnung wurden erreicht. Erfolgreiche Authentifizierung bleibt ungeprueft. |
| P11 DFX Kaufen / Uebergang | `flows/11-dfx-buy-transition.yaml` | Externe Zieloberflaeche zeigt positiv `Kaufen` oder `Buy` | **rot gegen Produktion**, 2026-08-31, `9cde627127`; **gruen einzeln gegen lokale API DFXswiss/backend#5179 mit `DFX_ENV=loc`** | Produktion antwortet weiter `400 Invalid signature`, bis #5179 ausgeliefert ist. Der lokale Lauf belegt den korrekten Uebergang, ist aber kein Kontrolllauf gegen `develop` ohne den Fix. |
| P12 DFX Verkaufen | `flows/12-dfx-sell-screen.yaml` | Externe Zieloberflaeche zeigt positiv `Verkaufen` oder `Sell` | **rot gegen Produktion**, 2026-08-31, `9cde627127`; **gruen einzeln gegen lokale API DFXswiss/backend#5179 mit `DFX_ENV=loc`** | Die lokale Messung erreichte die Verkaufen-Oberflaeche. Produktion bleibt bis zur Auslieferung von #5179 rot; ein Kontrolllauf gegen `develop` ohne den Fix fehlt. |
| P13 Lightning-Eintrag in Einstellungen | `flows/13-settings-lightning-entry.yaml` | Zielscreen zeigt `Wallet` und `Breez Spark` | **gruen**, 32 s — 2026-08-31, `9cde627127` | Endet im zugeordneten Wallet-Detail-Screen. |

## DFX-Vergleichsmessungen fuer P11/P12

- Mit der Spark-Wallet als aktiver Wallet endet KAUFEN in
  `Something went wrong` / `Invalid signature`.
- Mit der On-Chain-Wallet oeffnet derselbe Tap die DFX-Oberflaeche korrekt;
  `Kaufen`, eine `bc1q…`-Adresse und `KYC VERVOLLSTÄNDIGEN` sind sichtbar.
- Auf dem Eltern-Commit `c9a67d9d8d` tritt der Spark-Fehler ebenfalls auf. Der
  letzte Commit von Head `9cde627127` ist damit nicht seine Ursache.
- Gegen eine lokal betriebene API auf Stand DFXswiss/backend#5179 und mit
  `DFX_ENV=loc` gebauter App waren P11 und P12 einzeln gruen. Die API-Logs
  enthalten fuenfmal `POST /v1/auth 201`; im mitgeschnittenen Verkehr meldet
  sich die Spark-Wallet mit ihrer LNURL-Adresse
  (`LNURL1DP68GURN8GHJ7CNJV4JH5…`) neben der On-Chain-Adresse an. P12 erreichte
  die Verkaufen-Oberflaeche.
- Ein `DFX_ENV=prd`-Build ist gegen dieselbe lokale API kein valider Gegenlauf:
  Schon die On-Chain-Anmeldung scheitert. `auth.hook.ts` stellt der signierten
  Nachricht ausserhalb von `prd` ein `[env]_` voran; App und API pruefen dann
  nicht dieselbe Nachricht kryptografisch. Da `session.context.tsx`
  `isAvailable` erst setzt, wenn alle Wallets einen Token erhalten, fehlt in
  diesem Mischbetrieb der gesamte Block `Externe Services`.
- An derselben lokalen API wurde eine Signatur mit 128 Hex-Zeichen akzeptiert.
  Signaturen mit 100 und 120 Hex-Zeichen liefen in den adressabgeleiteten Pfad
  und endeten mit `400 Failed to get node public key (by invoice)`.
- Der fruehere Seed-Verdacht ist widerlegt: Die lokale Datenbank enthaelt 233
  Assets, darunter `BTC/Lightning` (id 236) und `BTC/Bitcoin` (id 113), beide
  `buyable` und `sellable`.
- Gegen Produktion bleiben P11/P12 bei `400 Invalid signature`, bis #5179 dort
  ausgeliefert ist.
- Diese Messung isoliert backend#5179 nicht als Ursache: Ein Kontrolllauf gegen
  `develop` beziehungsweise einen Stand ohne den Fix fehlt weiterhin.

## Manueller Geraetenachweis

Auf einem physischen iPhone mit iOS 26.6.1 wurde ein Release-Build dieses
Branches mit echtem Breez-Key gefahren: Spark-Wallet anlegen, QR-Code einer
Rechnung ueber 10 sats scannen und Zahlung ausfuehren. Die Empfaenger-Wallet
zeigte danach `10`, `sats`, `Erhalten` und die Beschreibung `Geraetetest`.
Damit ist der vollstaendige Spark-Sendepfad auf echter Hardware manuell belegt.
Er ist kein automatisiertes Suite-Ergebnis, weil die
[Maestro-Dokumentation](https://docs.maestro.dev/platform-support/ios-uikit)
keine Ausfuehrung auf physischen iOS-Geraeten unterstuetzt.

## Nicht semantisch adressierbare Elemente

- Die DFX-Kacheln sind Bitmaps ohne `testID` oder `accessibilityLabel` und
  werden ueber gemessene Punkte bedient.
- `QRCodeComponent` exponiert keinen Selektor fuer den QR. P5–P7 assertieren
  deshalb Payload und Zustand, nicht die QR-Pixel.
- Die Scanner-Aktionen sind unbeschriftete Icon-Buttons. P8–P10 umgehen nicht
  die Payload-Verarbeitung, sondern nur Kamera und optische Erkennung: `openLink`
  liefert denselben Inhalt an den zentralen Deeplink-Router wie der Scanner.

Diese Luecken wurden nicht durch Aenderungen am Produktionscode kaschiert.
