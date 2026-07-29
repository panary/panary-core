// discount-mutex-Resolver-Tests (Edge).
//
// Invariante: sobald eine Order (nicht-leere) `appliedDiscounts` traegt, gewinnt das
// neue Feld und der Legacy-`discount` wird server-seitig geleert (`null`) — statt als
// stale Karteileiche in SQLite/Sync/Audit stehen zu bleiben. Ohne appliedDiscounts
// bleibt der Legacy-Rabatt als aktiver Fallback erhalten.

import { describe, expect, it } from 'vitest'
import { orderDataResolver, orderPatchResolver } from './orders.schema'

const ctx = () => ({ params: {} }) as never

const legacyDiscount = { discountType: 'percent', discount: 10 } as const

const appliedOrder = {
  _id: 'ad-1',
  name: 'Happy Hour',
  method: 'manual',
  target: 'order',
  valueType: 'percent',
  valuePercent: 10,
  valueCents: 0,
  computedAmountCents: 0,
  appliedAt: '2026-07-04T10:00:00.000Z',
} as const

describe('orderDataResolver (create) — discount-mutex', () => {
  it('leert discount (null), wenn appliedDiscounts nicht-leer ist — nur ein Rabatt bleibt', async () => {
    const resolved = await orderDataResolver.resolve(
      { discount: legacyDiscount, appliedDiscounts: [appliedOrder], lineItems: [] } as never,
      ctx(),
    )
    expect(resolved.discount).toBeNull()
    expect(resolved.appliedDiscounts).toEqual([appliedOrder])
  })

  it('behaelt discount, wenn keine appliedDiscounts gesetzt sind (Legacy-Fallback)', async () => {
    const resolved = await orderDataResolver.resolve({ discount: legacyDiscount, lineItems: [] } as never, ctx())
    expect(resolved.discount).toEqual(legacyDiscount)
  })
})

describe('orderPatchResolver (patch) — discount-mutex', () => {
  it('ueberschreibt einen gespeicherten Legacy-discount aktiv mit null, wenn der Patch appliedDiscounts setzt', async () => {
    // Der Patch enthaelt KEIN discount-Feld — der Resolver muss den Alt-Wert
    // trotzdem aktiv auf null setzen (undefined wuerde ihn in der DB stehen lassen).
    const resolved = await orderPatchResolver.resolve({ appliedDiscounts: [appliedOrder] } as never, ctx())
    expect(resolved.discount).toBeNull()
    expect(resolved.appliedDiscounts).toEqual([appliedOrder])
  })

  it('behaelt discount, wenn der Patch nur den Legacy-Rabatt setzt (kein appliedDiscounts)', async () => {
    const resolved = await orderPatchResolver.resolve({ discount: legacyDiscount } as never, ctx())
    expect(resolved.discount).toEqual(legacyDiscount)
  })

  it('laesst discount unangetastet (undefined), wenn der Patch weder Feld setzt', async () => {
    const resolved = await orderPatchResolver.resolve({ status: 'completed' } as never, ctx())
    expect(resolved.discount).toBeUndefined()
  })
})
