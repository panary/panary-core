import { Order, OrderLineItem } from '@panary/orders/domain'
import { isRegularSale } from './classifications'
import { multiplyCents } from './money'

/**
 * Verbrauchs-Eintrag pro Zutat — die Mengenangabe ist in `baseUnit` der Zutat
 * (z. B. Gramm, Milliliter, Stück). Bewertung erfolgt erst im COGS-Compute.
 */
export interface ConsumptionLine {
  ingredientId: string
  ingredientName: string
  ingredientVersion?: number
  unit: string
  quantityUsed: number
}

/** Eintrag mit Preis-Auflösung (Cents). */
export type PricedConsumptionLine = ConsumptionLine & {
  baseUnitPriceCents: number
  totalCostCents: number
}

/** Rezept-Referenz, die weder eingebettet noch über die Map auflösbar war. */
export interface UnresolvedRecipe {
  recipeExternalId: string
  version?: number
}

export interface CogsAggregate {
  consumptionLines: ConsumptionLine[]
  totalFoodCostCents: number
  /** Detail-Eintrag pro Zutat mit Pricing-Auflösung. */
  pricedLines: PricedConsumptionLine[]
  /**
   * Rezept-Referenzen, die NICHT aufgelöst werden konnten (weder über den
   * eingebetteten `recipeReference.recipeIngredients`-Snapshot noch über die
   * externe `recipeIngredientMap`). Statt eines stillen 0-Verbrauchs wird der
   * Fehler hier explizit gemeldet — Caller (Hook/Pipeline) sollen das laut
   * loggen, weil es einen lückenhaften Materialverbrauch bedeutet.
   */
  unresolvedRecipes: UnresolvedRecipe[]
}

/**
 * Pricing-Map: ingredientId → Preis pro Basiseinheit in Cents.
 * Wird vom Caller (Cloud-Aggregation-Pipeline) aus supplier-products vorberechnet
 * — die Aggregator-Lib bleibt frei von supplier-products-Coupling.
 */
export type IngredientPricingMap = ReadonlyMap<string, number>

/**
 * Pricing-Map: recipeExternalId → { ingredientId, quantityPerBaseUnit, unit }[]
 * Beschreibt, wie ein Rezept in Zutaten zerlegt wird. Caller berechnet das
 * einmalig aus den `recipes`-Snapshots der Periode.
 */
export interface RecipeIngredientResolution {
  ingredientId: string
  ingredientName: string
  ingredientVersion?: number
  /** Menge pro 1 Einheit Rezept-Output (z. B. 0.05 kg Mehl pro 1 Pizza). */
  quantityPerOutputUnit: number
  unit: string
  /**
   * Wenn `true`: Zutat zählt nur beim Außer-Haus-Verkauf (`dineLocation`
   * ≠ DINE_IN). Bei Verzehr im Haus wird sie übersprungen (z. B. Tüten,
   * Einweg-Verpackung). Optional — Default `false`. Wird vom Caller aus den
   * Recipe-Snapshots angereichert, falls vorhanden.
   */
  onlyOutsideConsumption?: boolean
}

/**
 * Map mit zwei Lookup-Schichten (REV-2):
 *   - Schluessel `<externalId>:<version>` — historische Versions-Aufloesung
 *   - Schluessel `<externalId>`         — Fallback auf aktuelle Version
 *
 * Wenn `order.lineItems[].recipeReferences[i].version` gesetzt ist, wird die
 * versionierte Variante bevorzugt; sonst greift der Fallback. Damit bleibt
 * der Aggregator rueckwaerts-kompatibel mit Maps, die nur die aktuelle
 * Version enthalten.
 */
export type RecipeIngredientMap = ReadonlyMap<string, RecipeIngredientResolution[]>

/** Helper: erzeugt den versions-spezifischen Map-Key. */
export function versionedRecipeKey(externalId: string, version: number): string {
  return `${externalId}:v${version}`
}

/** Order-Marker für DINE_IN (Verzehr im Haus). */
const DINE_IN = 'dine-in'

/**
 * Entscheidet, ob eine (Zutaten- oder Rezept-)Referenz beim aktuellen
 * `dineLocation` übersprungen wird. `onlyOutsideConsumption` ⇒ nur Außer-Haus
 * zählen, also bei DINE_IN überspringen.
 */
function isSkippedForDineLocation(
  ref: { onlyOutsideConsumption?: boolean } | undefined,
  dineLocation: string | undefined,
): boolean {
  return ref?.onlyOutsideConsumption === true && dineLocation === DINE_IN
}

/**
 * Eingebettete Rezept-Zutat aus `recipeReference.recipeIngredients` —
 * RAW-Konvention: `quantity` ist die rohe Rezept-Zutatenmenge in Zutat-
 * Basiseinheit (NICHT vorskaliert). Verbrauch = `quantity ×
 * (recipeReference.quantity / recipeReference.recipeBaseQuantity) × amount`.
 */
