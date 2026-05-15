---
title: Tagesabschluss-Architektur (Edge + Cloud + Aggregator-Lib)
date: 2026-05-15
category: Domain-Konzepte
domains: [businessdays, orders, write-offs, working-times, ingredients, recipes]
status: implemented
---

# Tagesabschluss-Architektur

Modernisierter Tagesabschluss-Workflow als Nachfolger der Legacy-`smartfoodorders-server`-Implementierung. Verteilt auf drei Schichten:

| Schicht | Verantwortung |
|---|---|
| **`@panary-core/businessdays/aggregator`** | Reine Funktionen — Single Source of Truth für alle Tages-Aggregationen (Dashboard-Live + Tagesabschluss-Report) |
| **api-edge `business-days`-Service** | Lokaler Lifecycle-Service (open/close), Sync-Outbox-Vorabprüfung, Cloud-Trigger |
| **api-cloud `business-day-reports`-Service** | Heavy-Lifting-Aggregation: Bestellungen, Wareneinsatz, Inventur, Kassenabstimmung, Z-Bon-Nummer-Vergabe |

---

## Mode-Unterscheidung (Location.operationMode)

Pro Filiale konfigurierbar via [`Location.operationMode`](../libs/domains/locations/domain/src/lib/location.schema.ts):

- **`'orders-only'`** — Reines Bestellsystem. Tagesabschluss aggregiert nur Bestellungen + Wareneinsatz. Kein Cash-Count, kein Z-Bon.
- **`'pos-cashier'`** — Volle Kassen-Compliance. Mit Opening-Float, Cash-Count, Variance-Berechnung, lückenloser Z-Bon-Nummer pro Location.

Der Modus wird bei Tageseröffnung als Snapshot in [`BusinessDay.operationMode`](../libs/domains/businessdays/domain/src/lib/business-day.schema.ts) eingefroren — nachträgliches Umschalten der Location wirkt erst auf den nächsten Tag.

---

## Edge-Service (`apps/api-edge/src/services/business-days/`)

### Lifecycle

```
status: 'open'                  ← openDay()
   ↓
status: 'closing-requested'     ← closeDay() — Edge validiert + triggert Cloud
   ↓
status: 'closing-aggregating'   ← Cloud meldet Aggregation läuft (via Sync-Pull)
   ↓
status: 'closed' | 'failed'     ← Cloud meldet Endergebnis (via Sync-Pull)
   ↓
status: 'audited'               ← Manager hat Plombe im Admin-Dashboard gesetzt
```

### Custom-Methods

| Methode | Aufruf | Effekt |
|---|---|---|
| `openDay({ locationId?, openingFloatCents? })` | POS bei Schichtbeginn | Neuer BusinessDay mit `status='open'`. Verhindert Mehrfach-Eröffnung pro Location. Stempelt operationMode-Snapshot aus Location. |
| `closeDay({ businessDayId, countedClosingFloatCents?, cashDropsCents?, payoutsCents?, physicalCounts? })` | POS bei Tagesende | 1. Prüft `sync-outbox` auf pending Einträge — Hard-Block bei Backlog. 2. Setzt `status='closing-requested'`, `closedAt`, `closedBy`. 3. HTTP-POST an Cloud-Service `business-day-reports.startClosing`. |

### Outbox-Vorabprüfung

Beim Closing wird die [`sync-outbox`](../apps/api-edge/src/services/sync-outbox/) auf pending-Einträge geprüft. Wenn auch nur **eine** unsynchrone Änderung existiert, wird die Aggregation blockiert — sonst würde die Cloud auf einem unvollständigen Datenbestand rechnen und der Report wäre falsch.

### Cloud-Trigger

Der Edge nutzt die existierende [`cloud-connection`](../apps/api-edge/src/services/cloud-connection/) für die HTTP-Verbindung. Best-Effort: bei Cloud-Ausfall bleibt der Tag in `closing-requested` und wird beim nächsten manuellen Retry oder Heartbeat-Reconnect erneut getriggert.

---

## Aggregator-Lib (`libs/domains/businessdays/aggregator/`)

**Reine Funktionen, kein I/O, Cent-Integer-Arithmetik.** Konsumenten:

- `DashboardStore` in `panary-cloud/libs/domains/dashboard/feature-admin` (Live-Widget)
- Cloud-Pipeline-Steps in `panary-cloud/apps/api-cloud/src/services/business-day-reports/aggregation/`
- Optional zukünftig POS-Client für Edge-Live-Anzeige

**Module:**

