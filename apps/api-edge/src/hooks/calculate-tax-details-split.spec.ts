import { describe, expect, it, vi } from 'vitest'
import { calculateTaxDetailsOnPatch } from './calculate-tax-details'

/**
 * 🚨 Der stille Fehlschlag, gegen den diese Spec steht: Faende
 * `calculateTaxDetailsOnPatch` die neue Gegenbuchung nicht, rechnete er auf dem
 * Stand VOR dem Split und schriebe der Quelle die volle Steuer zurueck — HTTP
 * 200, kein Log, falsche Zahl auf einem steuerrelevanten Dokument.
 */
function line(id: string, price: number, amount: number, taxRate: number) {
  return {
    _id: id,
    externalId: `ext-${id}`,
    amount,
    name: id,
    price,
    recipeReferences: [],
    ingredientReferences: [],
    taxInside: taxRate,
    taxOutside: taxRate,
    topic: '',
    productGroupExternalId: 'pg-1',
    bundleNumber: null,
    modifiers: [],
  }
}

function makeContext(data: Record<string, unknown>) {
  const stored = {
    _id: 'o-1',
    dineLocation: 'dine-in',
    lineItems: [line('l1', 10.0, 5, 19)],
    appliedDiscounts: [],
  }
  const get = vi.fn().mockResolvedValue(stored)
  return {
    id: 'o-1',
    data,
    app: { service: () => ({ get }) },
  } as never
}

const ENTRY = {
  _id: 'so-1',
  targetOrderId: 't-1',
  lineItemRowId: 'l1',
  amount: 3,
  grossCents: 3000,
  splitAt: '2026-09-24T12:00:00.000Z',
}

describe('calculateTaxDetailsOnPatch — Split-Gegenbuchung', () => {
  it('erkennt splitOff als preisrelevant und rechnet nur noch den Rest', async () => {
    const context = makeContext({ splitOff: [ENTRY] }) as any
    await calculateTaxDetailsOnPatch(context)

    // 5 x 10,00 minus 3 abgegebene = 20,00 brutto.
    expect(context.data.taxSnapshot.brutto).toBeCloseTo(20.0, 5)
    expect(context.data.taxSnapshot.taxes).toHaveLength(1)
    expect(context.data.taxSnapshot.taxes[0].taxRate).toBe(19)
  })

  it('laesst einen Patch ohne preisrelevantes Feld unberuehrt', async () => {
    const context = makeContext({ pager: 3 }) as any
    await calculateTaxDetailsOnPatch(context)
    expect(context.data.taxSnapshot).toBeUndefined()
  })
})
