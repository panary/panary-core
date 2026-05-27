import { describe, expect, it } from 'vitest'

import { tseInfoFromError, tseInfoFromSignature, tseInfoFromStart, tseRefFromInfo } from './order-signing'
import { SimulatorTseAdapter } from './simulator.adapter'
import { TseError, TseUnavailableError } from './tse.errors'

describe('order-signing Helfer', () => {
  it('tseInfoFromStart übernimmt Ref-Felder und setzt Status started', () => {
    const info = tseInfoFromStart({
      transactionNumber: 5,
      clientId: 'pos-1',
      startedAt: '2026-05-16T10:00:00.000Z',
      provider: 'SIMULATOR',
      simulated: true,
    })
    expect(info.status).toBe('started')
    expect(info.transactionNumber).toBe(5)
    expect(info.clientId).toBe('pos-1')
    expect(info.simulated).toBe(true)
  })

  it('tseInfoFromSignature führt Start + Signatur zu signed zusammen', () => {
    const start = tseInfoFromStart({
      transactionNumber: 5,
      clientId: 'pos-1',
      startedAt: '2026-05-16T10:00:00.000Z',
      provider: 'SIMULATOR',
      simulated: true,
    })
    const signed = tseInfoFromSignature(start, {
      transactionNumber: 5,
      signatureCounter: 9,
      signatureValue: 'SIM-abc',
      signatureAlgorithm: 'simulated-sha256-v1',
      logTime: '2026-05-16T10:05:00.000Z',
      processType: 'Kassenbeleg-V1',
      simulated: true,
    })
    expect(signed.status).toBe('signed')
    expect(signed.signatureCounter).toBe(9)
    expect(signed.signatureValue).toBe('SIM-abc')
    expect(signed.transactionNumber).toBe(5)
  })

  it('tseInfoFromError: Ausfall → unavailable (§146a), sonst failed', () => {
    const unavailable = tseInfoFromError({
      transactionNumber: 1,
      clientId: 'pos-1',
      error: new TseUnavailableError(),
    })
    expect(unavailable.status).toBe('unavailable')

    const failed = tseInfoFromError({
      transactionNumber: 1,
      clientId: 'pos-1',
      error: new TseError('kaputt'),
    })
    expect(failed.status).toBe('failed')
    expect(failed.errorReason).toBe('kaputt')
  })

  it('voller Fluss mit Simulator: start → finish ergibt signed', async () => {
    const tse = new SimulatorTseAdapter()
    const ref = await tse.startTransaction({ clientId: 'pos-1', transactionNumber: 7 })
    const start = tseInfoFromStart(ref)
    const sig = await tse.finishTransaction(tseRefFromInfo(start), { amountCents: 1990 })
    const signed = tseInfoFromSignature(start, sig)
    expect(signed.status).toBe('signed')
    expect(signed.signatureValue).toMatch(/^SIM-/)
    expect(signed.transactionNumber).toBe(7)
  })
})
