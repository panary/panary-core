---
title: Order-Bundle-Preismodell — generische Komponenten + kanonische Preis-/Steuer-Engine
date: 2026-05-25
category: Architektur
domains: [orders, products, businessdays]
status: implemented
---

# Order-Bundle-Preismodell — generische Komponenten + kanonische Preis-/Steuer-Engine

ADR zur Modernisierung des Order-Zeilen-Modells (Bundles/Menüs) und zur
Vereinheitlichung der Preis-/Steuer-Berechnung. Fiskal-relevant (KassenSichV /
korrekter MwSt-Split).

## Problem

Der Tagesabschluss schlug mit `financials.tax_split_mismatch` fehl
(`Σ taxes.gross 10,90 € ≠ grossTotal 7,00 €`). Drei strukturelle Ursachen:

1. **Zwei divergente Gesamtsummen.** Der POS-Checkout stempelte
   `payment.totalAmount` über `active-orders.calculateTotal` = `Σ price × amount`
   — **ohne** Modifier/Menü-Komponenten (→ 7,00 €). Die kanonische Engine
   `computeOrderTax` (→ `taxSnapshot`) addierte alle Komponenten (→ 10,90 €). Der
   Aggregator nahm `grossTotal` aus `payment`, den Steuer-Split aus `taxSnapshot`
   → Mismatch.
2. **Legacy-Order-Shape.** Ein Menü wurde über `isMenu` + `menuDrink` +
   `menuSideDish` abgebildet — zwei hartkodierte Slots, kein generisches
   Komponenten-Array, **kein** Steuersatz je Komponente, **kein**
   `bundlePricingMode` auf der Zeile.
3. **Festpreis-Menüs (FIXED_PROPORTIONAL) waren in der Order-Preislogik nicht
   abgebildet.** Der Katalog kennt `bundlePricingMode` ROLLUP /
   FIXED_PROPORTIONAL, die Order-Zeile rollte aber immer alle Teile auf (10,90 €
   statt Festpreis 7,00 €).

## Entscheidung

### 1. Generisches Komponenten-Modell auf der Order-Zeile (Phase 1)

`orderLineItemSchema` erhält:

- `components?: LineComponent[]` — `lineComponentSchema = genericLineItemSchema +
  { optionGroupId?, role?: 'main'|'drink'|'side'|'sauce'|'extra' }`. Jede
  Komponente trägt ihren **eigenen** `taxInside`/`taxOutside`.
- `bundlePricingMode?: 'ROLLUP' | 'FIXED_PROPORTIONAL'` auf der Zeile.
- `isMenu`/`menuDrink`/`menuSideDish` bleiben optional (deprecated) für
  Rückwärtskompatibilität bestehender Orders + alter Reader. Sunset später.

### 2. Eine kanonische Engine für Brutto UND Steuer-Split (Phase 2/3)

`computeOrderTax` (`@panary/orders/domain`) ist **Single Source of Truth**:

- `price`-Felder sind BRUTTO; MwSt wird fiskalisch korrekt EXTRAHIERT
  (`netFromGross`). Invariante pro Satz: `netto + steuer === brutto` (cent-genau).
- **Beide** Seiten der Mismatch-Gleichung laufen jetzt über diese Engine:
  - Backend stempelt `taxSnapshot = computeOrderTax(order)` (Hook
    `calculate-tax-details.ts`).
  - POS stempelt `payment.totalAmount = calculateTaxSummary(order).brutto`
    (= `computeOrderTax`), statt `Σ price × amount`.
  → `payment.totalAmount === taxSnapshot.brutto` ist damit **strukturell
  garantiert**; `tax_split_mismatch` kann für neue Orders nicht mehr entstehen.

### 3. FIXED_PROPORTIONAL: Marktwert-Verteilung in der Engine (Phase 2/4)

