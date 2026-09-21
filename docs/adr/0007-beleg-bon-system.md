---
type: ADR
title: 'Persistentes Beleg-/Bon-System — Datenmodell, Offline-Abruf & Render-Strategie'
description: 'ADR zum persistenten elektronischen Beleg nach §146a AO: immutable Receipts-Domain, Render-on-demand statt PDF-Blob und offline-stabiler HMAC-Token-Abruf.'
tags: [receipts, orders, tse, locations, sync]
status: stable
decision: accepted
implementation: Phase 1–5 Kern gebaut; Branding/Admin-UI + externe Adapter offen
generated: { by: claude-code/historic, at: 2026-05-29T00:00:00Z }
---

# Persistentes Beleg-/Bon-System (§146a AO) — ADR

ADR zur Architektur eines persistenten elektronischen Belegs. Cloud-seitige
Deploy-/Service-Details (separater öffentlicher Abruf-Service auf eigener
Subdomain) im Companion-Dokument
[`panary-cloud/docs/adr/0012-beleg-abruf-service.md`](../../../panary-cloud/docs/adr/0012-beleg-abruf-service.md).
Baut auf der bestehenden Fiskalisierungs-Architektur auf
([`0005-fiskalisierung-architektur.md`](0005-fiskalisierung-architektur.md),
[`tse-integration.md`](../integrations/tse-integration.md)).

## Problem / Auslöser

§146a AO verlangt für *Kassen* (elektronische Aufzeichnungssysteme) einen
**nach Vorgangsabschluss abrufbaren** Beleg — eine reine Anzeige am Terminal-
Display genügt nicht. Panary soll wahlweise als **Kasse** (`pos-cashier`,
Belegpflicht greift) oder als **reines Bestellsystem** (`orders-only`, kein
steuerlicher Beleg) laufen, **hardware-agnostisch** (kein Drucker als
Onboarding-Pflicht), digital-first, und zukunftssicher gegenüber der laufenden
Belegreform (verpflichtende digitale Belegausgabe vsl. 2029).

Bisher existiert kein persistentes Beleg-Artefakt: Orders tragen zwar
strukturierte Daten (`taxSnapshot`, `payment`, `tse`) und es gibt einen
ESC/POS-Thermo-Renderer, aber keinen dauerhaft abrufbaren digitalen Beleg mit
nicht-enumerierbarer URL.

## Schlüssel-Erkenntnisse (Recht + Markt)

1. **Immutabilität (GoBD/§146a):** Unveränderbar sein müssen die
   **Aufzeichnungen (Daten)**, nicht das gerenderte Dokument. Maßgebliches
   Archiv = TSE-Sicherung (TAR) + DSFinV-K-Export — **nicht** das Beleg-PDF.
   ⇒ Deterministische Reproduktion aus unveränderbaren Daten + Hash genügt; ein
   eingefrorenes PDF-Blob ist **nicht** gesetzlich erforderlich.
2. **Belegnummer (§6 KassenSichV):** Pflicht ist die **TSE-Transaktionsnummer**,
   keine separate fortlaufende Belegnummer. Die Lückenlosigkeit trägt die
   TSE-Transaktionsnummer (+ `Z_NR` Kassenabschluss).
3. **Marktpraxis:** De-facto-Standard ist *strukturierte Daten + On-demand-
   Rendering* (anybill, fiskaly, Tillhub, refive); das PDF ist nur Export-/
   Zustellartefakt. Offline-Muster: *„advance QR + deferred upload"* — die
   Beleg-ID/URL wird lokal stabil erzeugt, die Daten später hochgeladen.
4. **Datenstandard:** DFKA-Taxonomie (amtlich in DSFinV-K übernommen) ist die
   reiche, maßgebliche Obermenge; **EKaBS** („Elektronischer Kassen-Beleg-
   Standard", DFKA e.V.) ist der schlanke kundenseitige eBon (JSON-in-PDF, von
   fiskaly genutzt) — geeignet als *Export-Adapter*, nicht als internes Schema.

## Entscheidung

1. **Eigene `receipts`-Domain** (`@panary/receipts/domain`) als **immutables
   ausgestelltes Artefakt** — nicht Felder am (mutablen) Order. Der Beleg
   snapshottet die strukturierten Order-Daten; **die strukturierten Daten sind
   die Source of Truth**, PDF/PNG sind nur Renderings.
