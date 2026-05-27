import { describe, expect, it } from 'vitest'

import {
  assembleDsfinvkExport,
  DSFINVK_TAXONOMY_VERSION,
  tseTransactionsToCsv,
  type DsfinvkExportOrder,
} from './dsfinvk-export'

const orders: DsfinvkExportOrder[] = [
  {
    transactionNumber: 1,
    recordedAt: '2026-05-16T10:00:00.000Z',
    grossAmountCents: 1990,
    tseStatus: 'signed',
    tseSignatureCounter: 4,
    tseSignatureValue: 'SIM-aaa',
    tseLogTime: '2026-05-16T10:00:01.000Z',
  },
  {
    transactionNumber: 2,
    recordedAt: '2026-05-16T10:05:00.000Z',
    grossAmountCents: 500,
    tseStatus: 'unavailable',
  },
]

describe('assembleDsfinvkExport', () => {
  it('erzeugt Meta mit korrekten Zählern + Default-Taxonomie', () => {
    const exp = assembleDsfinvkExport({
      businessDayId: 'bd-1',
      tenantId: 't-1',
      locationId: 'loc-1',
      from: '2026-05-16T00:00:00.000Z',
      to: '2026-05-16T23:59:59.000Z',
      simulated: true,
      orders,
      dayClose: { signatureCounter: 9, signatureValue: 'SIM-day', closedAt: '2026-05-16T20:00:00.000Z', status: 'signed' },
    })
    expect(exp.meta.taxonomyVersion).toBe(DSFINVK_TAXONOMY_VERSION)
    expect(exp.meta.orderCount).toBe(2)
    expect(exp.meta.signedCount).toBe(1)
    expect(exp.meta.simulated).toBe(true)
    expect(exp.dayClose?.signatureValue).toBe('SIM-day')
    expect(exp.transactions).toHaveLength(2)
  })

  it('dayClose default null', () => {
    const exp = assembleDsfinvkExport({
      businessDayId: 'bd-1',
      tenantId: 't-1',
      locationId: null,
      from: 'a',
      to: 'b',
      simulated: false,
      orders: [],
    })
    expect(exp.dayClose).toBeNull()
    expect(exp.meta.orderCount).toBe(0)
  })
})

describe('tseTransactionsToCsv', () => {
  it('rendert Header + eine Zeile je Transaktion', () => {
    const csv = tseTransactionsToCsv(orders)
    const lines = csv.split('\n')
    expect(lines[0]).toContain('transaktionsnummer')
    expect(lines).toHaveLength(3) // header + 2
    expect(lines[1]).toContain('SIM-aaa')
    expect(lines[2]).toContain('unavailable')
  })

  it('escaped Trennzeichen/Anführungszeichen', () => {
    const csv = tseTransactionsToCsv([
      { transactionNumber: 1, recordedAt: 'x', grossAmountCents: 0, tseStatus: 'signed', tseSignatureValue: 'a;b"c' },
    ])
    expect(csv.split('\n')[1]).toContain('"a;b""c"')
  })
})
