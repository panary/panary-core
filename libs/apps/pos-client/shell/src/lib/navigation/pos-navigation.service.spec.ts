// JIT-Compiler zuerst laden: @angular/material ist partial-compiled.
import '@angular/compiler'
import { describe, expect, it, vi } from 'vitest'
import { Injector, runInInjectionContext, signal } from '@angular/core'
import { MatSnackBar } from '@angular/material/snack-bar'
import { Router, UrlTree } from '@angular/router'
import { TranslateService } from '@ngx-translate/core'
import { Subject } from 'rxjs'
import { PosSessionService } from '@panary/auth/data-access'
import { LocationService } from '@panary/locations/data-access'
import { OrderService } from '@panary/orders/data-access'
import { KasseDraftRegistry } from '@panary/orders/feature-pos-order-dialog'
import { ConnectionService, TenantSuspensionService } from '@panary/shared/data-access'
import { PosDayActionsService } from './pos-day-actions.service'
import { PosNavigationService } from './pos-navigation.service'
import type { PosNavItem } from './pos-navigation'

function setup(state: { offline?: boolean; sheetOpen?: boolean } = {}) {
  const router = {
    url: '/kasse',
    events: new Subject(),
    navigate: vi.fn().mockResolvedValue(true),
    parseUrl: () => new UrlTree(),
  }
  const dayActions = { run: vi.fn() }
  const snackBar = { open: vi.fn() }
  const injector = Injector.create({
    providers: [
      { provide: Router, useValue: router },
      {
        provide: ConnectionService,
        useValue: { systemMode: signal('cloud'), cloudPairingStatus: signal('connected') },
      },
      {
        provide: LocationService,
        useValue: { activeLocation: signal({ currentBusinessDay: { businessDayId: 'bd-1' } }) },
      },
      { provide: TenantSuspensionService, useValue: { suspended: signal(false) } },
      { provide: PosSessionService, useValue: { isOffline: signal(!!state.offline) } },
      { provide: OrderService, useValue: { ordersActive: signal([{}, {}]) } },
      { provide: KasseDraftRegistry, useValue: { sheetOpen: signal(!!state.sheetOpen) } },
      { provide: PosDayActionsService, useValue: dayActions },
      { provide: MatSnackBar, useValue: snackBar },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
    ],
  })
  const service = runInInjectionContext(injector, () => new PosNavigationService())
  const item = (id: string): PosNavItem => {
    const all = [...service.rail(), ...service.moreGroups().flatMap(g => g.items), ...service.settings()]
    const found = all.find(i => i.entry.id === id)
    if (!found) throw new Error(`${id} nicht sichtbar`)
    return found
  }
  return { service, router, dayActions, snackBar, item }
}

describe('PosNavigationService (core#832)', () => {
  it('liest den Gerätezustand in den Regel-Kontext und zählt offene Bestellungen', () => {
    const { service } = setup({ offline: true })
    expect(service.context()).toEqual({
      standalone: false,
      cloudPaired: true,
      businessDayOpen: true,
      offline: true,
      bookingSuspended: false,
    })
    expect(service.openOrdersCount()).toBe(2)
  })

  it('navigiert Routen-Einträge samt Abschnitt der Einstellungen', () => {
    const { service, router, item } = setup()
    service.open(item('history'))
    service.open(item('settings-printer'))
    expect(router.navigate.mock.calls).toEqual([
      [['/orders/history'], { queryParams: undefined }],
      [['/settings'], { queryParams: { section: 'printer' } }],
    ])
  })

  it('führt Dialog-Einträge über PosDayActionsService aus', () => {
    const { service, dayActions, item } = setup()
    service.open(item('cash-drawer'))
    expect(dayActions.run.mock.calls).toEqual([['cash-drawer']])
  })

  it('ein gesperrter Eintrag meldet den Grund und tut nichts', () => {
    const { service, router, dayActions, snackBar, item } = setup({ offline: true })
    service.open(item('history'))
    service.open(item('write-off'))
    expect(router.navigate).not.toHaveBeenCalled()
    expect(dayActions.run).not.toHaveBeenCalled()
    expect(snackBar.open.mock.calls.map(call => call[0])).toEqual([
      'DASHBOARD.ACTION_OFFLINE_BLOCKED',
      'DASHBOARD.ACTION_OFFLINE_BLOCKED',
    ])
  })

  it('bei offenem Sheet in der Kasse führt die Rail nichts aus', () => {
    const { service, router, dayActions, item } = setup({ sheetOpen: true })
    service.open(item('overview'))
    service.open(item('cash-drawer'))
    expect(router.navigate).not.toHaveBeenCalled()
    expect(dayActions.run).not.toHaveBeenCalled()
  })
})
