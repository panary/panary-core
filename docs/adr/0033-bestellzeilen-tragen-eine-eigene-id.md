---
type: ADR
title: Bestellzeilen tragen eine eigene ID, die Produktidentität steht in externalId
description: Warum `lineItem._id` seit #230 eine je Zeile vergebene uuidv7 ist statt der Produkt-ID — und warum der Duplikat-Check dafür auf `externalId` umgestellt wurde statt auf ein neues Feld.
tags: [orders, discounts, pos]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-08-14T23:25:00Z }
---

# Bestellzeilen tragen eine eigene ID

## Problem

`increaseLineItem` setzte als `lineItem._id` die **Produkt-ID** (`_id: product._id`). Für
gewöhnliche Artikel blieb sie eindeutig, weil der Duplikat-Check dort die Menge erhöhte,
statt eine zweite Zeile anzulegen. **Für Bundles ist dieser Check bewusst ausgesetzt** —
zwei gleiche Menüs ergaben also zwei Warenkorbzeilen mit derselben `_id`.

Das kollidiert mit zwei Stellen, die `_id` als **Zeilen**-Bezug lesen:

- `computeOrderTax` ordnet Positionsrabatte über `lineItemId` den Steuer-Atomen zu
  (`lines.filter(l => l.lineItemId === ad.lineItemId)`). Bei doppelter ID träfe ein Rabatt
  die Atome **beider** Zeilen: eine Position rabattiert, zwei abgezogen — still, weil die
  Summe plausibel bleibt. `evaluateLineDiscountGate` sperrte deshalb seit
  [#179](https://github.com/panary/panary-core/issues/179) den Rabatt auf mehrfach
  vorhandenen Zeilen. Das war die Notbremse, nicht die Lösung.
- Angulars `@for (… ; track lineItem._id)` bekommt doppelte Keys. Am Framework-Code
  gemessen (Angular 21.2.19): Das ist ein `console.warn` (NG0955) **innerhalb eines
  `ngDevMode`-Blocks** — im Produktions-Build der POS-App also gar keine Meldung. Die
  Reconciliation läuft vorher durch und ordnet DOM-Knoten über den Key zu; bei doppelten
  Keys ist diese Zuordnung nicht mehr eindeutig. Der Fehlerfall ist damit **still**, nicht
  laut.

## Entscheidung

**`lineItem._id` ist die Identität der Zeile** — eine je Zeile vergebene `uuidv7`. Die
**Produktidentität** der Zeile steht in `externalId`, das dafür ohnehin schon auf jeder
Zeile mitgeführt wird.

Der Duplikat-Check vergleicht entsprechend `externalId` statt `_id` — mit einer
Absicherung gegen leere Werte:

```ts
const productKey = orderLineItem.externalId
const existing = productKey ? this.#lineItems.find(item => item.externalId === productKey) : undefined
if (!isBundle && existing) return this.increaseQuantity(existing)
```

**Verworfen: ein neues `productId`-Feld auf der Zeile.** Es wäre selbsterklärender, aber
eine Schema-Änderung an `orderSchema.lineItems[]` — mit Cloud-Pin-Bump und Abstimmung
zweier Repos für einen Bezug, den `externalId` bereits trägt.

**Die Leer-Absicherung ist kein Detail.** `externalId` wird am Edge serverseitig vergeben
(`value || uuidv7()`) und ist im Patch-Resolver geschützt, das Schema erlaubt aber
weiterhin `null` — und `increaseLineItem` macht daraus `''`. Ohne die Bedingung hätten
alle Alt-Produkte ohne `externalId` denselben Schlüssel, und der Warenkorb fiele zu einer
einzigen Zeile zusammen. Kein Treffer bedeutet jetzt „zweite Zeile" statt „falsch
zusammengeführt" — nach der ID-Umstellung ein unschädlicher Ausgang, weil die Zeilen
unterscheidbar sind.

**Bestandsdaten werden nicht migriert.** Gespeicherte Orders tragen weiterhin die
Produkt-ID als Zeilen-`_id`. Die ID muss nur **innerhalb einer Order** eindeutig sein; ein
Rückschreiben wäre Aufwand ohne Gewinn und bei TSE-signierten Vorgängen ohnehin
ausgeschlossen.

## Konsequenzen

- **Die Sperre aus #179 bleibt stehen**, feuert im Normalbetrieb aber nicht mehr (durch
  Spec belegt). Sie deckt weiterhin zwei Wege ab: eine im Dialog bearbeitete
  **Bestands-Order** und jede künftige Änderung, die die ID-Vergabe zurückdreht. Eine
  Sperre, die nie feuert, kostet nichts; ihr Wegfall kostet stillen Umsatz.
- **Wer das Produkt einer Zeile sucht, nimmt `externalId`.** `bundle-flow.findOptionGroupByTopic`
  tat das über `_id` und wurde umgedreht (`externalId` zuerst, `_id` als Bestands-Fallback).
  Die Stelle war in der Vorab-Erhebung des Plans übersehen worden — sie fiel erst beim
  Durchsuchen des Aufrufgraphen auf, nicht durch einen roten Test.
- **`active-orders` trackt Bestellzeilen auf `$index`.** Dort stehen gespeicherte Orders,
  deren Zeilen die alte ID tragen; die Umstellung in `increaseLineItem` erreicht sie nicht.
- **Kein Schema- oder Migrationsbedarf:** `_id` bleibt ein uuid-String, nur die Herkunft
  ändert sich.
- Keine Auswertung liest `lineItem._id` als Produktschlüssel — geprüft für Verbrauch/COGS
  (`explodeOrderConsumption`, `compute-cogs`), Bestandsführung und die Cloud-Reports; alle
  lösen über `externalId`/`ingredientId`/`recipeId` auf. `orderInteractions.lineItemId` ist
  trotz des Namens ein **Index**, kein ID-Bezug.

## Verwandt

- [Rabatte](../domains/rabatte.md) — Positionsrabatte und die Sperre
- [ADR 0011](0011-order-dialog-monolith.md) — warum die Logik neben der Komponente liegt
- [ADR 0004](0004-order-bundle-pricing-modell.md) — `computeOrderTax` als einzige Rechenstelle
