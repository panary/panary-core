import { Value } from '@sinclair/typebox/value'
import { describe, expect, it } from 'vitest'
import {
  buildReceiptHtml,
  buildReceiptSnapshot,
  canonicalReceiptJson,
  type BuildReceiptSnapshotInput,
} from './receipt-builder'
import { formatInternalReceiptNumber } from './receipt-number'
import { receiptDiscountSchema, ReceiptKind, type Receipt } from './receipt.schema'
import { getReceiptDeliveryArtifact } from './receipt-provider'

const baseInput = (): BuildReceiptSnapshotInput => ({
  kind: ReceiptKind.SALE,
  issuedAt: '2026-05-30T10:00:00.000Z',
  receiptNumber: 'R-20260530-aaaaaaaa-0042',
  location: {
    name: 'Bäckerei Test',
    address: { street: 'Hauptstr. 1', postalCode: '10115', city: 'Berlin', country: 'DE' },
    defaultCurrency: 'EUR',
    settings: { invoiceSettings: { taxNumber: '12/345/67890' } },
  },
  order: {
    _id: '0190aaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee',
    dailySequenceNumber: 42,
    dineLocation: 'dine-in',
    currency: 'EUR',
    lineItems: [
      {
        externalId: '0190aaaa-1111-7ccc-8ddd-eeeeeeeeeeee',
        name: 'Brötchen',
        amount: 3,
        price: 1,
        taxInside: 19,
        taxOutside: 7,
      },
      { name: 'Kaffee', amount: 1, price: 2.5, taxInside: 19, taxOutside: 7 },
    ],
    taxSnapshot: { taxes: [{ taxRate: 19, amount: 4.62, tax: 0.88 }], netto: 4.62, brutto: 5.5 },
    payment: { state: 'paid', totalAmount: 5.5, transactions: [{ method: 'cash' }] },
    tse: null,
  },
})

describe('buildReceiptSnapshot', () => {
  it('mappt Order-Positionen auf Belegpositionen (im Haus → taxInside)', () => {
    const core = buildReceiptSnapshot(baseInput())
    expect(core.lineItems).toEqual([
      {
        externalId: '0190aaaa-1111-7ccc-8ddd-eeeeeeeeeeee',
        name: 'Brötchen',
        quantity: 3,
        unitPrice: 1,
        lineTotal: 3,
        taxRate: 19,
      },
      { name: 'Kaffee', quantity: 1, unitPrice: 2.5, lineTotal: 2.5, taxRate: 19 },
    ])
    expect(core.totalGross).toBe(5.5)
    expect(core.paymentMethod).toBe('cash')
    expect(core.paymentState).toBe('paid')
    expect(core.seller).toEqual({
      name: 'Bäckerei Test',
      address: 'Hauptstr. 1, 10115 Berlin, DE',
      taxNumber: '12/345/67890',
    })
  })

  it('wählt außer Haus den taxOutside-Satz', () => {
    const input = baseInput()
    input.order.dineLocation = 'take-out'
    input.order.taxSnapshot = null
    const core = buildReceiptSnapshot(input)
    expect(core.lineItems.every(l => l.taxRate === 7)).toBe(true)
    // Fallback-Steuer aus Positionen (brutto 5.5 inkl. 7 %)
    expect(core.taxSummary.taxes[0].taxRate).toBe(7)
    expect(core.taxSummary.brutto).toBeCloseTo(5.5, 2)
  })

  it('order-confirmation trägt nie einen TSE-Block', () => {
    const input = baseInput()
    input.kind = ReceiptKind.ORDER_CONFIRMATION
    input.order.tse = { status: 'signed', provider: 'sim', clientId: 'x', transactionNumber: 5, simulated: true }
    const core = buildReceiptSnapshot(input)
    expect(core.tse).toBeNull()
  })

  it('canonicalReceiptJson ist deterministisch (schlüssel-stabil)', () => {
    const a = canonicalReceiptJson(buildReceiptSnapshot(baseInput()))
    const b = canonicalReceiptJson(buildReceiptSnapshot(baseInput()))
    expect(a).toBe(b)
  })
})

// Zahlenbasis ist die Test-Order aus panary/panary-core#228, an der der fehlende
// Nachlass gemessen wurde: 2× Nuggets à 4,50 (7 %) + 1× Apfelschorle 2,90 (19 %),
// 20 % Order-Rabatt. Positionen 11,90 − Nachlass 2,38 = Gesamt 9,52.
const discountedInput = (): BuildReceiptSnapshotInput => {
  const input = baseInput()
  input.order.lineItems = [
    { name: 'Nuggets', amount: 2, price: 4.5, taxInside: 7, taxOutside: 7 },
    { name: 'Apfelschorle', amount: 1, price: 2.9, taxInside: 19, taxOutside: 19 },
  ]
  input.order.appliedDiscounts = [{ name: '20 % Rabatt', computedAmountCents: 238 }]
  input.order.taxSnapshot = {
    taxes: [
      { taxRate: 7, amount: 6.73, tax: 0.47 },
      { taxRate: 19, amount: 1.95, tax: 0.37 },
    ],
    netto: 8.68,
    brutto: 9.52,
  }
  input.order.payment = { state: 'paid', totalAmount: 9.52, transactions: [{ method: 'card' }] }
  return input
}