2. **Render-on-demand statt Blob-Store.** Kein PDF wird dauerhaft gespeichert;
   die optische Darstellung wird bei Abruf aus dem unveränderbaren Snapshot
   **deterministisch** reproduziert. Audit-Anker:
   `renderHash = sha256(canonicalJSON(snapshot))`, beim Ausstellen gesetzt.
   Optionaler Lazy-Cache `renderedPdfBase64` (mit `protectFromExternal`). Es
   wird **keine** neue Blob-Infrastruktur eingeführt (kein Bunny — Bunny/Stripe/
   Mollie sind noch nicht produktiv; Architektur bleibt provider-neutral).
3. **Offline-First-Abruf** über einen an der Edge gemünzten, nicht-
   enumerierbaren **HMAC-Token** (`HMAC(perLocationSecret, receipt._id)`). Die
   QR-URL ist damit **stabil vor Sync** (Muster „advance QR + deferred upload").
   §146a „abrufbar nach Abschluss" gilt als erfüllt im Moment des Abschlusses;
   die kurze Edge→Cloud-Sync-Latenz betrifft nur den *Remote*-Abruf
   (**[Steuerberater-Check]** — Latenz-Toleranz).
4. **Betriebsmodus wiederverwenden:** `location.operationMode`
   (`pos-cashier`/`orders-only`) bleibt der Schalter Kasse/Bestellsystem und das
   **einzige** Fiskal-Gate (`requiresFiscalSignature()`). Operative Beleg-
   Schalter leben in einem neuen, live-patchbaren `settings.receiptSettings`-
   Block (aktive Kanäle, Default-Kanal, `localPrintOnly`-Override, Retention,
   `consentNotice` als `LocalizedString`, `tseEnabled`, `printTarget`) — **sofort
   wirksam, kein Snapshot-Republish.** `tseEnabled` ist additives Opt-in und kann
   eine `pos-cashier`-Pflicht nie schwächen.
5. **Belegnummer:** Die **TSE-Transaktionsnummer** (aus `order.tse`) ist die
   fiskalisch relevante Nummer. Eine optionale **nicht-fiskalische** interne
   `receiptNumber` (Datum + Location + `dailySequenceNumber`) dient nur
   Auffindbarkeit/DSFinV-K. **Kein** vierter gaploser Zähler (es gibt bereits
   `dailySequenceNumber`, den lückenlosen Fiskal-Zähler und die Subscription-
   `invoiceNumber`).
6. **Ein Dokumenttyp mit Diskriminator** `kind: 'sale' | 'order-confirmation' |
   'cancellation'`. `sale` = voller Fiskal-Snapshot (TSE-Block bei
   `pos-cashier`); `order-confirmation` = kein Beleg i.S.d. AO (kein TSE/keine
   Belegnummer); `cancellation` = `voidedReceiptId`, koppelt an den bestehenden
   Storno-Signatur-Pfad (`order.tse.cancellation`).
7. **`ReceiptProvider`-Abstraktion** (Vorbild `TsePort`) in der Domain-Lib:
   reine `generate`/`getDeliveryArtifact` (deterministisch → `renderHash`),
   `persist` ausschließlich über die Feathers-Adapter-API, `print` Edge-only
   (wiederverwendet `print-server/order-receipt.renderer.ts` + den vorhandenen
   `buildTseReceiptBlock()`).
8. **Schema reich, an DSFinV-K/DFKA-Taxonomie-Semantik** ausgerichtet (die
   amtliche Obermenge, die wir für Export/Reporting ohnehin brauchen). **EKaBS**
   wird ein dünner **Export-Adapter** (spätere Phase), nicht das interne Schema.

## Sync & öffentlicher Abruf

- Belege sind **edge-originated** und fahren über die bestehende Sync-Outbox:
  `RECEIPTS` in `SyncableTransactionService` + `TRANSACTION_ALLOWLIST` → Edge→Cloud
  ohne neuen Sync-Code (`dateFields`/`stripNullPayload` beachten).
- Der **öffentliche Abruf** (QR-Zielseite) läuft über einen **separaten, read-
  only Service auf eigener Subdomain** (`receipts.panary.io`) — bewusst von der
  Sync-Ingestion/Admin entkoppelt (Last/Abschottung). Details + Deploy:
  Companion-Dokument.

## Caveat (bewusst akzeptiert)

- **Offline-Remote-Abruf:** Bei Edge-Offline ist der Beleg über die Cloud-URL
  erst nach Sync auflösbar. Marktstandard (anybill) toleriert das; ein
  **optionaler Edge-Local-Fallback** (`GET /r/<token>` an der Edge, im LAN) ist
  als Resilienz-Feature für spätere Phasen vorgesehen, nicht Kern.
- **Aktiv ausgegebener E-Beleg (E-Mail):** kann GoBD-seitig selbst zum
  aufbewahrungspflichtigen Original werden → dann Determinismus dokumentieren
  oder die ausgegebene Kopie mitspeichern (**[Steuerberater-Check]**, relevant
  erst mit dem E-Mail-Kanal).

## Konsequenzen / Umsetzung

- **Neu (panary-core):** `libs/domains/receipts/domain/` (Schema, Builder,
  `ReceiptProvider`, Token/Number-Helper); `apps/api-edge/src/services/receipts/`;
  `apps/api-edge/src/hooks/issue-receipt.hook.ts`; SQLite-Migration `receipts`;
  `receiptSettings` in `location.schema.ts`; `receipts` in `AppResource` +
  `RolePermissions`; `createReceiptProvider(app)` in `app.ts`.
- **Bestehendes wiederverwendet:** `order.schema.ts` (Snapshot-Quelle),
  TSE-Infrastruktur (`@panary/tse/domain`, Sign-Hooks, `requiresFiscalSignature`),
  ESC/POS-Renderer, gaplose-Nummer-Pattern (`platform-subscription-invoices`),
  Sync-Outbox/Allowlist, `LocalizedString` + Theme-Tokens.
- **Phasen:** P1 Beleg-Kern (Edge) → P2 öffentlicher Abruf (separater Service +
  Subdomain) → P3 Kassenmodus/Druck-Vollständigkeit + Edge-Fallback → P4 Kanäle
  (NFC/E-Mail/Wallet) + Branding → P5 Reform/Export (EKaBS-Adapter, DSFinV-K an
  `TseExportRef`, Feature-Flags `digitalReceiptMandatory`/`cashRegisterMandatory`).

## Offene Punkte (im Implementierungsplan zu klären)

- **Token-Secret:** per-Location-HMAC-Secret, stabil + Edge↔Cloud geteilt, beim
  Pairing verteilt, rotierbar (Lynchpin der vor-Sync-stabilen URL).
- **[Steuerberater-Check]:** GoBD-Grenzfall E-Beleg-Ausgabe; DSFinV-K-`BON_NR`-
  Lückenlosigkeits-Ebene; Grenze Bestellsystem↔Kasse; Sync-Latenz-Toleranz bei
  „abrufbar nach Abschluss".
- **Renderer-Dependency:** PDF/PNG-Renderer — kein Paket ohne ausdrückliche
  Zustimmung (`pnpm add -w`); Entscheidung vor P2/P3.
- **Lib-Coupling:** `receipts/domain` importiert `orderLineItemSchema` vs.
  strukturelle Kopie (wie `order.tse`).

## Implementierungsstand (Stand 2026-05-30)

Die Entscheidung ist über alle Phasen hinweg im Kern **umgesetzt** (build-
verifiziert; auf `main` gemerged). Übersicht der real existierenden Artefakte:

**Phase 1 — Beleg-Kern (Edge):**
- `@panary/receipts/domain` (`libs/domains/receipts/domain/src/lib/`):
  `receipt.schema.ts` (Schema + `ReceiptKind`/`ReceiptChannel`/`ReceiptStatus`),
  `receipt-builder.ts` (`buildReceiptSnapshot`/`canonicalReceiptJson`/
  `buildReceiptHtml`), `receipt-provider.ts` (`ReceiptProvider` +
  `getReceiptDeliveryArtifact`/`buildReceiptUrl`), `receipt-number.ts`.
- Edge: `apps/api-edge/src/services/receipts/receipts.ts`,
  `apps/api-edge/src/hooks/issue-receipt.hook.ts` (after `orders`→`completed`,
  HMAC-Token + `sha256`-`renderHash`, idempotent), SQLite-Migration
  `migrations/…_receipts.ts`.
- `location.settings.receiptSettings` (live-patchbar), RBAC `RECEIPTS`.

**Phase 2 — Sync + öffentlicher Abruf:** `RECEIPTS` in
`SyncableTransactionService` (Edge→Cloud-Push); Cloud-Empfangs-Service +
öffentlicher Abruf — Details im Companion
[`panary-cloud/docs/adr/0012-beleg-abruf-service.md`](../../../panary-cloud/docs/adr/0012-beleg-abruf-service.md).

**Phase 3 — Kassenmodus/Druck:** Retention (`retainUntil` im issue-Hook + 410
im öffentlichen Abruf — nur Abruf-Dauer, GoBD-Aufbewahrung unberührt);
ESC/POS-Renderer `apps/api-edge/src/print-server/receipt-escpos.renderer.ts`
(reuse `buildTseReceiptBlock`).

**Phase 4 — Kanäle:** NFC + Wallet via `getReceiptDeliveryArtifact`
(NDEF-URI- bzw. URL-Payload); E-Mail = Cloud-Service (Companion).

**Phase 5 — Reform/Export:** Feature-Flags `digitalReceiptMandatory`/
`cashRegisterMandatory` in `receiptSettings`; Fiskal-Export = Cloud-Service
(Companion).

**Noch offen (Folge-Schritte):**
- Brandbare Astro-Abrufseite + `receiptSettings`-Admin-UI + QR-Anzeige am POS
  (Frontend).
- NDEF-**Schreiben** am Gerät (Web NFC / Tauri-native); `.pkpass`/Google-Pass-
  Erzeugung (Apple/Google-Zertifikate + SDK).
- PDF/PNG-Renderer-Dependency (O3 — kein Paket ohne Zustimmung).
- Echter Fiskaly-Adapter (Credentials); DSFinV-K-/EKaBS-Mapping
  ([Steuerberater-Check]).
- Token-Secret-Provisionierung (O1) für vor-Sync-stabile Edge-lokale Verifikation
  (Cloud-Abruf benötigt sie nicht — Capability-Lookup per gespeichertem Token).

## Nachtrag 2026-09-21 — die Quittung hat ihren Verkäufer-Kopf zurück

> Ersetzt den Nachtrag vom 2026-09-20 („der Bestellbon trägt keine
> Verkäufer-Anschrift mehr"). Der dort beschriebene Zustand galt genau einen Tag.

Entscheidung 5 dieses ADR macht `print` Edge-only und lässt sie
`print-server/order-receipt.renderer.ts` wiederverwenden. Dieser Renderer druckte
zwischen [core#342](https://github.com/panary/panary-core/issues/342) und
[core#347](https://github.com/panary/panary-core/issues/347) **keinen
Filialkopf** — eine bewusste Zwischenlösung, weil eine Vorlage Küchenzettel und
Kundenbeleg zugleich war und die Adresse in der Küche sinnlos ist.

Seit core#347 trägt jeder Drucker eine **Rolle**, und der Renderer kennt zwei
Varianten:

| Variante | Rolle | Filialkopf | TSE-Block | Positionen, Nachlässe, Summe |
|---|---|---|---|---|
| `full` | `receipt`, `both`, **fehlend** | ja (Name, Straße, PLZ/Ort, Tel.) | ja, bei gesetztem `order.tse` | ja |
| `kitchen` | `kitchen` | nein | nein | ja — **byte-gleich** |

**Konsequenz:** Der Bestellbon ist auf einem `receipt`/`both`-Drucker wieder ein
vollständiger Beleg im Sinne von §146a AO. Bestandsinstallationen sind es
automatisch, weil ein fehlendes `role` als `both` gilt. Ein Betrieb, der **alle**
Drucker auf `kitchen` stellt, hat danach keinen Beleg mehr — erzwungen wird das
nicht, siehe „Was bewusst offen bleibt" in
[ADR 0045](0045-druckerrollen-statt-stations-routing.md).

Die Rolle ist erst mit
[cloud#487](https://github.com/panary/panary-cloud/issues/487) pflegbar: Drucker
stehen unter Cloud-Hoheit ([ADR 0001](0001-emergency-override.md)), im Edge-Admin
ist das Feld außerhalb des Notfall-Modus gesperrt. Bis dahin läuft jede
Installation auf `both`, und der praktische Nutzen ist null — der
**Belegcharakter** ist aber wiederhergestellt, und das war die offene Frage
dieses ADR.

Der in Phase 3 genannte `receipt-escpos.renderer.ts` behält seinen Verkäufer-Kopf
und ist von der Änderung nicht betroffen — er wird allerdings vom Edge aus
weiterhin **gar nicht aufgerufen** (nur exportiert). Die Belegausgabe am Edge
hängt damit faktisch am Bestellbon. Der Filialkopf der `full`-Variante ist nach
seiner gemessenen Font-Sequenz gebaut, nicht nach dem alten Block von vor #342.
Details und die Messung des zugehörigen Zentrierungsfehlers:
[Print-Server-API §10–13](../integrations/print-server-api.md).

## Status

Entschieden 2026-05-29 (Recherche Recht + Wettbewerb + zwei Architektur-
Evaluierungen). Phase 1–5-Kern **umgesetzt** 2026-05-30, build-verifiziert, nach
`main` gemerged. Offene Folge-Schritte siehe oben + „Offene Entscheidungen".
