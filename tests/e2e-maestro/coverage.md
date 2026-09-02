# Abdeckungsnachweis

Die hier beschriebenen Fassungen aller 13 Flows - einschliesslich der
modusspezifisch verschaerften P11/P12 - wurden als vollstaendige Serie gegen eine
lokale API auf Stand DFXswiss/backend#5179 und eine lokale Services-Instanz mit
einem `DFX_ENV=loc`-Build gemessen:
`Flows: 13, passed: 13, assertion failures: 0, aborted: 0` und
`Suite outcome: passed`, jeder Flow einzeln `passed`. Die API-Anmeldung ist mit mehrfach
`POST /v1/auth/ 201` in den Logs belegt. Gegen Produktion bleiben P11/P12 rot,
weil dieselbe Anmeldung dort `400 Invalid signature` liefert.

Die Hierarchie zeigte im selben Stack fuer P11 die Kaufmaske mit `Kaufen` und
`Formular`, fuer P12 die Verkaufsmaske mit
`Deine IBAN hinzufügen oder auswählen`. P11 und P12 assertieren diese
disjunkten Modusmarker zusaetzlich zum gemeinsamen DFX-Seitentitel; in dieser
Fassung sind sie Teil des oben genannten Serienlaufs.

Der reproduzierbare App-Build verwendet
`REACT_APP_API_URL=http://127.0.0.1:3000/v1`,
`REACT_APP_SRV_URL=http://127.0.0.1:3001` und `DFX_ENV=loc`.

Vor der Runner-Haertung waren drei Serienlaeufe ohne `FAILED`-Assertionen im
Vorlauf zusammengebrochen; im dritten war der Simulator danach nicht mehr
gebootet und es lagen 428 Simulator-Prozesse vor. Der neue gruene Serienlauf
belegt nun auch die Serienfestigkeit unter den Bedingungen dieses lokalen
Laufs.

Die Dauern des aktuellen Gesamtlaufs wurden nicht uebermittelt. Deshalb werden
keine alten Dauern als Werte dieses Laufs ausgegeben. Die bei P1, P2, P4, P5,
P7 und P13 genannten Zeiten stammen aus zuvor dokumentierten Laeufen.

P8–P10 pruefen ueber das registrierte Schema `dfxtaro:lightning:` die Verarbeitung
des Inhalts, den ein QR-Scan an `DeeplinkSchemaMatch.navigationRouteFor` uebergibt.
Die Kamera und die optische QR-Erkennung selbst sind im Simulator nicht geprueft.

