// JIT-Compiler zuerst laden: @angular/material ist partial-compiled (siehe order-dialog.component.spec).
import '@angular/compiler'
import { describe, expect, it } from 'vitest'
import { Injector, runInInjectionContext, signal } from '@angular/core'
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router'
import { MatSnackBar } from '@angular/material/snack-bar'
import { TranslateService } from '@ngx-translate/core'
import { ReturnAfterOrderService, TenantSuspensionService } from '@panary/shared/data-access'
import { Subject } from 'rxjs'

import { KASSE_EXIT_URL, KassePageComponent, kasseOrigin } from './kasse-page.component'
import { kasseBookingGuard, kasseLeaveGuard } from './kasse.guards'
import { KasseDraftRegistry } from './kasse-draft-registry'

function setup(navigationSucceeds = true, previousUrl?: string, returnEnabled = true) {
  const navigations: string[] = []
  const suspended = signal(false)
  const snacks: Array<{ message: string; action: string; onAction: Subject<void> }> = []
  const router = {
    currentNavigation: () => (previousUrl ? { previousNavigation: { finalUrl: previousUrl } } : null),
    navigateByUrl: (url: string) => {
      navigations.push(url)
      return Promise.resolve(navigationSucceeds)
    },
    parseUrl: (url: string) => Object.assign(new UrlTree(), { probe: url }),
  }
  const injector = Injector.create({
    providers: [
      { provide: Router, useValue: router },
      { provide: TenantSuspensionService, useValue: { suspended } },
      { provide: ReturnAfterOrderService, useValue: { enabled: () => returnEnabled } },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
      {
        provide: MatSnackBar,
        useValue: {
          open: (message: string, action: string) => {
            const onAction = new Subject<void>()
            snacks.push({ message, action, onAction })
            return { onAction: () => onAction }
          },
        },
      },
    ],
  })
  return { injector, navigations, suspended, snacks }
}

const state = (url: string) => ({ url }) as RouterStateSnapshot
const route = {} as ActivatedRouteSnapshot

describe('KassePageComponent (core#828)', () => {
  it('nach dem Bestellen bleibt man in der Kasse — sie wird frisch aufgebaut, keine Navigation', () => {
    const { injector, navigations } = setup()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = runInInjectionContext(injector, () => new KassePageComponent()) as any

    page.onClosed('order-placed')
    page.onClosed('preorder-created')

    expect(page.run()).toBe(2)
    expect(navigations).toEqual([])
  })

  it('Verwerfen führt zur Übersicht, und der Guard fragt danach nicht ein zweites Mal', async () => {
    const { injector, navigations } = setup()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = runInInjectionContext(injector, () => new KassePageComponent()) as any

    page.onClosed('cancelled')

    expect(navigations).toEqual([KASSE_EXIT_URL])
    expect(page.run()).toBe(0)
    expect(await page.canLeave()).toBe(true)
  })
})

describe('KassePageComponent — Rücksprung nach dem Bestellen (core#974)', () => {
  const pageOf = (injector: Injector) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runInInjectionContext(injector, () => new KassePageComponent()) as any

  it.each(['order-placed', 'preorder-created'])('%s führt zur Ausgangsseite, der Guard fragt nicht', async reason => {
    const { injector, navigations } = setup(true, '/orders/active?x=1')
    const page = pageOf(injector)

    page.onClosed(reason)
    await Promise.resolve()

    expect(navigations).toEqual(['/orders/active'])
    expect(page.run()).toBe(0)
    expect(await page.canLeave()).toBe(true)
  })

  it('der Hinweis bietet „Neue Bestellung" an und öffnet die Kasse wieder', async () => {
    const { injector, navigations, snacks } = setup(true, '/pre-orders')
    pageOf(injector).onClosed('order-placed')
    await Promise.resolve()
    await Promise.resolve()

    expect(snacks).toHaveLength(1)
    expect(snacks[0].action).toBe('ACTIVE_ORDERS.NEW_ORDER')
    snacks[0].onAction.next()
    expect(navigations).toEqual(['/pre-orders', '/kasse'])
  })

  it('Schalter aus: man bleibt in der Kasse, sie wird frisch aufgebaut', () => {
    const { injector, navigations } = setup(true, '/orders/active', false)
    const page = pageOf(injector)

    page.onClosed('order-placed')

    expect(navigations).toEqual([])
    expect(page.run()).toBe(1)
  })

  it('ohne bekannte Ausgangsseite (direkter Aufruf) bleibt man in der Kasse', () => {
    const { injector, navigations } = setup(true, undefined)
    const page = pageOf(injector)

    page.onClosed('order-placed')

    expect(navigations).toEqual([])
    expect(page.run()).toBe(1)
  })

  it('Verwerfen geht unverändert zur Übersicht, auch mit Ausgangsseite', () => {
    const { injector, navigations } = setup(true, '/orders/history')

    pageOf(injector).onClosed('cancelled')

    expect(navigations).toEqual([KASSE_EXIT_URL])
  })

  it('scheitert die Rückkehr, bleibt die Kasse offen und frisch', async () => {
    const { injector, snacks } = setup(false, '/orders/active')
    const page = pageOf(injector)

    page.onClosed('order-placed')
    await Promise.resolve()
    await Promise.resolve()

    expect(page.run()).toBe(1)
    expect(snacks).toHaveLength(0)
  })

  it('kasseOrigin kennt nur die Rail-Seiten', () => {
    expect(kasseOrigin('/dashboard')).toBe('/dashboard')
    expect(kasseOrigin('/orders/history?day=1')).toBe('/orders/history')
    expect(kasseOrigin('/settings')).toBeNull()
    expect(kasseOrigin('/dashboard-x')).toBeNull()
    expect(kasseOrigin(undefined)).toBeNull()
  })
})