Bei `bundlePricingMode === 'FIXED_PROPORTIONAL'` ist `line.price` der **Festpreis**
(Verteilungs-Ziel). Die Engine verteilt diesen Festpreis summen-exakt
(`distributeByLargestRemainder`) über die **Normalpreise** der Komponenten — jede
Komponente behält ihren eigenen Steuersatz (Marktwertmethode). Das Hauptgericht
ist eine Komponente mit `role: 'main'` und eigenem Normalpreis-Gewicht.
Ad-hoc-Modifier liegen ON TOP (à-la-carte, am Zeilensatz).

**Herkunft des Haupt-Normalpreises:** neues optionales Katalogfeld
`product.mainPrice`. Fehlt der Wert, trägt der Order-Writer den **Restbetrag**
(Festpreis − Σ übrige Komponenten) als Hauptgewicht ein — die Verteilung bleibt in
jedem Fall summen-exakt == Festpreis (dann „Hauptgericht absorbiert die Ersparnis"
statt echt-proportional).

> Verworfene Alternative: den Festpreis-Vorteil als `appliedDiscount` (Menü-Rabatt)
> abbilden. Dagegen: würde als Pseudo-Rabatt in der Rabatt-Statistik auftauchen,
> bräuchte Order-Dialog-Bookkeeping (Anlage/Entfernung mit der Zeile) und kollidiert
> mit echten Rabatten. Der Engine-Pfad liefert dasselbe Ergebnis ohne diese Nachteile.

### 4. Reader-Strategie: components[] bevorzugt, Legacy-Fallback (Phase 5)

- **Bon** (`order-receipt.renderer.ts`): Gesamtsumme kanonisch über
  `computeOrderTax` (== Snapshot/Payment). Artikelpreis FIXED-aware (Festpreis statt
  Doppelzählung); Beilage/Getränk/Modifier bei FIXED ohne Aufschlag (im Festpreis
  enthalten).
- **Order-Total-Fallback** (`order-total.ts`, Prio 3 hinter payment → taxSnapshot):
  FIXED nutzt `line.price`; `components[]` wird on top addiert (ROLLUP/à-la-carte);
  sonst Legacy-Slots.
- **COGS** (`cogs.ts`): Material-Verbrauch bleibt **bewusst** auf den Legacy-Slots
  (vom Writer weiter gefüllt). `components[]` dient nur der fiskalischen Preis-/
  Steuer-Verteilung, NICHT dem Verbrauch — sonst Doppel-/Fehlverbrauch. Umstieg
  erst beim Legacy-Sunset.

## Berechnungsregeln (Engine `collectLineGrosses`)

| Zeilen-Form | Brutto-Atome |
|---|---|
| Ohne `components[]` (Legacy) | `lineGrossCents` = price×amount + Modifier + menuDrink + menuSideDish, alles am Zeilensatz |
| `components[]`, kein FIXED (ROLLUP/à-la-carte) | Hauptartikel (`line.price`) + Modifier am Zeilensatz; jede Komponente am EIGENEN Satz (parent-skaliert) |
| `bundlePricingMode = FIXED_PROPORTIONAL` | `line.price` (Festpreis) per Largest-Remainder über die Komponenten-Normalpreise verteilt, jede am eigenen Satz; Ad-hoc-Modifier on top am Zeilensatz |

### Beispiel — Festpreis-Menü „Hamburger 100gr" (7,00 € fix, take-out)

Komponenten (Normalpreis · Außer-Haus-Satz): Hauptgericht 4,40 € @7 %, Getränk
2,30 € @19 %, Beilage 0,90 € @7 % → Σ Normalpreise 7,60 €.

`distributeByLargestRemainder(700ct, [440, 230, 90])` → `[405, 212, 83]` (Σ 700).

- 7 %: 4,05 € (Haupt) + 0,83 € (Beilage) = 4,88 €
- 19 %: 2,12 € (Getränk)
- **Brutto = 7,00 € == Festpreis == payment == taxSnapshot.brutto** ✓

