---
type: Plan
title: 'Mobile-POS-Strategie — POS-Client auf iPad, iOS, Android und Sunmi mit Stripe Tap to Pay'
description: Recherche und Empfehlung, auf welchen Geräteklassen der POS-Client laufen soll und wie kartenlose Zahlung per Stripe Tap to Pay einzuordnen ist.
tags: [orders, devices, sync]
status: draft
generated: { by: claude-code/opus-5, at: 2026-05-29T00:00:00.000Z }
stale_after: 2026-11-29
---

> **Herkunft.** Entstanden am 2026-05-29 außerhalb der Repos und dort bewusst nicht
> versioniert; am 2026-08-08 ins Wiki übernommen.
>
> **Stand geprüft:** Keine Umsetzungsspur am 2026-08-08 (`grep -li "tap.to.pay|stripeTerminal"`
> → 0 Treffer). Recherchestand Mai 2026 — Preise, SDK-Verfügbarkeit und Gerätelisten sind
> zeitgebunden und vor einer Entscheidung nachzuprüfen.

# Mobile-POS-Strategie — Recherche & Empfehlung

> **Hinweis zur Ablage:** Dieses Dokument liegt bewusst **außerhalb der Git-Repositories**
> (`_WORKBENCH_PANARY/_planning/`) und wird **nicht** mit eingecheckt. Es ist ein
> Planungs-/Entscheidungsdokument. Querverweise auf `*.md` beziehen sich auf
> `panary-core/documentation/`.

ADR-Vorstufe (Recherche). Beantwortet die Frage: **Wie bringen wir den `pos-client`
mittelfristig auf iPads, iPhones, Android-Geräte und Sunmi-Kassen — mit nativem
Stripe Tap to Pay (NFC) und Nutzung der Sunmi-Hardware (NFC, Fingerabdruck, Drucker)?**

Diese Datei dokumentiert die durchgespielten Optionen und eine begründete Empfehlung
als Grundlage für eine spätere Entscheidung. **Es wurde noch nichts implementiert.**

---

## 1. Auslöser / Ziel

- POS-Client (`apps/pos-client/`) soll auf mobilen Geräten laufen: **iPad, iPhone,
  Android-Tablet/-Phone, Sunmi-Kassen** (bereits verbaut, mit NFC + Fingerabdruck).
- **Hartes Feature-Ziel:** natives **Stripe Tap to Pay** (SoftPOS — Karte/Phone direkt
  auf das Geräte-NFC tippen, kein externer Reader).
- Frage des Auftraggebers: **schlanke native App pro Plattform** bauen **oder** die
  bestehende Angular-App **wrappen**?

---

## 2. Ausgangslage im Code (Bestandsaufnahme)

| Baustein | Stand | Pfad |
|---|---|---|
| POS-UI | Angular 21 Standalone, Touch-First (Sunmi D3, 1280×800) | `apps/pos-client/` |
| Desktop-Shell | **Tauri 2** (v2.10.1), nur **Windows NSIS**, kein Mobile-Target | `apps/pos-client/src-tauri/` |
| Tauri-Plugins | `shell`, `updater`, `process` — **kein NFC/PCSC/Drucker** | `Cargo.toml` |
| Backend | **api-edge läuft AUF dem Gerät** (FeathersJS v5 + SQLite/Knex), POS verbindet gegen `http://localhost:3030` | `apps/api-edge/`, `app.config.ts` |
| Realtime/Sync | Socket.IO + `BaseService`, Outbox-Sync zur Cloud, Realtime-Scope-Guard (Multi-Tenancy) | `libs/domains/sync/` |
| Payment-Modell | **generisch**: `TransactionMethod = CASH\|CARD\|ONLINE\|OTHER`, `transaction.data: Type.Any()` — **kein Provider-Binding, kein Stripe-SDK** | `libs/domains/orders/domain/.../order.schema.ts` |
| Drucker | MQTT-Print-Server, ESC/POS via `@point-of-sale/receipt-printer-encoder` | `documentation/print-server-api.md` |
| Hardware-Layer | **fehlt** — keine Abstraktion für Reader/Schublade/NFC/Biometrie | — |
| NFC (Legacy-Referenz) | `pcsc`-Crate las Smartcard-UIDs (APDU `FF CA 00 00 00`) | `panary/apps/pos-counter/src-tauri/src/smartcard.rs` (Legacy, nur lesen) |

