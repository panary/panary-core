import { describe, it, expect } from 'vitest'
import { TransactionMethod } from '@panary/orders/domain'
import { aggregateFinancials } from './financials'
import { validateFinancials } from './validations'
import { makeOrder } from './fixtures/orders.fixtures'

describe('validations', () => {
  it('Sauberer Datensatz produziert keine Errors', () => {
    const orders = [
      makeOrder({ grossAmount: 11.9, taxes: [{ rate: 19, gross: 11.9, tax: 1.9 }], paymentMethod: TransactionMethod.CASH }),
      makeOrder({ grossAmount: 10.7, taxes: [{ rate: 7, gross: 10.7, tax: 0.7 }], paymentMethod: TransactionMethod.CARD }),
    ]
    const financials = aggregateFinancials(orders)
    const result = validateFinancials(financials)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('Erkennt manuell injizierte Inkonsistenz im Channel-Split', () => {
    const orders = [
      makeOrder({ grossAmount: 10 }),
    ]
    const financials = aggregateFinancials(orders)
    // Manipulation
    const corrupted = { ...financials, channels: { ...financials.channels, posCents: 9999 } }
    const result = validateFinancials(corrupted)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.code === 'financials.channels_mismatch')).toBe(true)
  })

  it('Erkennt manipulierte Payment-Summe', () => {
    const orders = [
      makeOrder({ grossAmount: 10, paymentMethod: TransactionMethod.CASH }),
    ]
    const financials = aggregateFinancials(orders)
    const corrupted = { ...financials, payments: { ...financials.payments, cashCents: 1500 } }
    const result = validateFinancials(corrupted)
    expect(result.errors.some(e => e.code === 'financials.payments_mismatch')).toBe(true)
  })

  it('Leerer Datensatz ist valid', () => {
    const financials = aggregateFinancials([])
    const result = validateFinancials(financials)
    expect(result.valid).toBe(true)
  })
})
