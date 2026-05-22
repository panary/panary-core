---
title: Verbrauchs-Explosion (computeCogs / explodeOrderConsumption)
date: 2026-05-22
category: Business-Logik
domains: [businessdays, orders, recipes, ingredients]
status: aktiv
---

# Verbrauchs-Explosion — `@panary/businessdays/aggregator`

Die Datei `libs/domains/businessdays/aggregator/src/lib/cogs.ts` ist die **Single
Source of Truth** dafür, welche Zutaten ein Verkauf in welcher Menge verbraucht.
Sie wird sowohl vom panary-cloud Live-Stock-Hook als auch vom Tagesabschluss
benutzt — strukturelle Konsistenz-Garantie. Reine Funktionen, keine I/O,
Cent-Integer-Arithmetik.

## Funktionen

### `explodeOrderConsumption(order, recipeMap)`

Zerlegt **eine** Order in den Material-Verbrauch pro Zutat — **ohne**
Klassifizierungs-Filter (regulär/Personal/Firma) und ohne Preis-Bewertung. Die
gemeinsame Primitive für:

- `computeCogs` (filtert reguläre Verkäufe + bewertet) und
- den Cloud-Stock-Hook (bucht je Order eine Bewegung mit dem zur Klassifizierung
  passenden Movement-Typ — auch Personal-/Firmenessen, deren Material das Lager
  verlässt).

Liefert `{ lines, unresolvedRecipes }`.

### `computeCogs(orders, pricing, recipeMap)`

Filtert via `isRegularSale` (schließt Personal-/Firmenessen, Stornos, Refunds
aus), summiert `explodeOrderConsumption` und bewertet mit der Pricing-Map.
Liefert `consumptionLines`, `pricedLines`, `totalFoodCostCents`,
`unresolvedRecipes`.

### `priceConsumptionLines(lines, pricing)`

Aggregiert pro `ingredientId`, sortiert deterministisch, bewertet mit
`multiplyCents`.

## Rechenregeln

### Proportionaler Faktor

```
Verbrauch je Rezept-Zutat
  = Zutatenmenge × (recipeReference.quantity / recipe.baseQuantity) × lineItem.amount
```

- **Modifier** (Extras): `lineItem.amount × modifier.amount` (multiplikativ).
- **Menü-Bestandteile** (`menuDrink`/`menuSideDish`): `lineItem.amount × child.amount`.
- **Direkte Zutaten** (`ingredientReferences`): `Menge × amount` (ohne Rezept-Faktor).

> **Keine Einheiten-Umrechnung.** Alle Mengen (Rezept-Zutat, `recipe.baseQuantity`,
> Bestands-/Preis-Basiseinheit) müssen in derselben Einheit vorliegen. Das
> Ingredient-Feld `conversionFactor` ist ein **Einkaufs**-Referenzwert (z. B.
> 25 kg-Sack → 25000 g) und fließt NICHT in den Verbrauch ein.

### Rezept-Auflösung (Embedded-Snapshot bevorzugt)

1. **Eingebetteter Snapshot** `recipeReference.recipeIngredients[]` +
   `recipeBaseQuantity` (RAW: rohe Mengen, Faktor zur Buchungszeit) — versionsgenau,
   selbstständig.
2. **Externe `RecipeIngredientMap`** (Fallback, versioniert `<id>:v<version>`) —
   `quantityPerOutputUnit` ist bereits `Menge / baseQuantity` normalisiert.
3. Sonst → `unresolvedRecipes` (kein stiller 0-Verbrauch). Caller loggen das laut.

### `onlyOutsideConsumption`

Zutaten mit diesem Flag zählen nur bei `order.dineLocation !== 'dine-in'`
(Außer-Haus, z. B. Tüten/Verpackung). Greift in allen drei Pfaden.

### Ausschlüsse (`computeCogs`, via `isRegularSale`)

Personalessen (`staffPaymentInfo`), Firmenessen (`customerPaymentInfo`), Stornos
(`ABORTED`/`cancellation`) und Refunds (`payment.state = REFUNDED`) fließen NICHT
in COGS. Ihr Material-Verbrauch wird in panary-cloud separat gebucht
(STAFF_MEAL/CORPORATE_MEAL bzw. Reversal).

## Bestand-Snapshot — `inventory-snapshot.ts`

```
theoreticalUsage  = consumption + wasteRaw + wasteFinished
calculatedClosing = openingStock + addedStock − theoreticalUsage
variance          = physicalStock − calculatedClosing   (falls gemessen)
```

## Tests

`cogs.spec.ts` (39) + `inventory-snapshot.spec.ts` (12) decken alle verschachtelten
Fälle ab: Modifier, Menü, Extras, Rezept mit Faktor, direkte Zutat, Storno-/
Staff-/Refund-Ausschluss, Embedded-vs-Map-Vorrang, `onlyOutsideConsumption`,
`unresolvedRecipes`, Determinismus. Konsumenten-Details (Cloud) siehe
`panary-cloud/documentation/warenbewegung-bestandslogik.md`.
