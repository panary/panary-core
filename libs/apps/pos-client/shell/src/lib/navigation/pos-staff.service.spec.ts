// JIT-Compiler zuerst laden: @angular/material ist partial-compiled.
import '@angular/compiler'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Injector, runInInjectionContext, signal } from '@angular/core'
import { NotificationService } from '@panary/shared/ui-notifications'
import { TranslateService } from '@ngx-translate/core'
import { AuthService, PosSessionService } from '@panary/auth/data-access'
import { clearPosOperatorToken, storePosOperatorToken, TenantSuspensionService } from '@panary/shared/data-access'
import { PosHandednessService, UserService } from '@panary/users/data-access'
import { KasseDraftRegistry } from '@panary/orders/feature-pos-order-dialog'
import { PosStaffService } from './pos-staff.service'

/** Jeder Test baut seine eigenen Fakes (testing.md §10): Aufzeichnungen bleiben im Test. */
function setup(
  state: {
    offline?: boolean
    suspended?: boolean
    stampingId?: string | null
    cartSide?: 'left' | 'right'
    choose?: () => Promise<'saved' | 'pending' | 'local'>
    /** Offene Kasse: angefangene Bestellung und Antwort auf die Rückfrage (core#1064). */
    kasse?: { input: boolean; confirm: boolean }
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
  const notifications = new NotificationService()
  const notify = vi.spyOn(notifications, 'notify')
  const handedness = {
    effective: () => state.cartSide ?? 'left',
    choose: vi.fn(state.choose ?? (() => Promise.resolve('saved' as const))),
  }
  const kasse = new KasseDraftRegistry()
  const confirmLeave = vi.fn(() => Promise.resolve(state.kasse?.confirm ?? true))
  if (state.kasse) kasse.attach({ hasInput: () => !!state.kasse?.input, confirmLeave, discard: vi.fn() })
  const injector = Injector.create({
    providers: [
      { provide: KasseDraftRegistry, useValue: kasse },
      { provide: UserService, useValue: users },
      { provide: AuthService, useValue: { fullName: signal('Olga Owner') } },
      { provide: PosSessionService, useValue: session },
      { provide: TenantSuspensionService, useValue: { suspended: signal(!!state.suspended) } },
      { provide: NotificationService, useValue: notifications },
      { provide: PosHandednessService, useValue: handedness },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
    ],
  })
  const service = runInInjectionContext(injector, () => new PosStaffService())
  return { service, users, session, notify, handedness, confirmLeave }
}

describe('PosStaffService (core#832)', () => {
  it('stempelt online ein', async () => {
    const { service, users, notify } = setup()
    await service.clockIn()
    expect(users.checkin.mock.calls).toEqual([['u-olga', {}]])
    // Die eine Rückmeldung, ohne Login-Namen (core#962).
    expect(notify.mock.calls).toEqual([['success', 'POS_NAV.CLOCKED_IN']])
  })

  it('sperrt Stempeln offline mit Hinweis und ruft den Server nicht', async () => {
    const { service, users, notify } = setup({ offline: true, stampingId: 'wt-1' })
    await service.clockIn()
    await service.startBreak()
    await service.clockOut()
    expect(users.checkin).not.toHaveBeenCalled()
    expect(users.startBreak).not.toHaveBeenCalled()
    expect(users.checkout).not.toHaveBeenCalled()
    expect(notify.mock.calls.map(call => call[1])).toEqual([
      'DASHBOARD.TIME_TRACKING_OFFLINE_BLOCKED',
      'DASHBOARD.TIME_TRACKING_OFFLINE_BLOCKED',
      'DASHBOARD.TIME_TRACKING_OFFLINE_BLOCKED',
    ])
  })

  it('nennt bei Mandantensperre die Sperre, auch wenn zugleich offline', async () => {
    const { service, users, notify } = setup({ offline: true, suspended: true })
    await service.clockIn()
    expect(users.checkin).not.toHaveBeenCalled()
    expect(notify.mock.calls[0][1]).toBe('CLOUD_STATUS.TENANT_SUSPENDED')
  })

  it('Gehen meldet nach Erfolg ab, nach Fehlschlag nicht', async () => {
    const ok = setup({ stampingId: 'wt-1' })
    await ok.service.clockOut()
    expect(ok.users.checkout.mock.calls).toEqual([['u-olga', {}]])
    expect(ok.session.endSession.mock.calls).toEqual([['button']])

    const failed = setup({ stampingId: 'wt-1' })
    failed.users.checkout.mockRejectedValue(new Error('TIME_CLOCK.ACTION_FAILED'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await failed.service.clockOut()
    expect(failed.session.endSession).not.toHaveBeenCalled()
  })

  it('jede Aktion meldet genau einmal ihren Text, ohne Login-Namen (core#962)', async () => {
    const { service, notify } = setup({ stampingId: 'wt-1' })
    await service.timeClock('start-break')
    await service.timeClock('end-break')
    await service.timeClock('clock-out')
    await service.timeClock('clock-in')
    expect(notify.mock.calls).toEqual([
      ['success', 'POS_NAV.BREAK_STARTED'],
      ['success', 'POS_NAV.BREAK_ENDED'],
      ['success', 'POS_NAV.CLOCKED_OUT'],
      ['success', 'POS_NAV.CLOCKED_IN'],
    ])
  })

  it('schlägt der Aufruf fehl, kommt keine Erfolgsmeldung (core#962)', async () => {
    const { service, users, notify } = setup()
    users.checkin.mockRejectedValue(new Error('TIME_CLOCK.ACTION_FAILED'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await service.clockIn()
    expect(notify).not.toHaveBeenCalled()
  })

  it('Rail-Taste ruft je Aktion den passenden Server-Aufruf (core#907)', async () => {
    const { service, users } = setup({ stampingId: 'wt-1' })
    await service.timeClock('start-break')
    await service.timeClock('end-break')
    expect(users.startBreak.mock.calls).toEqual([['u-olga', {}]])
    expect(users.endBreak.mock.calls).toEqual([['u-olga', {}]])

    const out = setup()
    await out.service.timeClock('clock-in')
    expect(out.users.checkin.mock.calls).toEqual([['u-olga', {}]])
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
    expect(users.checkin.mock.calls).toEqual([['u-olga', {}]])
    expect(service.timeClockBusy()).toBe(false)
  })

  it('abgelehntes Bediener-Token: Hinweis und kontrollierte PIN-Abfrage statt stummem Login (core#923)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const rejection = Object.assign(new Error('abgelehnt'), { code: 401, data: { reason: 'POS_OPERATOR_REQUIRED' } })
    const { service, users, session, notify } = setup({ stampingId: 'wt-1' })
    users.checkout.mockRejectedValue(rejection)
    await service.clockOut()
    expect(notify.mock.calls.map(call => call[1])).toEqual(['POS_NAV.OPERATOR_PIN_REQUIRED'])
    // Genau einmal: Gehen meldet nach einem Fehlschlag nicht noch zusätzlich ab.
    expect(session.endSession.mock.calls).toEqual([['button']])
  })

  it('Hinweis erst nach dem Abmelden — sonst stünde die Abmelde-Meldung über ihm (core#937)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const rejection = Object.assign(new Error('abgelehnt'), { code: 401, data: { reason: 'POS_OPERATOR_REQUIRED' } })
    const { service, users, session, notify } = setup()
    const order: string[] = []
    let finishLogout: (value: boolean) => void = () => undefined
    session.endSession.mockImplementation(
      () =>
        new Promise<boolean>(resolve => {
          order.push('endSession')
          finishLogout = value => {
            order.push('logout-done')
            resolve(value)
          }
        }),
    )
    notify.mockImplementation(() => {
      order.push('hint')
      return { id: 0, dismiss: () => undefined }
    })
    users.checkin.mockRejectedValue(rejection)
    const done = service.clockIn()
    await vi.waitFor(() => expect(order).toEqual(['endSession']))
    finishLogout(true)
    await done
    expect(order).toEqual(['endSession', 'logout-done', 'hint'])
  })

  it('scheitert das Abmelden, erscheint der Hinweis trotzdem und Stempeln wirft nicht (core#937)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const rejection = Object.assign(new Error('abgelehnt'), { code: 401, data: { reason: 'POS_OPERATOR_REQUIRED' } })
    const { service, users, session, notify } = setup()
    session.endSession.mockRejectedValue(new Error('Navigation fehlgeschlagen'))
    users.checkin.mockRejectedValue(rejection)
    await expect(service.timeClock('clock-in')).resolves.toBeUndefined()
    expect(notify.mock.calls.map(call => call[1])).toEqual(['POS_NAV.OPERATOR_PIN_REQUIRED'])
    expect(service.timeClockBusy()).toBe(false)
  })

  it('anderer Fehler beim Stempeln: keine PIN-Abfrage, kein Hinweis (core#923)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { service, users, session, notify } = setup()
    users.checkin.mockRejectedValue(Object.assign(new Error('jwt expired'), { code: 401 }))
    await service.clockIn()
    expect(session.endSession).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('Bedienhand aus dem Avatar-Menü: dieselbe Seite ändert nichts, die andere wird gespeichert (core#942)', async () => {
    const same = setup({ cartSide: 'left' })
    await same.service.chooseCartSide('left')
    expect(same.handedness.choose).not.toHaveBeenCalled()

    const other = setup({ cartSide: 'left' })
    await other.service.chooseCartSide('right')
    expect(other.handedness.choose.mock.calls).toEqual([['u-olga', 'right']])
  })

  it('Rail sitzt dem Warenkorb gegenüber, Stempelzustand aus dem Datensatz (core#942)', () => {
    expect(setup({ cartSide: 'left' }).service.railSide()).toBe('right')
    expect(setup({ cartSide: 'right' }).service.railSide()).toBe('left')
    expect(setup().service.timeClockState()).toBe('out')
    expect(setup({ stampingId: 'wt-1' }).service.timeClockState()).toBe('in')
  })

  it('Sperr-Hinweis der Stempeltaste: nur gesperrt eine Meldung, ohne Server-Aufruf (core#942)', () => {
    const blocked = setup({ offline: true, stampingId: 'wt-1' })
    expect(blocked.service.notifyTimeTrackingBlocked()).toBe(true)
    expect(blocked.notify.mock.calls.map(call => call[1])).toEqual(['DASHBOARD.TIME_TRACKING_OFFLINE_BLOCKED'])
    expect(blocked.users.startBreak).not.toHaveBeenCalled()

    const free = setup({ stampingId: 'wt-1' })
    expect(free.service.notifyTimeTrackingBlocked()).toBe(false)
    expect(free.notify).not.toHaveBeenCalled()
  })

  it('sperrt Abmelden offline mit Hinweis', async () => {
    const { service, session, notify } = setup({ offline: true })
    await service.logout()
    expect(session.endSession).not.toHaveBeenCalled()
    expect(notify.mock.calls[0][1]).toBe('DASHBOARD.LOGOUT_OFFLINE_BLOCKED')
  })

  it('Abmelden mit angefangener Bestellung: „Weiter bearbeiten" bleibt angemeldet (core#1064)', async () => {
    const { service, session, confirmLeave } = setup({ kasse: { input: true, confirm: false } })
    await service.logout()
    expect(confirmLeave).toHaveBeenCalledTimes(1)
    expect(session.endSession).not.toHaveBeenCalled()
  })

  it('Abmelden mit angefangener Bestellung: „Bestellung verwerfen" meldet ab (core#1064)', async () => {
    const { service, session } = setup({ kasse: { input: true, confirm: true } })
    await service.logout()
    expect(session.endSession.mock.calls).toEqual([['button']])
  })

  it('Abmelden ohne offene Kasse meldet direkt ab (core#1064)', async () => {
    const { service, session, confirmLeave } = setup()
    await service.logout()
    expect(confirmLeave).not.toHaveBeenCalled()
    expect(session.endSession.mock.calls).toEqual([['button']])
  })

  it('„Gehen" mit angefangener Bestellung fragt vor dem Ausstempeln; abgelehnt bleibt man eingestempelt (core#1064)', async () => {
    const refused = setup({ stampingId: 'wt-1', kasse: { input: true, confirm: false } })
    await refused.service.clockOut()
    expect(refused.users.checkout).not.toHaveBeenCalled()
    expect(refused.session.endSession).not.toHaveBeenCalled()

    const confirmed = setup({ stampingId: 'wt-1', kasse: { input: true, confirm: true } })
    await confirmed.service.clockOut()
    expect(confirmed.users.checkout).toHaveBeenCalledTimes(1)
    expect(confirmed.confirmLeave).toHaveBeenCalledTimes(1)
    expect(confirmed.session.endSession.mock.calls).toEqual([['button']])
  })

  it('bildet die Initialen aus dem Namen', () => {
    expect(setup().service.initials()).toBe('OO')
  })

  it('Warenkorb-Seite: wechselt auf die andere Seite des angemeldeten Mitarbeiters (core#833)', async () => {
    const left = setup({ cartSide: 'left' })
    await left.service.toggleCartSide()
    expect(left.handedness.choose.mock.calls).toEqual([['u-olga', 'right']])
    expect(left.notify).not.toHaveBeenCalled()

    const right = setup({ cartSide: 'right' })
    await right.service.toggleCartSide()
    expect(right.handedness.choose.mock.calls).toEqual([['u-olga', 'left']])
  })

  it('Warenkorb-Seite offline gemerkt: Hinweis aufs Nachsenden', async () => {
    const { service, notify } = setup({ choose: () => Promise.resolve('pending') })
    await service.toggleCartSide()
    expect(notify.mock.calls.map(call => call[1])).toEqual(['POS_NAV.CART_SIDE_PENDING'])
  })

  it('Warenkorb-Seite nur lokal (kein Token, Edge ohne Methode): Hinweis statt Fehler (core#964)', async () => {
    const { service, notify } = setup({ choose: () => Promise.resolve('local') })
    await service.toggleCartSide()
    expect(notify.mock.calls.map(call => call[1])).toEqual(['POS_NAV.CART_SIDE_LOCAL'])
  })

  it('Warenkorb-Seite abgelehnt: Fehlermeldung statt stiller Rücknahme', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { service, notify } = setup({ choose: () => Promise.reject(new Error('401')) })
    await service.toggleCartSide()
    expect(notify.mock.calls.map(call => call[1])).toEqual(['POS_NAV.CART_SIDE_FAILED'])
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
        { provide: KasseDraftRegistry, useValue: new KasseDraftRegistry() },
        { provide: PosSessionService, useValue: { isOffline: signal(false), endSession: vi.fn() } },
        { provide: TenantSuspensionService, useValue: { suspended: signal(false) } },
        { provide: NotificationService, useValue: new NotificationService() },
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
    // Das Token des neuen Bedieners geht mit, damit der Edge die Stempelung an ihn bindet (core#903, #907).
    expect(users.checkin.mock.calls).toEqual([['u-max', { query: { operatorToken: 't-u-max' } }]])

    storage.delete('pos_current_user')
    clearPosOperatorToken()
    expect(service.currentUser()).toBeUndefined()
  })
})