**Zentrale Erkenntnis:** Auf dem Desktop ist die Architektur faktisch
**„Tauri-Shell + Node-Sidecar (api-edge) + SQLite"**. Genau dieses Sidecar-Modell
**lässt sich nicht auf Mobil portieren** (iOS verbietet das Starten beliebiger
Prozesse). Damit ist eine Topologie-Entscheidung erzwungen — unabhängig davon,
welche App-Hülle wir wählen.

---

## 3. Die zwei orthogonalen Entscheidungen

Der häufigste Denkfehler ist, „Mobile App" als **eine** Entscheidung zu sehen. Es
sind **zwei** unabhängige Achsen:

- **Achse A — App-Hülle:** Wie kommt die Angular-UI aufs Gerät und wie erreicht sie
  native Hardware? → *Native pro Plattform / Tauri Mobile / Capacitor / PWA*
- **Achse B — Edge-Topologie:** Wo läuft die `api-edge` (Node + SQLite)? →
  *eingebettet im Gerät / Hub-and-Spoke im LAN / Cloud-direkt*

Beide müssen getrennt entschieden und dann kombiniert werden.

---

## 4. Harte externe Constraints (recherchiert)

Diese Fakten schränken den Lösungsraum stark ein — sie sind nicht verhandelbar:

### 4.1 Stripe Tap to Pay (entscheidend)

> **Tap to Pay läuft AUSSCHLIESSLICH über das native Stripe-Terminal-SDK.
> Es gibt KEINEN Web-/PWA-/WebView-Pfad.** Eine reine Browser-App kann Tap to Pay
> niemals auslösen — egal wie sie verpackt ist.

| | iPhone | Android |
|---|---|---|
| SDK | Terminal **iOS-SDK** (nativ) oder **React-Native-SDK** | Terminal **Android-SDK** (`com.stripe:stripeterminal-taptopay`) oder RN |
| WebView/PWA | ❌ nein | ❌ nein |
| OS / Gerät | iPhone **XS+**, iOS ≥ ~1 Jahr alt (kein Beta) | **Android 13+**, ARM, integriertes NFC |
| Pflicht-Voraussetzungen | Apple-**Entitlement** (`com.apple.developer.proximity-reader.payment.acceptance`), Dev- → Distribution-Stufe, **Apple-App-Review** | **GMS-zertifiziert** + Play-Store-App installiert, **nicht gerootet**, Bootloader gesperrt, Developer-Options aus, Security-Patch < 12 Mon., Internet aktiv |
| Verteilung | App Store (Review zwingend) | Play Store / GMS (kein Sideload-Bypass der GMS-Prüfung) |
| Verfügbarkeit DE | ✅ „General" | ✅ „General" |

**Konsequenz iPad:** „Tap to Pay on iPhone" ist **iPhone-only**. **iPads können
KEIN integriertes Tap to Pay** — Apple stellt das NFC-Secure-Element dafür nur auf
iPhones bereit. Ein iPad kann Karten nur über einen **externen Stripe-Reader**
(z. B. BBPOS WisePad 3 / Stripe Reader via Bluetooth) annehmen oder als reines
Bestell-/Bon-Terminal dienen.

**Konsequenz NFC-Doppeldeutigkeit:** „NFC nutzen" ist zweierlei —
1. **Zahlungs-NFC (Tap to Pay):** Kartenlesen ist eine **Blackbox im zertifizierten
   SDK**. Wir dürfen/können das **nicht** selbst über rohes NFC bauen (PCI/Apple/Google
   verbieten es).
2. **Daten-NFC (Mitarbeiter-/Tisch-/Loyalty-Tags, der alte `pcsc`-UID-Use-Case):**
   rohes NFC, eigener Code/Plugin — strikt **getrennt** vom Zahlungspfad halten.

### 4.2 Sunmi-Hardware

- **Gute Nachricht:** Sunmi ist **offizieller Stripe-Tap-to-Pay-Partner**. Unterstützte
  **GMS-**Geräte u. a.: **L3, V3, V3H, V3 Mix, T3 PRO, D3 MINI, L2s PRO, V2S**
  (V2s Plus nur Scanner-/GMS-Version). Die verbauten Sunmi-Geräte können Tap to Pay
  also **nativ auf dem Geräte-NFC** — kein Zusatz-Reader nötig.
- ⚠️ **Beschaffungs-Risiko (vorab prüfen!):** Tap to Pay verlangt die **GMS-Variante**
  (Google Mobile Services + Play Store). Die reine **AOSP/non-GMS-Variante** scheitert
  hart mit `ATTESTATION_FAILURE`. GMS lässt sich **nachträglich nicht aktivieren**.
  → **Vor jeder weiteren Planung verifizieren, dass unsere verbauten Sunmi-Geräte
  GMS-Geräte mit Android 13+ sind.**
