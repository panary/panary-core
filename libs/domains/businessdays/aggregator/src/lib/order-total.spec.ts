import { describe, it, expect } from 'vitest'
import { Order } from '@panary-core/orders/domain'
import {
  getOrderGrossCents,
  getOrderNetCents,
  getOrderTipCents,
  computeGrossFromLineItems,
} from './order-total'
import { makeOrder } from './fixtures/orders.fixtures'

describe('order-total', () => {
  it('verwendet payment.totalAmount als primäre Quelle', () => {
    const order = makeOrder({ grossAmount: 15.5 })
    expect(getOrderGrossCents(order)).toBe(1550)
  })

  it('fällt auf taxSnapshot.brutto zurück, wenn payment fehlt', () => {
    const order = makeOrder({ grossAmount: 9.99 })
    const noPayment: Order = { ...order, payment: null }
    expect(getOrderGrossCents(noPayment)).toBe(999)
  })

  it('fällt auf Line-Items zurück, wenn payment & taxSnapshot fehlen', () => {
    const order = makeOrder({
      lineItems: [
        {
          _id: '00000000-0000-7000-8000-000000000010',
          externalId: '00000000-0000-7000-8000-000000000011',
          amount: 2,
          name: 'Burger',
          price: 5.5,
          recipeReferences: [],
          ingredientReferences: [],
          taxInside: 0,
          taxOutside: 0,
          topic: '',
          productGroupExternalId: '00000000-0000-7000-8000-000000000012',
          bundleNumber: null,
          modifiers: [
            {
              _id: '00000000-0000-7000-8000-000000000013',
              externalId: '00000000-0000-7000-8000-000000000014',
              amount: 1,
              name: 'Extra Käse',
              price: 0.5,
              recipeReferences: [],
              ingredientReferences: [],
              taxInside: 0,
              taxOutside: 0,
              topic: '',
            },
          ],
          isMenu: false,
          menuDrink: null,
          menuSideDish: null,
        },
      ],
    })
    const stripped: Order = { ...order, payment: null, taxSnapshot: null }
    // Burger 2× 5.50€ = 11.00€ + 2× 0.50€ Käse = 12.00€
    expect(getOrderGrossCents(stripped)).toBe(1200)
  })

  it('rechnet Modifier mit Stückzahl skaliert', () => {
    // 3× Burger mit Extra Käse à 0.50€ → Käse 3×0.50€ = 1.50€
    const lineItems = [
      {
        _id: 'l1',
        externalId: 'e1',
        amount: 3,
        name: 'Burger',
        price: 5,
        recipeReferences: [],
        ingredientReferences: [],
        taxInside: 0,
        taxOutside: 0,
        topic: '',
        productGroupExternalId: 'g1',
        bundleNumber: null,
        modifiers: [
          {
            _id: 'm1',
            externalId: 'em1',
            amount: 1,
            name: 'Käse',
            price: 0.5,
            recipeReferences: [],
            ingredientReferences: [],
            taxInside: 0,
            taxOutside: 0,
            topic: '',
          },
        ],
        isMenu: false,
        menuDrink: null,
        menuSideDish: null,
      },
    ]
    expect(computeGrossFromLineItems(lineItems as unknown as Order['lineItems'])).toBe(3 * 500 + 3 * 50)
  })

  it('getOrderTipCents liest Trinkgeld', () => {
    const order = makeOrder({ tipAmount: 2.5 })
    expect(getOrderTipCents(order)).toBe(250)
  })

  it('getOrderNetCents bevorzugt taxSnapshot.netto', () => {
    const order = makeOrder({ grossAmount: 11.9, taxes: [{ rate: 19, gross: 11.9, tax: 1.9 }] })
    expect(getOrderNetCents(order)).toBe(1000)
  })
})
