// JIT-Compiler zuerst laden: @angular/material ist partial-compiled.
import '@angular/compiler'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Injector, runInInjectionContext, signal } from '@angular/core'
import { MatSnackBar } from '@angular/material/snack-bar'
import { TranslateService } from '@ngx-translate/core'
import { AuthService, PosSessionService } from '@panary/auth/data-access'
import { clearPosOperatorToken, storePosOperatorToken, TenantSuspensionService } from '@panary/shared/data-access'
import { PosHandednessService, UserService } from '@panary/users/data-access'
import { PosStaffService } from './pos-staff.service'

/** Jeder Test baut seine eigenen Fakes (testing.md §10): Aufzeichnungen bleiben im Test. */
function setup(
  state: {
    offline?: boolean
    suspended?: boolean
    stampingId?: string | null
    cartSide?: 'left' | 'right'
    choose?: () => Promise<'saved' | 'pending'>
  } = {},
) {
  const user = { _id: 'u-olga', firstName: 'Olga', lastName: 'Owner', stampingId: state.stampingId ?? null }
  const users = {
    currentUser: signal(user),
    users: signal([user]),
    checkin: vi.fn().mockResolvedValue(user),
    checkout: vi.fn().mockResolvedValue(user),
    startBreak: vi.fn().mockResolvedValue(user),
    endBreak: vi.fn().mockResolvedValue(user),
  }
  const session = { isOffline: signal(!!state.offline), endSession: vi.fn().mockResolvedValue(true) }
  const snackBar = { open: vi.fn() }
  const handedness = {
    effective: () => state.cartSide ?? 'left',
    choose: vi.fn(state.choose ?? (() => Promise.resolve('saved' as const))),
  }
  const injector = Injector.create({
    providers: [
      { provide: UserService, useValue: users },
      { provide: AuthService, useValue: { fullName: signal('Olga Owner') } },
      { provide: PosSessionService, useValue: session },
      { provide: TenantSuspensionService, useValue: { suspended: signal(!!state.suspended) } },
      { provide: MatSnackBar, useValue: snackBar },
      { provide: PosHandednessService, useValue: handedness },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
    ],
  })
  const service = runInInjectionContext(injector, () => new PosStaffService())
  return { service, users, session, snackBar, handedness }
}