```
src/lib/
├── money.ts                    # toCents/fromCents/sumCents — Integer-Math
├── classifications.ts          # isStaffMeal/isCorporate/isCancelled/isRefunded/...
├── order-total.ts              # getOrderGrossCents — kanonisch, mit Modifier-Auflösung
├── financials.ts               # aggregateFinancials → Steuersplit/Channels/Payments
├── meal-subsidies.ts           # aggregateMealSubsidies — Personal/Firmenkunden, paid/unpaid
├── cancellations.ts            # aggregateCancellations
├── waste.ts                    # aggregateWriteOffs — raw/finished/Promotion/EmployeeMeal
├── cogs.ts                     # computeCogs — Rezeptur-Auflösung + Bewertung
├── inventory-snapshot.ts       # buildInventorySnapshot — Opening + Wareneingang − Verbrauch
├── labor.ts                    # aggregateLabor — Stunden + Nachtzuschlag
├── stats.ts                    # computeStats — Bonzahl/AOV/Top-Produkte/Personalumsatz
├── cash-reconciliation.ts      # computeCashReconciliation — Variance Soll/Ist
├── derived-net-revenue.ts      # deriveDisplayNetRevenueCents — Dashboard-Formel
└── validations.ts              # assertAggregateInvariants — Σ-Checks (gross=net+tax, …)
```

**Geld-Konvention:** Alle Beträge intern als **Integer-Cents**, am Lib-Rand mit `toCents(euros)` / `fromCents(cents)`. Niemals Float-Multiplikation auf Geldwerten — vermeidet IEEE-754-Rundungsdrift, kritisch für KassenSichV.

**Determinismus:** Vor jeder Aggregation werden Inputs nach `_id` sortiert. Reproduzierbar bei `reAggregate`.

---

## Konsistenz-Garantie

Vor diesem Refactor hatte der Dashboard-`BusinessDayInfoComponent` einen eigenen Aggregations-Pfad (`dashboard.store.ts:34-110`) mit Float-Arithmetik im Order-Total-Fallback. Risiko: divergierende Zahlen zwischen Dashboard-Live-Anzeige und finalem Z-Bon.

**Lösung:** Beide Pfade lesen jetzt aus derselben `aggregator`-Lib. Dieselbe Funktion → dasselbe Ergebnis. Strukturelle Konsistenz-Garantie, nicht nur empirisch.

---

## Validierungs-Invarianten

Vor Persistierung in der Cloud-Pipeline (`steps/persist.ts`) werden harte Invarianten geprüft:

1. **Steuersplit**: `Σ(taxes.grossAmountCents) === financials.grossTotalCents` (±1 ct pro Steuerstufe)
2. **Zahlungsarten**: `Σ(payments) === grossTotal − tips`
3. **Channels**: `Σ(channels) === grossTotal`

Bei Verletzung → Persist-Step throws, `report.status='failed'`, Diff im `errorMessage`. Audit-Trail in `business-day-report-events` enthält den fehlgeschlagenen Step.

---

## KassenSichV / TSE — Phase 2

Schema-Felder für TSE-Anbindung sind in `BusinessDayReport.fiscal` reserviert:
- `tseSerialNumber`
- `tseSignatureChain`
- `dsfinvkExportPath`
- `fiscalDocumentNumber`

Eine Z-Bon-Nummer wird im pos-cashier-Modus lückenlos pro Location vergeben (`steps/assign-z-report-number.ts`, Unique-Index in MongoDB). TSE-Signatur-Anbindung folgt in einer separaten Phase, sobald TSE-Hardware integriert ist.

---

## Verwandte Dateien

- Edge-Service: [`apps/api-edge/src/services/business-days/`](../apps/api-edge/src/services/business-days/)
- Aggregator-Lib: [`libs/domains/businessdays/aggregator/`](../libs/domains/businessdays/aggregator/)
- BusinessDay-Schema: [`libs/domains/businessdays/domain/src/lib/business-day.schema.ts`](../libs/domains/businessdays/domain/src/lib/business-day.schema.ts)
- Location-Schema: [`libs/domains/locations/domain/src/lib/location.schema.ts`](../libs/domains/locations/domain/src/lib/location.schema.ts) (Feld `operationMode`)
- Migrations: `apps/api-edge/migrations/20260515000001_locations_operation_mode.ts`, `20260515000002_businessdays_closing_lifecycle.ts`
- POS-Dialoge: [`libs/domains/businessdays/feature-pos-closing-dialog/`](../libs/domains/businessdays/feature-pos-closing-dialog/)
- Cloud-Pendant: siehe panary-cloud/documentation/tagesabschluss-aggregation.md
