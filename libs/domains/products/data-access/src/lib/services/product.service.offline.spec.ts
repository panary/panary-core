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
import { AuthService } from '@panary/auth/data-access'
import { ProductService } from './product.service'

// core#649: Nach einem Offline-Start blieb die Produktliste leer — der Auto-Load hing allein
// an `isAuthenticated()`, und `count()` hing am gepufferten Socket-Emit. Geprueft wird die
// Verdrahtung im Service: Offline laedt er aus dem Cache, nach dem Reconnect neu vom Server.
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

const cachedProducts = () => [
  { _id: 'p1', name: 'Cola', status: 'ACTIVE' },
  { _id: 'p2', name: 'Alt', status: 'ARCHIVED' },
  { _id: 'p3', name: 'Apfel', status: 'ACTIVE' },
]

function setup() {
  const authenticated = signal(false)
  const effects = createEffectScheduler()
  const serverProducts = [{ _id: 'p9', name: 'Server-Stand', status: 'ACTIVE' }]
  const serverFind = vi.fn((params: { query: { $limit?: number } }) =>
    Promise.resolve(
      params.query.$limit === 0
        ? { total: serverProducts.length, limit: 0, skip: 0, data: [] }
        : { total: serverProducts.length, limit: 250, skip: 0, data: serverProducts },
    ),
  )

  const injector = Injector.create({
    providers: [
      {
        provide: ConnectionService,
        // Kein `on` am Feathers-Mock → BaseService ueberspringt die Socket-Listener.
        useValue: {
          productService: { find: serverFind },
          isAuthenticated: authenticated,
          connectionState: computed(() => ({ status: authenticated() ? 'authenticated' : 'disconnected' })),
        },
      },
      { provide: AuthService, useValue: { fullName: () => 'Testi Tester' } },
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
          readAll: () => Promise.resolve(cachedProducts()),
          upsertMany: () => Promise.resolve(),
        },
      },
    ],
  })

  const service = runInInjectionContext(injector, () => new ProductService())
  return { service, effects, authenticated, serverFind }
}

/** Effects laufen lassen und die angestossenen Loads abwarten (mehrere Mikrotask-Runden). */
async function tick(effects: ReturnType<typeof createEffectScheduler>) {
  for (let i = 0; i < 3; i++) {
    effects.flush()
    await settle()
  }
}

describe('ProductService — Auto-Load offline und nach dem Reconnect (core#649)', () => {
  it('laedt nach einem Offline-Start die aktiven Produkte aus dem Cache, sortiert', async () => {
    const { service, effects, serverFind } = setup()

    await tick(effects)

    expect(serverFind).not.toHaveBeenCalled()
    expect(service.products().map(product => product._id)).toEqual(['p3', 'p1'])
  })

  it('ersetzt den Cache-Stand nach dem Reconnect durch den Server-Stand', async () => {
    const { service, effects, authenticated, serverFind } = setup()
    await tick(effects)

    authenticated.set(true)
    await tick(effects)

    expect(serverFind).toHaveBeenCalled()
    expect(service.products().map(product => product._id)).toEqual(['p9'])
  })
})
