// JIT-Compiler zuerst laden: @angular/material ist partial-compiled; ohne Linker
// (kein analogjs-Plugin in dieser node-Vitest-Config) faellt Angular auf JIT zurueck.
import '@angular/compiler'
import { describe, expect, it, vi } from 'vitest'
import {
  computed,
  Injector,
  NgZone,
  runInInjectionContext,
  signal,
  ɵChangeDetectionScheduler,
  ɵEffectScheduler,
} from '@angular/core'
import { MatSnackBar } from '@angular/material/snack-bar'
import { TranslateService } from '@ngx-translate/core'
import { of } from 'rxjs'
import { ConnectionService, DATA_ACCESS_AUTO_LOAD, OFFLINE_CACHE, ServiceHelper } from '@panary/shared/data-access'
import { DeviceConfigService } from '@panary/shared/data-access-config'
import { LocationService } from './location.service'

// core#644: Startet der POS ohne erreichbaren Edge, wird die Verbindung nie
// authentifiziert. `activeLocation` blieb dann leer, und der Bestelldialog
// sperrte mit „Standort konnte nicht geladen werden" — der Outbox-Pfad war
// unerreichbar.
//
// Ohne TestBed fehlt der Root-Scheduler fuer effect(); `createEffectScheduler()`
// ersetzt ihn, `flush()` laesst die Effects laufen wie ein Change-Detection-Tick.

interface EffectHandle {
  dirty: boolean
  run(): void
}

function createEffectScheduler() {
  const handles = new Set<EffectHandle>()
  return {
    add: (handle: EffectHandle) => handles.add(handle),
    schedule: () => undefined,
    remove: (handle: EffectHandle) => handles.delete(handle),
    flush: () => {
      for (const handle of handles) if (handle.dirty) handle.run()
    },
  }
}

interface SetupOptions {
  authenticated?: boolean
  cacheReady?: boolean
  cached?: Record<string, unknown> | undefined
  registered?: boolean
  /** Antwort des Online-`get` (nur relevant, wenn authentifiziert). */
  online?: Record<string, unknown>
}

const CACHED_LOCATION = { _id: 'loc-1', tenantId: 'tenant-1', name: 'Filiale Mitte' }

function setup(options: SetupOptions = {}) {
  const authenticated = signal(options.authenticated ?? false)
  const cacheReady = signal(options.cacheReady ?? true)
  const effects = createEffectScheduler()
  const feathersGet = vi.fn(() => Promise.resolve(options.online ?? { _id: 'loc-1', name: 'Online-Stand' }))
  const cacheGet = vi.fn((_store: string, _id: string) =>
    Promise.resolve('cached' in options ? options.cached : CACHED_LOCATION),
  )
  const registered = options.registered ?? true

  const injector = Injector.create({
    providers: [
      {
        provide: ConnectionService,
        // Kein `on` am Feathers-Mock → BaseService ueberspringt die Socket-Listener.
        useValue: {
          locationService: { get: feathersGet, find: () => Promise.resolve([]) },
          isAuthenticated: authenticated,
          connectionState: computed(() => ({ status: authenticated() ? 'authenticated' : 'error' })),
        },
      },
      {
        provide: DeviceConfigService,
        useValue: {
          isRegistered: () => registered,
          // Auch ungekoppelt kann eine alte `locationId` in der Config stehen (Legacy-Edge-Session):
          // Sie darf ohne Kopplung keinen Cache-Read ausloesen.
          getConfig: () => ({ ...(registered ? { deviceId: 'd-1', apiKey: 'k' } : {}), locationId: 'loc-1' }),
        },
      },
      { provide: ServiceHelper, useValue: { handleError: vi.fn() } },
      { provide: MatSnackBar, useValue: { open: () => ({ afterDismissed: () => of(undefined) }) } },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
      { provide: NgZone, useValue: { run: (fn: () => unknown) => fn() } },
      { provide: DATA_ACCESS_AUTO_LOAD, useValue: false },
      { provide: ɵChangeDetectionScheduler, useValue: { notify: () => undefined, runningTick: false } },
      { provide: ɵEffectScheduler, useValue: effects },
      {
        provide: OFFLINE_CACHE,
        useValue: { isReady: () => cacheReady(), get: cacheGet, upsertMany: () => Promise.resolve() },
      },
    ],
  })

  const service = runInInjectionContext(injector, () => new LocationService())
  return { service, cacheGet, authenticated, cacheReady, effects, feathersGet }
}