| Pfad | Flow | Zustandspruefung | Gemessener Laufstand | Grenze / ungeprueft |
|---|---|---|---|---|
| P1 Onboarding bis On-Chain-Wallet | `flows/01-onboarding-onchain-wallet.yaml` | `Wallet Backup`, `On-Chain-Wallet` und `Lightning-Wallet` sichtbar | **gruen**, 25 s — 2026-08-31, `9cde627127` | Endet in der Wallet-Liste. Keine Persistenzpruefung nach Neustart. |
| P2 Spark-Wallet anlegen | `flows/02-create-spark-wallet.yaml` | Vollstaendige Wallet-Zeile `Bitcoin, Lightning (Spark), 0 sats, …` sichtbar; alte Hinzufuegen-Zeile nicht sichtbar | **gruen**, 25 s — 2026-08-31, `9cde627127` | Endet nach der Spark-Anlage. Die dialogfeste Positiv-Assertion ist im gemessenen Lauf gruen. |
| P3 Lightning-Adresse registriert | `flows/03-spark-lightning-address.yaml` | Adresse `…@breez.tips` sichtbar; Meldung fuer fehlende Adresse nicht sichtbar | **gruen mit aktueller enger Assertion**, einzeln und im Serienlauf; Dauer nicht uebermittelt | Das konkrete Konto ist dynamisch. Die Registrierung wird ueber ihr UI-Ergebnis beobachtet. |
| P4 Spark-Wallet-Details aus Einstellungen | `flows/04-spark-wallet-details.yaml` | `Typ` und `Breez Spark` sichtbar | **gruen**, 29 s — 2026-08-31, `9cde627127`; `Breez Spark` war sichtbar | Endet im Wallet-Detail-Screen. |
| P5 Invoice mit Betrag und Beschreibung | `flows/05-receive-invoice-amount-description.yaml` | BOLT11-Payload mit dem betragstragenden `lnbc10u1` (1000 Sat im Human Readable Part), `1000` und `Maestro-E2E` sichtbar; Tastatur nicht sichtbar; kein Adressfehler | **gruen**, 41 s — 2026-08-31, `9cde627127` | Der Tap auf `sats` schloss den Ziffernblock erfolgreich. QR-Pixel werden mangels semantischem Selektor nicht dekodiert. |
| P6 Empfang ohne Betrag | `flows/06-receive-lightning-address.yaml` | Adresse `…@breez.tips` sichtbar, kein BOLT11 und kein Adressfehler | **gruen mit aktueller enger Assertion**, einzeln und im Serienlauf; Dauer nicht uebermittelt | Die Adresse ist zugleich Quelle des gerenderten QR; die QR-Pixel werden nicht dekodiert. |
| P7 Spark-On-Chain-Empfang (#261) | `flows/07-receive-spark-onchain-address.yaml` | `bc1`-Adresse und Bestaetigungshinweis sichtbar; kein Adressfehler | **gruen**, 32 s — 2026-08-31, `9cde627127`; die On-Chain-Deposit-Adresse erschien | QR-Pixel und die spaetere Gutschrift nach Bestaetigungen werden nicht geprueft. |
| P8 BOLT11 senden | `flows/08-send-bolt11-to-confirmation.yaml` | `dfxtaro:lightning:` erreicht fuer den abgelaufenen BOLT11 `250000`, Empfaenger, `Abgelaufen` und danach `Rechnung verfallen` | **gruen**, 2026-08-31, `9cde627127`; Dauer im uebermittelten Gesamtlauf nicht enthalten | Der `openLink`-Pfad und alle genannten Zielassertions wurden erreicht. Eine Zahlung wird mit dem absichtlich abgelaufenen Vektor nicht ausgefuehrt. |
| P9 LNURL-Pay | `flows/09-send-lnurl-pay.yaml` | Die letzten 18 Zeichen der in diesem Lauf erzeugten LNURL (der Prefix `lnurl1dp68gurn8ghj` traegt jede https-LNURL und unterscheidet nichts), dazu `Lightning (Spark)`, `Senden`, `Gebühr`, `MAX`, `Note` und `Weiter` gemeinsam sichtbar | **gruen im Einzellauf und im aktuellen Serienlauf**; Dauer und Datum nicht uebermittelt | Der Flow endet in der Betragseingabe des LNURL-Pay-Screens; die Zahlung selbst wird nicht ausgefuehrt. |
| P10 LNURL-Auth | `flows/10-lnurl-auth.yaml` | `dfxtaro:lightning:` erreicht Domain, Authentifizierungsfrage und definierte Spark-Ablehnung | **gruen**, 2026-08-31, `9cde627127`; Dauer im uebermittelten Gesamtlauf nicht enthalten | Der `openLink`-Pfad, der Authentifizierungs-Prompt und die definierte Spark-Ablehnung wurden erreicht. Erfolgreiche Authentifizierung bleibt ungeprueft. |
| P11 DFX Kaufen / Kaufmaske | `flows/11-dfx-buy-transition.yaml` | Exakter DFX-Seitentitel, `Kaufen` und `Formular` sichtbar; Login und `Invalid signature` nicht sichtbar | **Gruen im Serienlauf gegen den lokalen Stack** | Belegt die erreichte Kaufmaske im lokalen Stack. Eingabe und Kaufabschluss bleiben ungeprueft. Gegen Produktion bleibt der Login-Schritt beziehungsweise `400 Invalid signature`. |
| P12 DFX Verkaufen / Verkaufsmaske | `flows/12-dfx-sell-transition.yaml` | Exakter DFX-Seitentitel und `Deine IBAN hinzufügen oder auswählen` sichtbar; Login und `Invalid signature` nicht sichtbar | **Gruen im Serienlauf gegen den lokalen Stack** | Belegt die erreichte Verkaufsmaske im lokalen Stack. IBAN-Auswahl und Verkaufsabschluss bleiben ungeprueft. Gegen Produktion bleibt der Login-Schritt beziehungsweise `400 Invalid signature`. |
| P13 Lightning-Eintrag in Einstellungen | `flows/13-settings-lightning-entry.yaml` | Zielscreen zeigt `Typ` und `Breez Spark` (`Typ` ist spark-spezifisch, der frueher gepruefte generische Header `Wallet` war es nicht) | **gruen**, 32 s — 2026-08-31, `9cde627127` | Endet im zugeordneten Wallet-Detail-Screen. |

## DFX-Vergleichsmessungen fuer P11/P12

- Mit der Spark-Wallet als aktiver Wallet endet KAUFEN in
  `Something went wrong` / `Invalid signature`.
- Mit der On-Chain-Wallet oeffnet derselbe Tap die DFX-Oberflaeche korrekt;
  `Kaufen`, eine `bc1q…`-Adresse und `KYC VERVOLLSTÄNDIGEN` sind sichtbar.
- Auf dem Eltern-Commit `c9a67d9d8d` tritt der Spark-Fehler ebenfalls auf. Der
  letzte Commit von Head `9cde627127` ist damit nicht seine Ursache.
- Gegen eine lokal betriebene API auf Stand DFXswiss/backend#5179, eine lokale
  Services-Instanz und mit `DFX_ENV=loc` gebaute App gelingt die
  Wallet-Anmeldung; die API-Logs
  enthalten mehrfach `POST /v1/auth/ 201`. Im mitgeschnittenen Verkehr meldet
  sich die Spark-Wallet mit ihrer LNURL-Adresse
  (`LNURL1DP68GURN8GHJ7CNJV4JH5…`) neben der On-Chain-Adresse an.
- Mit lokaler API und lokaler Services-Instanz wird die Session durchgereicht.
  P11 erreicht die Kaufmaske mit `Kaufen`, `Formular`, `Du zahlst` und
  `Du erhältst ungefähr`. P12 erreicht die Verkaufsmaske mit
  `Deine IBAN hinzufügen oder auswählen`, `Du zahlst` und
  `Du erhältst ungefähr`.
- Gegen Produktion bleibt die Seite dagegen bei `Login bei DFX Services`; die
  Formulare werden dort nicht erreicht. Die Spark-Anmeldung endet weiterhin
  mit `400 Invalid signature`, solange backend#5179 nicht ausgeliefert ist.
- Die frueheren Regexe `.*(Kaufen|Buy).*` und `.*(Verkaufen|Sell).*` trafen
  beide den Seitentitel `Buy & Sell directly into your wallet`. Die alten
  gruenen P11/P12-Ergebnisse waren damit vakuum-wahr. Nach dem Spark-Dialogtitel
  `Lightning (Spark)` und der Adresse `.*@.*` ist dies der dritte dokumentierte
  Fall derselben Fehlerklasse in dieser Suite.
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
