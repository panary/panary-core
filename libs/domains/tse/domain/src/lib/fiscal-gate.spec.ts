import { describe, expect, it } from 'vitest'

import { requiresFiscalSignature } from './fiscal-gate'

describe('requiresFiscalSignature', () => {
  it('pos-cashier → true', () => {
    expect(requiresFiscalSignature({ operationMode: 'pos-cashier' })).toBe(true)
  })

  it('orders-only → false', () => {
    expect(requiresFiscalSignature({ operationMode: 'orders-only' })).toBe(false)
  })

  it('undefined/null → false (kein fiskalischer Vorgang)', () => {
    expect(requiresFiscalSignature({})).toBe(false)
    expect(requiresFiscalSignature({ operationMode: null })).toBe(false)
  })
})
