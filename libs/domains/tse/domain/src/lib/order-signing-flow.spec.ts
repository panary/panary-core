import { describe, expect, it, vi } from 'vitest'

import {
  allocateOrderTransactionNumber,
  canCancelOrderTse,
  canFinishOrderTse,
  cancelOrderTseTransaction,
  finishOrderTseTransaction,
  resolveExistingOrderTse,
  resolveOrderTseAmountCents,
  shouldStartOrderTse,
  startOrderTseTransaction,
  type TseSigningLogger,
} from './order-signing-flow'
import type { OrderTseInfo } from './order-signing'
import { TseUnavailableError } from './tse.errors'

const makeLogger = (): TseSigningLogger & { warn: ReturnType<typeof vi.fn> } => ({ warn: vi.fn() })

const startedInfo: OrderTseInfo = {
  status: 'started',
  provider: 'SIMULATOR',
  clientId: 'pos-1',
  transactionNumber: 42,
  simulated: true,
  startedAt: '2026-07-06T10:00:00.000Z',
}

describe('shouldStartOrderTse', () => {
  it('reguläre Order ohne Snapshot → Start erlaubt', () => {
    expect(shouldStartOrderTse({ dailySequenceNumber: 7 })).toBe(true)
  })

  it('fehlende data → kein Start', () => {
    expect(shouldStartOrderTse(undefined)).toBe(false)
  })

  it('offline angelegte Order → kein (rückwirkendes) Signieren (§146a)', () => {
    expect(shouldStartOrderTse({ dailySequenceNumber: 7, offlineCreated: true })).toBe(false)
  })

  it('Idempotenz: bereits gesetzter tse-Snapshot → kein erneuter Start', () => {
    expect(shouldStartOrderTse({ dailySequenceNumber: 7, tse: startedInfo })).toBe(false)
  })
})

describe('allocateOrderTransactionNumber', () => {
  it('vergibt den lückenlosen Zählerwert bei vollständigem Scope', async () => {
    const allocate = vi.fn().mockResolvedValue(99)
    const result = await allocateOrderTransactionNumber({
      fallbackTransactionNumber: 7,
      tenantId: 't-1',
      locationId: 'l-1',
      allocateFiscalCounter: allocate,
      logger: makeLogger(),
    })
    expect(result).toBe(99)
    expect(allocate).toHaveBeenCalledWith('t-1', 'l-1')
  })

  it('fehlender Scope → Fallback-Nummer ohne Zähler-Aufruf', async () => {
    const allocate = vi.fn()
    const result = await allocateOrderTransactionNumber({
      fallbackTransactionNumber: 7,
      tenantId: 't-1',
      allocateFiscalCounter: allocate,
      logger: makeLogger(),
    })
    expect(result).toBe(7)
    expect(allocate).not.toHaveBeenCalled()
  })

  it('Zähler-Fehler → Fallback-Nummer + Warnung (§146a: nie blockieren)', async () => {
    const logger = makeLogger()
    const result = await allocateOrderTransactionNumber({
      fallbackTransactionNumber: 7,
      tenantId: 't-1',
      locationId: 'l-1',
      allocateFiscalCounter: vi.fn().mockRejectedValue(new Error('db locked')),
      logger,
    })
    expect(result).toBe(7)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'tse.fiscal_counter_allocation_failed', errorMessage: 'db locked' }),
    )
  })
})

describe('startOrderTseTransaction', () => {
  it('startet mit Zähler-Nummer und liefert den started-Snapshot', async () => {
    const startTransaction = vi.fn().mockResolvedValue({
      transactionNumber: 99,
      clientId: 'pos-1',
      provider: 'SIMULATOR',
      simulated: true,
      startedAt: '2026-07-06T10:00:00.000Z',
    })
    const info = await startOrderTseTransaction({
      tsePort: { startTransaction },
      clientId: 'pos-1',
      fallbackTransactionNumber: 7,
      tenantId: 't-1',
      locationId: 'l-1',
      allocateFiscalCounter: vi.fn().mockResolvedValue(99),
      logger: makeLogger(),
    })
    expect(startTransaction).toHaveBeenCalledWith({ clientId: 'pos-1', transactionNumber: 99 })
    expect(info.status).toBe('started')
    expect(info.transactionNumber).toBe(99)
  })

  it('§146a: TSE-Ausfall beim Start → unavailable-Snapshot + Warnung, kein Throw', async () => {
    const logger = makeLogger()
    const info = await startOrderTseTransaction({
      tsePort: { startTransaction: vi.fn().mockRejectedValue(new TseUnavailableError()) },
      clientId: 'pos-1',
      fallbackTransactionNumber: 7,
      allocateFiscalCounter: vi.fn(),
      logger,
    })
    expect(info.status).toBe('unavailable')
    expect(info.transactionNumber).toBe(7)
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'tse.order_start_failed' }))
  })

  it('terminaler Start-Fehler → failed-Snapshot mit errorReason', async () => {
    const info = await startOrderTseTransaction({
      tsePort: { startTransaction: vi.fn().mockRejectedValue(new Error('bad config')) },
      clientId: 'pos-1',
      fallbackTransactionNumber: 7,
      allocateFiscalCounter: vi.fn(),
      logger: makeLogger(),
    })
    expect(info.status).toBe('failed')
    expect(info.errorReason).toBe('bad config')
  })
})

