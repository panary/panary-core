import { ChangeDetectorRef, signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { ActivatedRoute, Router } from '@angular/router'
import { TranslateModule } from '@ngx-translate/core'
import { ConnectionService } from '@panary/shared/data-access'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
    component.syncSettings.update(v => ({ ...v, syncMode: 'scheduled' }))
    component.syncSettings.update(v => ({ ...v, syncScheduleTimes: ['22:00', '06:30', '22:00', '25:99', ''] }))
    component.syncSettings.update(v => ({ ...v, syncScheduleTimezone: 'Europe/Berlin' }))

    await component.onSaveSyncMode()

    expect(patchBody(api).syncSchedule).toEqual({ times: ['06:30', '22:00'], timezone: 'Europe/Berlin' })
  })

  it('speichert „Zeitplan" ohne gültige Uhrzeit gar nicht erst', async () => {
    // Genau dieser Zustand — Modus gewählt, kein Zeitplan hinterlegt — hat den
    // Modus funktionsunfähig gemacht. Der Worker fängt ihn inzwischen mit
    // AUTO-Verhalten ab; die UI soll ihn trotzdem nicht erzeugen können.
    const { component, api } = setup()
    component.syncSettings.update(v => ({ ...v, syncMode: 'scheduled' }))
    component.syncSettings.update(v => ({ ...v, syncScheduleTimes: ['abc'] }))

    await component.onSaveSyncMode()

    expect(api.patch).not.toHaveBeenCalled()
    expect(component.errors()).toHaveLength(1)
  })

  it('belegt beim Umschalten auf „Zeitplan" eine Uhrzeit vor, statt zu meckern', async () => {
    const { component, api } = setup()
    component.syncSettings.update(v => ({ ...v, syncMode: 'scheduled' }))

    component.onSyncModeChange()
    await Promise.resolve()

    expect(component.syncSettings().syncScheduleTimes).toEqual(['22:00'])
    expect(api.patch).toHaveBeenCalled()
  })

  it('lässt die letzte Uhrzeit im Zeitplan-Modus nicht entfernen', () => {
    const { component, api } = setup()
    component.syncSettings.update(v => ({ ...v, syncMode: 'scheduled' }))
    component.syncSettings.update(v => ({ ...v, syncScheduleTimes: ['22:00'] }))

    component.removeScheduleTime(0)

    expect(component.syncSettings().syncScheduleTimes).toEqual(['22:00'])
    expect(api.patch).not.toHaveBeenCalled()
    expect(component.errors()).toHaveLength(1)
  })

  it('schickt keinen syncSchedule mit, wenn kein Zeitplan gepflegt ist', async () => {
    // Ein leeres times-Array verletzt `minItems: 1` und würde den ganzen Patch
    // kippen — inklusive des syncMode-Wechsels, den der Nutzer eigentlich wollte.
    const { component, api } = setup()
    component.syncSettings.update(v => ({ ...v, syncMode: 'manual' }))
    component.syncSettings.update(v => ({ ...v, syncScheduleTimes: [] }))

    await component.onSaveSyncMode()

    expect(patchBody(api)).toEqual({ syncMode: 'manual', syncIntervalSec: 300 })
  })

  it('lädt nach erfolgreichem Speichern neu', async () => {
    const { component, api } = setup()
    component.syncSettings.update(v => ({ ...v, syncMode: 'manual' }))

    await component.onSaveSyncMode()

    expect(api.find).toHaveBeenCalledWith('cloud-connection', { $limit: 1 })
  })

  it('rollt bei abgelehntem Patch auf den persistierten Stand zurück', async () => {
    const { component } = setup({
      patch: () => Promise.reject(new Error('validation failed')),
      stored: { syncMode: 'auto', syncIntervalSec: 300, syncSchedule: { times: ['03:00'], timezone: 'Europe/Berlin' } },
    })
    component.syncSettings.update(v => ({ ...v, syncMode: 'scheduled' }))
    component.syncSettings.update(v => ({ ...v, syncScheduleTimes: ['04:00', '05:00'] }))

    await component.onSaveSyncMode()

    // Ohne Rollback bliebe die UI auf Werten stehen, die der Server abgelehnt hat.
    expect(component.syncSettings().syncMode).toBe('auto')
    expect(component.syncSettings().syncScheduleTimes).toEqual(['03:00'])
    expect(component.errors().length).toBeGreaterThan(0)
  })
})

