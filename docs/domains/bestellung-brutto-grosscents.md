---
type: Domain Concept
title: 'Gespeichertes Brutto je Bestellung (grossCents)'
description: 'Warum jede Bestellung ihr Brutto in Cents als Feld grossCents trägt, wer es wann setzt (Edge-Hook nach dem Resolver, aus getOrderGrossCents), warum die Funktion dafür nach orders/domain umgezogen ist und was für Bestandsbons gilt.'
tags: [orders, aggregator, sync, edge]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-17T08:00:00Z }
---

# Gespeichertes Brutto je Bestellung (`grossCents`)

Der Betrag, den Bestellliste, Tagesabschluss und Dashboard für eine Bestellung zeigen, ist
`getOrderGrossCents(order)`: die gezahlte Summe, außer es ist der nie befüllte Zahlungs-Platzhalter,
sonst `taxSnapshot.brutto`, sonst die Summe der Positionen nach Split. Diese Kette lässt sich nicht als
Mongo-Bedingung ausdrücken. Die Betragssuche der Bestellliste in der Cloud filterte deshalb nur auf
`taxSnapshot.brutto` und fand Bestellungen nicht, deren Spalte einen anderen Betrag zeigte
([panary/panary-cloud#1092](https://github.com/panary/panary-cloud/issues/1092)).

**Entscheidung (Michael, 2026-10-16):** Das Brutto wird beim Schreiben gespeichert, berechnet von genau
dieser einen Funktion ([#728](https://github.com/panary/panary-core/issues/728)).

## Feld

`grossCents` im Order-Schema ([`order.schema.ts`](../../libs/domains/orders/domain/src/lib/order.schema.ts)):
Ganzzahl in Cents, optional mit `Null`-Zweig.

| Stelle | Warum |
|---|---|
| `orderSchema` | optional, weil Bestandsbons das Feld nicht tragen; `Null`, weil der Edge ungesetzte SQLite-Spalten als `null` pusht |
| `orderDataSchema` (Pick) | dieses Schema validiert auch den Sync-Push Edge→Cloud. Ein nicht gepicktes Feld fiele dort als `additionalProperties` durch, und das ist TERMINAL (Outbox `rejected`, kein Retry) |
| `orderPatchSchema` | automatisch über `Type.Partial(orderSchema)` |
| `orderQueryProperties` | für die Betragssuche in der Cloud; `$gte`/`$lte` liefert `querySyntax` |

## Wer setzt es

Der Hook [`stampOrderGrossCents`](../../apps/api-edge/src/hooks/stamp-order-gross-cents.hook.ts) im
Edge-Service `orders`, auf `create` und `patch`, jeweils **nach** `resolveData` und **vor** den JSON-Hooks:

- **Nach dem Resolver**, weil erst dann feststeht, was gespeichert wird. Ein externer Patch mit
  `lineItems` oder `splitOff` wird dort still gestrippt. Ein Betrag aus dem ungestrippten Body wäre ein
  zweiter Betrag für dieselbe Bestellung.
- **Ein mitgeschickter Wert wird immer überschrieben.** Ein Client setzt das Feld nie, deshalb braucht es
  keinen Strip im Resolver.
- **Patch rechnet auf dem Zielstand:** gespeicherte Bestellung lesen, Body darübermergen (Feathers ersetzt
  je Spalte), dann rechnen. Jeder Patch rechnet neu, nicht nur „preisrelevante". Auch Zahlungsabschluss
  und Split ändern den Betrag, und eine Liste relevanter Felder wäre die nächste Stelle, die driftet.
- **Split** läuft über `orders.create` (Ziel) und `orders.patch` (Quelle) mit voller Hook-Kette. Beide
  Seiten tragen danach ihr eigenes Brutto.

Ein Lesefehler beim Patch (außer 404) bricht den Patch ab, statt still einen veralteten Betrag
stehenzulassen.

**Bekannte Grenze: parallele Patches.** Zwischen dem Lesen des Stands und dem Schreiben liegt ein
`await`. Patchen zwei Aufrufe dieselbe Bestellung gleichzeitig, rechnet der zweite auf dem Stand vor dem
ersten und kann ein veraltetes Brutto schreiben. Der nächste Patch korrigiert es. Dieselbe Lücke hat
`calculateTaxDetailsOnPatch` für den `taxSnapshot` seit jeher; ein Nachschreiben im After-Hook wäre ein
zweiter Write samt Outbox-Eintrag je Patch und wurde deshalb nicht gebaut.

## Wo die Funktion liegt

`getOrderGrossCents` und `computeGrossFromLineItems` liegen seit #728 in
[`order-gross.ts`](../../libs/domains/orders/domain/src/lib/order-gross.ts) (`@panary/orders/domain`).
Vorher lagen sie im Aggregator (`@panary/businessdays/aggregator`). Den darf weder `orders/domain` noch der
Edge importieren: Der Aggregator hängt selbst an `orders/domain`, und `api-edge` hat keinen Pfad zu ihm.
Der Aggregator re-exportiert beide Funktionen unverändert, Aufrufer in core und cloud bleiben gleich.

## Bestand

Die SQLite-Migration `20261017100000_orders_add_gross_cents.ts` legt eine nullable Spalte an und
**backfillt nicht**. Gesucht wird nur in der Cloud, und die backfillt ihren Bestand selbst (cloud#1092).
Ein Edge-Backfill müsste den Betrag in der Migration ausrechnen, ohne Domain-Import, also mit einer zweiten
Summenformel. Bestandsbons bekommen den Wert beim nächsten Patch.

## Tests

[`test/services/orders/gross-cents.test.ts`](../../apps/api-edge/test/services/orders/gross-cents.test.ts)
fährt die volle Hook-Kette gegen die migrierte Test-SQLite und liest die Spalte jeweils roh nach: Create,
überschriebener Client-Wert, Rabatt-Patch, Zahlung, Platzhalter-Zahlung, Patch ohne Preisbezug und Split.
