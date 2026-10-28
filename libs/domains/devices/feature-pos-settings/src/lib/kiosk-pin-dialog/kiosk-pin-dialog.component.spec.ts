// JIT-Compiler zuerst laden — siehe order-dialog.component.spec.ts (ADR 0011).
import '@angular/compiler'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DestroyRef, Injector, runInInjectionContext, ɵChangeDetectionScheduler, ɵEffectScheduler } from '@angular/core'
import { SIGNAL } from '@angular/core/primitives/signals'
import { TranslateService } from '@ngx-translate/core'
import { ConnectionService } from '@panary/shared/data-access'
import { KioskService, LogService } from '@panary/shared/data-access-updater'

import { type KioskAction, KioskPinDialogComponent } from './kiosk-pin-dialog.component'

/**
 * Specs des Kiosk-Notausgangs (panary/panary-core#1188): Nur Inhaber und Techniker
 * kommen durch, und erst nach erfolgreicher PIN ruft der Dialog die Shell.
 *
 * Aufbau wie `unpair-device-dialog.component.spec.ts`: echte Instanz ohne TestBed,
 * alle `inject()`-Tokens als Mocks, alles je Test angelegt (testing.md §10).
 */

interface User {
  _id: string
  firstName: string
  lastName: string
  role: string
}

const OWNER: User = { _id: 'u-owner', firstName: 'Ina', lastName: 'Haber', role: 'tenant:owner' }
const TECH: User = { _id: 'u-tech', firstName: 'Tom', lastName: 'Technik', role: 'tenant:technician' }
const MANAGER: User = { _id: 'u-mgr', firstName: 'Mia', lastName: 'Leitung', role: 'tenant:manager' }
const STAFF: User = { _id: 'u-staff', firstName: 'Sam', lastName: 'Kasse', role: 'tenant:staff' }

interface SetupOptions {
  readonly action?: KioskAction
  /** Was `users.find` liefert (der Edge filtert per `$in`, eine manipulierte Liste nicht). */
  readonly found?: User[]
  /** Was `verifyPin` zurückgibt; `null` = falsche PIN (wirft). */
  readonly verified?: User | null
}

function setup(options: SetupOptions = {}) {
  const kiosk = {
    exit: vi.fn(() => Promise.resolve()),
    enterWindowMode: vi.fn(() => Promise.resolve()),
    setEnabled: vi.fn<(enabled: boolean) => Promise<void>>(() => Promise.resolve()),
  }
  const logs: string[] = []
  const findQueries: unknown[] = []
  const verified = options.verified === undefined ? OWNER : options.verified

  const usersService = {
    find: (params: { query: unknown }) => {
      findQueries.push(params.query)
      return Promise.resolve({ data: options.found ?? [OWNER, TECH] })
    },
    verifyPin: () => (verified ? Promise.resolve(verified) : Promise.reject(new Error('401'))),
  }

  const injector = Injector.create({
    providers: [
      { provide: ConnectionService, useValue: { usersService } },
      { provide: KioskService, useValue: kiosk },
      { provide: LogService, useValue: { info: (m: string) => void logs.push(m) } },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
      { provide: ɵChangeDetectionScheduler, useValue: { notify: () => undefined } },
      {
        provide: ɵEffectScheduler,
        useValue: { add: () => undefined, schedule: () => undefined, remove: () => undefined },
      },
      { provide: DestroyRef, useValue: { onDestroy: () => () => undefined } },
    ],
  })
  const component = runInInjectionContext(injector, () => new KioskPinDialogComponent())
  // Signal-Input ohne TestBed setzen (dasselbe, was der Template-Binding-Pfad tut).
  const node = component.action[SIGNAL]
  node.applyValueToInputSignal(node, options.action ?? 'exit')

  let closed = 0
  component.closed.subscribe(() => void closed++)

  return { component, kiosk, logs, findQueries, closed: () => closed }
}

async function enterPin(component: KioskPinDialogComponent, user: User): Promise<void> {
  component.selectUser({ ...user, initials: '' })
  component.pinInput.set('1234')
  await component.verifyPin()
}

