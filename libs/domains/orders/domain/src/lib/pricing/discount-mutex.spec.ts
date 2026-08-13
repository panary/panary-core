import { describe, expect, it } from 'vitest'
import { assertNoLegacyDiscountWrite, clearLegacyDiscountIfApplied, findLegacyDiscountWrite } from './discount-mutex'
import type { AppliedDiscount, Discount } from '../order.schema'

// discount-mutex: sobald eine Order (nicht-leere) `appliedDiscounts` traegt, gewinnt
// das neue Feld und der Legacy-`discount` wird aktiv (auf `null`) geleert. Ohne
// appliedDiscounts bleibt der Legacy-Rabatt als Fallback unveraendert.

const legacyDiscount: Discount = { discountType: 'percent', discount: 10 }

const appliedOrder: AppliedDiscount = {
  _id: 'ad-1',
  name: 'Happy Hour',
  method: 'manual',
  target: 'order',
  valueType: 'percent',
  valuePercent: 10,
  valueCents: 0,
  computedAmountCents: 0,
  appliedAt: '2026-07-04T10:00:00.000Z',
}

describe('clearLegacyDiscountIfApplied', () => {
  it('leert discount (null), wenn appliedDiscounts nicht-leer ist', () => {
    expect(clearLegacyDiscountIfApplied(legacyDiscount, { appliedDiscounts: [appliedOrder] })).toBeNull()
  })

  it('behaelt discount, wenn appliedDiscounts fehlt (Legacy-Fallback)', () => {
    expect(clearLegacyDiscountIfApplied(legacyDiscount, {})).toBe(legacyDiscount)
  })

  it('behaelt discount, wenn appliedDiscounts leeres Array ist', () => {
    expect(clearLegacyDiscountIfApplied(legacyDiscount, { appliedDiscounts: [] })).toBe(legacyDiscount)
  })

  it('behaelt discount, wenn appliedDiscounts null ist (Edge-Sync-Serialisierung)', () => {
    expect(clearLegacyDiscountIfApplied(legacyDiscount, { appliedDiscounts: null })).toBe(legacyDiscount)
  })

  it('gibt null zurueck, auch wenn kein discount gesetzt war (kein Fehler)', () => {
    expect(clearLegacyDiscountIfApplied(undefined, { appliedDiscounts: [appliedOrder] })).toBeNull()
  })

  it('laesst undefined discount ohne appliedDiscounts unveraendert (kein Feld-Rauschen)', () => {
    expect(clearLegacyDiscountIfApplied(undefined, {})).toBeUndefined()
  })
})

// Abschaffung des Legacy-Felds (ADR 0030): ein externer Schreibzugriff auf `discount`
// wird sichtbar abgelehnt. Das LEEREN bleibt erlaubt — es ist der Migrationspfad.
describe('findLegacyDiscountWrite', () => {
  it('meldet einen gesetzten Legacy-discount', () => {
    expect(findLegacyDiscountWrite({ discount: legacyDiscount })).toContain('abgeschafft')
  })

  it('meldet auch einen Festbetrags-Rabatt', () => {
    expect(findLegacyDiscountWrite({ discount: { discountType: 'amount', discount: 5 } })).not.toBeNull()
  })

  it('laesst discount: null durch (Alt-Wert leeren ist der Migrationspfad)', () => {
    expect(findLegacyDiscountWrite({ discount: null })).toBeNull()
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

  it('wirft nicht beim Leeren', () => {
    expect(() => assertNoLegacyDiscountWrite({ discount: null })).not.toThrow()
  })
})