interface EmbeddedRecipeIngredient {
  externalId?: string
  ingredientId?: string
  ingredientName?: string
  version?: number
  quantity?: number
  unit?: string
  onlyOutsideConsumption?: boolean
}

/**
 * Zerlegt EINE Order in den Material-Verbrauch pro Zutat — OHNE
 * Klassifizierungs-Filter (regulär/Personal/Firma) und OHNE Preis-Bewertung.
 *
 * Das ist die gemeinsame Primitive für (a) `computeCogs` (filtert reguläre
 * Verkäufe + bewertet) und (b) den Cloud-Stock-Hook (bucht je Order eine
 * Bewegung mit dem zur Klassifizierung passenden Movement-Typ — auch für
 * Personal-/Firmenessen, deren Material ja ebenfalls das Lager verlässt).
 *
 * Auflösungs-Reihenfolge je `recipeReference`:
 *   1. **Eingebetteter Snapshot** `recipeReference.recipeIngredients[]` +
 *      `recipeBaseQuantity` (versionsgenaue Momentaufnahme zum Verkaufszeit-
 *      punkt). Bevorzugt — selbstständig, kein externer Lookup.
 *   2. **Externe Map** (`recipeIngredientMap`) als Fallback für Orders ohne
 *      materialisierten Snapshot (Altdaten/Edge).
 *   3. Wenn beides fehlt → `unresolvedRecipes` (kein stiller 0-Verbrauch).
 *
 * `onlyOutsideConsumption` wird honoriert: solche Zutaten zählen bei DINE_IN
 * nicht.
 */
export function explodeOrderConsumption(
  order: Order,
  recipeIngredients: RecipeIngredientMap,
): { lines: ConsumptionLine[]; unresolvedRecipes: UnresolvedRecipe[] } {
  const usage = new Map<string, ConsumptionLine>()
  const unresolved: UnresolvedRecipe[] = []
  const dineLocation = (order as { dineLocation?: string }).dineLocation

  for (const item of order.lineItems ?? []) {
    accumulateLineItem(item, item.amount, dineLocation, usage, recipeIngredients, unresolved)
    for (const mod of item.modifiers ?? []) {
      accumulateLineItem(mod as OrderLineItem, item.amount * mod.amount, dineLocation, usage, recipeIngredients, unresolved)
    }
    if (item.menuDrink) {
      accumulateLineItem(item.menuDrink as OrderLineItem, item.amount * item.menuDrink.amount, dineLocation, usage, recipeIngredients, unresolved)
    }
    if (item.menuSideDish) {
      accumulateLineItem(item.menuSideDish as OrderLineItem, item.amount * item.menuSideDish.amount, dineLocation, usage, recipeIngredients, unresolved)
    }
  }

  return { lines: [...usage.values()], unresolvedRecipes: unresolved }
}

/**
 * Bewertet Verbrauchs-Lines mit der Pricing-Map (Cents) und liefert
 * deterministisch nach `ingredientId` sortierte Detail-Lines + Total.
 */
export function priceConsumptionLines(
  lines: ReadonlyArray<ConsumptionLine>,
  ingredientPricing: IngredientPricingMap,
): { pricedLines: PricedConsumptionLine[]; totalFoodCostCents: number } {
  // Aggregation über mehrere Lines mit derselben ingredientId (z. B. wenn der
  // Caller Lines aus mehreren Orders zusammenführt).
  const merged = new Map<string, ConsumptionLine>()
  for (const line of lines) {
    const existing = merged.get(line.ingredientId)
    if (existing) existing.quantityUsed += line.quantityUsed
    else merged.set(line.ingredientId, { ...line })
  }

  const pricedLines: PricedConsumptionLine[] = []
  let totalFoodCostCents = 0
  const sortedKeys = [...merged.keys()].sort()
  for (const id of sortedKeys) {
    const line = merged.get(id)!
    const priceCents = ingredientPricing.get(id) ?? 0
    const totalCostCents = multiplyCents(priceCents, line.quantityUsed)
    pricedLines.push({ ...line, baseUnitPriceCents: priceCents, totalCostCents })
    totalFoodCostCents += totalCostCents
  }
  return { pricedLines, totalFoodCostCents }
}

/**
 * Berechnet COGS aus verkauften Bestellungen.
 *
 * Pipeline:
 *   1. Pro reguläre Order (`isRegularSale`): über `explodeOrderConsumption`
 *      pro LineItem inkl. Modifier/Menu-Items + Rezept-Auflösung.
 *   2. Zutatenmengen pro `ingredientId` aufaddieren.
 *   3. Mit `ingredientPricing.get(ingredientId)` × Menge multiplizieren.
 *   4. Total = Σ totalCostCents.
 *
 * Stornos/Refunds/Subventionen (Personal-/Firmenessen) werden ausgeschlossen —
 * sie sind kein regulärer Umsatz. Ihr Material-Verbrauch wird über den
 * Stock-Hook separat als STAFF_MEAL/CORPORATE_MEAL gebucht (nicht hier).
 */
