import { describe, expect, it } from 'vitest'

import { getProductLabelingState, PRODUCT_LABELING_STATES } from './product-labeling'

describe('getProductLabelingState', () => {
  it('kennt genau drei Zustände', () => {
    expect(PRODUCT_LABELING_STATES).toEqual(['UNDECLARED', 'DECLARED_NONE', 'DECLARED'])
  })

  it('fehlendes Feld → nicht deklariert (jedes Bestandsprodukt)', () => {
    expect(getProductLabelingState(undefined)).toBe('UNDECLARED')
  })

  it('`null` → nicht deklariert (der Widerruf)', () => {
    expect(getProductLabelingState(null)).toBe('UNDECLARED')
  })

  it('leere Listen → deklariert, nichts Kennzeichnungspflichtiges', () => {
    expect(getProductLabelingState({ allergens: [], additives: [] })).toBe('DECLARED_NONE')
    expect(getProductLabelingState({ allergens: [], additives: [], declaredAt: '2026-09-26T08:00:00.000Z' })).toBe(
      'DECLARED_NONE',
    )
  })

  it('nur Allergene → deklariert', () => {
    expect(getProductLabelingState({ allergens: ['GLUTEN'], additives: [] })).toBe('DECLARED')
  })

  it('nur Zusatzstoffe → deklariert', () => {
    expect(getProductLabelingState({ allergens: [], additives: ['COLOURING'] })).toBe('DECLARED')
  })
})
