import { beforeEach, describe, expect, it } from 'vitest'

import { SimulatorTseAdapter } from './simulator.adapter'
import { TseUnavailableError } from './tse.errors'

describe('SimulatorTseAdapter', () => {
  let tse: SimulatorTseAdapter

  beforeEach(() => {
    tse = new SimulatorTseAdapter()
  })

  it('signiert und markiert jeden Vorgang als simuliert (nicht-fiskalisch)', async () => {
    const ref = await tse.startTransaction({ clientId: 'pos-1', transactionNumber: 42 })
    expect(ref.simulated).toBe(true)
    expect(ref.provider).toBe('SIMULATOR')

    const sig = await tse.finishTransaction(ref, { amountCents: 2999 })
    expect(sig.simulated).toBe(true)
    expect(sig.transactionNumber).toBe(42)
    expect(sig.signatureValue).toMatch(/^SIM-/)
  })

  it('signatureCounter steigt monoton über Vorgänge (start + finish)', async () => {
    expect((await tse.getStatus()).signatureCounter).toBe(0)
    const ref = await tse.startTransaction({ clientId: 'pos-1', transactionNumber: 1 })
    await tse.finishTransaction(ref, { amountCents: 100 })
    expect((await tse.getStatus()).signatureCounter).toBe(2)
  })

  it('Lifecycle start → cancel erhöht den Counter und referenziert den Vorgang', async () => {
    const ref = await tse.startTransaction({ clientId: 'pos-1', transactionNumber: 7 })
    const sig = await tse.cancelTransaction(ref)
    expect(sig.transactionNumber).toBe(7)
    expect((await tse.getStatus()).signatureCounter).toBe(2)
  })

  it('signDayClose liefert eine Tagessignatur', async () => {
    const day = await tse.signDayClose({ businessDayId: 'bd-1', closedAt: '2026-05-16T20:00:00.000Z' })
    expect(day.businessDayId).toBe('bd-1')
    expect(day.simulated).toBe(true)
    expect(day.signatureValue).toMatch(/^SIM-/)
  })

  it('export liefert eine simulierte Export-Referenz (DSFinV-K)', async () => {
    const exp = await tse.export({ from: '2026-05-01', to: '2026-05-16' })
    expect(exp.simulated).toBe(true)
    expect(exp.format).toBe('DSFINV_K')
  })

  it('Fault-Injection: Ausfall wirft TseUnavailableError und meldet unhealthy (§146a)', async () => {
    tse.setFault({ outage: true })
    await expect(tse.startTransaction({ clientId: 'pos-1', transactionNumber: 1 })).rejects.toBeInstanceOf(
      TseUnavailableError,
    )
    const status = await tse.getStatus()
    expect(status.healthy).toBe(false)
  })

  it('Fault-Injection: Latenz verzögert, signiert aber weiterhin', async () => {
    tse.setFault({ latencyMs: 5 })
    const ref = await tse.startTransaction({ clientId: 'pos-1', transactionNumber: 1 })
    expect(ref.simulated).toBe(true)
  })

  it('Ausfall lässt sich zurücksetzen', async () => {
    tse.setFault({ outage: true })
    await expect(tse.export({ from: 'a', to: 'b' })).rejects.toBeInstanceOf(TseUnavailableError)
    tse.setFault({ outage: false })
    const exp = await tse.export({ from: 'a', to: 'b' })
    expect(exp.simulated).toBe(true)
  })
})