describe('LocationService.restoreActiveLocationFromCache (core#644)', () => {
  it('setzt die Location des Geraets offline aus dem Cache-Store `locations`', async () => {
    const { service, cacheGet } = setup()

    await service.restoreActiveLocationFromCache()

    expect(cacheGet).toHaveBeenCalledWith('locations', 'loc-1')
    expect(service.activeLocation()).toEqual(CACHED_LOCATION)
  })

  it('laesst die Location leer, wenn sie nicht im Cache liegt', async () => {
    const { service } = setup({ cached: undefined })

    await service.restoreActiveLocationFromCache()

    expect(service.activeLocation()).toBeUndefined()
  })

  it('liest nicht, solange der Cache nicht bereit ist', async () => {
    const { service, cacheGet } = setup({ cacheReady: false })

    await service.restoreActiveLocationFromCache()

    expect(cacheGet).not.toHaveBeenCalled()
    expect(service.activeLocation()).toBeUndefined()
  })

  it('liest nicht ohne gekoppeltes Geraet (Cloud-/Web-Frontend)', async () => {
    const { service, cacheGet } = setup({ registered: false })

    await service.restoreActiveLocationFromCache()

    expect(cacheGet).not.toHaveBeenCalled()
  })

  it('ueberschreibt keinen Online-Stand: Authentifizierung waehrend des Cache-Reads gewinnt', async () => {
    const { service, cacheGet, authenticated } = setup()
    cacheGet.mockImplementationOnce(() => {
      authenticated.set(true)
      return Promise.resolve(CACHED_LOCATION)
    })

    await service.restoreActiveLocationFromCache()

    expect(service.activeLocation()).toBeUndefined()
  })
})

// Kein Fake-Timer noetig: Die Cache-Reads sind aufgeloeste Promises, ein Mikrotask-Durchlauf genuegt.
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('LocationService — Effect beim Start (core#644)', () => {
  it('startet der POS offline, kommt die Location aus dem Cache', async () => {
    const { service, effects, feathersGet } = setup()

    effects.flush()
    await settle()

    expect(feathersGet).not.toHaveBeenCalled()
    expect(service.activeLocation()).toEqual(CACHED_LOCATION)
  })

  it('wird der Cache erst nach dem Start bereit, laeuft der Effect erneut und setzt die Location', async () => {
    const { service, effects, cacheReady, cacheGet } = setup({ cacheReady: false })

    effects.flush()
    await settle()
    expect(cacheGet).not.toHaveBeenCalled()

    cacheReady.set(true)
    effects.flush()
    await settle()

    expect(service.activeLocation()).toEqual(CACHED_LOCATION)
  })

  it('online bleibt es beim Server-Read: der Cache wird nicht gelesen', async () => {
    const { service, effects, cacheGet, feathersGet } = setup({ authenticated: true })

    effects.flush()
    await settle()

    expect(feathersGet).toHaveBeenCalledWith('loc-1', {})
    expect(cacheGet).not.toHaveBeenCalled()
    expect(service.activeLocation()).toEqual({ _id: 'loc-1', name: 'Online-Stand' })
  })

  it('bricht die Verbindung nach einem Online-Load ab, bleibt der Server-Stand stehen', async () => {
    const { service, effects, authenticated, cacheGet } = setup({ authenticated: true })

    effects.flush()
    await settle()
    authenticated.set(false)
    effects.flush()
    await settle()

    expect(cacheGet).not.toHaveBeenCalled()
    expect(service.activeLocation()).toEqual({ _id: 'loc-1', name: 'Online-Stand' })
  })

  it('kommt die Verbindung nach dem Offline-Start, ersetzt der Server-Stand den Cache-Stand', async () => {
    const { service, effects, authenticated } = setup()

    effects.flush()
    await settle()
    expect(service.activeLocation()).toEqual(CACHED_LOCATION)

    authenticated.set(true)
    effects.flush()
    await settle()

    expect(service.activeLocation()).toEqual({ _id: 'loc-1', name: 'Online-Stand' })
  })
})
