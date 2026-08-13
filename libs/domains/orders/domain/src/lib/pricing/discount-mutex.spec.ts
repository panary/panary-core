import { describe, expect, it } from 'vitest'
import { assertNoLegacyDiscountWrite, findLegacyDiscountWrite } from './discount-mutex'
import type { Discount } from '../order.schema'

// Das Legacy-Rabattfeld `order.discount` ist abgeschafft (ADR 0030). Uebrig bleibt der
// Guard: Ein Schreibzugriff, der den Schluessel ueberhaupt mitschickt, wird sichtbar
// abgelehnt — inklusive `discount: null`, denn das Feld existiert nicht mehr.

const legacyDiscount: Discount = { discountType: 'percent', discount: 10 }

describe('findLegacyDiscountWrite', () => {
  it('meldet einen gesetzten Legacy-discount', () => {
    expect(findLegacyDiscountWrite({ discount: legacyDiscount })).toContain('abgeschafft')
  })

  it('meldet auch einen Festbetrags-Rabatt', () => {
    expect(findLegacyDiscountWrite({ discount: { discountType: 'amount', discount: 5 } })).not.toBeNull()
  })

  it('meldet auch discount: null — das Feld existiert nicht mehr', () => {
    expect(findLegacyDiscountWrite({ discount: null })).not.toBeNull()
  })

  it('laesst einen Patch ohne discount-Feld durch', () => {
    expect(findLegacyDiscountWrite({})).toBeNull()
  })

  it('ist tolerant gegenueber null/undefined-Payloads', () => {
    expect(findLegacyDiscountWrite(null)).toBeNull()
    expect(findLegacyDiscountWrite(undefined)).toBeNull()
  })
})

describe('assertNoLegacyDiscountWrite', () => {
  it('wirft bei gesetztem Legacy-discount', () => {
    expect(() => assertNoLegacyDiscountWrite({ discount: legacyDiscount })).toThrow(/abgeschafft/)
  })

  it('wirft auch bei discount: null', () => {
    expect(() => assertNoLegacyDiscountWrite({ discount: null })).toThrow(/abgeschafft/)
  })
})
