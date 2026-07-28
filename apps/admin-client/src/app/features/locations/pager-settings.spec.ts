import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { TranslateService } from '@ngx-translate/core'
import { ConnectionService } from '@panary/shared/data-access'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiService } from '../../core/api.service'
import { CloudManagedService } from '../../core/cloud-managed.service'
import { PagerSettingsComponent } from './pager-settings'

function setup(opts: { cloudPaired?: boolean; patch?: () => Promise<unknown> } = {}) {
  const api = {
    find: vi.fn().mockResolvedValue({
      data: [{ _id: 'loc-1', settings: { pagerSettings: { enabled: true, pagers: [1, 2] } } }],
    }),
    patch: vi.fn(opts.patch ?? (() => Promise.resolve({}))),
  }
  const connection = {
    healthLoaded: signal(true),
    cloudPaired: signal(opts.cloudPaired ?? false),
    emergencyOverrideActive: signal(false),
    emergencyOverrideSinceMin: signal<number | null>(null),
    cloudUnreachable: signal(false),
    refreshHealth: vi.fn().mockResolvedValue(undefined),
  }
  TestBed.configureTestingModule({
    providers: [
      CloudManagedService,
      { provide: ApiService, useValue: api },
      { provide: ConnectionService, useValue: connection },
      { provide: TranslateService, useValue: { instant: (k: string) => k } },
    ],
  })
  const component = TestBed.runInInjectionContext(() => new PagerSettingsComponent())
  return { component, api, connection }
}

beforeEach(() => {
  TestBed.resetTestingModule()
  vi.clearAllMocks()
})

describe('PagerSettingsComponent', () => {
  it('übernimmt einen erfolgreich gespeicherten Pager', async () => {
    const { component, api } = setup()
    await component.ngOnInit()

    component.newPagerNumber = 7
    await component.addPager()

    expect(component.pagers()).toEqual([1, 2, 7])
    expect(api.patch).toHaveBeenCalledTimes(1)
    expect(component.error()).toBeNull()
  })

  // Der eigentliche Bug: vorher wurde optimistisch mutiert und der Save nicht
  // abgewartet — bei 403 blieb der Pager sichtbar, bis der Nutzer neu lud.
  it('rollt die Liste exakt zurück, wenn der Save fehlschlägt', async () => {
    const err = Object.assign(new Error('Forbidden'), { data: { code: 'CLOUD_MANAGED' } })
    const { component, connection } = setup({ patch: () => Promise.reject(err) })
    await component.ngOnInit()

    component.newPagerNumber = 7
    await component.addPager()

    expect(component.pagers()).toEqual([1, 2])
    expect(component.error()).toBeTruthy()
    // 403 CLOUD_MANAGED => lokaler Cloud-Zustand war veraltet, neu laden.
    expect(connection.refreshHealth).toHaveBeenCalled()
  })

  it('rollt auch den Toggle zurück, wenn der Save fehlschlägt', async () => {
    const { component } = setup({ patch: () => Promise.reject(new Error('boom')) })
    await component.ngOnInit()
    expect(component.pagerEnabled()).toBe(true)

    await component.toggleEnabled()

    expect(component.pagerEnabled()).toBe(true)
  })

  it('blockt die Mutation bei Cloud-Verwaltung, bevor der State sich ändert', async () => {
    const { component, api } = setup({ cloudPaired: true })
    await component.ngOnInit()

    component.newPagerNumber = 7
    await component.addPager()

    expect(component.pagers()).toEqual([1, 2])
    expect(api.patch).not.toHaveBeenCalled()
    expect(component.error()).toBe('CLOUD_MANAGED.SAVE_BLOCKED')
  })

  it('lehnt ein Duplikat ab, ohne zu speichern', async () => {
    const { component, api } = setup()
    await component.ngOnInit()

    component.newPagerNumber = 2
    await component.addPager()

    expect(component.pagerDuplicateError()).toBe(true)
    expect(api.patch).not.toHaveBeenCalled()
  })

  it('entfernt einen Pager und persistiert', async () => {
    const { component, api } = setup()
    await component.ngOnInit()

    await component.removePager(1)

    expect(component.pagers()).toEqual([2])
    expect(api.patch).toHaveBeenCalledTimes(1)
  })
})
