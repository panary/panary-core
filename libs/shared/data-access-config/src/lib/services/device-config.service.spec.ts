import { beforeEach, describe, expect, it } from 'vitest'

import { DeviceConfigService } from './device-config.service'

import type { DeviceConfig } from '../models/device-config.model'

// Die Uebernahme eines rotierten Geraete-Schluessels (ADR 0042) ist der eine
// Schreibvorgang, der WAEHREND des Kassenbetriebs passiert. Zwei Zusicherungen
// haengen daran:
//  - Es wird genau ein Feld ersetzt — deviceId, Standort und Sprache muessen die
//    Rotation ueberleben, sonst verliert das Terminal seine Identitaet.
//  - Ohne bestehende Config wird NICHTS geschrieben: Eine halbe Config waere
//    schlimmer als keine, weil `isRegistered()` dann faelschlich true meldet.
//
// Der Service hat weder Konstruktor noch `inject()` — deshalb reicht `new`
// statt TestBed. `environment: 'node'` kennt kein localStorage; der Stub unten
// ist die gesamte noetige Umgebung.
const STORAGE_KEY = 'panary_device_config'

class MemoryStorage {
  #data = new Map<string, string>()
  getItem(key: string): string | null {
    return this.#data.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.#data.set(key, value)
  }
  removeItem(key: string): void {
    this.#data.delete(key)
  }
  clear(): void {
    this.#data.clear()
  }
}

const baseConfig = (): DeviceConfig =>
  ({
    serverUrl: 'http://edge.local:3030',
    deviceId: 'geraet-1',
    apiKey: 'alter-schluessel',
    deviceName: 'Kasse 1',
    deviceType: 'pos-counter',
    tenantId: 'tenant-1',
    locationId: 'location-1',
    language: 'de',
    registeredAt: new Date('2026-01-01T00:00:00.000Z'),
  }) as unknown as DeviceConfig

describe('DeviceConfigService.updateApiKey', () => {
  let service: DeviceConfigService

  beforeEach(() => {
    // Instanz und Storage je Test — `.claude/rules/testing.md` §10.
    ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
    service = new DeviceConfigService()
  })

  it('ersetzt ausschliesslich den Schluessel und laesst die Identitaet stehen', () => {
    service.saveConfig(baseConfig())

    expect(service.updateApiKey('neuer-schluessel')).toBe(true)

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) as string)
    expect(stored.apiKey).toBe('neuer-schluessel')
    expect(stored.deviceId).toBe('geraet-1')
    expect(stored.tenantId).toBe('tenant-1')
    expect(stored.locationId).toBe('location-1')
    expect(stored.deviceName).toBe('Kasse 1')
    expect(stored.language).toBe('de')
  })

  it('bleibt registriert — die Rotation darf das Terminal nie in die Kopplung zurueckwerfen', () => {
    service.saveConfig(baseConfig())
    service.updateApiKey('neuer-schluessel')

    expect(service.isRegistered()).toBe(true)
  })

  it('schreibt ohne bestehende Config nichts', () => {
    expect(service.updateApiKey('neuer-schluessel')).toBe(false)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('schreibt bei leerem Schluessel nichts', () => {
    service.saveConfig(baseConfig())

    expect(service.updateApiKey('')).toBe(false)

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) as string)
    expect(stored.apiKey).toBe('alter-schluessel')
  })
})