// core#1173: Das Sync-Intervall hat Grenzen im Signal-Forms-Schema (wie `SYNC_INTERVAL_MIN_SEC`/`_MAX_SEC`
// im Domain-Schema). Vorher standen sie nur als HTML-Attribut am Feld und hielten keinen Save auf.
describe('CloudConnectionComponent — Sync-Intervall', () => {
  it('speichert ein Intervall unter 60 Sekunden nicht', async () => {
    const { component, api } = setup()
    component.syncSettings.update(v => ({ ...v, syncIntervalSec: 30 }))

    await component.onSaveSyncMode()

    expect(api.patch).not.toHaveBeenCalled()
    expect(component.errors()).toHaveLength(1)
  })

  it('speichert ein leeres Intervall im Modus „Automatisch" nicht', async () => {
    const { component, api } = setup()
    component.syncSettings.update(v => ({ ...v, syncIntervalSec: null }))

    await component.onSaveSyncMode()

    expect(api.patch).not.toHaveBeenCalled()
  })

  it('ein ungültiges Intervall sperrt den Wechsel auf „Zeitplan" nicht', async () => {
    const { component, api } = setup()
    component.syncSettings.update(v => ({
      ...v,
      syncMode: 'scheduled',
      syncIntervalSec: 30,
      syncScheduleTimes: ['22:00'],
    }))

    await component.onSaveSyncMode()

    expect(api.patch).toHaveBeenCalledTimes(1)
  })

  it('lässt ein leeres Intervall außerhalb von „Automatisch" aus dem Patch', async () => {
    const { component, api } = setup()
    component.syncSettings.update(v => ({ ...v, syncMode: 'manual', syncIntervalSec: null }))

    await component.onSaveSyncMode()

    expect(patchBody(api)).toEqual({ syncMode: 'manual' })
  })
})

// core#1173: Kopplungs-Assistent und Sync-Einstellungen hängen per `[formField]` am Modell. Geprüft wird
// über das gerenderte Template, denn genau diese Bindungen gehen beim Umbau still verloren.
describe('CloudConnectionComponent — Eingabefelder im Template', () => {
  async function render(stored: Record<string, unknown> | null) {
    const api = {
      find: vi.fn((service: string) =>
        Promise.resolve(
          service === 'cloud-connection'
            ? { data: stored ? [{ ...CONNECTION, ...stored }] : [] }
            : service === 'locations'
              ? { data: [{ name: 'Hauptfiliale' }] }
              : { data: [], total: 0 },
        ),
      ),
      patch: vi.fn().mockResolvedValue({}),
      get: vi.fn().mockResolvedValue({}),
      customMethod: vi.fn().mockResolvedValue({}),
    }
    const connection = {
      cloudNeedsRePairing: signal(false),
      cloudUnreachable: signal(false),
      lastCloudContactAgeMin: signal<number | null>(null),
      offlineModeActive: signal(false),
      offlineModeRemainingMin: signal<number | null>(null),
      nextExpectedSyncAt: signal<string | null>(null),
      syncMode: signal('auto'),
    }
    await TestBed.configureTestingModule({
      imports: [CloudConnectionComponent, TranslateModule.forRoot()],
      providers: [
        { provide: ApiService, useValue: api },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: new Map() }, queryParamMap: signal(new Map()) },
        },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: ConnectionService, useValue: connection },
      ],
    }).compileComponents()
    const fixture = TestBed.createComponent(CloudConnectionComponent)
    // Zoneless wartet `whenStable` nicht auf die Mock-Promises der Ladekette (find → Standortname).
    async function settle() {
      for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve))
        await fixture.whenStable()
      }
    }
    await settle()
    const el = fixture.nativeElement as HTMLElement
    async function type(field: HTMLInputElement, value: string) {
      field.value = value
      field.dispatchEvent(new Event('input'))
      await fixture.whenStable()
    }
    return { fixture, el, api, type, settle }
  }

  it('gibt die Prüfung erst mit sechsstelligem Code frei und schickt die getippten Werte', async () => {
    const { el, api, type } = await render(null)
    const code = el.querySelector<HTMLInputElement>('#pairingCode')!
    const edgeName = el.querySelector<HTMLInputElement>('#edgeName')!
    const check = [...el.querySelectorAll<HTMLButtonElement>('button')].find(b =>
      b.textContent?.includes('Mit Cloud verbinden'),
    )!
    expect(edgeName.value).toBe('Hauptfiliale')

    await type(code, '12345')
    expect(check.disabled).toBe(true)
    await type(code, '12345a')
    expect(check.disabled).toBe(true)
    await type(code, '123456')
    expect(check.disabled).toBe(false)

    check.click()
    expect(api.customMethod).toHaveBeenCalledWith(
      'cloud-connection',
      'preflight',
      expect.objectContaining({ pairingCode: '123456', edgeName: 'Hauptfiliale' }),
    )
  })

  it('sperrt die Prüfung bei leerem Edge-Namen oder leerer Cloud-URL', async () => {
    const { el, type } = await render(null)
    const check = [...el.querySelectorAll<HTMLButtonElement>('button')].find(b =>
      b.textContent?.includes('Mit Cloud verbinden'),
    )!
    await type(el.querySelector<HTMLInputElement>('#pairingCode')!, '123456')
    expect(check.disabled).toBe(false)

    await type(el.querySelector<HTMLInputElement>('#edgeName')!, '')
    expect(check.disabled).toBe(true)

    await type(el.querySelector<HTMLInputElement>('#edgeName')!, 'Filiale')
    await type(el.querySelector<HTMLInputElement>('#cloudUrl')!, '')
    expect(check.disabled).toBe(true)
  })

  it('zeigt das gespeicherte Intervall und speichert das getippte beim Verlassen', async () => {
    const { el, api, type, settle } = await render({})
    const interval = el.querySelector<HTMLInputElement>('#syncIntervalSec')!
    expect(interval.value).toBe('300')

    await type(interval, '600')
    interval.dispatchEvent(new Event('blur'))
    await settle()

    expect(api.patch).toHaveBeenCalledWith('cloud-connection', 'conn-1', { syncMode: 'auto', syncIntervalSec: 600 })
  })
})

