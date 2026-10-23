// JIT-Compiler zuerst laden: @angular/material ist partial-compiled.
import '@angular/compiler'
import { describe, expect, it, vi } from 'vitest'
import { Injector, runInInjectionContext, signal } from '@angular/core'
import { MatSnackBar } from '@angular/material/snack-bar'
import { TranslateService } from '@ngx-translate/core'
import { AuthService, PosSessionService } from '@panary/auth/data-access'
import { TenantSuspensionService } from '@panary/shared/data-access'
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
})
