import { describe, expect, it } from 'vitest'

import { dayTseFieldsFromError, dayTseFieldsFromSignature } from './day-signing'
import { SimulatorTseAdapter } from './simulator.adapter'
import { TseError, TseUnavailableError } from './tse.errors'

describe('day-signing Helfer', () => {
  it('dayTseFieldsFromSignature mappt die Tagessignatur auf flache Felder', async () => {
    const tse = new SimulatorTseAdapter()
    const sig = await tse.signDayClose({ businessDayId: 'bd-1', closedAt: '2026-05-16T20:00:00.000Z' })
    const fields = dayTseFieldsFromSignature(sig)
    expect(fields.tseDayStatus).toBe('signed')
    expect(fields.tseDaySignature).toMatch(/^SIM-/)
    expect(typeof fields.tseDaySignatureCounter).toBe('number')
    expect(fields.tseDaySimulated).toBe(true)
  })

  it('dayTseFieldsFromError: Ausfall → unavailable (§146a), sonst failed', () => {
    expect(dayTseFieldsFromError(new TseUnavailableError()).tseDayStatus).toBe('unavailable')
    const failed = dayTseFieldsFromError(new TseError('kaputt'))
    expect(failed.tseDayStatus).toBe('failed')
    expect(failed.tseDaySignature).toBeNull()
    expect(failed.tseDaySignatureCounter).toBeNull()
  })
})