- Sunmi-Peripherie (eingebauter Bondrucker, NFC-Leser, **Fingerabdruck**) wird über
  **native Sunmi-SDKs** (Java/Kotlin/AIDL) angesprochen — nicht über Web-APIs.

### 4.3 App-Hüllen-Reife

- **Tauri 2 Mobile:** iOS/Android seit Okt. 2024 stabil, native Plugins in Swift/Kotlin
  möglich (swift-rs / jni-rs). **Aber:** vom Tauri-Team selbst als „**nicht
  Mobile-first-class**" eingestuft (Fundament, nicht fertig); nicht alle Desktop-Plugins
  vorhanden; **kein Sidecar/Node auf Mobile**. Für tiefe native Integration explizit
  „besser anderer Stack". **Es existiert kein fertiges Tauri-Plugin für Stripe Terminal**
  — wir müssten Tap to Pay komplett selbst in Swift + Kotlin schreiben.
- **Capacitor:** reifer WebView-Wrapper mit großem Native-Bridge-Ökosystem.
  **`@capacitor-community/stripe-terminal`** unterstützt **Tap to Pay** bereits
  (`TerminalConnectTypes.TapToPay`, derzeit RC), inkl. Angular-Demo; dazu fertige
  Plugins für Biometrie, NFC etc. Eigene native Plugins (Sunmi-SDKs) sind über die
  dokumentierte Plugin-API geradlinig nachrüstbar.

### 4.4 Node + SQLite auf dem Mobilgerät

- `nodejs-mobile` existiert und ist gepflegt, aber: Native-Module (`better-sqlite3`)
  müssen für die Mobil-ABI neu kompiliert werden (Android = bionic, iOS = eigene
  Toolchain — unsere `glibc`-Annahme aus dem Docker-Setup gilt nicht), zusätzliche
  Binärgröße, App-Store-Review-Reibung. **Hohes Risiko, Nischenpfad** → als Primärweg
  nicht empfohlen.

---

## 5. Achse A durchgespielt — App-Hülle

| Option | Code-Wiederverwendung | Stripe Tap to Pay | Sunmi-SDKs | Aufwand / Risiko | Urteil |
|---|---|---|---|---|---|
| **A1 Native pro Plattform** (Swift + Kotlin neu) | ❌ Angular wird verworfen, 2–3 Codebases | ✅ direkt | ✅ direkt | 🔴 sehr hoch, Dauer-Doppelpflege | ❌ verworfen |
| **A2 Tauri 2 Mobile** | ✅ Angular bleibt | ⚠️ nur via **selbst geschriebenem** Swift/Kotlin-Plugin (kein fertiges) | ⚠️ alles selbst | 🔴 hoch, „nicht first-class", kein Zahlungs-Plugin | ❌ für Zahlterminal zu riskant |
| **A3 Capacitor** | ✅ Angular bleibt | ✅ **fertiges Community-Plugin** (Tap to Pay) | ✅ eigene Plugins über reife API | 🟡 mittel | ✅ **empfohlen** |
| **A4 PWA / reine Web-App** | ✅ maximal | ❌ **unmöglich** (kein WebView-Pfad) | ❌ kein Hardware-Zugriff | 🟢 niedrig | ❌ disqualifiziert fürs Zahlterminal (ok als Begleit-/Read-only-App) |

**Begründung A3 statt A2:** Beide erhalten die Angular-Investition. Den Ausschlag gibt
der **Zahlungspfad**: Capacitor hat ein **vorhandenes** Stripe-Terminal-Tap-to-Pay-Plugin,
Tauri hat **keines** — dort müssten wir die PCI-/Apple-/Google-kritische Integration
in Swift **und** Kotlin selbst bauen und pflegen. Bei einem Zahlterminal ist das das
falsche Risiko.

> **Kein Widerspruch zum Desktop:** Die Angular-`pos-client` ist die gemeinsame Basis.
> **Tauri bleibt für die stationäre Windows-Kasse**, **Capacitor** kommt für
> iPad/iPhone/Android/Sunmi dazu. Beide Hüllen rendern dieselbe Angular-App; der
> Unterschied steckt nur hinter einer **`PlatformBridge`-Abstraktion** (Tauri-Impl
> vs. Capacitor-Impl).

---

## 6. Achse B durchgespielt — Edge-Topologie

