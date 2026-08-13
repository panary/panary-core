---
type: ADR
title: Legacy-Rabattfeld order.discount wird abgeschafft statt kombiniert
description: Statt einer Kombinationsregel zwischen order.discount und appliedDiscounts wird das Legacy-Feld abgeschafft — externe Schreibzugriffe werden mit 400 abgelehnt, interne Sync-Pfade behalten den bisherigen Mutex.
tags: [orders, discounts, pricing, sync]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-08-13T21:40:00Z }
---

# Legacy-Rabattfeld `order.discount` wird abgeschafft statt kombiniert

## Problem

Eine Order kannte zwei Rabattquellen: `appliedDiscounts[]` (das Modell) und `discount`
(Legacy-Einzelrabatt). `computeOrderTax` behandelt `appliedDiscounts` als führend und
`discount` nur als Fallback, wenn die Liste leer ist.

Der 2026-07-04 eingeführte „discount-mutex" sollte die Doppelung auflösen, indem er
`discount` leert, sobald `appliedDiscounts` geschrieben wird. Er entschied das aber
allein am **eingehenden Payload**:

```ts
const hasApplied = Array.isArray(data.appliedDiscounts) && data.appliedDiscounts.length > 0
return hasApplied ? null : value
```

Patcht ein Flow nur `{ discount }` auf eine Order, die in der DB **bereits**
`appliedDiscounts` trägt, sieht der Mutex nichts. Der Legacy-Rabatt wird gespeichert
und von der Engine ignoriert: ein persistierter Rabatt **ohne Wirkung** auf Preis,
`taxSnapshot` und Bon — fiskalisch heikel, weil der Wert in Audit, Sync und Anzeige
auftaucht (panary/panary-core#181).

Der Fall war nicht theoretisch. `applyCorporateCustomer` (POS, „Firmenkunde zuweisen")
patchte genau so: `patch.discount = customer.discountDetails`, ohne `appliedDiscounts`.
Auf einer Bestellung mit Automatik- oder Picker-Rabatt war der Vertragsrabatt des
Firmenkunden damit wirkungslos gespeichert. Der Flow umging zusätzlich die
Personalessen-Exklusivität, weil `assertStaffMealDiscountExclusivity` nur
`appliedDiscounts` prüft.

## Entscheidung

**Keine Kombinationsregel — das Legacy-Feld wird abgeschafft.** Es gibt genau eine
Rabattquelle je Order, und das ist `appliedDiscounts`.

Erwogen und verworfen wurden die drei naheliegenden Kombinationsregeln (ablehnen /
in einen `appliedDiscounts`-Eintrag übersetzen / bestehende ersetzen). Alle drei lösen
den Einzelfall, erhalten aber die Doppelung — und damit die nächste Variante desselben
Fehlers an der nächsten Stelle, die nur ein Feld schreibt.

Konkret:

1. **Extern wird abgelehnt, nicht gestrippt.** Ein Client, der `discount` setzt, bekommt
   `400`. Stilles Strippen wäre dieselbe Fehlerklasse wie vorher: Der Client meldet einen
   Rabatt an, der Server verwirft ihn wortlos.
2. **`discount: null` bleibt erlaubt.** Das Leeren ist der Migrationspfad für
   Bestands-Orders, nicht sein Gegenteil.
3. **Intern (Sync-Apply) bleibt der Mutex.** Ein `400` wäre dort TERMINAL (rejected ohne
   Retry) — Bestandsbestellungen von Alt-Edges würden dauerhaft hängenbleiben. Interne
   Aufrufe bereinigen Alt-Werte weiterhin still über `clearLegacyDiscountIfApplied`.
4. **Der Firmenkunden-Vertragsrabatt wird zum Snapshot** und **ersetzt** die bestehende
   Liste — konsistent zu `applyDiscount` und `applyStaffMeal`, die beide ersetzen. Ein
   Legacy-`discountDetails` aus den Kunden-Stammdaten trägt kein `combinable`-Metadatum;
   Stapeln wäre also nicht validierbar.

Das Zeitfenster war ausschlaggebend: Staging und Prod sind in der Testphase, es gibt
praktisch keine produktiven Datensätze. Nach dem Produktivgang wäre die Entfernung
eines fiskalisch relevanten Feldes deutlich teurer.

## Konsequenzen

- `applyCorporateCustomer` schreibt einen `AppliedDiscount` mit `discountId: null` und
  dem Kundennamen. Der Vertragsrabatt ist damit erstmals **auswertbar** und läuft durch
  die Personalessen-Exklusivität: Firmenkunde mit Vertragsrabatt auf einer
  Personalessen-Bestellung wird jetzt mit `400` abgelehnt statt still gestapelt.
- Der Legacy-Spiegel entfällt in `order.service.ts` (`CreateOrderInput.discountDetails`)
  und im Bestelldialog. Der Dialog baute für jeden `discountDetails` ohnehin bereits
  einen `appliedDiscounts`-Eintrag — der Spiegel war reine Doppelung.
- ⚠️ **Versions-Skew:** Ein POS-Build im Feld, der noch `discount` patcht, kann einen
  Firmenkunden nicht mehr zuweisen (der `400` verwirft den ganzen Patch, auch
  `customerPaymentInfo`). Der POS-Build muss vor dem Pre-Production-Test mit ausgerollt
  werden.
- Der Tagesabschluss-Aggregator (`financials.ts`) liest die Rabatt-KPI bisher
  **ausschließlich** aus `order.discount` und kennt `appliedDiscounts` nicht. Da der
  Mutex `discount` leert, zählt jeder über den POS gewährte Rabatt heute als
  **0 Rabatte / 0,00 €** — im Z-Bon, in `discountRatePercent` und in der Cloud-Karte
  „Finanzen". Dasselbe gilt für `LIVE_KPI_ORDER_PROJECTION` in panary-cloud. Beides wird
  im Zuge dieser Entscheidung nachgezogen, bevor das Feld verschwindet.
- Die Entfernung von `discount` aus `orderSchema`, `computeOrderTax`, Sync-Feldliste,
  `ORDER_JSON_FIELDS` und der SQLite-Migration ist ein Breaking Change am Order-Schema
  und braucht einen Core-Release plus Pin-Bump in panary-cloud.
- 🚨 **Kein stiller Repair.** Bestands-Orders mit gesetztem `discount` werden vor der
  Feld-Entfernung erkannt und **berichtet**, nicht umgeschrieben — abgeschlossene bzw.
  signierte Vorgänge sind nach KassenSichV unveränderbar.

Verwandt: [0026-fiskal-snapshot-serverseitig-abgeleitet.md](0026-fiskal-snapshot-serverseitig-abgeleitet.md)
(der Snapshot wird serverseitig aus dem Zielzustand gerechnet — der wirkungslose
Legacy-Rabatt war genau die Lücke, die dieser Ableitung entging),
[Rabatte](../domains/rabatte.md).
