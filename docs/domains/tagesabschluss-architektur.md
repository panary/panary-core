---
type: Domain Concept
title: Tagesabschluss-Architektur (Edge + Cloud + Aggregator-Lib)
description: 'Dreischichtiger Tagesabschluss-Workflow: Lifecycle-Maschine im Edge, Cloud-Report-Aggregation und geteilte Aggregator-Lib als Single Source of Truth, mit Mode-Unterscheidung orders-only versus pos-cashier.'
tags: [businessdays, orders, write-offs, working-times, ingredients, recipes]
status: stable
generated: { by: claude-code/historic, at: 2026-05-15T00:00:00Z }
---

# Tagesabschluss-Architektur

Modernisierter Tagesabschluss-Workflow als Nachfolger der Legacy-`smartfoodorders-server`-Implementierung. Verteilt auf drei Schichten:

| Schicht | Verantwortung |
|---|---|
| **`@panary/businessdays/aggregator`** | Reine Funktionen — Single Source of Truth für alle Tages-Aggregationen (Dashboard-Live + Tagesabschluss-Report) |
| **api-edge `business-days`-Service** | Lokaler Lifecycle-Service (open/close), Sync-Outbox-Vorabprüfung, Cloud-Trigger |
| **api-cloud `business-day-reports`-Service** | Heavy-Lifting-Aggregation: Bestellungen, Wareneinsatz, Inventur, Kassenabstimmung, Z-Bon-Nummer-Vergabe |

> **Als Ablaufdiagramm:** Das LikeC4-Modell (`panary-cloud/docs/architecture/c4/`, [ADR 0028](../../../panary-cloud/docs/adr/0028-likec4-architecture-as-code.md))
> trägt den Tagesabschluss seit panary/panary-cloud#187 in drei Views: `dynBusinessDayClosing`
> (Regelfall — Abschluss im Cloud-Admin, Rückweg über den Business-Day-Pull zum Edge),
> `dynBusinessDayClosingEdge` (der hier beschriebene Edge-Pfad, erreichbar nur ohne aktives
> Pairing) und `dynBusinessDayRotation` (04:00-Rotation plus Überlängen-Sweep der Cloud).
> Ansehen mit `pnpm arch:dev` **in panary-cloud**.

---

## Mode-Unterscheidung (Location.operationMode)

Pro Filiale konfigurierbar via [`Location.operationMode`](../../libs/domains/locations/domain/src/lib/location.schema.ts):

- **`'orders-only'`** — Reines Bestellsystem. Tagesabschluss aggregiert nur Bestellungen + Wareneinsatz. Kein Cash-Count, kein Z-Bon.
- **`'pos-cashier'`** — Volle Kassen-Compliance. Mit Opening-Float, Cash-Count, Variance-Berechnung, lückenloser Z-Bon-Nummer pro Location.

Der Modus wird bei Tageseröffnung als Snapshot in [`BusinessDay.operationMode`](../../libs/domains/businessdays/domain/src/lib/business-day.schema.ts) eingefroren — nachträgliches Umschalten der Location wirkt erst auf den nächsten Tag.

Der Snapshot entsteht **serverseitig im `businessDayDataResolver`** ([business-days.schema.ts](../../apps/api-edge/src/services/business-days/business-days.schema.ts)) und ist nicht aus der Anfrage bestimmbar: Ein `operationMode` aus der Create-Payload wird verworfen, nicht als Default behandelt. Das ist kein Detail der Hygiene — der Snapshot ist das Fiskal-Gate für die TSE-Signierung der Bestellungen ([sign-order-tse.hook.ts](../../apps/api-edge/src/hooks/sign-order-tse.hook.ts)) und für den Kassen-Zwang ([restrict-order-to-cash-session.ts](../../apps/api-edge/src/hooks/restrict-order-to-cash-session.ts)). Solange er wählbar war, bestimmte ein Kassen-Token selbst, ob die Bestellungen seines Tages signiert werden (`create` steht in `businessDaysMethods`, `DEVICE_POS` hat `MANAGE` auf `BUSINESS_DAYS`). Ist die Location nicht ladbar, fällt der Resolver auf `pos-cashier` — **fail-safe Richtung Signieren**: zu viel Fiskalisierung ist ein Aufwands-, zu wenig ein Rechtsproblem.