describe('resolveExistingOrderTse / resolveOrderTseAmountCents', () => {
  it('explizit gepatchter Snapshot hat Vorrang vor dem gespeicherten Stand', () => {
    const patched: OrderTseInfo = { ...startedInfo, transactionNumber: 1 }
    expect(resolveExistingOrderTse({ tse: patched }, { tse: startedInfo })).toBe(patched)
    expect(resolveExistingOrderTse({}, { tse: startedInfo })).toBe(startedInfo)
    expect(resolveExistingOrderTse({ tse: null }, { tse: null })).toBeUndefined()
  })

  it('amountCents: Patch-Betrag vor gespeichertem Betrag, Default 0, gerundet', () => {
    expect(resolveOrderTseAmountCents({ payment: { totalAmount: 19.9 } }, { payment: { totalAmount: 5 } })).toBe(1990)
    expect(resolveOrderTseAmountCents({}, { payment: { totalAmount: 5.555 } })).toBe(556)
    expect(resolveOrderTseAmountCents({ payment: null }, {})).toBe(0)
  })
})

describe('canFinishOrderTse / canCancelOrderTse', () => {
  it('nur ein started-Snapshot ist abschließbar (transitives Fiskal-Gate)', () => {
    expect(canFinishOrderTse(startedInfo)).toBe(true)
    expect(canFinishOrderTse({ ...startedInfo, status: 'signed' })).toBe(false)
    expect(canFinishOrderTse({ ...startedInfo, status: 'failed' })).toBe(false)
    expect(canFinishOrderTse(undefined)).toBe(false)
  })

  it('stornierbar sind started/signed ohne bestehende cancellation', () => {
    expect(canCancelOrderTse(startedInfo)).toBe(true)
    expect(canCancelOrderTse({ ...startedInfo, status: 'signed' })).toBe(true)
    expect(canCancelOrderTse({ ...startedInfo, status: 'failed' })).toBe(false)
    expect(canCancelOrderTse(undefined)).toBe(false)
    expect(
      canCancelOrderTse({
        ...startedInfo,
        status: 'signed',
        cancellation: { status: 'canceled', canceledAt: '2026-07-06T12:00:00.000Z' },
      }),
    ).toBe(false)
  })
})

describe('finishOrderTseTransaction', () => {
  it('führt Start-Snapshot und Signatur zum signed-Snapshot zusammen', async () => {
    const finishTransaction = vi.fn().mockResolvedValue({
      transactionNumber: 42,
      signatureCounter: 9,
      signatureValue: 'SIG-abc',
      signatureAlgorithm: 'simulated-sha256-v1',
      logTime: '2026-07-06T10:05:00.000Z',
      processType: 'Kassenbeleg-V1',
      simulated: true,
    })
    const info = await finishOrderTseTransaction({
      tsePort: { finishTransaction },
      existing: startedInfo,
      amountCents: 1990,
      logger: makeLogger(),
    })
    expect(finishTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ transactionNumber: 42, clientId: 'pos-1' }),
      { amountCents: 1990 },
    )
    expect(info.status).toBe('signed')
    expect(info.signatureValue).toBe('SIG-abc')
  })

  it('§146a: Abschluss-Fehler → failed-Snapshot (Provider bleibt erhalten) + Warnung', async () => {
    const logger = makeLogger()
    const info = await finishOrderTseTransaction({
      tsePort: { finishTransaction: vi.fn().mockRejectedValue(new Error('TSE down')) },
      existing: startedInfo,
      amountCents: 1990,
      logger,
    })
    expect(info.status).toBe('failed')
    expect(info.provider).toBe('SIMULATOR')
    expect(info.transactionNumber).toBe(42)
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'tse.order_finish_failed' }))
  })
})

describe('cancelOrderTseTransaction', () => {
  const signedInfo: OrderTseInfo = { ...startedInfo, status: 'signed', signatureValue: 'SIG-abc' }

  it('legt die Storno-Signatur NEBEN der erhaltenen Sale-Signatur ab', async () => {
    const cancelTransaction = vi.fn().mockResolvedValue({
      transactionNumber: 42,
      signatureCounter: 10,
      signatureValue: 'CANCEL-1',
      signatureAlgorithm: 'simulated-sha256-v1',
      logTime: '2026-07-06T12:00:00.000Z',
      processType: 'Kassenbeleg-V1',
      simulated: true,
    })
    const info = await cancelOrderTseTransaction({
      tsePort: { cancelTransaction },
      existing: signedInfo,
      canceledAt: '2026-07-06T12:00:00.000Z',
      logger: makeLogger(),
    })
    expect(info.signatureValue).toBe('SIG-abc')
    expect(info.cancellation?.status).toBe('canceled')
    expect(info.cancellation?.signatureValue).toBe('CANCEL-1')
    expect(info.cancellation?.canceledAt).toBe('2026-07-06T12:00:00.000Z')
  })

  it('§146a: TSE-Ausfall beim Storno → cancellation unavailable + Warnung, Sale-Signatur bleibt', async () => {
    const logger = makeLogger()
    const info = await cancelOrderTseTransaction({
      tsePort: { cancelTransaction: vi.fn().mockRejectedValue(new TseUnavailableError()) },
      existing: signedInfo,
      canceledAt: '2026-07-06T12:00:00.000Z',
      logger,
    })
    expect(info.status).toBe('signed')
    expect(info.cancellation?.status).toBe('unavailable')
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'tse.order_cancel_failed' }))
  })
})
