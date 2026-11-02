// core#1173: Standort-Stammdaten laufen auf Signal Forms. Geprüft wird über das gerenderte Template:
// Der geladene Wert muss im Feld stehen, die Eingabe muss im Patch landen, und ein leerer Name sperrt
// das Speichern. Genau diese Bindungen gehen beim Umbau still verloren.
import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { TranslateModule } from '@ngx-translate/core'
import { ConnectionService } from '@panary/shared/data-access'
import { describe, expect, it, vi } from 'vitest'

import { ApiService } from '../../core/api.service'
import { CloudManagedService } from '../../core/cloud-managed.service'
import { LocationStateService } from '../../core/location-state.service'
import { LocationDetailComponent } from './location-detail'

const LOCATION = { _id: 'loc-1', name: 'Hauptfiliale', email: '', phone: '0301234', status: 'ACTIVE' }

async function render() {
  const api = {
    find: vi.fn().mockResolvedValue({ data: [{ ...LOCATION }] }),
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
  const locationState = { locationName: signal('') }
  await TestBed.configureTestingModule({
    imports: [LocationDetailComponent, TranslateModule.forRoot()],
    providers: [
      CloudManagedService,
      { provide: ApiService, useValue: api },
      { provide: ConnectionService, useValue: connection },
      { provide: LocationStateService, useValue: locationState },
    ],
  }).compileComponents()
  const fixture = TestBed.createComponent(LocationDetailComponent)
  await fixture.whenStable()
  const el = fixture.nativeElement as HTMLElement

  const input = (id: string) => el.querySelector<HTMLInputElement>(`#${id}`)!
  async function type(id: string, value: string) {
    input(id).value = value
    input(id).dispatchEvent(new Event('input'))
    await fixture.whenStable()
  }
  async function submit() {
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await fixture.whenStable()
  }
  const submitButton = () => el.querySelector<HTMLButtonElement>('button[type="submit"]')!

  return { api, locationState, input, type, submit, submitButton }
}

describe('LocationDetailComponent – Formular', () => {
  it('zeigt die geladenen Stammdaten in den Feldern', async () => {
    const { input } = await render()
    expect(input('locationName').value).toBe('Hauptfiliale')
    expect(input('locationPhone').value).toBe('0301234')
  })

  it('sperrt das Speichern bei leerem Namen', async () => {
    const { type, submitButton } = await render()
    expect(submitButton().disabled).toBe(false)

    await type('locationName', '')
    expect(submitButton().disabled).toBe(true)
  })

  it('sperrt das Speichern bei ungültiger E-Mail', async () => {
    const { type, submitButton } = await render()
    await type('locationEmail', 'keine-adresse')
    expect(submitButton().disabled).toBe(true)
  })

  it('schickt die getippten Werte im Patch und leere Optionalfelder nicht mit', async () => {
    const { type, submit, api, locationState } = await render()
    await type('locationName', 'Filiale Mitte')
    await type('locationPhone', '')
    await submit()

    expect(api.patch).toHaveBeenCalledWith('locations', 'loc-1', { name: 'Filiale Mitte', status: 'ACTIVE' })
    expect(locationState.locationName()).toBe('Filiale Mitte')
  })
})
