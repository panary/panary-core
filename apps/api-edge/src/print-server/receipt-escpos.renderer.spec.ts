import { describe, expect, it } from 'vitest'

import type { Receipt } from '@panary/receipts/domain'

import type { EscposOptions, PaperWidth } from './escpos.adapter'
import { centerOffsetDots, decodeEscPosLines } from '../../test/escpos-layout'
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

// #342: Der Verkaeufer-Kopf ist Pflichtangabe (§146a AO) und bleibt auf diesem
// Beleg — er war aber, wie der Bon-Kopf, ohne jede Assertion. Der
// Zentrierungsfehler steckte in beiden.
describe('receipt-escpos.renderer — Verkaeufer-Kopf (#342)', () => {
  const mitKopf = (overrides: Record<string, unknown> = {}) =>
    buildReceipt({
      seller: {
        name: 'Baeckerei Beispiel',
        address: 'Dahler Strasse 35, 58091 Hagen',
        taxNumber: '123/456/789',
        ...overrides,
      },
    } as Partial<Receipt>)

  const kopfZeilen = (receipt: Receipt, paperWidth: PaperWidth = '80mm') =>
    decodeEscPosLines(renderReceiptEscPos(receipt, { paperWidth }), 8)

  it('druckt Name, Anschrift und Steuernummer weiterhin', () => {
    const text = renderToText(mitKopf())

    expect(text).toContain('Baeckerei Beispiel')
    expect(text).toContain('Dahler Strasse 35, 58091 Hagen')
    expect(text).toContain('St-Nr: 123/456/789')
  })

  it.each([
    ['80mm', 48],
    ['58mm', 32],
  ] as const)('setzt jede Kopfzeile auf %s mittig', (paperWidth, columns) => {
    const zeilen = kopfZeilen(mitKopf(), paperWidth)

    for (const suche of ['Baeckerei Beispiel', 'Dahler Strasse 35', 'St-Nr: 123/456/789']) {
      const zeile = zeilen.find(z => z.text.includes(suche))
      expect(zeile, `Zeile „${suche}" nicht gefunden`).toBeDefined()
      // Toleranz: eine Zellenbreite (Rundung des Encoders). Der Fehler aus #342
      // lag bei rund vier Zellen — er faellt hier durch.
      expect(Math.abs(centerOffsetDots(zeile!, columns)), `Zeile „${suche}" nicht mittig`).toBeLessThanOrEqual(
        zeile!.charDots,
      )
    }
  })

  it('setzt die Anschrift auch ohne Steuernummer mittig', () => {
    const ohneStNr = buildReceipt({
      seller: { name: 'Baeckerei Beispiel', address: 'Dahler Strasse 35, 58091 Hagen' },
    } as Partial<Receipt>)
    const zeile = kopfZeilen(ohneStNr).find(z => z.text.includes('Dahler Strasse 35'))

    expect(zeile).toBeDefined()
    expect(Math.abs(centerOffsetDots(zeile!, 48))).toBeLessThanOrEqual(zeile!.charDots)
  })

  it('stellt den Font-Umbruch nur aus, wenn ein Font-B-Block folgt', () => {
    // Der zusaetzliche Umbruch existiert einzig, um den Font-Wechsel vor die
    // Polsterung der naechsten zentrierten Zeile zu bringen. Ohne Anschrift und
    // Steuernummer gibt es nichts umzuschalten — dann darf er auch nicht kosten.
    const ohne = kopfZeilen(buildReceipt({ seller: { name: 'Baeckerei Beispiel' } } as Partial<Receipt>))
    const nameOhne = ohne.findIndex(z => z.text.includes('Baeckerei Beispiel'))

    // Nach dem Namen genau eine Leerzeile (die des Metablocks), dann die Trennlinie.
    expect(ohne[nameOhne + 1].text.trim()).toBe('')
    expect(ohne[nameOhne + 2].text).toMatch(/^Ä+$/)

    // Mit Details liegt an derselben Stelle die Leerzeile des Font-Wechsels,
    // direkt gefolgt von der Anschrift.
    const mit = kopfZeilen(mitKopf())
    const nameMit = mit.findIndex(z => z.text.includes('Baeckerei Beispiel'))

    expect(mit[nameMit + 1].text.trim()).toBe('')
    expect(mit[nameMit + 2].text).toContain('Dahler Strasse 35')
  })
})