Ausgenommen ist allein der Sync-Apply: `syncAwareResolveCreate` überspringt bei `fromSync` den gesamten Create-Resolver, weil dort der vollständige Lifecycle-Record der Cloud ankommt. Der Snapshot eines gepullten Tages stammt aus derselben Quelle, nur zum richtigen Zeitpunkt — ihn lokal aus der *aktuellen* Betriebsart zu überschreiben schriebe Historie um. Gleiche Regel wie im Cloud-Gegenstück (panary/panary-cloud#146).

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
| `openDay({ locationId?, openingFloatCents? })` | POS bei Schichtbeginn | Neuer BusinessDay mit `status='open'`. Verhindert Mehrfach-Eröffnung pro Location. Den operationMode-Snapshot setzt der Create-Resolver (s. o.), nicht diese Methode — sonst gäbe es zwei Ableitungen derselben Sache, und die über `create` wäre die schwächere. |
| `closeDay({ businessDayId, countedClosingFloatCents?, cashDropsCents?, payoutsCents?, physicalCounts? })` | POS bei Tagesende | 1. Prüft `sync-outbox` auf pending Einträge — Hard-Block bei Backlog. 2. Setzt `status='closing-requested'`, `closedAt`, `closedBy`. 3. HTTP-POST an Cloud-Service `business-day-reports.startClosing`. |

### Outbox-Vorabprüfung

Beim Closing wird die [`sync-outbox`](../../apps/api-edge/src/services/sync-outbox) auf pending-Einträge geprüft. Wenn auch nur **eine** unsynchrone Änderung existiert, wird die Aggregation blockiert — sonst würde die Cloud auf einem unvollständigen Datenbestand rechnen und der Report wäre falsch.

> **Reichweite dieser Prüfung — wichtig.** Sie sitzt im **Edge**-`closeDay` und misst die
> Outbox **lokal**; genau deshalb ist sie belastbar. Im **gepairten** Betrieb wird sie extern
> allerdings nie erreicht: `guardCloudManagedLifecycle` sperrt den Edge-`closeDay`, sobald eine
> `cloud-connection` mit `PairingStatus.CONNECTED` existiert — der Tagesabschluss läuft dann über
> den Cloud-Service. Der Guard bleibt als Netz für Standalone-Betrieb und interne Aufrufe.
>
> Das Cloud-Pendant gibt es bewusst **nicht**: Die Cloud kann Unvollständigkeit vorher nicht
> feststellen (das Sync-Protokoll trägt keinen Wasserstand), und ein Gate auf einer
> Edge-Selbstauskunft ist per
> [ADR 0030](../../../panary-cloud/docs/adr/0030-edge-geraetezaehlung-ueber-heartbeat.md) gesperrt.
> Stattdessen erkennt die Cloud Nachzügler **nach** dem Abschluss und markiert den Report als
> rekonziliations-bedürftig —
> [ADR 0032](../../../panary-cloud/docs/adr/0032-tagesabschluss-vollstaendigkeit-ohne-selbstauskunft.md).

### Cloud-Trigger

Der Edge nutzt die existierende [`cloud-connection`](../../apps/api-edge/src/services/cloud-connection) für die HTTP-Verbindung. Best-Effort: bei Cloud-Ausfall bleibt der Tag in `closing-requested` und wird beim nächsten manuellen Retry oder Heartbeat-Reconnect erneut getriggert.

### Nachzieh-Worker (`closing-status-refresh.worker.ts`)

Damit der Manager den Endstatus auch ohne UI-Refresh sieht, pollt ein Worker alle
~30 s die Tage in `closing-requested`/`closing-aggregating` und ruft pro Tag
`refreshClosingStatus` — das holt den Report aus der Cloud und patcht den Status.

**Backoff (seit 2026-07-31).** Die ersten zehn Versuche laufen mit voller
Frequenz — ein normaler Abschluss ist in wenigen Minuten durch. Danach wächst
der Abstand exponentiell bis maximal ~1 h. Grund: bleibt ein Tag dauerhaft
hängen (die Cloud hat nie einen Report angelegt), pollte der Worker ihn vorher
für immer im 30-Sekunden-Takt — ein Cloud-Roundtrip je Tag und Tick, rund 2.880
pro Tag und Geschäftstag, ohne dass sich je etwas änderte. Ein Statuswechsel
setzt den Backoff zurück, damit der Folgeschritt
(`closing-requested` → `aggregating` → `closed`) nicht in der langen Wartezeit
hängen bleibt.

**Log-Disziplin.** Ein Tick ohne Statusänderung loggt **nichts**. Geloggt wird
nur eine echte Transition (`business_day.refresh.tick_done`, info) sowie
einmalig je Tag ein Hänger, der länger als eine Stunde im Zwischenstatus sitzt
(`business_day.refresh.stuck`, warn). Vorher schrieb der Worker bei jedem Tick
`refreshedCount=n transitionedCount=0` — bei hängenden Tagen also dieselbe
nichtssagende Zeile alle 30 s, in der die eine Zeile unterging, die zählt.

> **Diagnose-Hinweis:** `refreshedCount` entspricht dem Wert `maxPerTick`
> (Default 5), wenn mindestens so viele Tage im Zwischenstatus stehen. Dauerhaft
> `transitionedCount=0` bei vollem `refreshedCount` heißt: die Tage lösen nicht
> auf — nicht, dass der Worker arbeitet. Seit dem Backoff meldet sich dieser
> Zustand von selbst über `business_day.refresh.stuck`.

Der Backoff-Zustand ist **prozess-lokal**: ein Neustart des Edge pollt wieder mit
voller Frequenz und meldet Hänger erneut. Das ist gewollt — nach einem Neustart
ist ein frischer Zustellversuch billiger als eine persistierte Sperre.

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

**Vorzeichen-Konvention (Kassendifferenz):** `varianceCents = counted − expected`. Positiv = Überschuss (mehr Geld in der Lade als erwartet), negativ = Fehlbetrag. Die Konvention gilt repo-übergreifend: [`cash-session.schema.ts`](../../libs/domains/businessdays/domain/src/lib/cash-session.schema.ts), der Cloud-Hook `recompute-cash-session`, das Z-Bon-PDF und die Abstimmungs-Card der Tagesabschluss-Detailseite führen dasselbe Vorzeichen.

Bis panary/panary-core#133 rechnete [`cash-reconciliation.ts`](../../libs/domains/businessdays/aggregator/src/lib/cash-reconciliation.ts) als **einzige** Stelle die Gegenrichtung — die Cloud-UI meldete Fehlbeträge deshalb als „Überschuss". Ein erneuter Dreh kehrt still jede gespeicherte Differenz um und ist ohne begleitende Re-Aggregation der Bestandsberichte nicht deploybar. Hintergrund und Bestandsdaten-Pfad: `panary-cloud/docs/adr/0045-kassendifferenz-vorzeichen.md`.

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

## KassenSichV / TSE

Felder für die TSE-Anbindung in `BusinessDayReport.fiscal`:
- `tseSerialNumber`
- `tseSignatureChain`
- `dsfinvkExportPath`
- `fiscalDocumentNumber`

Eine Z-Bon-Nummer wird im pos-cashier-Modus lückenlos pro Location vergeben (`steps/assign-z-report-number.ts`, Unique-Index in MongoDB).

**Der Signierpfad existiert bereits** — nicht mehr „Phase 2". `signBusinessDayClose` ruft beim Edge-Closing `tsePort.signDayClose`, das Cloud-Pendant `signCloudDayClose` tut dasselbe. Was fehlt, ist ausschließlich der **Provider-Adapter**: `tse-port.factory.ts` kennt nur den `SimulatorTseAdapter`, der in Produktion fail-closed abgelehnt wird; für `fiskaly` wirft die Factory `TSE_PROVIDER_NOT_IMPLEMENTED`. Solange das so ist, bleibt `fiscal.tseSignatureChain` in Produktion leer.

Ein Signatur-Ausfall blockiert den Abschluss bewusst nie (§146a): der Tag schließt und wird als nachzusignieren markiert.

> **Folge für die Rekonziliation:** Der cloud-seitige `reAggregate` ruft **keinen** TSE-Pfad. Sobald ein echter Adapter aktiv ist, würde eine Neuberechnung Zahlen ändern, über die bereits signiert wurde — deshalb sperrt er seit [ADR 0032](../../../panary-cloud/docs/adr/0032-tagesabschluss-vollstaendigkeit-ohne-selbstauskunft.md) bei gesetzter Signaturkette.

---

## Verwandte Dateien

- Edge-Service: [`apps/api-edge/src/services/business-days/`](../../apps/api-edge/src/services/business-days)
- Aggregator-Lib: [`libs/domains/businessdays/aggregator/`](../../libs/domains/businessdays/aggregator)
- BusinessDay-Schema: [`libs/domains/businessdays/domain/src/lib/business-day.schema.ts`](../../libs/domains/businessdays/domain/src/lib/business-day.schema.ts)
- Location-Schema: [`libs/domains/locations/domain/src/lib/location.schema.ts`](../../libs/domains/locations/domain/src/lib/location.schema.ts) (Feld `operationMode`)
- Migrations: `apps/api-edge/migrations/20260515000001_locations_operation_mode.ts`, `20260515000002_businessdays_closing_lifecycle.ts`
- POS-Dialoge: [`libs/domains/businessdays/feature-pos-closing-dialog/`](../../libs/domains/businessdays/feature-pos-closing-dialog)
- Cloud-Pendant: siehe panary-cloud/docs/domains/tagesabschluss-aggregation.md
