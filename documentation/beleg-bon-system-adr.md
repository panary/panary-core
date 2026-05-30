---
title: Persistentes Beleg-/Bon-System — Datenmodell, Offline-Abruf & Render-Strategie
date: 2026-05-29
category: Architektur
domains: [receipts, orders, tse, locations, sync]
status: Umgesetzt (Phase 1–5 Kern gebaut; Branding/Admin-UI + externe Adapter offen)
---

# Persistentes Beleg-/Bon-System (§146a AO) — ADR

ADR zur Architektur eines persistenten elektronischen Belegs. Cloud-seitige
Deploy-/Service-Details (separater öffentlicher Abruf-Service auf eigener
Subdomain) im Companion-Dokument
[`panary-cloud/documentation/beleg-abruf-service.md`](../../panary-cloud/documentation/beleg-abruf-service.md).
Baut auf der bestehenden Fiskalisierungs-Architektur auf
([`fiskalisierung-architektur-adr.md`](fiskalisierung-architektur-adr.md),
[`tse-integration.md`](tse-integration.md)).

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
[`beleg-abruf-service.md`](../../panary-cloud/documentation/beleg-abruf-service.md).

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

## Status

Entschieden 2026-05-29 (Recherche Recht + Wettbewerb + zwei Architektur-
Evaluierungen). Phase 1–5-Kern **umgesetzt** 2026-05-30, build-verifiziert, nach
`main` gemerged. Offene Folge-Schritte siehe oben + „Offene Entscheidungen".
