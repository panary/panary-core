import type { ProductLabeling } from './product.schema'

/**
 * Die drei Zustände der Deklaration am Produkt (#393, ADR 0050).
 *
 * `null` und ein fehlendes Feld bedeuten dasselbe: Das Fehlen trägt jedes Bestandsprodukt, `null`
 * entsteht beim Widerruf. Wer den Zustand selbst ableitet, prüft leicht nur eine der beiden
 * Formen — und zeigt ein widerrufenes Gericht dann als „deklariert" an.
 */
export const PRODUCT_LABELING_STATES = ['UNDECLARED', 'DECLARED_NONE', 'DECLARED'] as const
export type ProductLabelingState = (typeof PRODUCT_LABELING_STATES)[number]

export function getProductLabelingState(labeling: ProductLabeling | null | undefined): ProductLabelingState {
  if (labeling == null) return 'UNDECLARED'
  return labeling.allergens.length === 0 && labeling.additives.length === 0 ? 'DECLARED_NONE' : 'DECLARED'
}
