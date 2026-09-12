import { describe, expect, it } from 'vitest'

import type { Receipt } from '@panary/receipts/domain'

import type { EscposOptions } from './escpos.adapter'
import { renderReceiptEscPos } from './receipt-escpos.renderer'

// Die Encoder-Ausgabe ist ESC/POS-Binaerstrom — der Zellentext liegt darin als
// Klartext. Fuer die Assertions reicht dekodieren + Steuerzeichen verwerfen
// (gleiches Vorgehen wie order-receipt.renderer.spec.ts).
const renderToText = (receipt: Receipt, options: EscposOptions = {}): string => {
  const bytes = renderReceiptEscPos(receipt, options)
  // eslint-disable-next-line no-control-regex
  return new TextDecoder('latin1').decode(bytes).replace(/[\x00-\x1f]/g, ' ')
}

// Test-Order aus panary/panary-core#228: Positionen 11,90 − Nachlass 2,38 = 9,52.
const buildReceipt = (overrides: Partial<Receipt> = {}): Receipt =>
  ({
    kind: 'sale',
    status: 'issued',
    currency: 'EUR',
    receiptNumber: 'R-20260814-aaaaaaaa-0042',
    dailySequenceNumber: 42,
    issuedAt: '2026-08-14T10:00:00.000Z',
    lineItems: [
      { name: 'Nuggets', quantity: 2, unitPrice: 4.5, lineTotal: 9, taxRate: 7 },
      { name: 'Apfelschorle', quantity: 1, unitPrice: 2.9, lineTotal: 2.9, taxRate: 19 },
    ],
    taxSummary: {
      taxes: [
        { taxRate: 7, amount: 6.73, tax: 0.47 },
        { taxRate: 19, amount: 1.95, tax: 0.37 },
      ],
      netto: 8.68,
      brutto: 9.52,
    },
    totalGross: 9.52,
    seller: { name: 'Baeckerei Test' },
    tse: null,
    ...overrides,
  }) as unknown as Receipt

describe('receipt-escpos.renderer — Nachlass (#228)', () => {
  it('druckt je Nachlass eine Zeile mit negativem Betrag', () => {
    const text = renderToText(buildReceipt({ discounts: [{ name: '20 % Rabatt', amount: 2.38 }] }))
    expect(text).toContain('Nachlass: 20 % Rabatt')
    expect(text).toContain('-2,38 EUR')
  })

  it('der gedruckte Beleg rechnet sich auf: 9,00 + 2,90 − 2,38 = 9,52', () => {
    const text = renderToText(buildReceipt({ discounts: [{ name: '20 % Rabatt', amount: 2.38 }] }))
    for (const betrag of ['9,00 EUR', '2,90 EUR', '-2,38 EUR', '9,52 EUR']) {
      expect(text).toContain(betrag)
    }
  })

  it('druckt den Rabattnamen des Personalessens', () => {
    const text = renderToText(buildReceipt({ discounts: [{ name: 'Personalessen', amount: 11.9 }] }))
    expect(text).toContain('Nachlass: Personalessen')
  })

  it('führt mehrere Rabatte einzeln auf', () => {
    const text = renderToText(
      buildReceipt({
        discounts: [
          { name: 'Positionsrabatt', amount: 1 },
          { name: '20 % Rabatt', amount: 2.18 },
        ],
      }),
    )
    expect(text).toContain('Nachlass: Positionsrabatt')
    expect(text).toContain('Nachlass: 20 % Rabatt')
  })

  it('druckt ohne Rabatt keine Nachlasszeile', () => {
    expect(renderToText(buildReceipt())).not.toContain('Nachlass')
  })

  it('bleibt bei einem Bestandsbeleg lesbar (discounts === null aus SQLite)', () => {
    const text = renderToText(buildReceipt({ discounts: null }))
    expect(text).not.toContain('Nachlass')
    expect(text).toContain('9,52 EUR')
  })
})

// #274: Der Beleg-Kopf formatierte ohne `timeZone` und folgte damit der
// Prozess-Zeitzone (im Container UTC). Der Aufrufer reicht die Zone der Filiale
// durch; fehlt sie, greift der Geschaeftstag-Default.
describe('receipt-escpos.renderer — Zeitzone (#274)', () => {
  // `issuedAt` = 2026-08-14T10:00:00Z, also Sommerzeit (Berlin = UTC+2).
  it('druckt Datum und Uhrzeit in der uebergebenen Zone', () => {
    expect(renderToText(buildReceipt(), { timeZone: 'America/New_York' })).toContain('Datum: 14.8.2026 06:00')
    expect(renderToText(buildReceipt(), { timeZone: 'UTC' })).toContain('Datum: 14.8.2026 10:00')
  })

  it('nutzt ohne Zone den Geschaeftstag-Default (Europe/Berlin)', () => {
    expect(renderToText(buildReceipt())).toContain('Datum: 14.8.2026 12:00')
  })
})