describe('KassePageComponent — Rückfrage beim Verlassen (core#828)', () => {
  const pageWithOrder = (navigationSucceeds: boolean, answer: boolean) => {
    const { injector } = setup(navigationSucceeds)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = runInInjectionContext(injector, () => new KassePageComponent()) as any
    const asked = { count: 0 }
    page.order = () => ({
      confirmLeave: () => {
        asked.count++
        return Promise.resolve(answer)
      },
    })
    return { page, asked }
  }

  it('scheitert die Navigation zur Übersicht, fragt der Guard beim nächsten Verlassen wieder', async () => {
    const { page, asked } = pageWithOrder(false, false)

    page.onClosed('cancelled')
    await Promise.resolve()
    await Promise.resolve()

    expect(await page.canLeave()).toBe(false)
    expect(asked.count).toBe(1)
  })

  it('zweimal Zurück während der Rückfrage öffnet keine zweite', async () => {
    const { page, asked } = pageWithOrder(true, true)

    const first = page.canLeave()
    const second = page.canLeave()

    expect(second).toBe(first)
    expect(await first).toBe(true)
    expect(asked.count).toBe(1)
  })
})

describe('kasseLeaveGuard (core#828)', () => {
  const page = (answer: boolean) => ({ canLeave: () => Promise.resolve(answer) }) as unknown as KassePageComponent

  it('übernimmt beim normalen Routenwechsel die Antwort der Kasse', async () => {
    const { injector } = setup()
    const run = (answer: boolean) =>
      runInInjectionContext(injector, () => kasseLeaveGuard(page(answer), route, state('/kasse'), state('/dashboard')))

    expect(await run(false)).toBe(false)
    expect(await run(true)).toBe(true)
  })

  it.each(['/login', '/login?reason=idle', '/setup'])('fragt bei Sitzungsende (%s) nicht nach', target => {
    const { injector } = setup()

    const result = runInInjectionContext(injector, () =>
      kasseLeaveGuard(page(false), route, state('/kasse'), state(target)),
    )

    expect(result).toBe(true)
  })

  it('ein Pfad, der nur mit „login" beginnt, ist kein Sitzungsende', async () => {
    const { injector } = setup()

    const result = runInInjectionContext(injector, () =>
      kasseLeaveGuard(page(false), route, state('/kasse'), state('/login-hilfe')),
    )

    expect(await result).toBe(false)
  })
})

describe('kasseBookingGuard (core#828)', () => {
  it('lässt ohne Mandantensperre in die Kasse', () => {
    const { injector } = setup()

    expect(runInInjectionContext(injector, () => kasseBookingGuard(route, state('/kasse')))).toBe(true)
  })

  it('leitet beim gesperrten Mandanten auf die Übersicht um', () => {
    const { injector, suspended } = setup()
    suspended.set(true)

    const result = runInInjectionContext(injector, () => kasseBookingGuard(route, state('/kasse')))

    expect(result).toBeInstanceOf(UrlTree)
    expect(result).toMatchObject({ probe: KASSE_EXIT_URL })
  })
})

describe('KasseDraftRegistry.sheetOpen (core#832)', () => {
  it('folgt dem Sheet der angehängten Kasse und fällt nach dem Lösen auf false', () => {
    const registry = new KasseDraftRegistry()
    const sheet = signal(false)
    const detach = registry.attachSheet(sheet)

    expect(registry.sheetOpen()).toBe(false)
    sheet.set(true)
    expect(registry.sheetOpen()).toBe(true)

    detach()
    expect(registry.sheetOpen()).toBe(false)
  })

  it('das Lösen einer abgelösten Kasse lässt die neue stehen (Neuaufbau je Bestellung)', () => {
    const registry = new KasseDraftRegistry()
    const alt = registry.attachSheet(signal(false))
    registry.attachSheet(signal(true))

    alt()
    expect(registry.sheetOpen()).toBe(true)
  })
})
