---
type: Domain Concept
title: „OHNE"-Modifier — Marker `amount −1`, entfernbare Zutaten und Preisregeln
description: 'Zwei OHNE-Mechanismen im POS: der Marker amount −1 (preisneutral) und entfernbare Zutaten mit negativem priceAdjustment (Abzug) — beide brauchen Modifier-eigene Schema-Regeln, eine Klemme bei 0 und einen Bon, der sich aufrechnet.'
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

## Der zweite Pfad: entfernbare Zutaten

Daneben gibt es einen **unabhängigen** Mechanismus: `toggleRemovableIngredient()`
blendet für jede `ingredientReference` mit `isRemovable: true` eine Taste ein und
legt beim Antippen einen Modifier mit `amount: 1`, dem Namen `„Ohne <Zutat>"` und
`price: ingredient.priceAdjustment` an. Der −1-Marker kommt hier **nicht** vor.

Gepflegt wird das in panary-cloud im Dialog „Zutaten-Referenzen aktualisieren"
(Toggle „Entfernbar", Tooltip „Kunde kann Zutat entfernen") plus einem Preisfeld,
dessen Placeholder **`-1.0`** lautet: `priceAdjustment` ist ein **Abzug** fürs
Weglassen, kein Aufpreis. Der Katalog führt das Feld als vorzeichenoffenes
`Type.Number()`.

Bekannte Einschränkungen dieses Pfads:

* `recipeReferenceSchema` hat dieselben Felder `isRemovable`/`priceAdjustment`,
  aber der Cloud-Dialog schreibt dort hart `false`/`0` und der POS wertet nur
  `ingredientReferences` aus — Rezept-Ebene ist tote Schema-Fläche.
* Der Bon druckt „1x Ohne Zwiebeln" (Name trägt das „Ohne" selbst), **nicht**
  die `OHNE …`-Großschreibung des −1-Marker-Pfads.

## Schema

Beide Pfade brauchen auf Modifier-Ebene Werte, die auf Positions-Ebene verboten
sind: **`amount` −1** (Marker) und **negativer `price`** (Abzug). Dafür existiert
`modifierLineItemSchema` in `libs/domains/orders/domain/src/lib/order.schema.ts`:

| Schema                   | `amount`      | `price`       | Verwendung                          |
| ------------------------ | ------------- | ------------- | ----------------------------------- |
| `genericLineItemSchema`  | `minimum: 0`  | `minimum: 0`  | Basis, `menuDrink`/`menuSideDish`   |
| `lineComponentSchema`    | `minimum: 0`  | `minimum: 0`  | Bundle-Komponenten (`components[]`) |
| `modifierLineItemSchema` | `minimum: -1` | vorzeichenoffen | `orderLineItem.modifiers[]`       |
| `orderLineItemSchema`    | `minimum: 0`  | `minimum: 0`  | Position selbst                     |

Auf Hauptartikel und Komponenten haben negative Werte keine Bedeutung — sie
würden nur negativen Verbrauch (`explodeOrderConsumption`, siehe
[Verbrauchs-Explosion](verbrauchs-explosion.md)) und negatives Brutto erzeugen.

`modifierLineItemSchema.price` bleibt bewusst **ohne** untere Schranke: der
Katalog führt `priceAdjustment` ebenfalls unbegrenzt, und eine engere Schranke
hier wäre genau die Schema-Drift, die diese Klasse von 400ern erzeugt. Die
Begrenzung passiert fachlich (Zeile nie negativ, siehe unten).

### Historie

Die Inline-Feld-Härtung vom 2026-05-22 (`3a502fe`) setzte `minimum: 0` auf
`genericLineItemSchema.amount` **und** `.price` und traf damit beide OHNE-Pfade:

* `/lineItems/0/modifiers/0/amount must be >= 0` — jede Bestellung mit
  −1-Marker-Modifier.
* `/lineItems/0/modifiers/0/price must be >= 0` — jede Bestellung mit einer
  entfernten Zutat, deren `priceAdjustment` negativ konfiguriert war (also genau
  der vom Admin-UI vorgeschlagene Fall).

Der `400` traf drei Stellen: den Edge, den POS-Offline-Outbox-Replay (400 =
`terminal` → Bestellung verworfen) und den Cloud-Sync-Push (`BadRequest` →
`classifyAcceptError` → `TERMINAL`, also `rejected` ohne Retry und ohne
`sync-conflicts`-Eintrag). Betroffen war identisch `pre-orders`, das dasselbe
`orderLineItemSchema` verwendet.

## Preisregeln

Die beiden Pfade werden bewusst **unterschiedlich** bepreist:

| Pfad | Preisregel | Begründung |
| --- | --- | --- |
| `amount: -1` (Modifier weglassen) | **preisneutral** | Das Extra wurde nie berechnet — fürs Weglassen gibt es keine Gutschrift. |
| negativer `price` (Zutat entfernen) | **Abzug wie konfiguriert** | Der Betreiber hat den Abzug pro Zutat explizit gepflegt (`priceAdjustment`). |

Vorher zog „Margherita 6,70 € ohne Bacon (1,90 €)" den Bacon-Aufpreis ab und
kostete 4,80 €, während der Bon die OHNE-Zeile **ohne Betrag** druckte — der
Beleg rechnete sich nicht auf.

### Klemme bei 0

Der summierte Modifier-Beitrag einer Zeile ist nach unten auf `−Basispreis`
geklemmt (`modifiersGrossCents`). Ohne die Klemme könnte eine fehlkonfigurierte
Zutat die Position ins Negative ziehen — `bucketize()` verwirft Steuer-Eimer
`<= 0` komplett, die Position verschwände also samt ihres **positiven** Anteils
lautlos aus dem Steuer-Split.

Bei `FIXED_PROPORTIONAL` mindert ein Abzug den Festpreis **vor** der Verteilung
auf die Komponenten (statt als eigenes Atom am Zeilensatz zu liegen) — sonst
könnte er einen einzelnen Steuer-Eimer ins Negative ziehen. Er wirkt dadurch
proportional auf alle Sätze des Menüs (Marktwertmethode). Aufpreise liegen
weiterhin on top am Zeilensatz.

Die Regeln sind in **beiden** Brutto-Pfaden implementiert, die konsistent bleiben
müssen:

* `computeOrderTax` / `lineItemGrossCents` (`libs/domains/orders/domain/src/lib/pricing/compute-order-tax.ts`)
  — die kanonische Engine für `order.taxSnapshot` und die POS-Anzeige; Helper
  `modifierGrossCents()`.
* `computeGrossFromLineItems` (`libs/domains/businessdays/aggregator/src/lib/order-total.ts`)
  — der Reporting-Fallback, wenn `payment` und `taxSnapshot` fehlen.

Driftet einer der beiden ab, weichen Tagesabschluss und Order-Snapshot
voneinander ab (siehe [Tagesabschluss-Architektur](tagesabschluss-architektur.md)).

## Bon

`order-receipt.renderer.ts` druckt einen Betrag genau dann, wenn der Modifier den
Zeilenpreis bewegt — die Bedingung spiegelt `modifierGrossCents`:

* `amount === -1` → `1x OHNE <Name>`, **kein** Betrag (preisneutral).
* `amount > 0 && price !== 0` → Betrag, **auch negativ** (`-1,00 EUR`).

Vorher war die Bedingung `price > 0`, der Abzug wurde also verschwiegen. Damit
rechnet sich der Bon jetzt in beiden Pfaden gegen die Summe auf.

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
