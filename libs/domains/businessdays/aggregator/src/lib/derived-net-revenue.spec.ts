import { describe, it, expect } from 'vitest'
import { TransactionMethod } from '@panary/orders/domain'
import {
  deriveDisplayNetRevenueCents,
  deriveTotalRevenueCents,
  deriveCashCardRevenueCents,
} from './derived-net-revenue'
import { aggregateFinancials } from './financials'
import { aggregateMealSubsidies } from './meal-subsidies'
import { makeOrder } from './fixtures/orders.fixtures'

describe('derived-net-revenue', () => {
  it('Anzeige-Netto = Cash/Card-Umsatz − unbezahlte Personalessen (1:1 Dashboard-Formel)', () => {
    // Szenario (entspricht Legacy `dashboard.store.ts:34-41` + `business-day-info.component.ts:110`):
    //   - 2 reguläre Cash-Verkäufe à 10€   → cashCents += 2000
    //   - 1 Karten-Verkauf 15€              → cardCents += 1500
    //   - 1 Personalessen 5€ unbezahlt (Cash) → cashCents += 500
    //   - 1 Personalessen 3€ bezahlt   (Cash) → cashCents += 300
    //
    // Legacy-Dashboard: Personalessen sind in dailyNetRevenue ENTHALTEN (nur
    // Corporate wird ausgefiltert). Display-Netto zieht *nur* das unpaid-Stück ab:
    //
    //   cashCardCents = 2000 + 1500 + 500 + 300 = 4300
    //   displayNet    = 4300 − 500 (unpaid staff) = 3800
    const orders = [
      makeOrder({ grossAmount: 10, paymentMethod: TransactionMethod.CASH }),
      makeOrder({ grossAmount: 10, paymentMethod: TransactionMethod.CASH }),
      makeOrder({ grossAmount: 15, paymentMethod: TransactionMethod.CARD }),
      makeOrder({ grossAmount: 5, staffPaymentInfo: { paid: false } }),
      makeOrder({ grossAmount: 3, staffPaymentInfo: { paid: true } }),
    ]
    const financials = aggregateFinancials(orders)
    const meals = aggregateMealSubsidies(orders)
    expect(deriveDisplayNetRevenueCents(financials, meals)).toBe(4300 - 500)
  })

  it('Total = financials.grossTotalCents', () => {
    const orders = [
      makeOrder({ grossAmount: 10 }),
      makeOrder({ grossAmount: 20 }),
    ]
    const financials = aggregateFinancials(orders)
    expect(deriveTotalRevenueCents(financials)).toBe(financials.grossTotalCents)
  })

  it('CashCard = nur Cash + Card aus payments', () => {
    const orders = [
      makeOrder({ grossAmount: 10, paymentMethod: TransactionMethod.CASH }),
      makeOrder({ grossAmount: 5, paymentMethod: TransactionMethod.ONLINE }),
    ]
    const financials = aggregateFinancials(orders)
    expect(deriveCashCardRevenueCents(financials)).toBe(1000)
  })
})
