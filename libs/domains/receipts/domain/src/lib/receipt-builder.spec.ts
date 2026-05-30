import { describe, expect, it } from 'vitest'
import { buildReceiptSnapshot, canonicalReceiptJson, type BuildReceiptSnapshotInput } from './receipt-builder'
import { formatInternalReceiptNumber } from './receipt-number'
import { ReceiptKind, type Receipt } from './receipt.schema'
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
      { externalId: '0190aaaa-1111-7ccc-8ddd-eeeeeeeeeeee', name: 'Brötchen', amount: 3, price: 1, taxInside: 19, taxOutside: 7 },
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
      { externalId: '0190aaaa-1111-7ccc-8ddd-eeeeeeeeeeee', name: 'Brötchen', quantity: 3, unitPrice: 1, lineTotal: 3, taxRate: 19 },
      { name: 'Kaffee', quantity: 1, unitPrice: 2.5, lineTotal: 2.5, taxRate: 19 },
    ])
    expect(core.totalGross).toBe(5.5)
    expect(core.paymentMethod).toBe('cash')
    expect(core.paymentState).toBe('paid')
    expect(core.seller).toEqual({ name: 'Bäckerei Test', address: 'Hauptstr. 1, 10115 Berlin, DE', taxNumber: '12/345/67890' })
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