| Option | Offline-First | Code-Wiederverwendung (api-edge) | Aufwand | Urteil |
|---|---|---|---|---|
| **B1 Edge im Gerät** (nodejs-mobile / Logik clientseitig nachbauen) | ✅ je Gerät autark | ❌ Node/SQLite-Neukompilat oder Reimplementierung | 🔴 sehr hoch | ❌ Nischenrisiko |
| **B2 Hub-and-Spoke (LAN)** — `api-edge` läuft auf **einem festen Hub pro Filiale** (Windows-Kasse oder Mini-PC), Mobilgeräte sind **Satelliten-Terminals** über LAN-WebSocket | ✅ Filiale offline-fähig (Hub trägt SQLite + Sync) | ✅ **api-edge bleibt unverändert** | 🟡 niedrig–mittel | ✅ **empfohlen** |
| **B3 Cloud-direkt** — Mobilgerät spricht direkt mit `panary-cloud` | ❌ nur online | ✅ kein Edge nötig | 🟢 niedrig | ⚠️ nur als Online-only-Modus / Fallback |

**Begründung B2:** Erhält die gesamte bestehende FeathersJS-Edge-Logik (Sync, Outbox,
TSE, Tagesabschluss) **unangetastet**. Der Code kennt das Konzept bereits: Rolle
**`DEVICE_TABLET`** existiert in der RBAC-Matrix, Realtime-Scope-Guard und Socket-Sync
sind vorhanden. Mobilgeräte ändern nur **eine Konstante**: statt `localhost:3030` die
**LAN-Adresse des Hubs** (`http(s)://hub.local:3030`). Die Fiskalisierungs-ADR
(`panary-core/documentation/fiskalisierung-architektur-adr.md`) erlaubt zusätzlich
Cloud-direktes Onboarding — B3 ist also als **Online-Modus** bereits konzeptionell
gedeckt und kann als Fallback dienen, wenn (noch) kein Hub existiert.

---

## 7. Empfehlung (mittelfristig)

**Kombination A3 + B2 + Provider-Abstraktion + native Bridge-Plugins.** Konkret:

1. **Eine Angular-Basis, zwei Hüllen.** `pos-client` bleibt die Single Source of Truth.
   - Windows-Kasse: **Tauri** (wie heute).
   - iPad/iPhone/Android/Sunmi: **Capacitor**.
   - Hardware-/Payment-Zugriff hinter einer Angular-`PlatformBridge` (DI-getauscht).

2. **Edge als Hub-and-Spoke.** `api-edge` läuft pro Filiale auf einem festen Hub;
   Mobilgeräte verbinden als `DEVICE_TABLET`-Satelliten über LAN. **Kein Node auf dem
   Mobilgerät.** Cloud-direkt (B3) als Online-Fallback.

3. **`PaymentProvider`-Abstraktion einführen** (fehlt heute). Das generische
   `transaction.data: Type.Any()` ist bereits die richtige Naht. Eine Schnittstelle
   (`requestPayment(amount, method) → transaction`) mit Implementierungen:
   - `CashProvider` (heute),
   - `StripeTapToPayProvider` (Capacitor-Plugin, iPhone + Android/Sunmi-GMS),
   - `StripeBluetoothReaderProvider` (iPad + externer Reader),
   - später `SunmiPayProvider` o. ä.

4. **Native Bridge-Plugins (dünn) statt nativer App:**
   - **Stripe Terminal** via `@capacitor-community/stripe-terminal` (Tap to Pay + BT-Reader).
   - **Sunmi-Drucker/NFC/Fingerabdruck** als eigene, schlanke Capacitor-Plugins um die
     Sunmi-SDKs (alternativ Drucker weiter über den vorhandenen **MQTT-Print-Server** —
     das läuft schon).
   - **Biometrie:** iOS Face/Touch ID via Capacitor-Biometric-Plugin; Sunmi-Fingerabdruck
     via Sunmi-SDK — Use-Case ist **Mitarbeiter-Auth / Manager-Freigabe / Clock-in**,
     **nicht** Zahlung.
   - **Daten-NFC** (Mitarbeiter-/Tisch-Tags) als separates Plugin — **getrennt** vom
     Stripe-Zahlungspfad (siehe §4.1).

Damit ist die Antwort auf die Ausgangsfrage: **Wrappen — nicht nativ neu bauen.**
Eine Capacitor-Hülle plus wenige dünne native Plugins an genau den
Hardware-/Zahlungs-Nahtstellen. Kein Voll-Rewrite, kein React Native (würde Angular
wegwerfen), keine PWA fürs Zahlterminal.

---

## 8. Geräte-Fähigkeits-Matrix

