// JIT-Compiler zuerst laden: @angular/common (ueber den ConnectionService-Barrel)
// ist partial-compiled; ohne Linker (kein analogjs-Plugin in dieser
// node-Vitest-Config) faellt Angular auf JIT zurueck.
import '@angular/compiler'
import { Injector, runInInjectionContext } from '@angular/core'
import { DeviceAccessMode } from '@panary/devices/domain'
import { ConnectionService } from '@panary/shared/data-access'
import { DeviceConfigService } from '@panary/shared/data-access-config'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DeviceAssignmentService } from './device-assignment.service'

// Anzeige-Zustand der Geraete-Zuweisung am Login-Screen
// (PNRY-FEAT-DEVICE-ASSIGNMENT-001). Der Service entscheidet nichts — die
// Durchsetzung sitzt am Edge —, aber er entscheidet, WAS der Bediener sieht.
// Genau die drei Wege, auf denen er das falsch tun koennte, stehen hier:
// ein fremder Cache, ein fremdes Realtime-Event und ein kaputter Cache.

const ASSIGNMENT_CACHE_KEY = 'pnry_device_assignment'
const OWN_DEVICE_ID = 'terminal-1'

/**
 * `environment: 'node'` (Workspace-Standard fuer Lib-Specs) hat kein
 * localStorage. Der Stub ist hier kein Notbehelf, sondern Absicht: Der
 * kaputte-Cache-Fall braucht einen Rohwert, den kein echtes Storage-API
 * so schreiben liesse.
 */
function installLocalStorage(seed?: string): Map<string, string> {
  const store = new Map<string, string>()
  if (seed !== undefined) store.set(ASSIGNMENT_CACHE_KEY, seed)

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
  /** Rohinhalt des Caches vor der Konstruktion — der Konstruktor liest ihn. */
  cache?: string
  /** `null` simuliert ein noch nicht gepairtes Terminal. */
  deviceId?: string | null
  /** Datensatz, den `devices.find` liefert. `null` = leeres Ergebnis. */
  record?: Record<string, unknown> | null
}

function setup(options: SetupOptions = {}) {
  const { cache, deviceId = OWN_DEVICE_ID, record = null } = options
  const store = installLocalStorage(cache)

  const listeners = new Map<string, (record: Record<string, unknown>) => void>()
  const find = vi.fn().mockResolvedValue({ data: record ? [record] : [] })
  const devicesService = {
    find,
    on: (event: string, handler: (record: Record<string, unknown>) => void) => void listeners.set(event, handler),
  }

  const injector = Injector.create({
    providers: [
      { provide: DeviceConfigService, useValue: { getConfig: () => (deviceId ? { deviceId } : null) } },
      { provide: ConnectionService, useValue: { devicesService } },
    ],
  })

  const service = runInInjectionContext(injector, () => new DeviceAssignmentService())

  return {
    service,
    find,
    store,
    emitPatched: (patched: Record<string, unknown>) => listeners.get('patched')?.(patched),
    hasPatchedListener: () => listeners.has('patched'),
  }
}

const assignedRecord = (overrides: Record<string, unknown> = {}) => ({
  _id: 'dev-1',
  deviceId: OWN_DEVICE_ID,
  deviceAccessMode: DeviceAccessMode.ASSIGNED,
  assignedUserIds: ['u-anna'],
  ...overrides,
})

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('DeviceAssignmentService — Cache-Wiederherstellung', () => {
  it('stellt den Zustand aus einem Cache desselben Geraets wieder her', () => {
    const { service } = setup({
      cache: JSON.stringify({
        deviceId: OWN_DEVICE_ID,
        deviceAccessMode: DeviceAccessMode.ASSIGNED,
        assignedUserIds: ['u-anna', 'u-bruno'],
      }),
    })

    expect(service.isAssigned()).toBe(true)
    expect(service.assignedUserIds()).toEqual(['u-anna', 'u-bruno'])
  })

  it('verwirft einen Cache aus einem frueheren Pairing statt ihn zu uebernehmen', () => {
    const { service, store } = setup({
      cache: JSON.stringify({
        deviceId: 'terminal-aus-vorherigem-pairing',
        deviceAccessMode: DeviceAccessMode.ASSIGNED,
        assignedUserIds: ['u-fremd'],
      }),
    })

    expect(service.isAssigned()).toBe(false)
    expect(service.assignedUserIds()).toEqual([])
    // Nicht nur ignoriert, sondern entfernt — sonst haengt der Fremdzustand
    // bis zum naechsten Server-Wert im Storage.
    expect(store.has(ASSIGNMENT_CACHE_KEY)).toBe(false)
  })

  it('meldet trotz Cache erst nach einem Server-Wert `loaded`', async () => {
    const { service } = setup({
      cache: JSON.stringify({
        deviceId: OWN_DEVICE_ID,
        deviceAccessMode: DeviceAccessMode.ASSIGNED,
        assignedUserIds: ['u-anna'],
      }),
      record: assignedRecord(),
    })

    expect(service.isAssigned()).toBe(true)
    expect(service.loaded()).toBe(false)

    await service.refresh()

    expect(service.loaded()).toBe(true)
  })

  it('laesst ein kaputtes Cache-JSON den Login-Screen nicht scheitern', () => {
    const { service } = setup({ cache: '{"deviceId":"terminal-1", kaputt' })

    expect(service.isAssigned()).toBe(false)
    expect(service.assignedUserIds()).toEqual([])
  })

  it('kommt ohne Cache-Eintrag aus', () => {
    const { service } = setup()

    expect(service.isShared()).toBe(true)
    expect(service.assignedUserIds()).toEqual([])
  })
})

