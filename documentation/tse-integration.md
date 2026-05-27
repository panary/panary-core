---
title: TSE-Port + Simulator (KassenSichV-Fiskalisierung)
date: 2026-05-16
category: Architektur
domains: [tse]
status: Aktiv
---

# TSE-Port + Simulator-Skelett

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
- 4 zusätzliche Specs in der tse-Domain (18 gesamt).
- **Offen/Refinement:** präzise Gating auf `operationMode = pos-cashier` (aktuell signiert jeder Vorgang bei aktiver TSE) + Betrags-Einheit; folgt mit dem echten Provider/Cloud-Config.

## Folgephasen (Out of scope)
1. **Tagesabschluss-Signatur** (`signDayClose`) im businessdays-Close + DSFinV-K/TAR-Export.
2. Signatur-Druck auf dem Bon (Print-Server, Belegausgabepflicht).
3. Edge↔Cloud-Sync der `tenant.tse`-Config + per-Tenant-Provider-Auswahl.
4. Fiskaly-Real-Adapter (Test-/Prod-Endpoint, `apiKeyRef`/`apiSecretRef` aus BWS via `tenant.tse`).
5. Standalone-TSE-Gateway-Container (Staging/E2E/Multi-Edge) — teilt die Simulator-Kernlogik.

## Verification
- `nx test tse-domain` (14 Specs grün) · `nx build tse-domain` · `nx build api-edge` (alle grün).
- Fail-closed: `resolveTseProvider('simulator', true)` wirft (Unit-Test) — Bootstrap würde in
  Produktion mit erzwungenem Simulator abbrechen.
