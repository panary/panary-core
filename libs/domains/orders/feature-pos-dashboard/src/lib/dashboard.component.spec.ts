// JIT-Compiler zuerst laden: ohne Linker (kein analogjs-Plugin in dieser node-Vitest-Config)
// fällt Angular für partial-compiled Pakete auf JIT zurück.
import '@angular/compiler'
import { describe, expect, it, vi } from 'vitest'
import { DestroyRef, Injector, runInInjectionContext, signal } from '@angular/core'
import { Router } from '@angular/router'
import { OrderService } from '@panary/orders/data-access'
import { PreOrderService } from '@panary/pre-orders/data-access'
import { LocationService } from '@panary/locations/data-access'
import { ConnectionService } from '@panary/shared/data-access'
import { DashboardComponent } from './dashboard.component'

// Init-Fall aus core#1132: Die aktive Location kommt erst nach `ngOnInit`. Vorher lief
// `#loadOpeningHours` einmalig, fand keine Location und ließ still den Rückfall „08–20" stehen.
// Echte Instanz ohne TestBed, alle inject()-Tokens als Mocks — je Test angelegt (testing.md §10).

function setup() {
  const activeLocation = signal<unknown>(undefined)
  const exceptionsFind = vi.fn().mockResolvedValue([])
  const injector = Injector.create({
    providers: [
      { provide: Router, useValue: { navigate: vi.fn() } },
      { provide: OrderService, useValue: { orders: signal([]) } },
      { provide: PreOrderService, useValue: { find: vi.fn().mockResolvedValue([]), service: undefined } },
      { provide: DestroyRef, useValue: { onDestroy: vi.fn() } },
      { provide: LocationService, useValue: { activeLocation } },
      {
        provide: ConnectionService,
        useValue: { openingHourExceptionsService: { find: exceptionsFind, on: vi.fn(), off: vi.fn() } },
      },
    ],
  })
  const component = runInInjectionContext(injector, () => new DashboardComponent())
  return { component, activeLocation, exceptionsFind }
}

const location = (weekday: number, hours: { closed: boolean; open?: string; close?: string }, enabled = true) => ({
  _id: 'loc-1',
  name: 'Dahlerstraße',
  settings: {
    generalSettings: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    openingHoursSettings: { enabled, regular: [{ day: weekday, ...hours }] },
  },
})

describe('DashboardComponent — Unterzeile der Öffnungszeit (core#1132)', () => {
  const today = new Date().getDay()

  it('ohne Location „nicht gepflegt", danach folgt die Unterzeile der nachgereichten Location', () => {
    const { component, activeLocation } = setup()
    expect(component.chartSubtitle()).toEqual({ key: 'DASHBOARD.OPENING_WINDOW_UNSET' })

    activeLocation.set(location(today, { closed: true }))
    expect(component.chartSubtitle()).toEqual({ key: 'DASHBOARD.OPENING_WINDOW_CLOSED' })
  })

  it('ein Settings-Patch der Location wirkt ohne neuen Init', () => {
    const { component, activeLocation } = setup()
    activeLocation.set(location(today, { closed: true }))
    expect(component.chartSubtitle().key).toBe('DASHBOARD.OPENING_WINDOW_CLOSED')

    activeLocation.set(location(today, { closed: false, open: '00:00', close: '23:30' }))
    expect(component.chartSubtitle()).toEqual({
      key: 'DASHBOARD.OPENING_WINDOW',
      params: { window: '00–24' },
    })

    activeLocation.set(location(today, { closed: false, open: '00:00', close: '23:30' }, false))
    expect(component.chartSubtitle()).toEqual({ key: 'DASHBOARD.OPENING_WINDOW_UNSET' })
  })

  it('Ausnahmen: lädt bei nachgereichter Filiale und neuem Tag, sonst nicht erneut; „geschlossen" wirkt', async () => {
    const { component, activeLocation, exceptionsFind } = setup()
    component.refreshHourExceptions()
    expect(exceptionsFind).not.toHaveBeenCalled()

    const loc = location(today, { closed: false, open: '09:00', close: '18:00' })
    activeLocation.set(loc)
    const date = new Date().toLocaleDateString('sv-SE')
    exceptionsFind.mockResolvedValueOnce({ data: [{ date, closed: true, locationId: 'loc-1' }] })
    component.refreshHourExceptions()
    expect(exceptionsFind).toHaveBeenCalledWith({ query: { date, locationId: 'loc-1', $limit: 5 } })
    await vi.waitFor(() => expect(component.chartSubtitle().key).toBe('DASHBOARD.OPENING_WINDOW_CLOSED'))

    component.refreshHourExceptions()
    expect(exceptionsFind).toHaveBeenCalledTimes(1)
    component.refreshHourExceptions(true)
    expect(exceptionsFind).toHaveBeenCalledTimes(2)
    await vi.waitFor(() =>
      expect(component.chartSubtitle()).toEqual({ key: 'DASHBOARD.OPENING_WINDOW', params: { window: '09–18' } }),
    )
  })
})
