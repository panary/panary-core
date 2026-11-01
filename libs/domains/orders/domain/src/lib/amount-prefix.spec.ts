import { describe, expect, it } from 'vitest'

import { amountPrefix } from './amount-prefix'

describe('amountPrefix (#1257)', () => {
  it.each([
    [1, ''],
    [2, '2x '],
    [12, '12x '],
  ])('Menge %s → „%s"', (amount, erwartet) => {
    expect(amountPrefix(amount)).toEqual(erwartet)
  })
})
