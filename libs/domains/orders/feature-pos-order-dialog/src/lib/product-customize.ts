import type { OrderLineItem } from '@panary/orders/data-access'
import type { ProductSchema } from '@panary/products/domain'

/**
 * Anpassen-Panel des Bestelldialogs (#639): Zutaten abwählen, Extras hinzufügen.
 *
 * Reine Funktionen ohne Angular — der Dialog mutiert die Bestellzeile, diese Datei
 * liest sie aus und liefert das View-Model. Die OHNE-Funktionstaste ist entfallen:
 * Zutaten werden abgewählt, Extras nur hinzugefügt und per Minus wieder entfernt.
 */

type IngredientReference = OrderLineItem['ingredientReferences'][number]

/** Präfix des Modifiers, der eine abgewählte Zutat kennzeichnet (`docs/domains/modifier-ohne-marker.md`). */
export const REMOVED_INGREDIENT_PREFIX = 'Ohne '

/**
 * Gruppe „Alle Modifier" im Sheet (#1085): alle Modifier des Katalogs, die nicht schon in einer
 * Optionsgruppe des Produkts stehen. Ersetzt das frühere Extras-Raster mit ABBRUCH-Taste.
 */
export const ALL_MODIFIERS_GROUP_ID = 'all-modifiers'
export const ALL_MODIFIERS_GROUP_NAME = 'Alle Modifier'

/** Für wie viele Stück einer Zeile gilt eine Anpassung im Panel (#699)? */
export type CustomizeScope = 'one' | 'all'

export interface CustomizeIngredient {
  externalId: string
  name: string
  /** Vorzeichenbehaftet, Abzug negativ — so pflegt ihn der Cloud-Zutaten-Dialog. */
  priceAdjustment: number
  removed: boolean
}

export interface CustomizeOption {
  productId: string
  name: string
  price: number
  amount: number
  /** Optionsgruppen zeigen jedes Produkt, buchen lässt sich nur ein Modifier (#273). */
  isModifier: boolean
}

export interface CustomizeGroup {
  id: string
  name: string
  minSelections: number
  /** `null` = unbegrenzt (`maxSelections: 0` im Katalog). */
  maxSelections: number | null
  selected: number
  /** Wie viele noch fehlen, bis `minSelections` erreicht ist. */
  missing: number
  full: boolean
  options: CustomizeOption[]
}

export interface CustomizeModel {
  name: string
  amount: number
  ingredients: CustomizeIngredient[]
  groups: CustomizeGroup[]
  /** Kurzform der Anpassungen, z. B. „ohne Ketchup · 2× Käse". */
  summary: string
  canFinish: boolean
  /** Ist die Gruppe „Alle Modifier" eingeblendet? */
  showingAllModifiers: boolean
  /** Weder abwählbare Zutaten noch Extras — das Sheet zeigt einen Leerzustand (#1085). */
  empty: boolean
}

export interface CustomizeCatalog {
  findProductById(id: string): ProductSchema | undefined
  isModifier(product: ProductSchema): boolean
}

/** Hat das Produkt etwas, das sich im Panel anpassen lässt? */
export function hasCustomizableContent(product: Pick<ProductSchema, 'ingredientReferences' | 'optionGroups'>): boolean {
  const removable = (product.ingredientReferences ?? []).some(ing => ing.isRemovable)
  const options = (product.optionGroups ?? []).some(group => group.options.length > 0)
  return removable || options
}

/** Öffnet sich das Panel beim Antippen des Produkts von selbst? */
export function opensCustomizeAutomatically(product: ProductSchema): boolean {
  return product.ui?.showOptionsAuto === true && hasCustomizableContent(product)
}

/**
 * Ist dieser Modifier die Abwahl einer Zutat? Seit #640 trägt er `removesIngredientExternalId`.
 * Der Rückfall auf Präfix + `externalId` deckt Zeilen, die vor dem Feld angelegt wurden.
 */
export function isRemovalModifier(mod: OrderLineItem['modifiers'][number]): boolean {
  return !!mod.removesIngredientExternalId || mod.name.startsWith(REMOVED_INGREDIENT_PREFIX)
}

function removalIndex(lineItem: OrderLineItem, ingredientExternalId: string): number {
  return lineItem.modifiers.findIndex(
    mod =>
      mod.removesIngredientExternalId === ingredientExternalId ||
      (mod.externalId === ingredientExternalId && mod.name.startsWith(REMOVED_INGREDIENT_PREFIX)),
  )
}

export function isIngredientRemoved(lineItem: OrderLineItem, ingredientExternalId: string): boolean {
  return removalIndex(lineItem, ingredientExternalId) !== -1
}

