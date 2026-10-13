import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { Title } from '@angular/platform-browser'
import { ThemeServiceService } from '@panary/shared/data-access-theme'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiService } from '../core/api.service'
import { AuthService } from '../core/auth.service'
import { DeviceStatusService } from '../core/device-status.service'
import { LocationStateService } from '../core/location-state.service'
import { SyncProblemCountService } from '../core/sync-problem-count.service'
import { AdminLayoutComponent } from './admin-layout'

// #684: Unterhalb von md ist die Seitenleiste ein Drawer. Direkt instanziiert statt
// gerendert (Muster device-assignment.spec): geprueft wird der Zustand, den das
// Template bindet, nicht das DOM.

/** Steuerbare MediaQueryList je Test — der Handler gehoert zu genau dieser Instanz. */
function createMediaQuery(matches: boolean) {
  const listeners: Array<(event: MediaQueryListEvent) => void> = []
  const query = {
    matches,
    addEventListener: vi.fn((_type: string, cb: (event: MediaQueryListEvent) => void) => listeners.push(cb)),
    removeEventListener: vi.fn(),
    fire(next: boolean) {
      query.matches = next
      listeners.forEach(cb => cb({ matches: next } as MediaQueryListEvent))
    },
  }
  return query
}

function setup(narrow: boolean) {
  const query = createMediaQuery(narrow)
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => query),
  )
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { user: signal(null), logout: vi.fn() } },
      { provide: ApiService, useValue: { find: vi.fn().mockResolvedValue({ total: 0 }) } },
      { provide: SyncProblemCountService, useValue: { count: signal(0), refresh: vi.fn() } },
      {
        provide: DeviceStatusService,
        useValue: { online: signal(null), total: signal(null), refresh: vi.fn().mockResolvedValue(undefined) },
      },
      { provide: ThemeServiceService, useValue: { theme: 'light', setTheme: vi.fn() } },
      { provide: LocationStateService, useValue: { load: vi.fn(), locationName: signal('') } },
      { provide: Title, useValue: { setTitle: vi.fn() } },
    ],
  })
  const component = TestBed.runInInjectionContext(() => new AdminLayoutComponent())
  return { component, query }
}

beforeEach(() => {
  // Der Konstruktor startet ein 60-s-Polling; mit echten Timern liefe es ueber den Test hinaus.
  vi.useFakeTimers()
  TestBed.resetTestingModule()
})

afterEach(() => {
  TestBed.resetTestingModule()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('AdminLayoutComponent — Drawer unterhalb md (#684)', () => {
  it('zeigt im schmalen Fenster die Beschriftung, auch wenn die Seitenleiste eingeklappt war', () => {
    const { component } = setup(true)
    component.sidebarOpen.set(false)

    expect(component.isNarrow()).toBe(true)
    expect(component.expanded()).toBe(true)
    expect(component.mobileNavOpen()).toBe(false)
  })

  it('folgt im breiten Fenster weiter dem Einklapp-Schalter', () => {
    const { component } = setup(false)

    component.sidebarOpen.set(false)
    expect(component.expanded()).toBe(false)
    component.sidebarOpen.set(true)
    expect(component.expanded()).toBe(true)
  })

  it('schliesst einen offenen Drawer, wenn das Fenster breit wird', () => {
    const { component, query } = setup(true)
    component.mobileNavOpen.set(true)

    query.fire(false)

    expect(component.isNarrow()).toBe(false)
    expect(component.mobileNavOpen()).toBe(false)
  })

  it('wird schmal, wenn das Fenster unter die Schwelle faellt', () => {
    const { component, query } = setup(false)

    query.fire(true)

    expect(component.isNarrow()).toBe(true)
    expect(component.expanded()).toBe(true)
  })

  it('closeMobileNav schliesst den Drawer (Escape, Backdrop, Menuepunkt)', () => {
    const { component } = setup(true)
    component.mobileNavOpen.set(true)

    component.closeMobileNav()

    expect(component.mobileNavOpen()).toBe(false)
  })

  it('meldet den Listener beim Zerstoeren wieder ab', () => {
    const { query } = setup(true)

    TestBed.resetTestingModule()

    expect(query.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })
})
