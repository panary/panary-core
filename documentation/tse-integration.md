---
title: TSE-Port + Simulator (KassenSichV-Fiskalisierung)
date: 2026-05-16
category: Architektur
domains: [tse]
status: Aktiv
---

# TSE-Port + Simulator-Skelett

> **⚠️ Architektur-Update (2026-05-27):** Die hier umgesetzte Signierung ist
> **Edge-seitig**; das ist nicht mehr die ganze Geschichte. Da Fiskaly eine
> **Online-TSE** ist, ist **cloud-direktes** fiskalisches Signieren ein
> erstklassiger Pfad (Onboarding ohne Hardware). Der geteilte `TsePort` wird auch
> aus `api-cloud` genutzt (Phase D, cloud-direkter Signier-Pfad); „Erzeuger
> signiert" verhindert Doppelsignieren gesyncter Edge-Orders (`fromSync`-Guard).
> Die Edge-Order-Signier-Hooks gaten seit Phase B auf `pos-cashier` (geteilter
> Helfer `requiresFiscalSignature`); ein **separater lückenloser Fiskal-Zähler**
> (≠ `dailySequenceNumber`, Phase C) ist umgesetzt, **Storno-Signierung** folgt.
> Maßgeblich: [`fiskalisierung-architektur-adr.md`](fiskalisierung-architektur-adr.md).

