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

export interface CogsAggregate {
  consumptionLines: ConsumptionLine[]
  totalFoodCostCents: number
  /** Detail-Eintrag pro Zutat mit Pricing-Auflösung. */
  pricedLines: Array<ConsumptionLine & { baseUnitPriceCents: number; totalCostCents: number }>
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

/**
 * Berechnet COGS aus verkauften Bestellungen.
 *
 * Pipeline:
 *   1. Pro reguläre Order: pro LineItem inkl. Modifier/Menu-Items
 *      → Falls Item direkte Zutatenreferenzen hat: `ingredientReferences`
 *      → Falls Item eine Rezeptur referenziert: `recipeReferences` über
 *        `recipeIngredientMap` in Zutaten zerlegen
 *   2. Zutatenmengen pro `ingredientId` aufaddieren
 *   3. Mit `ingredientPricing.get(ingredientId)` × Menge multiplizieren
 *   4. Total = Σ totalCostCents
 *
 * Stornos/Refunds/Subsidies werden ausgeschlossen — sie verbrauchen zwar
 * theoretisch Material, aber dieser Verbrauch ist als Write-Off zu erfassen.
 */
export function computeCogs(
  orders: ReadonlyArray<Order>,
  ingredientPricing: IngredientPricingMap,
  recipeIngredients: RecipeIngredientMap,
): CogsAggregate {
  const regular = orders.filter(isRegularSale)

  // Aggregation pro Zutat
  const ingredientUsage = new Map<string, ConsumptionLine>()

  for (const order of regular) {
    for (const item of order.lineItems ?? []) {
      accumulateLineItem(item, item.amount, ingredientUsage, recipeIngredients)
      for (const mod of item.modifiers ?? []) {
        accumulateLineItem(mod as OrderLineItem, item.amount * mod.amount, ingredientUsage, recipeIngredients)
      }
      if (item.menuDrink) {
        accumulateLineItem(item.menuDrink as OrderLineItem, item.amount * item.menuDrink.amount, ingredientUsage, recipeIngredients)
      }
      if (item.menuSideDish) {
        accumulateLineItem(item.menuSideDish as OrderLineItem, item.amount * item.menuSideDish.amount, ingredientUsage, recipeIngredients)
      }
    }
  }

  // Pricing + Total
  const pricedLines: CogsAggregate['pricedLines'] = []
  let totalFoodCostCents = 0
  // Determinismus: Sortierung nach ingredientId
  const sortedKeys = [...ingredientUsage.keys()].sort()
  for (const id of sortedKeys) {
    const line = ingredientUsage.get(id)!
    const priceCents = ingredientPricing.get(id) ?? 0
    const totalCostCents = multiplyCents(priceCents, line.quantityUsed)
    pricedLines.push({ ...line, baseUnitPriceCents: priceCents, totalCostCents })
    totalFoodCostCents += totalCostCents
  }

  return {
    consumptionLines: pricedLines.map(({ baseUnitPriceCents: _p, totalCostCents: _c, ...rest }) => rest),
    totalFoodCostCents,
    pricedLines,
  }
}

function accumulateLineItem(
  item: OrderLineItem | { ingredientReferences?: unknown; recipeReferences?: unknown; amount?: number },
  effectiveAmount: number,
  ingredientUsage: Map<string, ConsumptionLine>,
  recipeIngredients: RecipeIngredientMap,
): void {
  // Direkte Zutatenreferenzen
  const ingredientRefs = (item as OrderLineItem).ingredientReferences ?? []
  for (const ref of ingredientRefs) {
    const id = (ref as { ingredientId?: string; externalId?: string }).ingredientId
      ?? (ref as { externalId?: string }).externalId
    const quantity = (ref as { quantity?: number }).quantity ?? 0
    const unit = (ref as { unit?: string }).unit ?? ''
    const name = (ref as { name?: string }).name ?? ''
    if (!id) continue
    const usedQuantity = quantity * effectiveAmount
    addUsage(ingredientUsage, id, name, unit, usedQuantity)
  }

  // Rezeptur-Auflösung mit historischer Versions-Auflösung (REV-2):
  // 1. Wenn recipeReferences[i].version gesetzt: versionierter Map-Key
  //    `<externalId>:v<version>` versuchen.
  // 2. Wenn nicht vorhanden ODER version fehlt: Fallback auf `<externalId>`
  //    (= aktuelle Recipe-Version).
  const recipeRefs = (item as OrderLineItem).recipeReferences ?? []
  for (const ref of recipeRefs) {
    const recipeId = (ref as { externalId?: string; recipeId?: string }).externalId
      ?? (ref as { recipeId?: string }).recipeId
    const refQuantity = (ref as { quantity?: number }).quantity ?? 1
    const refVersion = (ref as { version?: number }).version
    if (!recipeId) continue

    let ingredients: RecipeIngredientResolution[] | undefined
    if (typeof refVersion === 'number') {
      ingredients = recipeIngredients.get(versionedRecipeKey(recipeId, refVersion))
    }
    if (!ingredients) {
      ingredients = recipeIngredients.get(recipeId)
    }
    if (!ingredients) continue

    for (const ing of ingredients) {
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