| Gerät | Hülle | Tap to Pay (integriert) | Karte alternativ | Bondruck | Biometrie |
|---|---|---|---|---|---|
| **iPhone XS+** | Capacitor | ✅ (Entitlement + Review) | — | Netzwerk/MQTT-Drucker | Face/Touch ID |
| **iPad** | Capacitor | ❌ (iPhone-only) | **externer BT-Reader** o. Bestell-/Bonterminal | Netzwerk/MQTT-Drucker | Face/Touch ID |
| **Android-Phone/-Tablet (GMS, A13+)** | Capacitor | ✅ | — | Netzwerk/MQTT-Drucker | Geräte-Biometrie |
| **Sunmi (GMS-Variante, A13+)** | Capacitor | ✅ (Geräte-NFC) | — | **eingebauter Drucker (Sunmi-SDK)** | **Sunmi-Fingerabdruck-SDK** |
| **Sunmi (non-GMS/AOSP)** | Capacitor | ❌ `ATTESTATION_FAILURE` | externer Reader | eingebauter Drucker | Fingerabdruck (kein Tap to Pay) |
| **Windows-Kasse** | Tauri (heute) | ❌ | externer Reader | MQTT-Drucker | — |

---

## 9. Code-Konsequenzen & nächste Schritte (noch offen)

1. **`@panary/payments/domain`** anlegen: `PaymentProvider`-Port + `transaction.data`-
   Typisierung pro Provider (Stripe-`PaymentIntent`-Referenzen statt `Type.Any()`).
2. **Connection-Token-Endpoint** für Stripe Terminal (Server-seitig in `api-edge` und/oder
   `api-cloud` — Terminal-SDK fordert ein Backend, das `connection_token` ausgibt).
3. **`PlatformBridge`** in Angular (DI): `TauriBridge` (Desktop) vs. `CapacitorBridge`
   (Mobile); kapselt Drucker, NFC, Biometrie, Payment.
4. **Capacitor-Setup** für `pos-client` (eigene Build-Targets neben dem Tauri-Target,
   Nx-Executor prüfen).
5. **Hub-Discovery** für Satelliten (LAN-Adresse/QR-Pairing statt hartem `localhost:3030`).
6. **Beschaffungs-Check Sunmi GMS + Android 13+** (Blocker — zuerst klären).
7. **Apple-Entitlement** beantragen (Dev → Distribution, Vorlauf 1–2 Wochen).

---

## 10. Risiken & Vorbehalte

- **Sunmi-GMS-Risiko** (s. §4.2) — Show-Stopper, falls die verbauten Geräte non-GMS sind.
- **Apple-Review** für Tap-to-Pay-Apps ist verpflichtend und kann verzögern.
- `@capacitor-community/stripe-terminal` ist **RC** — vor Produktiv-Einsatz Reife/Wartung
  und PCI-Konformität verifizieren.
- **Tap to Pay braucht Online-Verbindung** (Stripe-Constraint) — auch im sonst
  offline-fähigen B2-Setup ist die **Kartenzahlung selbst nicht offline** möglich
  (Bargeld bleibt offline). Das ist im UX einzuplanen.
- Zwei Hüllen (Tauri + Capacitor) = zwei Build-/Release-Pipelines. Vertretbar, weil die
  Angular-Basis geteilt bleibt, aber bewusst einplanen.

---

## 11. Quellen

- [Stripe — Tap to Pay (Setup Reader)](https://docs.stripe.com/terminal/payments/setup-reader/tap-to-pay)
- [Apple Developer — Setting up the entitlement for Tap to Pay on iPhone](https://developer.apple.com/documentation/ProximityReader/setting-up-the-entitlement-for-tap-to-pay-on-iPhone)
- [Stripe — Tap to Pay on iPhone/Android & Terminal (Support)](https://support.stripe.com/questions/tap-to-pay-on-iphone-or-android-and-stripe-terminal)
- [Sunmi & Stripe Tap to Pay — Partnerschaft & unterstützte Geräte](https://m.sunmi.com/en/news/439/)
- [GMS vs. non-GMS Android (Hintergrund)](https://emteria.com/blog/gms-vs-non-gms)
- [Tauri 2.0 Stable Release](https://v2.tauri.app/blog/tauri-20/) · [Tauri — Mobile Plugin Development](https://v2.tauri.app/develop/plugins/develop-mobile/)
- [@capacitor-community/stripe-terminal (npm)](https://www.npmjs.com/package/@capacitor-community/stripe-terminal) · [capacitor-community/stripe (GitHub, Angular-Demo)](https://github.com/capacitor-community/stripe)
- [nodejs-mobile (GitHub)](https://github.com/nodejs-mobile/nodejs-mobile)
