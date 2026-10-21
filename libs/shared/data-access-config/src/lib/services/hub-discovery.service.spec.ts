import { afterEach, describe, expect, it, vi } from 'vitest'

import { HubDiscoveryService } from './hub-discovery.service'

// Capacitor-Wrapper (panary/panary-core#818): Der Wizard unterscheidet Tauri (mDNS) von Capacitor (kein mDNS).
describe('HubDiscoveryService Plattform-Erkennung', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('erkennt Capacitor nur auf der nativen Plattform', () => {
    vi.stubGlobal('window', { Capacitor: { isNativePlatform: () => true } })
    const service = new HubDiscoveryService()
    expect(service.isCapacitor()).toBe(true)
    expect(service.isTauri()).toBe(false)
  })

  it('meldet im Browser weder Capacitor noch Tauri', () => {
    vi.stubGlobal('window', { Capacitor: { isNativePlatform: () => false } })
    const service = new HubDiscoveryService()
    expect(service.isCapacitor()).toBe(false)
    expect(service.isTauri()).toBe(false)
  })
})
