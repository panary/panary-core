import { StringEnum } from '@feathersjs/typebox'

/**
 * Diät-Tags für Zutaten und Rezepte.
 * Werden manuell gepflegt und/oder automatisch aus Allergenen abgeleitet
 * (Phase 2.5 — siehe panary-cloud/documentation/ingredients-supplier-products-konzept.md §10).
 */
export const DIETARY_TAGS = [
  'VEGETARIAN',
  'VEGAN',
  'GLUTEN_FREE',
  'LACTOSE_FREE',
  'PORK_FREE',
  'HALAL',
  'KOSHER',
] as const

export type DietaryTag = (typeof DIETARY_TAGS)[number]

export const dietaryTagSchema = StringEnum([...DIETARY_TAGS])