describe('buildReceiptSnapshot — Nachlass (#228)', () => {
  it('weist den Order-Rabatt mit Namen und abgezogenem Betrag aus', () => {
    const core = buildReceiptSnapshot(discountedInput())
    expect(core.discounts).toEqual([{ name: '20 % Rabatt', amount: 2.38 }])
  })

  it('der Beleg rechnet sich auf: Σ Positionen − Σ Nachlass === Gesamt', () => {
    const core = buildReceiptSnapshot(discountedInput())
    const positions = core.lineItems.reduce((s, l) => s + l.lineTotal, 0)
    const nachlass = (core.discounts ?? []).reduce((s, d) => s + d.amount, 0)
    expect(positions).toBeCloseTo(11.9, 2)
    expect(positions - nachlass).toBeCloseTo(core.totalGross, 2)
  })

  it('übernimmt den Rabattnamen des Personalessens', () => {
    const input = discountedInput()
    input.order.appliedDiscounts = [{ name: 'Personalessen', computedAmountCents: 1190 }]
    expect(buildReceiptSnapshot(input).discounts).toEqual([{ name: 'Personalessen', amount: 11.9 }])
  })

  it('führt mehrere Rabatte einzeln auf (Positions- + Order-Rabatt)', () => {
    const input = discountedInput()
    input.order.appliedDiscounts = [
      { name: 'Nuggets −1,00', computedAmountCents: 100 },
      { name: '20 % Rabatt', computedAmountCents: 218 },
    ]
    expect(buildReceiptSnapshot(input).discounts).toEqual([
      { name: 'Nuggets −1,00', amount: 1 },
      { name: '20 % Rabatt', amount: 2.18 },
    ])
  })

  it('lässt das Feld ohne Rabatt komplett weg — kanonische JSON unverändert', () => {
    const core = buildReceiptSnapshot(baseInput())
    expect(core.discounts).toBeUndefined()
    // Der renderHash haengt an genau diesem String: ein Beleg ohne Rabatt muss
    // nach #228 denselben Hash bekommen wie davor.
    expect(canonicalReceiptJson(core)).not.toContain('discounts')
  })

  it('unterdrückt wirkungslose Rabatte (0 ct) statt eine Nullzeile zu drucken', () => {
    const input = discountedInput()
    input.order.appliedDiscounts = [{ name: 'Ohne Wirkung', computedAmountCents: 0 }]
    expect(buildReceiptSnapshot(input).discounts).toBeUndefined()
  })

  it('fängt einen leeren Rabattnamen ab — der Snapshot bleibt schema-valide', () => {
    const input = discountedInput()
    input.order.appliedDiscounts = [{ name: '   ', computedAmountCents: 238 }]
    const discounts = buildReceiptSnapshot(input).discounts ?? []
    expect(discounts).toEqual([{ name: 'Nachlass', amount: 2.38 }])
    // Ohne Fallback riss `minLength: 1` die Beleg-Validierung — und der
    // issue-receipt-Hook schluckt Fehler, der Beleg fiele also ganz aus.
    expect(discounts.every(d => Value.Check(receiptDiscountSchema, d))).toBe(true)
  })

  it('buildReceiptHtml zeigt die Nachlasszeile', () => {
    const core = buildReceiptSnapshot(discountedInput())
    const html = buildReceiptHtml({ ...core, tse: null } as unknown as Parameters<typeof buildReceiptHtml>[0])
    expect(html).toContain('Nachlass: 20 % Rabatt')
    expect(html).toContain('−2.38 EUR')
  })
})

describe('buildReceiptSnapshot — Positionssumme aus grossCents (#236)', () => {
  it('bevorzugt das vorberechnete Brutto gegenüber amount × price', () => {
    const input = baseInput()
    // 3 × 1,00 Basispreis + 0,50 Modifier — nur der Aufrufer kennt den Aufpreis.
    input.order.lineItems[0].grossCents = 350
    const core = buildReceiptSnapshot(input)
    expect(core.lineItems[0].lineTotal).toBe(3.5)
    // unitPrice bleibt der Artikel-Basispreis: unitPrice × quantity ≠ lineTotal ist gewollt.
    expect(core.lineItems[0].unitPrice).toBe(1)
  })

  it('fällt ohne grossCents auf amount × price zurück (Bestands-Aufrufer)', () => {
    const core = buildReceiptSnapshot(baseInput())
    expect(core.lineItems.map(l => l.lineTotal)).toEqual([3, 2.5])
  })

  it('rundet ein krummes grossCents auf ganze Cents', () => {
    const input = baseInput()
    input.order.lineItems[0].grossCents = 333.4
    expect(buildReceiptSnapshot(input).lineItems[0].lineTotal).toBe(3.33)
  })
})

