// JIT-Compiler zuerst laden: @angular/material/@angular/common sind partial-compiled;
// ohne Linker (kein analogjs-Plugin in dieser node-Vitest-Config) faellt Angular auf JIT zurueck.
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
import { ProductGroupService } from './product-group.service'

// core#649: Nach einem Offline-Start zeigte der Bestelldialog keine Kategorien — der Auto-Load
// hing allein an `isAuthenticated()`, und `count()` hing am gepufferten Socket-Emit. Geprueft
// wird die Verdrahtung im Service: Offline laedt er aus dem Cache, nach dem Reconnect neu.
//
// Ohne TestBed fehlt der Root-Scheduler fuer effect(); `createEffectScheduler()` ersetzt ihn,
// `flush()` laesst die Effects laufen wie ein Change-Detection-Tick.

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

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

const cachedGroups = () => [
  { _id: 'g1', name: 'Getränke', status: 'ACTIVE', index: 2 },
  { _id: 'g2', name: 'Alt', status: 'ARCHIVED', index: 0 },
  { _id: 'g3', name: 'Pizza', status: 'ACTIVE', index: 1 },
]

function setup() {
  const authenticated = signal(false)
  const effects = createEffectScheduler()
  const serverGroups = [{ _id: 'g9', name: 'Server-Stand', status: 'ACTIVE', index: 0 }]
  const serverFind = vi.fn((params: { query: { $limit?: number } }) =>
    Promise.resolve(
      params.query.$limit === 0
        ? { total: serverGroups.length, limit: 0, skip: 0, data: [] }
        : { total: serverGroups.length, limit: 250, skip: 0, data: serverGroups },
    ),
  )

  const injector = Injector.create({
    providers: [
      {
        provide: ConnectionService,
        // Kein `on` am Feathers-Mock → BaseService ueberspringt die Socket-Listener.
        useValue: {
          productGroupService: { find: serverFind },
          isAuthenticated: authenticated,
          connectionState: computed(() => ({ status: authenticated() ? 'authenticated' : 'disconnected' })),
        },
      },
      { provide: ServiceHelper, useValue: { handleError: vi.fn() } },
      { provide: MatSnackBar, useValue: { open: () => ({ afterDismissed: () => of(undefined) }) } },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
      { provide: NgZone, useValue: { run: (fn: () => unknown) => fn() } },
      { provide: DATA_ACCESS_AUTO_LOAD, useValue: true },
      { provide: ɵChangeDetectionScheduler, useValue: { notify: () => undefined, runningTick: false } },
      { provide: ɵEffectScheduler, useValue: effects },
      {
        provide: OFFLINE_CACHE,
        useValue: {
          isReady: () => true,
          readAll: () => Promise.resolve(cachedGroups()),
          upsertMany: () => Promise.resolve(),
        },
      },
    ],
  })

  const service = runInInjectionContext(injector, () => new ProductGroupService())
  return { service, effects, authenticated, serverFind }
}

/** Effects laufen lassen und die angestossenen Loads abwarten (mehrere Mikrotask-Runden). */
async function tick(effects: ReturnType<typeof createEffectScheduler>) {
  for (let i = 0; i < 3; i++) {
    effects.flush()
    await settle()
  }
}

describe('ProductGroupService — Auto-Load offline und nach dem Reconnect (core#649)', () => {
  it('laedt nach einem Offline-Start die aktiven Gruppen aus dem Cache, nach index sortiert', async () => {
    const { service, effects, serverFind } = setup()

    await tick(effects)

    expect(serverFind).not.toHaveBeenCalled()
    expect(service.productGroups().map(group => group._id)).toEqual(['g3', 'g1'])
  })

  it('ersetzt den Cache-Stand nach dem Reconnect durch den Server-Stand', async () => {
    const { service, effects, authenticated, serverFind } = setup()
    await tick(effects)

    authenticated.set(true)
    await tick(effects)

    expect(serverFind).toHaveBeenCalled()
    expect(service.productGroups().map(group => group._id)).toEqual(['g9'])
  })
})
