# Abdeckungsnachweis

Die Suite wurde am 2026-08-31 auf einem iPhone-17-Simulator gegen den
ad-hoc-signierten Release-Build von Head `9cde627127` mit Frischinstallation
vor jedem Flow ausgefuehrt: 8 von 13 Flows waren gruen. Die danach geaenderte
Eingabebehandlung in P8–P10 und das neue, app-eigene LNURL-Pay-Ziel in P9 sind noch
nicht ausgefuehrt worden. P11/P12 wurden nicht geaendert und bleiben gemessen
rot auf dem korrekten Zielzustand.

React-Native-`TextInput` exponiert auf iOS keinen nutzbaren `focused`-Zustand;
P8–P10 pruefen deshalb nach der sichtbaren Eingabe, dass `Fortsetzen` aktiviert ist.

| Pfad | Flow | Zustandspruefung | Gemessener Laufstand | Erwartung nach noch ungefahrenen Aenderungen / Grenze |
|---|---|---|---|---|
| P1 Onboarding bis On-Chain-Wallet | `flows/01-onboarding-onchain-wallet.yaml` | `Wallet Backup` und `On-Chain-Wallet` sichtbar | **gruen**, 25 s — 2026-08-31, `9cde627127` | Endet in der Wallet-Liste. Keine Persistenzpruefung nach Neustart. |
| P2 Spark-Wallet anlegen | `flows/02-create-spark-wallet.yaml` | Vollstaendige Wallet-Zeile `Bitcoin, Lightning (Spark), 0 sats, …` sichtbar; alte Hinzufuegen-Zeile nicht sichtbar | **gruen**, 25 s — 2026-08-31, `9cde627127` | Endet nach der Spark-Anlage. Die dialogfeste Positiv-Assertion ist im gemessenen Lauf gruen. |
| P3 Lightning-Adresse registriert | `flows/03-spark-lightning-address.yaml` | Sichtbare Zeichenfolge mit `@`; Meldung fuer fehlende Adresse nicht sichtbar | **gruen**, 30 s — 2026-08-31, `9cde627127`; eine Adresse `…@breez.tips` war sichtbar | Das konkrete Konto ist dynamisch. Die Registrierung wird ueber ihr UI-Ergebnis beobachtet. |
| P4 Spark-Wallet-Details aus Einstellungen | `flows/04-spark-wallet-details.yaml` | `Typ` und `Breez Spark` sichtbar | **gruen**, 29 s — 2026-08-31, `9cde627127`; `Breez Spark` war sichtbar | Endet im Wallet-Detail-Screen. |
| P5 Invoice mit Betrag und Beschreibung | `flows/05-receive-invoice-amount-description.yaml` | BOLT11-Payload, `1000` und `Maestro-E2E` sichtbar; Tastatur nicht sichtbar; kein Adressfehler | **gruen**, 41 s — 2026-08-31, `9cde627127` | Der Tap auf `sats` schloss den Ziffernblock erfolgreich. QR-Pixel werden mangels semantischem Selektor nicht dekodiert. |
| P6 Empfang ohne Betrag | `flows/06-receive-lightning-address.yaml` | Lightning-Adresse sichtbar, kein BOLT11 und kein Adressfehler | **gruen**, 35 s — 2026-08-31, `9cde627127` | Die Adresse ist zugleich Quelle des gerenderten QR. QR-Pixel werden nicht dekodiert. |
| P7 Spark-On-Chain-Empfang (#261) | `flows/07-receive-spark-onchain-address.yaml` | `bc1`-Adresse und Bestaetigungshinweis sichtbar; kein Adressfehler | **gruen**, 32 s — 2026-08-31, `9cde627127`; die On-Chain-Deposit-Adresse erschien | QR-Pixel und die spaetere Gutschrift nach Bestaetigungen werden nicht geprueft. |
| P8 BOLT11 senden | `flows/08-send-bolt11-to-confirmation.yaml` | Eingegebener BOLT11-Praefix und aktiviertes `Fortsetzen`; danach `250000`, Empfaenger, `Abgelaufen` und `Rechnung verfallen` | **rot**, 64 s — 2026-08-31, `9cde627127`; der Koordinaten-Tap fokussierte das leere Feld nicht | Erwartet: relativer Tap unter `Textadresse oder Rechnung`, sichtbarer BOLT11-Praefix und aktiviertes `Fortsetzen`. Diese Aenderung ist ungefahren. Zahlung bleibt ungeprueft. |
| P9 LNURL-Pay | `flows/09-send-lnurl-pay.yaml` | App-eigene `@breez.tips`-Adresse und aktiviertes `Fortsetzen`; danach Adresse, `Betrag eingeben` und `Weiter` sichtbar | **rot**, 70 s — 2026-08-31, `9cde627127`; der Koordinaten-Tap fokussierte das Feld nicht. Zusaetzlich war `lntxbot.bigsun.xyz` nicht erreichbar (`curl` 000) | Erwartet: Die frisch registrierte Spark-Adresse wird im selben Flow kopiert und als Lightning-Address/LNURL-Pay-Ziel eingefuegt. Relativer Tap, sichtbare Eingabe, aktiviertes `Fortsetzen` und Zielscreen sind ungefahren; ein fremder Testdienst wird nicht mehr verwendet. Zahlung bleibt ungeprueft. |
| P10 LNURL-Auth | `flows/10-lnurl-auth.yaml` | Eingegebener LNURL-Praefix und aktiviertes `Fortsetzen`; danach Domain, Authentifizierungsfrage und definierte Spark-Ablehnung | **rot**, 64 s — 2026-08-31, `9cde627127`; der Koordinaten-Tap fokussierte das leere Feld nicht | Erwartet: relativer Tap, sichtbarer LNURL-Praefix und aktiviertes `Fortsetzen`. Diese Aenderung ist ungefahren. `lightninglogin.live` antwortete im Messlauf mit HTTP 200; erfolgreiche Authentifizierung bleibt ungeprueft. |
| P11 DFX Kaufen / Uebergang | `flows/11-dfx-buy-transition.yaml` | Externe Zieloberflaeche zeigt positiv `Kaufen` oder `Buy` | **rot**, 58 s — 2026-08-31, `9cde627127`; mit aktiver Spark-Wallet erschien `Something went wrong` / `Invalid signature` | Unveraendert: Der Flow prueft den korrekten Uebergang und schreibt den Fehlerdialog bewusst nicht als Soll fest. |
| P12 DFX Verkaufen | `flows/12-dfx-sell-screen.yaml` | Externe Zieloberflaeche zeigt positiv `Verkaufen` oder `Sell` | **rot**, 58 s — 2026-08-31, `9cde627127`; mit aktiver Spark-Wallet erschien `Something went wrong` / `Invalid signature` | Unveraendert: Der Flow prueft den korrekten Uebergang und schreibt den Fehlerdialog bewusst nicht als Soll fest. |
| P13 Lightning-Eintrag in Einstellungen | `flows/13-settings-lightning-entry.yaml` | Zielscreen zeigt `Wallet` und `Breez Spark` | **gruen**, 32 s — 2026-08-31, `9cde627127` | Endet im zugeordneten Wallet-Detail-Screen. |

## DFX-Vergleichsmessungen fuer P11/P12

- Mit der Spark-Wallet als aktiver Wallet endet KAUFEN in
  `Something went wrong` / `Invalid signature`.
- Mit der On-Chain-Wallet oeffnet derselbe Tap die DFX-Oberflaeche korrekt;
  `Kaufen`, eine `bc1q…`-Adresse und `KYC VERVOLLSTÄNDIGEN` sind sichtbar.
- Auf dem Eltern-Commit `c9a67d9d8d` tritt der Spark-Fehler ebenfalls auf. Der
  letzte Commit von Head `9cde627127` ist damit nicht seine Ursache.

## Nicht semantisch adressierbare Elemente

- Die DFX-Kacheln sind Bitmaps ohne `testID` oder `accessibilityLabel` und
  werden ueber gemessene Punkte bedient.
- `QRCodeComponent` exponiert keinen Selektor fuer den QR. P5–P7 assertieren
  deshalb Payload und Zustand, nicht die QR-Pixel.
- Die Scanner-Aktionen sind unbeschriftete Icon-Buttons. P8–P10 verwenden den
  gemessenen Mittelpunkt der manuellen Eingabe. Das nachfolgende leere
  TextInput wird relativ zum stabilen Label `Textadresse oder Rechnung`
  adressiert und sein Fokus vor jeder Eingabe assertiert. `Adresse eingeben`
  ist im Produktionscode der Navigationstitel und kein TextInput-Platzhalter;
  er wird deshalb nicht als Feldselektor verwendet.

Diese Luecken wurden nicht durch Aenderungen am Produktionscode kaschiert.
