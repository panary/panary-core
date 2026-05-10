import { StringEnum } from '@feathersjs/typebox'

/**
 * EU-LMIV: Liste der 14 deklarationspflichtigen Hauptallergene.
 * Quelle: Verordnung (EU) Nr. 1169/2011, Anhang II.
 */
export const ALLERGENS = [
  'GLUTEN',
  'CRUSTACEANS',
  'EGG',
  'FISH',
  'PEANUTS',
  'SOY',
  'MILK',
  'NUTS',
  'CELERY',
  'MUSTARD',
  'SESAME',
  'SULPHITES',
  'LUPIN',
  'MOLLUSCS',
] as const

export type Allergen = (typeof ALLERGENS)[number]

export const allergenSchema = StringEnum([...ALLERGENS])

/**
 * Mapping von Open-Food-Facts `allergens_tags`-Werten auf Panary-Allergene.
 * Quelle: <https://world.openfoodfacts.org/allergens>.
 */
export const OFF_ALLERGEN_TAG_MAP: Readonly<Record<string, Allergen>> = Object.freeze({
  'en:gluten': 'GLUTEN',
  'en:crustaceans': 'CRUSTACEANS',
  'en:eggs': 'EGG',
  'en:fish': 'FISH',
  'en:peanuts': 'PEANUTS',
  'en:soybeans': 'SOY',
  'en:milk': 'MILK',
  'en:nuts': 'NUTS',
  'en:celery': 'CELERY',
  'en:mustard': 'MUSTARD',
  'en:sesame-seeds': 'SESAME',
  'en:sulphur-dioxide-and-sulphites': 'SULPHITES',
  'en:lupin': 'LUPIN',
  'en:molluscs': 'MOLLUSCS',
})