describe('buildReceiptSnapshot — Steuer-Fallback ohne taxSnapshot (#236)', () => {
  // Der Fallback greift nur, wenn die Order GAR KEINEN taxSnapshot trägt.
  const fallbackInput = (): BuildReceiptSnapshotInput => {
    const input = baseInput()
    input.order.taxSnapshot = null
    input.order.payment = null
    return input
  }

  it('extrahiert die MwSt aus dem Brutto, statt sie draufzurechnen', () => {
    const core = buildReceiptSnapshot(fallbackInput())
    // 5,50 brutto bei 19 % → 4,62 netto + 0,88 Steuer. Die falsche Formel
    // `brutto × (1 − 19/100)` ergaebe 4,46 und ueberschaetzte die Steuer — die
    // Invariante „netto + steuer === brutto" haelt dabei trotzdem, sie taugt
    // also NICHT als Beleg fuer die Methode.
    expect(core.taxSummary.taxes).toEqual([{ taxRate: 19, amount: 4.62, tax: 0.88 }])
    expect(core.taxSummary.netto).toBe(4.62)
    expect(core.taxSummary.brutto).toBe(5.5)
  })

  it('rechnet cent-genau statt in Float (kein akkumulierter Drift)', () => {
    const input = fallbackInput()
    input.order.lineItems = [
      { name: 'A', amount: 3, price: 0.1, taxInside: 19, taxOutside: 19 },
      { name: 'B', amount: 3, price: 0.2, taxInside: 19, taxOutside: 19 },
    ]
    const core = buildReceiptSnapshot(input)
    expect(core.taxSummary.brutto).toBe(0.9)
    expect(core.totalGross).toBe(0.9)
  })

  it('zieht die Nachlässe ab, statt sie zu ignorieren', () => {
    const input = fallbackInput()
    input.order.appliedDiscounts = [{ name: '20 % Rabatt', computedAmountCents: 110 }]
    const core = buildReceiptSnapshot(input)
    // Positionen 5,50 − 1,10 Nachlass = 4,40
    expect(core.taxSummary.brutto).toBe(4.4)
    expect(core.totalGross).toBe(4.4)
    expect(core.lineItems.reduce((s, l) => s + l.lineTotal, 0)).toBe(5.5)
  })

  it('verteilt einen Nachlass summen-exakt über mehrere Sätze (Largest Remainder)', () => {
    const input = fallbackInput()
    // Zwei GLEICH grosse Eimer und 1 ct Nachlass: unabhaengiges Runden je Eimer
    // gibt beiden Math.round(0.5) = 1 und zieht damit 0,02 ab statt 0,01.
    input.order.lineItems = [
      { name: '7 %', amount: 1, price: 5, taxInside: 7, taxOutside: 7 },
      { name: '19 %', amount: 1, price: 5, taxInside: 19, taxOutside: 19 },
    ]
    input.order.appliedDiscounts = [{ name: 'Nachlass', computedAmountCents: 1 }]
    const core = buildReceiptSnapshot(input)
    expect(core.taxSummary.brutto).toBe(9.99)
    const summe = core.taxSummary.taxes.reduce((s, t) => s + t.amount + t.tax, 0)
    expect(Math.round(summe * 100) / 100).toBe(9.99)
  })

  it('klemmt einen Nachlass über der Positionssumme auf 0', () => {
    const input = fallbackInput()
    input.order.appliedDiscounts = [{ name: 'Zu viel', computedAmountCents: 99_999 }]
    const core = buildReceiptSnapshot(input)
    expect(core.taxSummary.brutto).toBe(0)
    expect(core.taxSummary.taxes).toEqual([])
    expect(core.totalGross).toBe(0)
  })
})

