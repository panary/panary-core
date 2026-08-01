import { ChangeDetectorRef, signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { ActivatedRoute, Router } from '@angular/router'
import { ConnectionService } from '@panary/shared/data-access'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiService } from '../../core/api.service'
import { CloudConnectionComponent } from './cloud-connection'

const CONNECTION = {
  _id: 'conn-1',
  cloudUrl: 'https://api.panary.cloud',
  pairingStatus: 'connected' as const,
  syncEnabled: true,
  syncMode: 'auto' as const,
  syncIntervalSec: 300,
}

function setup(opts: { patch?: () => Promise<unknown>; stored?: Record<string, unknown> } = {}) {
  const stored = { ...CONNECTION, ...(opts.stored ?? {}) }
  const api = {
    find: vi.fn().mockResolvedValue({ data: [stored] }),
    patch: vi.fn(opts.patch ?? (() => Promise.resolve({}))),
    get: vi.fn().mockResolvedValue({}),
    customMethod: vi.fn().mockResolvedValue({}),
  }
  const connection = {
    cloudNeedsRePairing: signal(false),
    cloudUnreachable: signal(false),
    lastCloudContactAgeMin: signal<number | null>(null),
    offlineModeActive: signal(false),
    offlineModeRemainingMin: signal<number | null>(null),
  }
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ChangeDetectorRef, useValue: { markForCheck: vi.fn(), detectChanges: vi.fn() } },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: new Map() }, queryParamMap: signal(new Map()) },
      },
      { provide: Router, useValue: { navigate: vi.fn() } },
      { provide: ConnectionService, useValue: connection },
    ],
  })
  const component = TestBed.runInInjectionContext(() => new CloudConnectionComponent())
  component.connectionInfo.set(stored as never)
  return { component, api }
}

const patchBody = (api: { patch: ReturnType<typeof vi.fn> }) => api.patch.mock.calls.at(-1)?.[2]

beforeEach(() => {
  TestBed.resetTestingModule()
  vi.clearAllMocks()
})

describe('CloudConnectionComponent — Zeitplan', () => {
  it('normalisiert Uhrzeiten: entdoppelt, verwirft Ungültiges, sortiert chronologisch', async () => {
    const { component, api } = setup()
    component.syncMode = 'scheduled'
    component.syncScheduleTimes = ['22:00', '06:30', '22:00', '25:99', '']
    component.syncScheduleTimezone = 'Europe/Berlin'

    await component.onSaveSyncMode()

    expect(patchBody(api).syncSchedule).toEqual({ times: ['06:30', '22:00'], timezone: 'Europe/Berlin' })
  })

  it('speichert „Zeitplan" ohne gültige Uhrzeit gar nicht erst', async () => {
    // Genau dieser Zustand — Modus gewählt, kein Zeitplan hinterlegt — hat den
    // Modus funktionsunfähig gemacht. Der Worker fängt ihn inzwischen mit
    // AUTO-Verhalten ab; die UI soll ihn trotzdem nicht erzeugen können.
    const { component, api } = setup()
    component.syncMode = 'scheduled'
    component.syncScheduleTimes = ['abc']

    await component.onSaveSyncMode()

    expect(api.patch).not.toHaveBeenCalled()
    expect(component.errors()).toHaveLength(1)
  })

  it('belegt beim Umschalten auf „Zeitplan" eine Uhrzeit vor, statt zu meckern', async () => {
    const { component, api } = setup()
    component.syncMode = 'scheduled'

    component.onSyncModeChange()
    await Promise.resolve()

    expect(component.syncScheduleTimes).toEqual(['22:00'])
    expect(api.patch).toHaveBeenCalled()
  })

  it('lässt die letzte Uhrzeit im Zeitplan-Modus nicht entfernen', () => {
    const { component, api } = setup()
    component.syncMode = 'scheduled'
    component.syncScheduleTimes = ['22:00']

    component.removeScheduleTime(0)

    expect(component.syncScheduleTimes).toEqual(['22:00'])
    expect(api.patch).not.toHaveBeenCalled()
    expect(component.errors()).toHaveLength(1)
  })

  it('schickt keinen syncSchedule mit, wenn kein Zeitplan gepflegt ist', async () => {
    // Ein leeres times-Array verletzt `minItems: 1` und würde den ganzen Patch
    // kippen — inklusive des syncMode-Wechsels, den der Nutzer eigentlich wollte.
    const { component, api } = setup()
    component.syncMode = 'manual'
    component.syncScheduleTimes = []

    await component.onSaveSyncMode()

    expect(patchBody(api)).toEqual({ syncMode: 'manual', syncIntervalSec: 300 })
  })

  it('lädt nach erfolgreichem Speichern neu', async () => {
    const { component, api } = setup()
    component.syncMode = 'manual'

    await component.onSaveSyncMode()

    expect(api.find).toHaveBeenCalledWith('cloud-connection', { $limit: 1 })
  })

  it('rollt bei abgelehntem Patch auf den persistierten Stand zurück', async () => {
    const { component } = setup({
      patch: () => Promise.reject(new Error('validation failed')),
      stored: { syncMode: 'auto', syncIntervalSec: 300, syncSchedule: { times: ['03:00'], timezone: 'Europe/Berlin' } },
    })
    component.syncMode = 'scheduled'
    component.syncScheduleTimes = ['04:00', '05:00']

    await component.onSaveSyncMode()

    // Ohne Rollback bliebe die UI auf Werten stehen, die der Server abgelehnt hat.
    expect(component.syncMode).toBe('auto')
    expect(component.syncScheduleTimes).toEqual(['03:00'])
    expect(component.errors().length).toBeGreaterThan(0)
  })
})