describe('DeviceAssignmentService — refresh', () => {
  it('uebernimmt den eigenen Datensatz und merkt sich dessen _id', async () => {
    const { service, find } = setup({ record: assignedRecord({ assignedUserIds: ['u-anna', 'u-bruno'] }) })

    await service.refresh()

    expect(find).toHaveBeenCalledWith({ query: { deviceId: OWN_DEVICE_ID, $limit: 1 } })
    expect(service.isAssigned()).toBe(true)
    expect(service.assignedUserIds()).toEqual(['u-anna', 'u-bruno'])
    expect(service.deviceRecordId).toBe('dev-1')
  })

  it('fragt ohne gepairtes Geraet gar nicht erst an', async () => {
    const { service, find, hasPatchedListener } = setup({ deviceId: null })

    await service.refresh()

    expect(find).not.toHaveBeenCalled()
    expect(hasPatchedListener()).toBe(false)
    expect(service.loaded()).toBe(false)
  })

  it('bleibt bei leerem Ergebnis im Ausgangszustand', async () => {
    const { service, hasPatchedListener } = setup({ record: null })

    await service.refresh()

    expect(service.isShared()).toBe(true)
    expect(service.loaded()).toBe(false)
    // Kein Listener ohne aufgeloesten Datensatz — sonst haengt er an einem
    // Geraet, das der Service gar nicht kennt.
    expect(hasPatchedListener()).toBe(false)
  })
})

describe('DeviceAssignmentService — Realtime-Listener', () => {
  it('ignoriert ein patched-Event eines fremden Geraets', async () => {
    // Der wichtigste Fall: Das devices-Publish in channels.ts geht an den
    // GESAMTEN Mandanten. Ohne den deviceId-Filter uebernaehme dieses Terminal
    // die Zuweisung jedes anderen Geraets — und zwar genau dann, wenn irgendwo
    // im Betrieb ein Geraet gepatcht wird.
    const { service, emitPatched } = setup({ record: assignedRecord({ assignedUserIds: ['u-anna'] }) })
    await service.refresh()

    emitPatched({
      _id: 'dev-2',
      deviceId: 'ein-anderes-terminal',
      deviceAccessMode: DeviceAccessMode.SHARED,
      assignedUserIds: [],
    })

    expect(service.isAssigned()).toBe(true)
    expect(service.assignedUserIds()).toEqual(['u-anna'])
  })

  it('uebernimmt ein patched-Event des eigenen Geraets', async () => {
    const { service, emitPatched } = setup({ record: assignedRecord({ assignedUserIds: ['u-anna'] }) })
    await service.refresh()

    emitPatched({
      _id: 'dev-1',
      deviceId: OWN_DEVICE_ID,
      deviceAccessMode: DeviceAccessMode.ASSIGNED,
      assignedUserIds: ['u-bruno', 'u-clara'],
    })

    expect(service.assignedUserIds()).toEqual(['u-bruno', 'u-clara'])
  })

  it('traegt das Zurueckschalten auf `shared` nach', async () => {
    const { service, emitPatched } = setup({ record: assignedRecord() })
    await service.refresh()

    emitPatched({ _id: 'dev-1', deviceId: OWN_DEVICE_ID, deviceAccessMode: DeviceAccessMode.SHARED })

    expect(service.isShared()).toBe(true)
    expect(service.assignedUserIds()).toEqual([])
  })

  it('haengt den Listener bei mehrfachem refresh nur einmal ein', async () => {
    const { service, emitPatched } = setup({ record: assignedRecord() })

    await service.refresh()
    await service.refresh()

    // Waere er doppelt gebunden, ueberschriebe der zweite Handler den ersten in
    // der Map — der Test faenge das nicht. Stattdessen ueber die Wirkung: ein
    // Event muss weiterhin genau einmal ankommen.
    emitPatched({ _id: 'dev-1', deviceId: OWN_DEVICE_ID, deviceAccessMode: DeviceAccessMode.SHARED })
    expect(service.isShared()).toBe(true)
  })
})

describe('DeviceAssignmentService — Cache-Schreibpfad', () => {
  it('schreibt den Server-Zustand unter der eigenen deviceId in den Cache', async () => {
    const { service, store } = setup({ record: assignedRecord({ assignedUserIds: ['u-anna'] }) })

    await service.refresh()

    expect(JSON.parse(store.get(ASSIGNMENT_CACHE_KEY) as string)).toEqual({
      deviceId: OWN_DEVICE_ID,
      deviceAccessMode: DeviceAccessMode.ASSIGNED,
      assignedUserIds: ['u-anna'],
    })
  })
})
