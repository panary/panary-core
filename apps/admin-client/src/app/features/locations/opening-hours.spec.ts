// core#1173: Öffnungszeiten laufen auf Signal Forms mit `applyEach` je Tag und je Ausnahme.
// Geprüft wird über das gerenderte Template: Die geladene Uhrzeit steht im Feld, eine Änderung
// landet im Patch, und eine geleerte Uhrzeit eines geöffneten Tages wird nicht gespeichert.
import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { TranslateModule } from '@ngx-translate/core'
import { ConnectionService } from '@panary/shared/data-access'
import { describe, expect, it, vi } from 'vitest'

import { ApiService } from '../../core/api.service'
import { CloudManagedService } from '../../core/cloud-managed.service'
import { OpeningHoursComponent } from './opening-hours'

const REGULAR = [0, 1, 2, 3, 4, 5, 6].map(day => ({ day, open: '08:00', close: '18:00', closed: day === 0 }))
const EXCEPTION = {
  _id: 'exc-1',
  date: '2099-12-24',
  label: 'Heiligabend',
  closed: false,
  open: '08:00',
  close: '12:00',
}

async function render() {
  const api = {
    find: vi.fn((service: string) =>
      Promise.resolve(
        service === 'locations'
          ? { data: [{ _id: 'loc-1', settings: { openingHoursSettings: { enabled: true, regular: REGULAR } } }] }
          : { data: [{ ...EXCEPTION }] },
      ),
    ),
    patch: vi.fn().mockResolvedValue({}),
  }
  const connection = {
    healthLoaded: signal(true),
    cloudPaired: signal(false),
    emergencyOverrideActive: signal(false),
    emergencyOverrideSinceMin: signal<number | null>(null),
    cloudUnreachable: signal(false),
    cloudContactUnknown: signal(false),
    refreshHealth: vi.fn().mockResolvedValue(undefined),
  }
  await TestBed.configureTestingModule({
    imports: [OpeningHoursComponent, TranslateModule.forRoot()],
    providers: [
      CloudManagedService,
      { provide: ApiService, useValue: api },
      { provide: ConnectionService, useValue: connection },
    ],
  }).compileComponents()
  const fixture = TestBed.createComponent(OpeningHoursComponent)
  await fixture.whenStable()
  const el = fixture.nativeElement as HTMLElement

  /** Zeitfelder in Dokumentreihenfolge: Mo–Sa je open/close (So ist geschlossen), danach die Ausnahme. */
  const timeInputs = () => [...el.querySelectorAll<HTMLInputElement>('input[type="time"]')]
  async function change(field: HTMLInputElement, value: string) {
    field.value = value
    // Der Browser feuert erst `input` (darauf hört `[formField]`), dann `change` (Autosave).
    field.dispatchEvent(new Event('input'))
    field.dispatchEvent(new Event('change'))
    await fixture.whenStable()
  }

  return { el, api, timeInputs, change }
}

describe('OpeningHoursComponent – Formular', () => {
  it('zeigt die geladenen Uhrzeiten in den Feldern', async () => {
    const { timeInputs } = await render()
    // 6 geöffnete Tage × 2 + Ausnahme × 2
    expect(timeInputs()).toHaveLength(14)
    expect(timeInputs()[0].value).toBe('08:00')
    expect(timeInputs()[13].value).toBe('12:00')
  })

  it('speichert eine geänderte Öffnungszeit mit dem neuen Wert', async () => {
    const { timeInputs, change, api } = await render()
    await change(timeInputs()[0], '09:30')

    expect(api.patch).toHaveBeenCalledTimes(1)
    // Signal Forms hängt an Array-Einträge Symbol-Schlüssel zur Identitätsverfolgung. Über HTTP geht
    // die JSON-Form, und die lässt Symbole weg — also wird genau die verglichen.
    const body = JSON.parse(JSON.stringify(api.patch.mock.calls[0][2]))
    expect(body.settings.openingHoursSettings.regular[1]).toEqual({
      day: 1,
      open: '09:30',
      close: '18:00',
      closed: false,
    })
  })

  it('speichert eine geleerte Uhrzeit nicht und zeigt den Hinweis', async () => {
    const { el, timeInputs, change, api } = await render()
    await change(timeInputs()[1], '')

    expect(api.patch).not.toHaveBeenCalled()
    expect(el.textContent).toContain('OPENING_HOURS.TIME_REQUIRED')
  })

  it('speichert eine geänderte Ausnahme über ihren eigenen Datensatz', async () => {
    const { timeInputs, change, api } = await render()
    await change(timeInputs()[13], '14:00')

    expect(api.patch).toHaveBeenCalledWith('opening-hour-exceptions', 'exc-1', {
      date: '2099-12-24',
      label: 'Heiligabend',
      closed: false,
      open: '08:00',
      close: '14:00',
    })
  })

  it('speichert eine Ausnahme mit geleerter Uhrzeit nicht', async () => {
    const { timeInputs, change, api } = await render()
    await change(timeInputs()[12], '')

    expect(api.patch).not.toHaveBeenCalled()
  })
})