Provider-agnostische Abstraktion für die KassenSichV-Fiskalisierung (Online-TSE via
Fiskaly geplant) plus ein Simulator-Adapter für Dev/CI/Staging. Erste Phase: Port +
Simulator + Provider-Auflösung + Bootstrap-Wiring. Signier-Hooks, echter Provider und
Export folgen (s. „Folgephasen").

## Problem

Bevor ein echter TSE-Provider (Account, Kosten, Netzabhängigkeit) angebunden wird, braucht
es eine austauschbare Abstraktion. Vor allem muss der **TSE-Ausfall-Pfad (KassenSichV §146a:
weiterverkaufen erlaubt, Ausfall dokumentieren, später signieren)** deterministisch testbar
sein — Panarys Offline-First-USP. Eine echte Hersteller-Sandbox kann „TSE ausgefallen" nicht
auf Knopfdruck reproduzieren.

## Entscheidung

### Port (Domain-Lib `@panary/tse/domain`)
- `TsePort`-Interface ([tse-port.ts](../libs/domains/tse/domain/src/lib/tse-port.ts)):
  `getStatus`, `startTransaction`, `finishTransaction`, `cancelTransaction`, `signDayClose`,
  `export`. Provider-agnostisch.
- TypeBox-Typen ([tse-transaction.schema.ts](../libs/domains/tse/domain/src/lib/tse-transaction.schema.ts)):
  `TseTransactionRef`, `TseSignature`, `TseDaySignature`, `TsePortStatus`, `TseExportRef`.
  `TsePortStatus` (Laufzeit-Health) ist bewusst getrennt vom Account-`TseStatus` aus
  `@panary/tenants/domain`.
- Fehler ([tse.errors.ts](../libs/domains/tse/domain/src/lib/tse.errors.ts)):
  `TseUnavailableError` (transient → §146a) vs. `TseError` (terminal). Zentral fürs Ausfall-Handling.

### Simulator ([simulator.adapter.ts](../libs/domains/tse/domain/src/lib/simulator.adapter.ts))
- Deterministisch, in-memory, monoton steigender `signatureCounter`, nicht-kryptografische
  `SIM-`-Signatur, jede Ausgabe `simulated: true`.
- **Fault-Injection** (`setFault({ outage, latencyMs })`) → `TseUnavailableError` / künstliche
  Latenz. Macht den §146a-Ausfall-Pfad deterministisch testbar.

### Provider-Auflösung + Bootstrap (fail-closed)
- Pure Funktion `resolveTseProvider(configured, isProduction)`
  ([tse-provider.ts](../libs/domains/tse/domain/src/lib/tse-provider.ts)): ohne Config in
  Nicht-Produktion = `simulator`, in Produktion = **inaktiv** (kein Bruch bestehender
  Deployments). Ein **Simulator in Produktion wirft** (würde nicht-fiskalische Belege erzeugen).
- Factory ([tse-port.factory.ts](../apps/api-edge/src/services/tse/tse-port.factory.ts)) +
  Bootstrap in [app.ts](../apps/api-edge/src/app.ts): `app.set('tsePort', createTsePort(app))`
  (nur wenn aktiv). Config-Feld `tse.provider` in
  [configuration.ts](../apps/api-edge/src/configuration.ts); Typ `tsePort` in
  [declarations.ts](../apps/api-edge/src/declarations.ts).

## Konsequenzen
- Edge-intern; Cloud konsumiert den Port (noch) nicht — bei künftigem Cloud-Konsum (z. B.
  Status-/DSFinV-K-Anzeige) Core-Pin-Bump nötig.
- 14 Vitest-Specs in der Domain-Lib (Simulator-Lifecycle/Fault-Injection + Provider-Auflösung).
  api-edge hat kein Test-Target → Factory ist durch `nx build api-edge` typgeprüft.

## Phase 1 — Order-Signierung (umgesetzt)

Die Einzelbon-Signierung ist gegen den `TsePort` (Simulator) verdrahtet:
- Order-Schema: eingebetteter `tse`-Snapshot ([order.schema.ts](../libs/domains/orders/domain/src/lib/order.schema.ts) → `orderTseSchema`, Status `started`/`signed`/`failed`/`unavailable`) + Knex-Migration `orders.tse` (JSON).
- Pure Helfer in `@panary/tse/domain` ([order-signing.ts](../libs/domains/tse/domain/src/lib/order-signing.ts)): `tseInfoFromStart` / `tseInfoFromSignature` / `tseInfoFromError` / `tseRefFromInfo`.
- Hooks ([sign-order-tse.hook.ts](../apps/api-edge/src/hooks/sign-order-tse.hook.ts)): `signOrderTseStart` (orders `before.create`, nach `assignDailySequenceNumber`) ruft `tsePort.startTransaction`; `signOrderTseFinish` (orders `before.patch`, Übergang → `completed`) ruft `tsePort.finishTransaction`. Beide **No-Op ohne aktive TSE** und **nie blockierend** (§146a: Ausfall → Snapshot `unavailable`, nachzusignieren).
- **Fiskal-Gate (Phase B):** `signOrderTseStart` signiert nur noch `pos-cashier`-Vorgänge — geprüft über den geteilten Helfer `requiresFiscalSignature` gegen den `operationMode`-Snapshot des Geschäftstags (gleiche Quelle wie `signBusinessDayClose`). `signOrderTseFinish` gated transitiv: nur ein gestarteter (= pos-cashier) Vorgang hat einen `started`-Snapshot. **fail-safe Richtung Signatur:** ist der Modus nicht ermittelbar (kein `businessDayId`, Lookup-Fehler, fehlender Snapshot), wird signiert — ein unsignierter pos-cashier-Bon wäre ein Compliance-Defekt, ein über-signierter orders-only-Bon nur Verschwendung. Schließt die alte „signiert jeden Vorgang"-Lücke.
- 4 zusätzliche Specs in der tse-Domain (18 gesamt); `requiresFiscalSignature` mit eigener Spec ([fiscal-gate.spec.ts](../libs/domains/tse/domain/src/lib/fiscal-gate.spec.ts)).
- **Offen/Refinement:** Betrags-Einheit härten; folgt mit dem echten Provider/Cloud-Config.

## Phase 2 — Tagesabschluss-Signatur (umgesetzt)

Der Geschäftstag wird beim tatsächlichen Schließen TSE-signiert:
- `signBusinessDayClose` in [business-days.ts](../apps/api-edge/src/services/business-days/business-days.ts) hängt im `refreshClosingStatus` ein: bei Übergang → `CLOSED`, **nur** `operationMode = pos-cashier` + aktive TSE, ruft `tsePort.signDayClose`. Das Ergebnis fließt in denselben internen Close-Patch.
- Flache Felder am BusinessDay ([business-day.schema.ts](../libs/domains/businessdays/domain/src/lib/business-day.schema.ts)): `tseDayStatus` / `tseDaySignature` / `tseDaySignatureCounter` / `tseDaySimulated` (kein JSON-Hook im businessdays-Service) + Knex-Migration.
- Pure Helfer ([day-signing.ts](../libs/domains/tse/domain/src/lib/day-signing.ts)): `dayTseFieldsFromSignature` / `dayTseFieldsFromError`.
- **Nie blockierend** (§146a): ein Ausfall schließt den Tag trotzdem, Status `unavailable` (nachzusignieren). 2 zusätzliche Specs (tse-domain 20 gesamt).

## Phase 3 — Signatur auf dem Bon (umgesetzt)

KassenSichV-Belegausgabepflicht: die Signatur erscheint auf dem gedruckten Bon.
- Pure `buildTseReceiptBlock` ([receipt.ts](../libs/domains/tse/domain/src/lib/receipt.ts)) aus `order.tse`: `signed` → Transaktion/Signaturzähler/TSE-Zeit + QR-Code (Signaturwert) + ggf. „SIMULATION"-Hinweis; `unavailable`/`failed` → §146a-Beleghinweis.
- Gerendert in [order-receipt.renderer.ts](../apps/api-edge/src/print-server/order-receipt.renderer.ts) (`appendTseBlock`, nach der Gesamtsumme). No-Op ohne `order.tse`.
- 5 zusätzliche Specs (tse-domain 25 gesamt).

## Phase C — Lückenloser Fiskal-Zähler (umgesetzt)

KassenSichV verlangt eine **lückenlose, monoton steigende Vorgangsnummer** je
Erfassungseinheit (TSE). Bisher diente die zeitbasierte `dailySequenceNumber`
(`assign-daily-sequence-number.ts`, `MMSS`+Suffix) als `transactionNumber` —
**nicht** lückenlos/monoton (Defekt S1). Jetzt getrennt:
- **Eigener Zähler je (tenantId, locationId)** in `@panary/tse/domain`
  ([fiscal-counter.schema.ts](../libs/domains/tse/domain/src/lib/fiscal-counter.schema.ts)):
  Entity `fiscal-counters` (`_id = ${tenantId}:${locationId}`, `lastValue`) +
  pure Helfer `fiscalCounterId` / `nextFiscalCounterValue` (Start bei 1, +1).
- **Umgebungs-lokal, NICHT gesynct:** eine Location signiert an genau einer
  Stelle (Edge wenn gepairt, sonst cloud-direkt) → autoritativer Zähler dort.
  Edge: SQLite-Tabelle ([Migration](../apps/api-edge/migrations/20260527140000_fiscal_counters.ts))
  + interner Service ([fiscal-counters.ts](../apps/api-edge/src/services/fiscal-counters/fiscal-counters.ts),
  `allocateFiscalCounter`, atomar via In-Process-`Mutex` + Feathers-Adapter-API,
  kein Raw-Write). Cloud-Pendant folgt mit dem Cloud-Signier-Pfad (Phase D).
- **Wiring:** `signOrderTseStart` vergibt vor `startTransaction` den nächsten
  Zählerwert als `transactionNumber`; `dailySequenceNumber` bleibt reine
  Bon-/Anzeigenummer. Scope aus dem Geschäftstag-Snapshot (ein Read deckt Gate +
  Scope). Zähler-Vergabe-Fehler → Fallback auf `dailySequenceNumber` (nie blockierend, §146a).
- 6 zusätzliche Specs (tse-domain 38 gesamt). **Offen:** Multi-Replica-Atomik im
  Cloud (mehrere api-cloud-Instanzen) — In-Process-Mutex reicht für Single-Replica
  Dev/Staging; Härtung mit dem echten Provider/produktivem cloud-direktem Betrieb (F+).

## Phase D — Cloud-Signier-Pfad + Doppelsignier-Guard (umgesetzt, api-cloud)

Cloud-direktes fiskalisches Kassieren ohne Edge (Onboarding-Vision: < 10 Min,
keine Hardware). Spiegelt die Edge-Signierung in `panary-cloud/apps/api-cloud`:
- **Per-Tenant-Factory** `getTsePortForTenant(app, tenantId)`
  (`services/tse/tse-port.factory.ts`, TTL-Cache): Provider aus Cloud-Config
  `app.get('tse').provider`; ohne Provider inaktiv (Default). Per-Tenant-Cache
  vorbereitet für tenant.tse-Auswahl (Phase F).
- **Cloud-Fiskal-Zähler** (`services/fiscal-counters/`, Mongo via
  `registerMongoService`, `allocateFiscalCounter` mit In-Process-Mutex) — gleiche
  Domain-Schemata wie Edge, umgebungs-lokal/nicht gesynct.
- **Signier-Hooks** (`hooks/sign-order-tse.hook.ts`): `signOrderTseStartCloud`
  (orders `customBeforeHooks.create`, nach `restrictOrderToBusinessDay`),
  `signOrderTseFinishCloud` (`customBeforeHooks.patch`). Zwei-Phasen wie Edge.
- **Doppelsignier-Guard (höchste Test-Priorität):** skip bei `params.fromSync`
  (gesyncte Edge-Order → Edge hat signiert) UND bei bereits gesetztem `order.tse`
  (kein Überschreiben). Finish nur bei vorhandenem `started`-Snapshot →
  Soft-Delete-Patch + Re-Patch signierter Orders sind No-Op. 10 Hook-Specs
  (`sign-order-tse.hook.spec.ts`).
- **Wiring-Hinweis:** `@panary/tse` als Cloud-Dependency ergänzt (`package.json`
  + `pnpm install` → node_modules-Symlink), sonst bricht `nx build api-cloud`.
- **Cloud-Tagesabschluss-Signatur:** `business-day-reports.class.ts`
  `reconcileBusinessDayFromDraft` signiert beim Übergang → `CLOSED` über
  `getTsePortForTenant` (nur `pos-cashier` + konfigurierter Port), `tseDay*`-Felder
  in denselben Close-Patch. Cloud-Analogon zu `signBusinessDayClose` (Edge).

## DSFinV-K-Export — Gerüst (umgesetzt)

Reusable, getesteter Export-Kern in `@panary/tse/domain`
([dsfinvk-export.ts](../libs/domains/tse/domain/src/lib/dsfinvk-export.ts)):
`assembleDsfinvkExport` (Meta + signierte Transaktionen + Tagesabschluss) +
`tseTransactionsToCsv` (semikolon-CSV mit Escaping). **Foundation, nicht
voll-konform:** der offizielle DSFinV-K-Export ist ein TAR mit ~30 Tabellen +
index.xml gemäß Taxonomie — Tabellen-/Format-Vollständigkeit + Validierung
(DSFinV-K-Prüftool) folgen mit dem echten Provider. 4 Specs (tse-domain 29).
Offen: Export-Endpoint/Service (sammelt Tagesorders) + RBAC.

## TSE-Gateway-Container (umgesetzt)

Standalone-App [`apps/tse-gateway`](../apps/tse-gateway/src/main.ts): kapselt den
`SimulatorTseAdapter` über HTTP (node:http, zero-dep, self-contained esbuild-Bundle),
damit Staging/E2E + mehrere Edges einen gemeinsamen, zustandsbehafteten Fake-TSE
ansprechen (konsistenter Signatur-Zähler) und den echten Netzwerk-/Timeout-Pfad testen.
- Endpoints: `GET /health`, `GET /status`, `POST /transactions`, `/transactions/finish`,
  `/transactions/cancel`, `/day-close`, `/export`, `/fault` (Ausfall/Latenz-Toggle für §146a-Tests).
- Ausfall (`/fault {outage:true}`) → Signiervorgänge liefern `503 tse_unavailable`.
- Build `nx build tse-gateway` → `dist/apps/tse-gateway/main.js`; Dockerfile dabei. NICHT fiskalisch gültig.

## Folgephasen (Out of scope)
1. **DSFinV-K Voll-Konformität** — offizielles TAR-Format (alle Tabellen + index.xml) + Export-Endpoint + Prüftool-Validierung.
2. Edge↔Cloud-Sync der `tenant.tse`-Config + per-Tenant-Provider-Auswahl.
3. Fiskaly-Real-Adapter (Test-/Prod-Endpoint, `apiKeyRef`/`apiSecretRef` aus BWS via `tenant.tse`).

## Verification
- `nx test tse-domain` (38 Specs grün) · `nx build tse-domain` · `nx build api-edge` (alle grün).
- Fail-closed: `resolveTseProvider('simulator', true)` wirft (Unit-Test) — Bootstrap würde in
  Produktion mit erzwungenem Simulator abbrechen.