describe('KioskPinDialogComponent', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('fragt beim Edge nur Inhaber und Techniker an', async () => {
    const { component, findQueries } = setup()

    component.ngOnInit()
    await vi.waitFor(() => expect(component.step()).toBe('select-user'))

    expect(findQueries[0]).toMatchObject({ role: { $in: ['tenant:owner', 'tenant:technician'] } })
  })

  it('blendet Rollen außerhalb des Kreises aus, auch wenn der Edge sie liefert', async () => {
    const { component } = setup({ found: [OWNER, MANAGER, STAFF, TECH] })

    component.ngOnInit()
    await vi.waitFor(() => expect(component.step()).toBe('select-user'))

    expect(component.eligibleUsers().map(u => u._id)).toEqual(['u-owner', 'u-tech'])
  })

  it('ruft bei falscher PIN nichts auf', async () => {
    const { component, kiosk } = setup({ verified: null })

    await enterPin(component, OWNER)

    expect(component.pinError()).toBe(true)
    expect(component.step()).toBe('enter-pin')
    expect(kiosk.exit).not.toHaveBeenCalled()
  })

  it.each([
    ['Manager', MANAGER],
    ['Mitarbeiter', STAFF],
  ])('lehnt die PIN eines %s ab', async (_name, user) => {
    const { component, kiosk } = setup({ verified: user })

    await enterPin(component, user)

    expect(component.pinError()).toBe(true)
    expect(component.errorMessage()).toBe('SETTINGS.KIOSK_ROLE_NOT_ALLOWED')
    expect(kiosk.exit).not.toHaveBeenCalled()
  })

  it.each([
    ['Inhaber', OWNER],
    ['Techniker', TECH],
  ])('beendet das Terminal mit der PIN eines %s', async (_name, user) => {
    const { component, kiosk, logs } = setup({ verified: user })

    await enterPin(component, user)

    expect(kiosk.exit).toHaveBeenCalledTimes(1)
    expect(logs).toEqual([
      `[kiosk] exit freigegeben von ${user.firstName} ${user.lastName} (${user.role}, ${user._id})`,
    ])
  })

  it('schreibt die PIN nie ins Log', async () => {
    const { component, logs } = setup({ verified: TECH })

    await enterPin(component, TECH)

    expect(logs.join('\n')).not.toContain('1234')
  })

  it('wechselt nach PIN in den Fenstermodus und schließt den Dialog', async () => {
    const { component, kiosk, closed } = setup({ action: 'window-mode', verified: TECH })

    await enterPin(component, TECH)

    expect(kiosk.enterWindowMode).toHaveBeenCalledTimes(1)
    expect(kiosk.exit).not.toHaveBeenCalled()
    expect(closed()).toBe(1)
  })

  it.each([
    ['disable', false],
    ['enable', true],
  ] as const)('schaltet den Geräte-Schalter (%s)', async (action, enabled) => {
    const { component, kiosk } = setup({ action, verified: OWNER })

    await enterPin(component, OWNER)

    expect(kiosk.setEnabled).toHaveBeenCalledWith(enabled)
  })

  it('löst die Aktion nicht aus, wenn der Dialog vor dem Auto-Submit schließt', async () => {
    vi.useFakeTimers()
    const { component, kiosk, closed } = setup({ verified: OWNER })

    component.selectUser({ ...OWNER, initials: '' })
    for (const d of '1234') component.addDigit(d)
    component.cancel()
    await vi.advanceTimersByTimeAsync(200)

    expect(closed()).toBe(1)
    expect(kiosk.exit).not.toHaveBeenCalled()
  })

  it('verwirft den Auto-Submit, wenn nach der vierten Ziffer gelöscht wird', async () => {
    vi.useFakeTimers()
    const { component, kiosk } = setup({ verified: OWNER })

    component.selectUser({ ...OWNER, initials: '' })
    for (const d of '1234') component.addDigit(d)
    component.deleteDigit()
    await vi.advanceTimersByTimeAsync(200)

    expect(kiosk.exit).not.toHaveBeenCalled()
  })

  it('reicht die vollständige PIN per Auto-Submit ein', async () => {
    vi.useFakeTimers()
    const { component, kiosk } = setup({ verified: OWNER })

    component.selectUser({ ...OWNER, initials: '' })
    for (const d of '1234') component.addDigit(d)
    await vi.advanceTimersByTimeAsync(200)

    expect(kiosk.exit).toHaveBeenCalledTimes(1)
  })

  it('zeigt einen Fehler der Shell an, statt still zu schließen', async () => {
    const { component, kiosk, closed } = setup({ action: 'disable', verified: OWNER })
    kiosk.setEnabled.mockRejectedValueOnce(new Error('kiosk.json nicht schreibbar'))

    await enterPin(component, OWNER)

    expect(component.step()).toBe('error')
    expect(component.errorMessage()).toBe('kiosk.json nicht schreibbar')
    expect(closed()).toBe(0)
  })
})
