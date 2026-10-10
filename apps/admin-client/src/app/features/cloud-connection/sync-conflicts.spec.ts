import { ChangeDetectorRef } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiService } from '../../core/api.service'
import { SyncProblemCountService } from '../../core/sync-problem-count.service'
import { SyncConflictsComponent } from './sync-conflicts'

// #663: „Verwerfen" loeschte den lokalen Datensatz ohne Rueckfrage — am
// Kunden-Edge zehn Benutzer. Geprueft wird, ob der Patch abgeschickt wird,
// nicht die Beschriftung.
const conflict = (origin?: 'bootstrap' | 'push-write' | 'push-remove') => ({
  _id: 'c-1',
  service: 'users',
  edgeRecordId: 'u-1',
  reason: 'push-rejected' as const,
  status: 'open' as const,
  createdAt: '2026-10-10T14:45:54.000Z',
  ...(origin ? { origin } : {}),
})

function setup() {
  const api = {
    find: vi.fn().mockResolvedValue({ data: [] }),
    patch: vi.fn().mockResolvedValue({}),
    remove: vi.fn().mockResolvedValue({}),
  }
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ChangeDetectorRef, useValue: { markForCheck: vi.fn(), detectChanges: vi.fn() } },
      { provide: SyncProblemCountService, useValue: { refresh: vi.fn() } },
    ],
  })
  const component = TestBed.runInInjectionContext(() => new SyncConflictsComponent())
  return { component, api }
}

let confirmSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  TestBed.resetTestingModule()
  confirmSpy = vi.fn()
  vi.stubGlobal('confirm', confirmSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SyncConflictsComponent — Verwerfen (#663)', () => {
  it('fragt bei einem Konflikt aus einer Aenderung vor dem Loeschen und bricht bei Nein ab', async () => {
    const { component, api } = setup()
    confirmSpy.mockReturnValue(false)

    await component.resolveConflict(conflict('push-write') as never, 'discard')

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(String(confirmSpy.mock.calls[0][0])).toContain('an diesem Standort gelöscht')
    expect(api.patch).not.toHaveBeenCalled()
  })

  it('verwirft nach Bestaetigung', async () => {
    const { component, api } = setup()
    confirmSpy.mockReturnValue(true)

    await component.resolveConflict(conflict('push-write') as never, 'discard')

    expect(api.patch).toHaveBeenCalledWith('sync-conflicts', 'c-1', { resolution: 'discard' })
  })

  it('fragt auch, wenn der Edge den Ursprung nicht mitliefert', async () => {
    const { component, api } = setup()
    confirmSpy.mockReturnValue(false)

    await component.resolveConflict(conflict() as never, 'discard')

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(api.patch).not.toHaveBeenCalled()
  })

  it('verwirft einen Loesch-Auftrag ohne Rueckfrage — dort wird nichts geloescht', async () => {
    const { component, api } = setup()

    await component.resolveConflict(conflict('push-remove') as never, 'discard')

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(api.patch).toHaveBeenCalledWith('sync-conflicts', 'c-1', { resolution: 'discard' })
  })

  it('fragt bei den anderen Aufloesungen nicht', async () => {
    const { component, api } = setup()

    await component.resolveConflict(conflict('push-write') as never, 'use-edge')

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(api.patch).toHaveBeenCalledWith('sync-conflicts', 'c-1', { resolution: 'use-edge' })
  })
})
