import { describe, expect, it } from 'vitest'

import { cloudTone, deviceTone, syncTone } from './edge-status-bar'

describe('Edge-Statuszeile: Tönung', () => {
  it('Cloud: verbunden ok, Fehler rot, Kopplung und Funkstille gelb, ohne Kopplung neutral', () => {
    expect(cloudTone('connected')).toBe('ok')
    expect(cloudTone('error')).toBe('error')
    expect(cloudTone('pairing')).toBe('warn')
    expect(cloudTone('stale')).toBe('warn')
    expect(cloudTone('standalone')).toBe('neutral')
    expect(cloudTone('disconnected')).toBe('neutral')
  })

  it('Sync: jedes offene Problem färbt rot', () => {
    expect(syncTone(0)).toBe('ok')
    expect(syncTone(1)).toBe('error')
  })

  it('Geräte: keins gekoppelt neutral, keins verbunden gelb, mindestens eins ok', () => {
    expect(deviceTone(0, 0)).toBe('neutral')
    expect(deviceTone(0, 2)).toBe('warn')
    expect(deviceTone(1, 2)).toBe('ok')
  })
})
