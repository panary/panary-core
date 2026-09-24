import { describe, expect, it } from 'vitest'
import { orderPatchResolver } from './orders.schema'

/**
 * `splitOff` senkt ueber `effectiveLineItems()` das ausgewiesene Brutto UND die
 * Steuer. Duerfte ein Client es selbst patchen, rabattierte er seine eigene
 * Bestellung an der Rabattlogik vorbei — auf einem steuerrelevanten Dokument.
 *
 * 🚨 Der Strip ist STILL (HTTP 200, nichts passiert). Ein Test auf den
 * Statuscode waere deshalb gruen, waehrend der Wert durchginge. Diese Spec liest
 * das ERGEBNIS des Resolvers nach.
 */
const ENTRY = {
  _id: 'so-1',
  targetOrderId: '33333333-3333-3333-3333-333333333333',
  lineItemRowId: '44444444-4444-4444-4444-444444444444',
  amount: 1,
  grossCents: 1190,
  splitAt: '2026-09-24T12:00:00.000Z',
}

const resolvePatch = (params: Record<string, unknown>) =>
  orderPatchResolver.resolve({ splitOff: [ENTRY], splitRoundingRemainderCents: 7 } as never, { params } as never)

describe('orderPatchResolver — splitOff (panary/panary-core#349)', () => {
  it('strippt splitOff fuer einen externen Aufrufer', async () => {
    const result = await resolvePatch({ provider: 'rest', user: { _id: 'u-1' } })
    expect(result.splitOff).toBeUndefined()
    expect(result.splitRoundingRemainderCents).toBeUndefined()
  })

  it('strippt splitOff auch fuer einen internen Aufruf OHNE die Split-Markierung', async () => {
    // Der interne Weg allein reicht nicht — sonst schriebe jeder Hook, Worker
    // oder Seed die Gegenbuchung mit (dieselbe Lehre wie ADR 0048 Nr. 4: Die
    // Methodenliste schuetzt nur den externen Weg).
    const result = await resolvePatch({ provider: undefined })
    expect(result.splitOff).toBeUndefined()
    expect(result.splitRoundingRemainderCents).toBeUndefined()
  })

  it('strippt splitOff, wenn die Markierung von aussen kaeme (provider gesetzt)', async () => {
    const result = await resolvePatch({ provider: 'socketio', orderSplit: true })
    expect(result.splitOff).toBeUndefined()
  })

  it('laesst splitOff genau fuer orders.split durch', async () => {
    const result = await resolvePatch({ provider: undefined, orderSplit: true })
    expect(result.splitOff).toEqual([ENTRY])
    expect(result.splitRoundingRemainderCents).toBe(7)
  })
})