describe('buildReceiptSnapshot — leerer taxSnapshot ist autoritativ (#236)', () => {
  it('übernimmt taxes: [] bei brutto 0, statt Steuer aus den Positionen zu erfinden', () => {
    const input = baseInput()
    // Genau das liefert computeOrderTax bei 100 % Nachlass: Eimer <= 0 verworfen.
    input.order.taxSnapshot = { taxes: [], netto: 0, brutto: 0 }
    input.order.appliedDiscounts = [{ name: 'Personalessen', computedAmountCents: 550 }]
    input.order.payment = null
    const core = buildReceiptSnapshot(input)
    expect(core.taxSummary).toEqual({ taxes: [], netto: 0, brutto: 0 })
    expect(core.totalGross).toBe(0)
    expect(core.lineItems.reduce((s, l) => s + l.lineTotal, 0)).toBe(5.5)
  })

  it('vertraut dem Snapshot auch ohne computedAmountCents am Rabatt', () => {
    const input = baseInput()
    input.order.taxSnapshot = { taxes: [], netto: 0, brutto: 0 }
    // Rabatt ohne zurückgeschriebenen Betrag (Bestands-Order, gestripptes Feld):
    // der Fallback käme hier auf 5,50 und wiese eine Steuer aus, die es nicht gibt.
    input.order.appliedDiscounts = [{ name: 'Personalessen' }]
    input.order.payment = null
    const core = buildReceiptSnapshot(input)
    expect(core.taxSummary.brutto).toBe(0)
    expect(core.totalGross).toBe(0)
  })
})

describe('formatInternalReceiptNumber', () => {
  it('leitet eine deterministische Nummer aus Datum + Location + Sequenz ab', () => {
    expect(
      formatInternalReceiptNumber({
        date: '2026-05-30T10:00:00.000Z',
        locationId: '0190aaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee',
        dailySequenceNumber: 42,
      }),
    ).toBe('R-20260530-0190aaaa-0042')
  })
})

describe('getReceiptDeliveryArtifact', () => {
  const receipt = {
    token: 'AbC123_token-xyz',
    kind: ReceiptKind.SALE,
    currency: 'EUR',
    issuedAt: '2026-05-30T10:00:00.000Z',
    dailySequenceNumber: 42,
    lineItems: [{ name: 'Brötchen', quantity: 1, unitPrice: 1, lineTotal: 1, taxRate: 19 }],
    taxSummary: { taxes: [{ taxRate: 19, amount: 0.84, tax: 0.16 }], netto: 0.84, brutto: 1 },
    totalGross: 1,
    seller: { name: 'Bäckerei Test' },
  } as unknown as Receipt
  const opts = { baseUrl: 'https://receipts.panary.io' }

  it('qr/url/wallet liefern die Beleg-URL', () => {
    for (const channel of ['qr', 'url', 'wallet'] as const) {
      const art = getReceiptDeliveryArtifact(receipt, channel, opts)
      expect(art.url).toBe('https://receipts.panary.io/r/AbC123_token-xyz')
    }
  })

  it('nfc liefert die URL als NDEF-URI-Payload', () => {
    const art = getReceiptDeliveryArtifact(receipt, 'nfc', opts)
    expect(art.contentType).toBe('application/vnd.nfc.ndef.uri')
    expect(art.url).toContain('/r/AbC123_token-xyz')
  })

  it('html liefert gerendertes Markup', () => {
    const art = getReceiptDeliveryArtifact(receipt, 'html', opts)
    expect(art.contentType).toContain('text/html')
    expect(art.body).toContain('Bäckerei Test')
  })

  it('pdf/png werfen (Renderer-Dependency erforderlich)', () => {
    expect(() => getReceiptDeliveryArtifact(receipt, 'pdf', opts)).toThrow()
    expect(() => getReceiptDeliveryArtifact(receipt, 'png', opts)).toThrow()
  })
})

describe('buildReceiptHtml branding', () => {
  const receipt = {
    kind: ReceiptKind.SALE,
    currency: 'EUR',
    issuedAt: '2026-05-30T10:00:00.000Z',
    dailySequenceNumber: 7,
    receiptNumber: 'R-1',
    lineItems: [{ name: 'Brot', quantity: 1, unitPrice: 2, lineTotal: 2, taxRate: 7 }],
    taxSummary: { taxes: [{ taxRate: 7, amount: 1.87, tax: 0.13 }], netto: 1.87, brutto: 2 },
    totalGross: 2,
    seller: { name: 'Bäckerei' },
    tse: null,
  } as unknown as Parameters<typeof buildReceiptHtml>[0]

  it('wendet eine gültige Markenfarbe + Logo + Footer an', () => {
    const html = buildReceiptHtml(receipt, {
      primaryColor: '#2dd4a4',
      logoUrl: 'https://cdn.example/logo.webp',
      footerText: 'Vielen Dank!',
    })
    expect(html).toContain('#2dd4a4')
    expect(html).toContain('<img src="https://cdn.example/logo.webp"')
    expect(html).toContain('Vielen Dank!')
  })

  it('ignoriert ungültige Farbe + javascript:-Logo (Injection-Schutz)', () => {
    const html = buildReceiptHtml(receipt, {
      primaryColor: 'red;}body{display:none', // kein #hex → ignoriert
      logoUrl: 'javascript:alert(1)', // kein http(s)/Pfad → ignoriert
    })
    expect(html).not.toContain('display:none')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('#15181c') // Default-Farbe greift
  })
})