/**
 * Schaltet eine Zutat zwischen „drin" und „ohne". Gibt zurück, ob sie danach abgewählt ist.
 * Abgewählt heißt: genau ein Modifier „Ohne X" mit `amount 1` und dem Preis-Effekt der Zutat.
 */
export function toggleIngredientRemoval(
  lineItem: OrderLineItem,
  ingredient: Pick<IngredientReference, 'externalId' | 'ingredientName' | 'priceAdjustment'>,
  topic: string,
): boolean {
  const index = removalIndex(lineItem, ingredient.externalId)
  if (index !== -1) {
    lineItem.modifiers.splice(index, 1)
    return false
  }
  lineItem.modifiers.push({
    _id: ingredient.externalId,
    externalId: ingredient.externalId,
    name: REMOVED_INGREDIENT_PREFIX + ingredient.ingredientName,
    amount: 1,
    price: ingredient.priceAdjustment || 0,
    parentId: lineItem.externalId,
    taxInside: lineItem.taxInside,
    taxOutside: lineItem.taxOutside,
    topic,
    recipeReferences: [],
    ingredientReferences: [],
    removesIngredientExternalId: ingredient.externalId,
  })
  return true
}

/** Gebuchte Menge eines Options-Produkts auf der Zeile — Bestands-Marker mit `amount −1` zählen nicht. */
function amountOf(lineItem: OrderLineItem, productId: string): number {
  return lineItem.modifiers
    .filter(mod => mod._id === productId && !isRemovalModifier(mod))
    .reduce((sum, mod) => sum + Math.max(0, mod.amount), 0)
}

/**
 * `allModifiers` gesetzt = „Alle Modifier" ist eingeblendet. `product` ist bei einem Menü (BUNDLE)
 * `undefined`: Dessen Optionsgruppen sind Menüschritte, keine Extras.
 */
export function buildCustomizeModel(
  lineItem: OrderLineItem,
  product: ProductSchema | undefined,
  catalog: CustomizeCatalog,
  allModifiers?: readonly ProductSchema[],
): CustomizeModel {
  const references = lineItem.ingredientReferences ?? product?.ingredientReferences ?? []
  const ingredients: CustomizeIngredient[] = references
    .filter(ing => ing.isRemovable)
    .map(ing => ({
      externalId: ing.externalId,
      name: ing.displayName || ing.ingredientName,
      priceAdjustment: ing.priceAdjustment || 0,
      removed: isIngredientRemoved(lineItem, ing.externalId),
    }))

  const groups: CustomizeGroup[] = (product?.optionGroups ?? [])
    .map(group => {
      const options: CustomizeOption[] = []
      for (const option of group.options) {
        const optionProduct = catalog.findProductById(option.productId)
        if (!optionProduct) continue
        options.push({
          productId: option.productId,
          name: optionProduct.name,
          price: optionProduct.price || 0,
          amount: amountOf(lineItem, option.productId),
          isModifier: catalog.isModifier(optionProduct),
        })
      }
      const selected = options.reduce((sum, option) => sum + option.amount, 0)
      const minSelections = group.minSelections ?? 0
      const maxSelections = group.maxSelections ? group.maxSelections : null
      return {
        id: group.id,
        name: group.name,
        minSelections,
        maxSelections,
        selected,
        missing: Math.max(0, minSelections - selected),
        full: maxSelections !== null && selected >= maxSelections,
        options,
      }
    })
    .filter(group => group.options.length > 0)

  if (allModifiers) {
    const inProductGroups = new Set(groups.flatMap(group => group.options.map(option => option.productId)))
    const options: CustomizeOption[] = allModifiers
      .filter(modifier => !inProductGroups.has(modifier._id))
      .map(modifier => ({
        productId: modifier._id,
        name: modifier.name,
        price: modifier.price || 0,
        amount: amountOf(lineItem, modifier._id),
        isModifier: catalog.isModifier(modifier),
      }))
    if (options.length > 0) {
      groups.push({
        id: ALL_MODIFIERS_GROUP_ID,
        name: ALL_MODIFIERS_GROUP_NAME,
        minSelections: 0,
        maxSelections: null,
        selected: options.reduce((sum, option) => sum + option.amount, 0),
        missing: 0,
        full: false,
        options,
      })
    }
  }

  const parts = [
    ...ingredients.filter(ing => ing.removed).map(ing => `ohne ${ing.name}`),
    ...groups.flatMap(group =>
      group.options
        .filter(option => option.amount > 0)
        .map(option => (option.amount > 1 ? `${option.amount}× ${option.name}` : option.name)),
    ),
  ]

  return {
    name: lineItem.name,
    amount: lineItem.amount,
    ingredients,
    groups,
    summary: parts.join(' · '),
    canFinish: groups.every(group => group.missing === 0),
    showingAllModifiers: !!allModifiers,
    empty: ingredients.length === 0 && groups.length === 0,
  }
}
