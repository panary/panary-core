// Bestellbetrieb: Steuer-Split und Zahlungsarten entstehen gar nicht erst.
//
// Hintergrund (panary-cloud ADR 0036): In `orders-only` wird ueber Panary
// nicht kassiert — kassiert wird auf der Fremdkasse des Betriebs. Ein zweiter
// USt-Split daneben ist das Kernmerkmal eines Kassenabschlusses; ein
// Zahlungsarten-Bild ohne erfasste Zahlungen ist eine Nullaussage im Gewand
// eines Datums (der Fallback-Zweig schob bislang den kompletten Bestellwert
// nach „Sonstige").
//
// Der Knackpunkt: Die Persist-Invariante `Σ payments === grossTotal − tips`
// haelt dann natuerlich nicht mehr. Sie MUSS modus-bewusst uebersprungen
// werden, sonst scheitert jeder orders-only-Bericht am Persist-Step.

import { describe, it, expect } from 'vitest'

import { aggregateFinancials } from './financials'
import { validateFinancials } from './validations'
import { TransactionMethod } from '@panary/orders/domain'

import { makeOrder } from './fixtures/orders.fixtures'

const ORDERS_ONLY = { operationMode: 'orders-only' as const }
const POS_CASHIER = { operationMode: 'pos-cashier' as const }

// Zahlart explizit wie in financials.spec.ts, und bewusst OHNE Trinkgeld: Die
// Fixture legt die Transaktion mit dem Brutto-Betrag an, das Trinkgeld aber
// separat — mit Trinkgeld erfuellt schon der Kassenbetrieb die Invariante
// `Σ payments === grossTotal − tips` nicht, und der Test pruefte dann eine
// Fixture-Eigenheit statt des Modus-Guards.
const orders = [
  makeOrder({ grossAmount: 23.8, paymentMethod: TransactionMethod.CASH }),
  makeOrder({ grossAmount: 11.9, paymentMethod: TransactionMethod.CARD }),
]

describe('aggregateFinancials — Bestellbetrieb', () => {
  it('erzeugt keinen Steuer-Split', () => {
    expect(aggregateFinancials(orders, ORDERS_ONLY).taxes).toEqual([])
  })

  it('erzeugt keine Zahlungsarten-Aufteilung', () => {
    const p = aggregateFinancials(orders, ORDERS_ONLY).payments
    expect(p.cashCents).toBe(0)
    expect(p.cardCents).toBe(0)
    expect(p.onlineCents).toBe(0)
    expect(p.otherCents).toBe(0)
  })

  it('laesst Bestellwert, Kanaele und Konsumort unberuehrt', () => {
    const withMode = aggregateFinancials(orders, ORDERS_ONLY)
    const withoutMode = aggregateFinancials(orders)
    expect(withMode.grossTotalCents).toBe(withoutMode.grossTotalCents)
    expect(withMode.netTotalCents).toBe(withoutMode.netTotalCents)
    expect(withMode.channels).toEqual(withoutMode.channels)
    expect(withMode.dineLocation).toEqual(withoutMode.dineLocation)
  })
})

describe('aggregateFinancials — Kassenbetrieb bleibt unveraendert', () => {
  it('ohne Option identisch zu explizitem pos-cashier', () => {
    expect(aggregateFinancials(orders, POS_CASHIER)).toEqual(aggregateFinancials(orders))
  })

  it('erzeugt weiterhin Steuer-Split und Zahlungsarten', () => {
    const r = aggregateFinancials(orders, POS_CASHIER)
    expect(r.taxes.length).toBeGreaterThan(0)
    expect(r.payments.cashCents).toBeGreaterThan(0)
  })
})

describe('validateFinancials — Persist-Invarianten', () => {
  it('Bestellbetrieb besteht die Validierung trotz leerer Zahlungsarten', () => {
    const financials = aggregateFinancials(orders, ORDERS_ONLY)
    const result = validateFinancials(financials, ORDERS_ONLY)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('OHNE Modus-Option wuerde derselbe Bericht scheitern — der Guard ist noetig', () => {
    // Belegt, dass die Invariante ohne Weitergabe des Modus zuschlaegt. Genau
    // deshalb muss der Aufrufer sie durchreichen.
    const financials = aggregateFinancials(orders, ORDERS_ONLY)
    const result = validateFinancials(financials)
    expect(result.valid).toBe(false)
    expect(result.errors.map(e => e.code)).toContain('financials.payments_mismatch')
  })

  it('Kassenbetrieb prueft die Zahlungs-Invariante weiterhin', () => {
    const financials = aggregateFinancials(orders, POS_CASHIER)
    expect(validateFinancials(financials, POS_CASHIER).valid).toBe(true)

    const broken = { ...financials, payments: { ...financials.payments, cashCents: 1 } }
    const result = validateFinancials(broken, POS_CASHIER)
    expect(result.valid).toBe(false)
    expect(result.errors.map(e => e.code)).toContain('financials.payments_mismatch')
  })

  it('Kanal-Invariante gilt in BEIDEN Modi — sie haengt nicht am Kassieren', () => {
    const financials = aggregateFinancials(orders, ORDERS_ONLY)
    const broken = { ...financials, channels: { ...financials.channels, posCents: 999999 } }
    const result = validateFinancials(broken, ORDERS_ONLY)
    expect(result.valid).toBe(false)
    expect(result.errors.map(e => e.code)).toContain('financials.channels_mismatch')
  })
})
