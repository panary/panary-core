// JIT-Compiler zuerst laden (siehe device-assignment.service.spec.ts).
import '@angular/compiler'
import { Injector, runInInjectionContext } from '@angular/core'
import { ConnectionService } from '@panary/shared/data-access'
import { DeviceConfigService } from '@panary/shared/data-access-config'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DeviceOrderChannelService } from './device-order-channel.service'

// Vorbelegung der Bestellart (core#1166). Der Service entscheidet nichts am Server, aber er
// bestimmt, womit der Dialog startet. Die Wege, auf denen er das falsch tun koennte: fremder
// Cache, fremdes Realtime-Event, kaputter Cache, unlesbarer Wert.

const CACHE_KEY = 'pnry_device_order_channel'
const OWN_DEVICE_ID = 'terminal-1'

function installLocalStorage(seed?: string): Map<string, string> {
  const store = new Map<string, string>()
  if (seed !== undefined) store.set(CACHE_KEY, seed)
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    },
  })
  return store
}

interface SetupOptions {
  cache?: string
  deviceId?: string | null
  record?: Record<string, unknown> | null
}

function setup(options: SetupOptions = {}) {
  const { cache, deviceId = OWN_DEVICE_ID, record = null } = options
  const store = installLocalStorage(cache)

  const listeners = new Map<string, (record: Record<string, unknown>) => void>()
  let registrations = 0
  const find = vi.fn().mockResolvedValue({ data: record ? [record] : [] })
  const devicesService = {
    find,
    on: (event: string, handler: (record: Record<string, unknown>) => void) => {
      registrations++
      listeners.set(event, handler)
    },
  }

  const injector = Injector.create({
    providers: [
      { provide: DeviceConfigService, useValue: { getConfig: () => (deviceId ? { deviceId } : null) } },
      { provide: ConnectionService, useValue: { devicesService } },
    ],
  })

  const service = runInInjectionContext(injector, () => new DeviceOrderChannelService())

  return {
    service,
    find,
    store,
    emitPatched: (patched: Record<string, unknown>) => listeners.get('patched')?.(patched),
    hasPatchedListener: () => listeners.has('patched'),
    listenerCount: () => registrations,
  }
}

const record = (overrides: Record<string, unknown> = {}) => ({
  _id: 'dev-1',
  deviceId: OWN_DEVICE_ID,
  defaultOrderChannel: 'telephone',
  ...overrides,
})

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('DeviceOrderChannelService — Cache', () => {
  it('stellt den Wert aus einem Cache desselben Geraets wieder her (Offline-Start)', () => {
    const { service } = setup({ cache: JSON.stringify({ deviceId: OWN_DEVICE_ID, defaultOrderChannel: 'telephone' }) })
    expect(service.channel()).toBe('telephone')
  })

  it('verwirft einen Cache aus einem frueheren Pairing', () => {
    const { service, store } = setup({
      cache: JSON.stringify({ deviceId: 'altes-pairing', defaultOrderChannel: 'telephone' }),
    })
    expect(service.channel()).toBeNull()
    expect(store.has(CACHE_KEY)).toBe(false)
  })

  it('ein kaputtes Cache-JSON laesst die Kasse nicht scheitern', () => {
    expect(setup({ cache: '{"deviceId":"terminal-1", kaputt' }).service.channel()).toBeNull()
  })

  it('ein unlesbarer Cache-Wert wird zu „kein Standard"', () => {
    const { service } = setup({ cache: JSON.stringify({ deviceId: OWN_DEVICE_ID, defaultOrderChannel: 'online' }) })
    expect(service.channel()).toBeNull()
  })

  it('ohne Cache und ohne Refresh gibt es keinen Standard', () => {
    expect(setup().service.channel()).toBeNull()
  })
})

describe('DeviceOrderChannelService — refresh', () => {
  it('Server gewinnt gegen den Cache und schreibt ihn neu', async () => {
    const { service, store } = setup({
      cache: JSON.stringify({ deviceId: OWN_DEVICE_ID, defaultOrderChannel: 'pos' }),
      record: record({ defaultOrderChannel: 'telephone' }),
    })
    expect(service.channel()).toBe('pos')

    await service.refresh()

    expect(service.channel()).toBe('telephone')
    expect(JSON.parse(store.get(CACHE_KEY) as string)).toEqual({
      deviceId: OWN_DEVICE_ID,
      defaultOrderChannel: 'telephone',
    })
  })

  it('ein serverseitiges Zuruecksetzen (null) loescht auch den gecachten Wert', async () => {
    const { service } = setup({
      cache: JSON.stringify({ deviceId: OWN_DEVICE_ID, defaultOrderChannel: 'pos' }),
      record: record({ defaultOrderChannel: null }),
    })
    await service.refresh()
    expect(service.channel()).toBeNull()
  })

  it('fragt ohne gepairtes Geraet nicht an', async () => {
    const { service, find, hasPatchedListener } = setup({ deviceId: null })
    await service.refresh()
    expect(find).not.toHaveBeenCalled()
    expect(hasPatchedListener()).toBe(false)
  })

  it('fragt genau den eigenen Datensatz ab', async () => {
    const { service, find } = setup({ record: record() })
    await service.refresh()
    expect(find).toHaveBeenCalledWith({ query: { deviceId: OWN_DEVICE_ID, $limit: 1 } })
  })

  it('leeres Ergebnis laesst den Zustand und haengt keinen Listener ein', async () => {
    const { service, hasPatchedListener } = setup({ record: null })
    await service.refresh()
    expect(service.channel()).toBeNull()
    expect(hasPatchedListener()).toBe(false)
  })
})

describe('DeviceOrderChannelService — Realtime-Listener', () => {
  it('ignoriert ein patched-Event eines fremden Geraets', async () => {
    // Das devices-Publish geht an den GESAMTEN Mandanten (channels.ts).
    const { service, emitPatched } = setup({ record: record({ defaultOrderChannel: 'telephone' }) })
    await service.refresh()

    emitPatched({ deviceId: 'anderes-terminal', defaultOrderChannel: 'pos' })

    expect(service.channel()).toBe('telephone')
  })

  it('uebernimmt ein patched-Event des eigenen Geraets, auch das Zuruecksetzen', async () => {
    const { service, emitPatched } = setup({ record: record({ defaultOrderChannel: 'telephone' }) })
    await service.refresh()

    emitPatched({ deviceId: OWN_DEVICE_ID, defaultOrderChannel: 'pos' })
    expect(service.channel()).toBe('pos')

    emitPatched({ deviceId: OWN_DEVICE_ID, defaultOrderChannel: null })
    expect(service.channel()).toBeNull()
  })

  it('haengt den Listener nur einmal ein (refresh ist idempotent)', async () => {
    const { service, listenerCount } = setup({ record: record() })
    await service.refresh()
    await service.refresh()
    expect(listenerCount()).toBe(1)
  })
})