Ist `mainPrice` nicht gesetzt: Hauptgewicht = 7,00 − (2,30 + 0,90) = 3,80 €; Σ
Gewichte = Festpreis → Komponenten zum vollen Normalpreis, Haupt trägt den Rest.

## Konsequenzen

- **`payment.totalAmount === taxSnapshot.brutto`** strukturell garantiert (Single
  Engine) → Tagesabschluss-Mismatch für neue Orders behoben.
- **Kein Backfill.** Bestehende Orders behalten ihre (ggf. fehlerhafte) Shape; ihre
  bereits fehlgeschlagenen Tagesabschlüsse werden hierdurch NICHT automatisch grün.
- **Transitions-Zustand:** Der POS-Writer füllt für FIXED-Bundles `components[]`
  **und** die Legacy-Slots (Dialog-Anzeige, COGS, alte Reader). ROLLUP/à-la-carte
  bleiben unverändert bei der Legacy-Shape → keine Regression.
- **Echt-proportionaler Split** greift, sobald `product.mainPrice` gepflegt ist.
  Der Produkt-Editor liegt in **panary-cloud** (admin-dashboard) → mainPrice-Eingabe
  + `PANARY_CORE_REF`-Bump sind Phase 6. Bis dahin: Restbetrags-Fallback (korrekte
  Summe, „Haupt absorbiert"-Split).
- **SQLite-Migration** `20260525000003_products_add_main_price` (nullable, additiv).
  MongoDB/Cloud schemalos → Feld reist über Sync mit, sobald Cloud den Core-Pin zieht.
- **Sunset (späterer Schritt):** Legacy-Slots entfernen; dann müssen Bon, COGS und
  Dialog-Anzeige vollständig auf `components[]` umgestellt werden (heute teils noch
  Legacy-Pfad).

## Code-Pfade

| Bereich | Datei |
|---|---|
| Order-Schema (components/bundlePricingMode/role) | `libs/domains/orders/domain/src/lib/order.schema.ts` |
| Engine (Brutto + Steuer-Split, FIXED-Pfad) | `libs/domains/orders/domain/src/lib/pricing/compute-order-tax.ts` |
| Money-Helfer (Largest-Remainder) | `libs/domains/orders/domain/src/lib/pricing/money.ts` |
| POS-Total (payment-Stempel) | `libs/domains/orders/feature-pos-active/src/lib/active-orders.component.ts` |
| POS-Writer (Bundle → components[]) | `libs/domains/orders/feature-pos-order-dialog/src/lib/order-dialog.component.ts` |
| Dialog-Preis-Anzeige (FIXED-aware) | `libs/domains/orders/data-access/src/lib/utils/prices-and-taxes.ts` |
| taxSnapshot-Stempel (Backend) | `apps/api-edge/src/hooks/calculate-tax-details.ts` |
| Bon-Renderer | `apps/api-edge/src/print-server/order-receipt.renderer.ts` |
| Order-Total-Fallback | `libs/domains/businessdays/aggregator/src/lib/order-total.ts` |
| COGS (Legacy-Slots) | `libs/domains/businessdays/aggregator/src/lib/cogs.ts` |
| Katalog-Feld `mainPrice` | `libs/domains/products/domain/src/lib/product.schema.ts` |
| Migration | `apps/api-edge/migrations/20260525000003_products_add_main_price.ts` |

## Tests

- `compute-order-tax.spec.ts` — ROLLUP (mehrsatzig), FIXED_PROPORTIONAL
  (proportional, Restbetrags-Fallback, Modifier-on-top, Mengen-Skalierung),
  Invariante `netto+steuer==brutto`, Rabatte. 22 Tests.
- `order-total.spec.ts` — FIXED-Fallback (Festpreis, keine Doppelzählung),
  components[]-ROLLUP-Fallback. +2 Tests.
