import { describe, expect, it } from 'vitest'

import { matchesSocketIdentity, type SocketIdentity } from './socket-identity'

/** Socket wurde ohne DeviceConfig gebaut (Erst-Setup, Admin-/User-Zweig). */
const adminBoot: SocketIdentity = { deviceId: null, baseUrl: 'http://localhost:3030' }

/** Socket wurde mit Geraete-Credentials gegen den lokalen Hub gebaut. */
const deviceBoot: SocketIdentity = { deviceId: 'dev-1', baseUrl: 'http://192.168.1.5:3030' }

describe('matchesSocketIdentity', () => {
  it('Regression: Admin-Boot passt nicht zu einer nachtraeglich gepairten Config', () => {
    // Der eigentliche Bug — der Socket lief ohne auth-Payload gegen localhost,
    // waehrend die frisch gespeicherte Config auf den Hub zeigt.
    expect(matchesSocketIdentity(adminBoot, { deviceId: 'dev-1', serverUrl: 'http://192.168.1.5:3030' })).toBe(false)
  })

  it('unveraenderte Device-Config passt', () => {
    expect(matchesSocketIdentity(deviceBoot, { deviceId: 'dev-1', serverUrl: 'http://192.168.1.5:3030' })).toBe(true)
  })

  it('Serverwechsel Hub → Cloud bei gleicher deviceId passt nicht', () => {
    expect(matchesSocketIdentity(deviceBoot, { deviceId: 'dev-1', serverUrl: 'https://api.panary.cloud' })).toBe(false)
  })

  it('Trailing Slash und Pfad sind irrelevant — verglichen werden Protokoll und Host', () => {
    expect(matchesSocketIdentity(deviceBoot, { deviceId: 'dev-1', serverUrl: 'http://192.168.1.5:3030/' })).toBe(true)
    expect(matchesSocketIdentity(deviceBoot, { deviceId: 'dev-1', serverUrl: 'http://192.168.1.5:3030/api' })).toBe(
      true,
    )
  })

  it('abweichender Port zaehlt als anderer Host', () => {
    expect(matchesSocketIdentity(deviceBoot, { deviceId: 'dev-1', serverUrl: 'http://192.168.1.5:4000' })).toBe(false)
  })

  it('nach clearConfig passt der Device-Socket nicht mehr', () => {
    expect(matchesSocketIdentity(deviceBoot, null)).toBe(false)
    expect(matchesSocketIdentity(deviceBoot, undefined)).toBe(false)
  })

  it('Admin-Client ohne Geraet passt immer', () => {
    expect(matchesSocketIdentity(adminBoot, null)).toBe(true)
    expect(matchesSocketIdentity(adminBoot, { serverUrl: 'http://irrelevant:1234' })).toBe(true)
  })

  it('unparsbare serverUrl faellt auf den Rohwert zurueck statt zu werfen', () => {
    expect(
      matchesSocketIdentity({ deviceId: 'dev-1', baseUrl: 'kaputt' }, { deviceId: 'dev-1', serverUrl: 'kaputt' }),
    ).toBe(true)
  })
})