export function computeCogs(
  orders: ReadonlyArray<Order>,
  ingredientPricing: IngredientPricingMap,
  recipeIngredients: RecipeIngredientMap,
): CogsAggregate {
  const regular = orders.filter(isRegularSale)

  const usage = new Map<string, ConsumptionLine>()
  const unresolvedRecipes: UnresolvedRecipe[] = []

  for (const order of regular) {
    const { lines, unresolvedRecipes: unresolved } = explodeOrderConsumption(order, recipeIngredients)
    for (const line of lines) {
      const existing = usage.get(line.ingredientId)
      if (existing) existing.quantityUsed += line.quantityUsed
      else usage.set(line.ingredientId, { ...line })
    }
    unresolvedRecipes.push(...unresolved)
  }

  const { pricedLines, totalFoodCostCents } = priceConsumptionLines([...usage.values()], ingredientPricing)

  return {
    consumptionLines: pricedLines.map(({ baseUnitPriceCents: _p, totalCostCents: _c, ...rest }) => rest),
    totalFoodCostCents,
    pricedLines,
    unresolvedRecipes,
  }
}

function accumulateLineItem(
  item:
    | OrderLineItem
    | { ingredientReferences?: unknown; recipeReferences?: unknown; amount?: number },
  effectiveAmount: number,
  dineLocation: string | undefined,
  ingredientUsage: Map<string, ConsumptionLine>,
  recipeIngredients: RecipeIngredientMap,
  unresolved: UnresolvedRecipe[],
): void {
  // Direkte Zutatenreferenzen
  const ingredientRefs = (item as OrderLineItem).ingredientReferences ?? []
  for (const ref of ingredientRefs) {
    const r = ref as EmbeddedRecipeIngredient & { name?: string }
    if (isSkippedForDineLocation(r, dineLocation)) continue
    const id = r.ingredientId ?? r.externalId
    const quantity = r.quantity ?? 0
    const unit = r.unit ?? ''
    const name = r.ingredientName ?? r.name ?? ''
    if (!id) continue
    addUsage(ingredientUsage, id, name, unit, quantity * effectiveAmount, r.version)
  }

  // Rezeptur-Auflösung. Bevorzugt der eingebettete Snapshot
  // (recipeReference.recipeIngredients + recipeBaseQuantity), Fallback die
  // externe Map (REV-2, versioniert).
  const recipeRefs = (item as OrderLineItem).recipeReferences ?? []
  for (const ref of recipeRefs) {
    const r = ref as {
      externalId?: string
      recipeId?: string
      quantity?: number
      version?: number
      recipeBaseQuantity?: number
      recipeIngredients?: EmbeddedRecipeIngredient[]
    }
    const recipeId = r.externalId ?? r.recipeId
    const refQuantity = r.quantity ?? 1
    if (!recipeId) continue

    // 1. Eingebetteter Snapshot (RAW-Konvention)
    const embedded = r.recipeIngredients
    if (Array.isArray(embedded) && embedded.length > 0) {
      const baseQuantity = r.recipeBaseQuantity
      const factor = refQuantity / (baseQuantity && baseQuantity > 0 ? baseQuantity : 1)
      for (const ing of embedded) {
        if (isSkippedForDineLocation(ing, dineLocation)) continue
        const ingId = ing.ingredientId ?? ing.externalId
        if (!ingId) continue
        addUsage(
          ingredientUsage,
          ingId,
          ing.ingredientName ?? '',
          ing.unit ?? '',
          (ing.quantity ?? 0) * factor * effectiveAmount,
          ing.version,
        )
      }
      continue
    }

    // 2. Externe Map (Fallback)
    let ingredients: RecipeIngredientResolution[] | undefined
    if (typeof r.version === 'number') {
      ingredients = recipeIngredients.get(versionedRecipeKey(recipeId, r.version))
    }
    if (!ingredients) {
      ingredients = recipeIngredients.get(recipeId)
    }
    if (!ingredients) {
      unresolved.push({ recipeExternalId: recipeId, version: r.version })
      continue
    }

    for (const ing of ingredients) {
      if (isSkippedForDineLocation(ing, dineLocation)) continue
      const usedQuantity = ing.quantityPerOutputUnit * refQuantity * effectiveAmount
      addUsage(ingredientUsage, ing.ingredientId, ing.ingredientName, ing.unit, usedQuantity, ing.ingredientVersion)
    }
  }
}

function addUsage(
  map: Map<string, ConsumptionLine>,
  ingredientId: string,
  ingredientName: string,
  unit: string,
  quantityUsed: number,
  ingredientVersion?: number,
): void {
  const existing = map.get(ingredientId)
  if (existing) {
    existing.quantityUsed += quantityUsed
    return
  }
  map.set(ingredientId, { ingredientId, ingredientName, ingredientVersion, unit, quantityUsed })
}
