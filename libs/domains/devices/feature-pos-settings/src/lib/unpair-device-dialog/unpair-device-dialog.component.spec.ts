// JIT-Compiler zuerst laden — siehe order-dialog.component.spec.ts (ADR 0011).
import '@angular/compiler'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DestroyRef,
  Injector,
  runInInjectionContext,
  type StaticProvider,
  ɵChangeDetectionScheduler,
  ɵEffectScheduler,
} from '@angular/core'
import { TranslateService } from '@ngx-translate/core'
import { ConnectionService, OFFLINE_OUTBOX } from '@panary/shared/data-access'
import { DeviceConfigService } from '@panary/shared/data-access-config'

import { UnpairDeviceDialogComponent } from './unpair-device-dialog.component'

/**
 * Specs der Datenverlust-Rückfrage vor dem Entkoppeln (#322).
 *
 * `unpair()` löscht alle lokalen IndexedDB-Datenbanken — inklusive der Offline-Outbox.
 * Geprüft wird hier ausschließlich, ob der Dialog bei ausstehenden Einträgen einen
 * zweiten Bestätigungsschritt einschiebt und ihn bei leerer Outbox auslässt. Was
 * `unpair()` danach tut, hat seine Tests dort.
 *
 * Aufbau wie `order-dialog.component.spec.ts`: echte Instanz ohne TestBed, alle
 * `inject()`-Tokens als `useValue`-Mocks in einem eigenen Injector (die Lib läuft mit
 * `environment: 'node'`). Alles je Test angelegt (`.claude/rules/code-style.md` §10).
 */

interface SetupOptions {
  /** Rückgabe von `pendingCount()`. `null` = kein Outbox-Provider (Nicht-POS-Host). */
  readonly pendingCount?: number | null
}

function setup(options: SetupOptions = {}) {
  const unpairCalls: Array<{ discardedOutboxCount?: number }> = []
  let disconnects = 0
  let reloads = 0

  vi.stubGlobal('window', { location: { reload: () => void reloads++ } })

  // Explizit typisiert: sonst leitet TS den Union-Typ aus den Literalen ab und der
  // spaetere push() scheitert (faellt nur im typecheck auf, nicht im Test-Lauf).
  const providers: StaticProvider[] = [
    { provide: ConnectionService, useValue: { socketDisconnect: () => void disconnects++, usersService: {} } },
    {
      provide: DeviceConfigService,
      useValue: {
        getDeviceName: () => 'Kasse 1',
        unpair: (opts: { discardedOutboxCount?: number } = {}) => {
          unpairCalls.push(opts)
          return Promise.resolve({ backendDeleted: true, databasesDeleted: 2 })
        },
      },
    },
    { provide: TranslateService, useValue: { instant: (key: string) => key } },
    // Effects/CD-Scheduler: `Injector.create` bringt sie nicht mit (NG0201).
    { provide: ɵChangeDetectionScheduler, useValue: { notify: () => undefined } },
    {
      provide: ɵEffectScheduler,
      useValue: { add: () => undefined, schedule: () => undefined, remove: () => undefined },
    },
    { provide: DestroyRef, useValue: { onDestroy: () => () => undefined } },
  ]

  const pending = options.pendingCount ?? null
  if (pending !== null) {
    providers.push({ provide: OFFLINE_OUTBOX, useValue: { pendingCount: () => pending } })
  }

  const injector = Injector.create({ providers })
  const component = runInInjectionContext(injector, () => new UnpairDeviceDialogComponent())

  return { component, unpairCalls, reloads: () => reloads, disconnects: () => disconnects }
}

describe('UnpairDeviceDialogComponent — Datenverlust-Rückfrage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('entkoppelt ohne Rückfrage, wenn die Outbox leer ist', async () => {
    const { component, unpairCalls } = setup({ pendingCount: 0 })

    component.requestUnpair()
    await Promise.resolve()

    expect(component.step()).not.toBe('confirm-pending')
    expect(unpairCalls).toHaveLength(1)
    expect(unpairCalls[0].discardedOutboxCount).toBe(0)
  })

  it('verlangt einen zweiten Schritt, wenn Einträge ausstehen', async () => {
    const { component, unpairCalls } = setup({ pendingCount: 3 })

    component.requestUnpair()
    await Promise.resolve()

    expect(component.step()).toBe('confirm-pending')
    expect(component.pendingOutboxCount()).toBe(3)
    // 🚨 Der Kern: Bis zur zweiten Bestätigung wird NICHTS gelöscht.
    expect(unpairCalls).toHaveLength(0)
  })

  it('lässt das Gerät unverändert, wenn der zweite Schritt abgebrochen wird', () => {
    const { component, unpairCalls, disconnects } = setup({ pendingCount: 2 })

    component.requestUnpair()
    component.backToConfirm()

    expect(component.step()).toBe('confirm')
    expect(unpairCalls).toHaveLength(0)
    expect(disconnects()).toBe(0)
  })

  it('reicht die verworfene Anzahl an unpair() durch (einzige Spur des Verlusts)', async () => {
    const { component, unpairCalls } = setup({ pendingCount: 2 })

    component.requestUnpair()
    await component.performUnpair()

    expect(unpairCalls[0].discardedOutboxCount).toBe(2)
  })

  it('bleibt ohne Outbox-Provider beim unveränderten Ablauf', async () => {
    const { component, unpairCalls } = setup({ pendingCount: null })

    expect(component.pendingOutboxCount()).toBe(0)
    component.requestUnpair()
    await Promise.resolve()

    expect(unpairCalls).toHaveLength(1)
  })
})