// #666: „Benutzer neu laden" archiviert ueber den Sichtbarkeits-Abgleich womoeglich
// Benutzer — ohne Bestaetigung darf die Methode nicht aufgerufen werden.
describe('CloudConnectionComponent — Benutzer neu laden', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('ruft reloadUsers erst nach Bestaetigung auf und zeigt das Ergebnis', async () => {
    const confirmSpy = vi.fn().mockReturnValue(true)
    vi.stubGlobal('confirm', confirmSpy)
    const { component, api } = setup()
    api.customMethod.mockResolvedValue({ _id: 'conn-1', pushed: 0, pulled: 7, durationMs: 12 })

    await component.onReloadUsers()

    expect(String(confirmSpy.mock.calls[0][0])).toContain('archiviert')
    expect(api.customMethod).toHaveBeenCalledWith('cloud-connection', 'reloadUsers', { cloudConnectionId: 'conn-1' })
    expect(component.lastReloadUsersResult()).toEqual({ _id: 'conn-1', pushed: 0, pulled: 7, durationMs: 12 })
    expect(component.reloadingUsers()).toBe(false)
  })

  it('leert ein frueheres Ergebnis, wenn der naechste Versuch scheitert', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    const { component, api } = setup()
    component.lastReloadUsersResult.set({ pulled: 7 })
    api.customMethod.mockRejectedValue(new Error('3 Benutzer-Änderung(en) warten noch auf das Hochladen.'))

    await component.onReloadUsers()

    expect(component.lastReloadUsersResult()).toBeNull()
    expect(component.errors().join(' ')).toContain('warten noch')
  })

  // #673: Die Rueckfrage versprach, wartende Aenderungen vorher zu senden — der Edge
  // lehnt dann aber ab (#666). Und das Menue muss zu sein, bevor der Dialog kommt.
  it('schliesst das Menue und verspricht kein Senden wartender Benutzer-Aenderungen', async () => {
    const confirmSpy = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirmSpy)
    const { component } = setup()
    component.syncMenuOpen.set(true)

    await component.onReloadUsers()

    expect(component.syncMenuOpen()).toBe(false)
    const text = String(confirmSpy.mock.calls[0][0])
    expect(text).not.toContain('vorher gesendet')
    expect(text).toContain('wird nicht neu geladen')
  })

  it('bricht bei Nein ab, ohne die Methode aufzurufen', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false))
    const { component, api } = setup()

    await component.onReloadUsers()

    expect(api.customMethod).not.toHaveBeenCalled()
    expect(component.lastReloadUsersResult()).toBeNull()
  })
})