describe('PosStaffService (core#832)', () => {
  it('stempelt online ein', async () => {
    const { service, users, snackBar } = setup()
    await service.clockIn()
    expect(users.checkin.mock.calls).toEqual([['u-olga']])
    expect(snackBar.open).not.toHaveBeenCalled()
  })

  it('sperrt Stempeln offline mit Hinweis und ruft den Server nicht', async () => {
    const { service, users, snackBar } = setup({ offline: true, stampingId: 'wt-1' })
    await service.clockIn()
    await service.startBreak()
    await service.clockOut()
    expect(users.checkin).not.toHaveBeenCalled()
    expect(users.startBreak).not.toHaveBeenCalled()
    expect(users.checkout).not.toHaveBeenCalled()
    expect(snackBar.open.mock.calls.map(call => call[0])).toEqual([
      'DASHBOARD.TIME_TRACKING_OFFLINE_BLOCKED',
      'DASHBOARD.TIME_TRACKING_OFFLINE_BLOCKED',
      'DASHBOARD.TIME_TRACKING_OFFLINE_BLOCKED',
    ])
  })

  it('nennt bei Mandantensperre die Sperre, auch wenn zugleich offline', async () => {
    const { service, users, snackBar } = setup({ offline: true, suspended: true })
    await service.clockIn()
    expect(users.checkin).not.toHaveBeenCalled()
    expect(snackBar.open.mock.calls[0][0]).toBe('CLOUD_STATUS.TENANT_SUSPENDED')
  })

  it('Gehen meldet nach Erfolg ab, nach Fehlschlag nicht', async () => {
    const ok = setup({ stampingId: 'wt-1' })
    await ok.service.clockOut()
    expect(ok.users.checkout.mock.calls).toEqual([['u-olga']])
    expect(ok.session.endSession.mock.calls).toEqual([['button']])

    const failed = setup({ stampingId: 'wt-1' })
    failed.users.checkout.mockRejectedValue(new Error('TIME_CLOCK.ACTION_FAILED'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await failed.service.clockOut()
    expect(failed.session.endSession).not.toHaveBeenCalled()
  })

  it('Rail-Taste ruft je Aktion den passenden Server-Aufruf (core#907)', async () => {
    const { service, users } = setup({ stampingId: 'wt-1' })
    await service.timeClock('start-break')
    await service.timeClock('end-break')
    expect(users.startBreak.mock.calls).toEqual([['u-olga']])
    expect(users.endBreak.mock.calls).toEqual([['u-olga']])

    const out = setup()
    await out.service.timeClock('clock-in')
    expect(out.users.checkin.mock.calls).toEqual([['u-olga']])
  })

  it('Doppeltipp auf eine Rail-Taste stempelt nur einmal (core#907)', async () => {
    const { service, users } = setup()
    let answer: (value: unknown) => void = () => undefined
    users.checkin.mockReturnValue(new Promise(resolve => (answer = resolve)))
    const first = service.timeClock('clock-in')
    const second = service.timeClock('clock-in')
    expect(service.timeClockBusy()).toBe(true)
    answer({})
    await Promise.all([first, second])
    expect(users.checkin.mock.calls).toEqual([['u-olga']])
    expect(service.timeClockBusy()).toBe(false)
  })

  it('sperrt Abmelden offline mit Hinweis', () => {
    const { service, session, snackBar } = setup({ offline: true })
    service.logout()
    expect(session.endSession).not.toHaveBeenCalled()
    expect(snackBar.open.mock.calls[0][0]).toBe('DASHBOARD.LOGOUT_OFFLINE_BLOCKED')
  })

  it('bildet die Initialen aus dem Namen', () => {
    expect(setup().service.initials()).toBe('OO')
  })

  it('Warenkorb-Seite: wechselt auf die andere Seite des angemeldeten Mitarbeiters (core#833)', async () => {
    const left = setup({ cartSide: 'left' })
    await left.service.toggleCartSide()
    expect(left.handedness.choose.mock.calls).toEqual([['u-olga', 'right']])
    expect(left.snackBar.open).not.toHaveBeenCalled()

    const right = setup({ cartSide: 'right' })
    await right.service.toggleCartSide()
    expect(right.handedness.choose.mock.calls).toEqual([['u-olga', 'left']])
  })

  it('Warenkorb-Seite offline gemerkt: Hinweis aufs Nachsenden', async () => {
    const { service, snackBar } = setup({ choose: () => Promise.resolve('pending') })
    await service.toggleCartSide()
    expect(snackBar.open.mock.calls.map(call => call[0])).toEqual(['POS_NAV.CART_SIDE_PENDING'])
  })

  it('Warenkorb-Seite abgelehnt: Fehlermeldung statt stiller Rücknahme', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { service, snackBar } = setup({ choose: () => Promise.reject(new Error('401')) })
    await service.toggleCartSide()
    expect(snackBar.open.mock.calls.map(call => call[0])).toEqual(['POS_NAV.CART_SIDE_FAILED'])
  })

  it('Bedienerwechsel ohne users-Event: currentUser, Name und Stempeln folgen dem neuen Bediener (core#902)', async () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    })
    onTestFinished(() => {
      vi.unstubAllGlobals()
    })
    const olga = { _id: 'u-olga', firstName: 'Olga', lastName: 'Owner', stampingId: null }
    const max = { _id: 'u-max', firstName: 'Max', lastName: 'Manager', stampingId: null }
    const users = {
      // Am POS ist der Auth-User das Gerät — der Kassierer kommt aus `pos_current_user`.
      currentUser: signal(undefined),
      users: signal([olga, max]),
      checkin: vi.fn().mockResolvedValue(max),
    }
    const injector = Injector.create({
      providers: [
        { provide: UserService, useValue: users },
        { provide: AuthService, useValue: { fullName: signal('Unknown User') } },
        { provide: PosSessionService, useValue: { isOffline: signal(false), endSession: vi.fn() } },
        { provide: TenantSuspensionService, useValue: { suspended: signal(false) } },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        { provide: PosHandednessService, useValue: { effective: () => 'left', choose: vi.fn() } },
        { provide: TranslateService, useValue: { instant: (key: string) => key } },
      ],
    })
    const service = runInInjectionContext(injector, () => new PosStaffService())
    // Anmeldung wie `#completeLogin`: erst der Mitarbeiter, dann das Token.
    const login = (user: typeof olga) => {
      storage.set('pos_current_user', JSON.stringify(user))
      storePosOperatorToken({ operatorToken: `t-${user._id}`, operatorTokenExpiresAt: '2999-01-01T00:00:00.000Z' })
    }

    login(olga)
    expect(service.currentUser()?._id).toBe('u-olga')
    expect(service.displayName()).toBe('Olga Owner')

    login(max)
    expect(service.currentUser()?._id).toBe('u-max')
    expect(service.displayName()).toBe('Max Manager')
    await service.clockIn()
    expect(users.checkin.mock.calls).toEqual([['u-max']])

    storage.delete('pos_current_user')
    clearPosOperatorToken()
    expect(service.currentUser()).toBeUndefined()
  })
})
