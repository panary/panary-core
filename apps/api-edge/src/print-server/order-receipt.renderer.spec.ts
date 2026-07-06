import { describe, expect, it } from 'vitest'

import { renderOrderReceipt } from './order-receipt.renderer'

// Die Encoder-Ausgabe ist ESC/POS-Binärstrom — der Zellentext liegt darin als
// Klartext. Fuer die Assertions reicht dekodieren + Steuerzeichen verwerfen.
const renderToText = (order: Record<string, unknown>, location: Record<string, unknown>): string => {
  const bytes = renderOrderReceipt(order, location)
  // eslint-disable-next-line no-control-regex
  return new TextDecoder('latin1').decode(bytes).replace(/[\x00-\x1f]/g, ' ')
}

const location = {
  settings: {
    genericProductSettings: {
      generalDrinkPrice: 3.5,
      generalSideDishPrice: 1.0,
    },
  },
}

const buildMenuOrder = (amount: number, overrides: Record<string, unknown> = {}) => ({
  dailySequenceNumber: 42,
  dineLocation: 'dine-in',
  recordingDate: '2026-07-06T10:00:00.000Z',
  lineItems: [
    {
      _id: 'li-1',
      name: 'Schnitzel-Menue',
      topic: 'Menues',
      amount,
      price: 12.9,
      taxInside: 19,
      taxOutside: 7,
      isMenu: true,
      menuSideDish: { name: 'Suesskartoffel-Pommes', price: 1.5, amount: 1, taxInside: 19, taxOutside: 7 },
      menuDrink: { name: 'Hauslimo', price: 3.5, amount: 1, taxInside: 19, taxOutside: 7 },
      ...overrides,
    },
  ],
})

describe('order-receipt.renderer — Menü-Sub-Zeilen', () => {
  it('weist den Beilagen-Aufpreis bei Menge 1 einmalig aus', () => {
    const text = renderToText(buildMenuOrder(1), location)
    // Aufpreis = 1,50 − 1,00 (General-Preis) = 0,50
    expect(text).toContain('+ Suesskartoffel-Pommes')
    expect(text).toContain('0,50 EUR')
  })

  it('skaliert den Beilagen-Aufpreis mit der Menü-Menge (×amount)', () => {
    const text = renderToText(buildMenuOrder(2), location)
    // 2 Menüs × 0,50 Aufpreis = 1,00 — derselbe Betrag, den lineItemGrossCents
    // in die Zeilensumme einrechnet.
    expect(text).toContain('1,00 EUR')
    expect(text).not.toContain('0,50 EUR')
  })

  it('weist für Getränke auf General-Preis-Niveau keinen Aufpreis aus', () => {
    const text = renderToText(buildMenuOrder(2), location)
    expect(text).toContain('+ Hauslimo')
    expect(text).not.toContain('3,50 EUR')
  })

  it('weist bei FIXED_PROPORTIONAL keine Komponenten-Aufpreise aus', () => {
    const text = renderToText(buildMenuOrder(2, { bundlePricingMode: 'FIXED_PROPORTIONAL' }), location)
    expect(text).toContain('+ Suesskartoffel-Pommes')
    expect(text).not.toContain('0,50 EUR')
    expect(text).not.toContain('1,00 EUR')
  })

  it('skaliert zusätzlich mit der Komponenten-Menge (component.amount × line.amount)', () => {
    const order = buildMenuOrder(2, {
      menuSideDish: { name: 'Suesskartoffel-Pommes', price: 1.5, amount: 2, taxInside: 19, taxOutside: 7 },
    })
    const text = renderToText(order, location)
    // 2 Komponenten × 2 Menüs × 0,50 = 2,00
    expect(text).toContain('2,00 EUR')
  })
})
