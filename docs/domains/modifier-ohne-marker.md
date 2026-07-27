---
type: Domain Concept
title: „OHNE"-Modifier — Marker `amount −1`, Preisregel und Bon-Darstellung
description: 'Ein Modifier mit amount −1 ist der POS-Marker für „OHNE <Extra>": schema-seitig nur auf Modifier-Ebene erlaubt, preisneutral in beiden Brutto-Rechenpfaden und auf dem Bon als „OHNE …" ohne Betrag gedruckt.'
tags: [orders, pos, pricing, businessdays]
status: stable
generated: { by: claude-code/opus-5, at: 2026-07-27T20:45:00Z }
---

# „OHNE"-Modifier

## Der Marker

Im POS-Bestelldialog gibt es einen OHNE-Toggle (`toggleWithoutExtra()`). Ist er
aktiv und der Bediener tippt auf einen Modifier, der noch **nicht** auf der
Position liegt, legt `decreaseExtra()` einen Modifier mit **`amount: -1`** an
(`libs/domains/orders/feature-pos-order-dialog/src/lib/order-dialog.component.ts`).
Das ist der kanonische Marker für „OHNE `<Extra>`".

−1 ist der Boden: weiteres Dekrementieren ist ein No-Op, `increaseExtra()`
springt von einem negativen Wert direkt auf 1.

> **Zweiter, unabhängiger Pfad:** `toggleRemovableIngredient()` entfernt
> Rezept-Zutaten und legt dafür einen Modifier mit `amount: 1` und dem Namen
> `„Ohne <Zutat>"` an. Dieser Pfad nutzt den −1-Marker **nicht** — beide
> Mechanismen existieren nebeneinander.

## Schema

`amount` ist auf Order-Zeilen und Bundle-Komponenten auf `minimum: 0` gehärtet.
Nur Modifier dürfen −1 führen — dafür existiert
`modifierLineItemSchema` in `libs/domains/orders/domain/src/lib/order.schema.ts`:

| Schema                    | `amount`       | Verwendung                          |
| ------------------------- | -------------- | ----------------------------------- |
| `genericLineItemSchema`   | `minimum: 0`   | Basis, `menuDrink`/`menuSideDish`   |
| `lineComponentSchema`     | `minimum: 0`   | Bundle-Komponenten (`components[]`) |
| `modifierLineItemSchema`  | `minimum: -1`  | `orderLineItem.modifiers[]`         |
| `orderLineItemSchema`     | `minimum: 0`   | Position selbst                     |

Auf Hauptartikel und Komponenten hat ein negativer `amount` keine Bedeutung — er
würde nur negativen Verbrauch (`explodeOrderConsumption`, siehe
[Verbrauchs-Explosion](verbrauchs-explosion.md)) und negatives Brutto erzeugen.

### Historie

Die Inline-Feld-Härtung vom 2026-05-22 (`3a502fe`) setzte `minimum: 0` auf
`genericLineItemSchema.amount` und traf damit auch die Modifier. Jede Bestellung
mit einem OHNE-Modifier wurde ab da mit
`/lineItems/0/modifiers/0/amount must be >= 0` als `400` abgelehnt — am Edge, im
POS-Offline-Outbox-Replay (400 = `terminal` → Bestellung verworfen) und beim
Cloud-Sync-Push (`BadRequest` → `classifyAcceptError` → `TERMINAL`, also
`rejected` ohne Retry und ohne `sync-conflicts`-Eintrag). Betroffen war
identisch `pre-orders`, das dasselbe `orderLineItemSchema` verwendet.

## Preisregel: OHNE ist preisneutral

Ein OHNE-Modifier trägt **nichts** zum Brutto bei — auch dann nicht, wenn der
zugrunde liegende Modifier einen Aufpreis hat. Begründung: das Extra wurde nie
berechnet, also gibt es beim Weglassen auch keine Gutschrift.

Vorher zog „Margherita 6,70 € ohne Bacon (1,90 €)" den Bacon-Aufpreis ab und
kostete 4,80 €, während der Bon die OHNE-Zeile **ohne Betrag** druckte — der
Beleg rechnete sich nicht auf.

Die Regel ist in **beiden** Brutto-Pfaden implementiert, die konsistent bleiben
müssen:

* `computeOrderTax` / `lineItemGrossCents` (`libs/domains/orders/domain/src/lib/pricing/compute-order-tax.ts`)
  — die kanonische Engine für `order.taxSnapshot` und die POS-Anzeige; Helper
  `modifierGrossCents()`.
* `computeGrossFromLineItems` (`libs/domains/businessdays/aggregator/src/lib/order-total.ts`)
  — der Reporting-Fallback, wenn `payment` und `taxSnapshot` fehlen.

Driftet einer der beiden ab, weichen Tagesabschluss und Order-Snapshot
voneinander ab (siehe [Tagesabschluss-Architektur](tagesabschluss-architektur.md)).

## Bon

`order-receipt.renderer.ts` liest `mod.amount === -1` und druckt die Zeile als
`1x OHNE <Name>` ohne Betrag. Mit der Preisregel oben stimmt der Bon jetzt mit
der Summe überein.

## Verbrauch

`explodeOrderConsumption` reicht das Vorzeichen unverändert durch: ein
OHNE-Modifier **mit** `ingredientReferences` mindert den Materialverbrauch der
Position (Netting). Der POS erzeugt in diesem Pfad allerdings leere
`ingredientReferences`, der Effekt ist dort also 0.

## Rollout-Reihenfolge

`orderDataSchema` ist geteilter Code: `panary-cloud` validiert Sync-Pushes mit
demselben Schema aus dem gepinnten `@panary/orders`. Eine Schema-Lockerung im
Edge allein reicht nicht — sonst legt der Edge die Bestellung an, der
Cloud-Receiver lehnt sie mit `BadRequest` ab und der Outbox-Eintrag geht
**terminal** (kein Retry, kein Konflikt-Eintrag) verloren.

1. `panary-core` releasen (`@panary/orders` publizieren)
2. Pin in `panary-cloud/package.json` bumpen, `api-cloud` deployen
3. POS-Client-Release

Siehe auch [Rabatte](rabatte.md) für die übrige Preis-/Steuer-Arithmetik.
