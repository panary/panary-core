import { describe, expect, it } from 'vitest'

import type { OrderTseInfo } from './order-signing'
import { buildTseReceiptBlock } from './receipt'

const base: OrderTseInfo = {
  status: 'signed',
  provider: 'SIMULATOR',
  clientId: 'pos-1',
  transactionNumber: 42,
  simulated: true,
  signatureCounter: 9,
  signatureValue: 'SIM-abc',
  logTime: '2026-05-16T10:05:00.000Z',
}

describe('buildTseReceiptBlock', () => {
  it('null/undefined → kein Block', () => {
    expect(buildTseReceiptBlock(null)).toBeNull()
    expect(buildTseReceiptBlock(undefined)).toBeNull()
  })

  it('signed → Signatur-Block mit QR + Simulations-Hinweis', () => {
    const block = buildTseReceiptBlock(base)
    expect(block?.title).toBe('TSE-Signatur')
    expect(block?.qrPayload).toBe('SIM-abc')
    expect(block?.note).toMatch(/SIMULATION/)
    expect(block?.rows.find(r => r.label === 'Signaturzähler')?.value).toBe('9')
  })

  it('signed + nicht simuliert → kein Simulations-Hinweis', () => {
    const block = buildTseReceiptBlock({ ...base, simulated: false })
    expect(block?.note).toBeUndefined()
  })

  it('unavailable → §146a-Hinweis, kein QR', () => {
    const block = buildTseReceiptBlock({ ...base, status: 'unavailable', signatureValue: undefined })
    expect(block?.title).toBe('TSE')
    expect(block?.note).toMatch(/§146a/)
    expect(block?.qrPayload).toBeUndefined()
  })

  it('failed → Fehlschlag-Hinweis', () => {
    const block = buildTseReceiptBlock({ ...base, status: 'failed', signatureValue: undefined })
    expect(block?.note).toMatch(/fehlgeschlagen/)
  })
})
