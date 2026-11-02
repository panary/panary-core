// core#1173: Das Anlege-Formular für API-Schlüssel läuft auf Signal Forms. Geprüft wird über das
// gerenderte Template: Pflicht und Mindestlänge des Namens sperren das Anlegen, die getippten Werte
// landen im `create`, und ein Wechsel auf einen bestehenden Schlüssel setzt das Formular zurück.
import { TestBed } from '@angular/core/testing'
import { Router } from '@angular/router'
import { TranslateModule } from '@ngx-translate/core'
import { APIKEY_DEVICE_ROLES } from '@panary/apikeys/domain'
import { describe, expect, it, vi } from 'vitest'

import { ApiService } from '../../core/api.service'
import { ApikeyFormComponent } from './apikey-form'

async function render() {
  const api = {
    create: vi.fn().mockResolvedValue({ _id: 'key-1', key: 'pk_test' }),
    get: vi.fn().mockRejectedValue(new Error('nicht gebraucht')),
    find: vi.fn().mockResolvedValue({ data: [] }),
  }
  await TestBed.configureTestingModule({
    imports: [ApikeyFormComponent, TranslateModule.forRoot()],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: Router, useValue: { navigate: vi.fn() } },
    ],
  }).compileComponents()
  const fixture = TestBed.createComponent(ApikeyFormComponent)
  fixture.componentRef.setInput('id', 'new')
  await fixture.whenStable()
  const el = fixture.nativeElement as HTMLElement

  async function type(id: string, value: string) {
    const field = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!
    field.value = value
    field.dispatchEvent(new Event('input'))
    await fixture.whenStable()
  }
  async function submit() {
    const event = new Event('submit', { cancelable: true })
    el.querySelector('form')!.dispatchEvent(event)
    await fixture.whenStable()
    return event
  }
  const submitButton = () => el.querySelector<HTMLButtonElement>('button[type="submit"]')!

  return { fixture, el, api, type, submit, submitButton }
}

describe('ApikeyFormComponent – Anlege-Formular', () => {
  it('sperrt das Anlegen ohne Namen und bei einem Zeichen', async () => {
    const { type, submitButton } = await render()
    expect(submitButton().disabled).toBe(true)

    await type('apikeyName', 'K')
    expect(submitButton().disabled).toBe(true)

    await type('apikeyName', 'Kasse 1')
    expect(submitButton().disabled).toBe(false)
  })

  it('sperrt mehr als 80 Zeichen', async () => {
    const { type, submitButton } = await render()
    await type('apikeyName', 'K'.repeat(81))
    expect(submitButton().disabled).toBe(true)
  })

  it('zeigt die Mindestlänge erst nach Berührung und Eingabe', async () => {
    const { el, fixture, type } = await render()
    await type('apikeyName', 'K')
    expect(el.textContent).not.toContain('COMMON.MIN_CHARS')
    el.querySelector('#apikeyName')!.dispatchEvent(new Event('blur'))
    await fixture.whenStable()

    expect(el.textContent).toContain('COMMON.MIN_CHARS')
  })

  it('markiert beim Absenden eines ungültigen Formulars alle Felder und zeigt den Fehler', async () => {
    const { el, submit, api } = await render()
    await submit()

    expect(api.create).not.toHaveBeenCalled()
    expect(el.textContent).toContain('APIKEYS.NAME_REQUIRED')
  })

  it('schickt die getippten Werte im create', async () => {
    const { type, submit, api } = await render()
    await type('apikeyName', 'Kasse 1')
    await type('apikeyDescription', 'Theke vorne')
    const event = await submit()

    // `[formRoot]` fängt den nativen Submit ab; ohne ihn lüde der Browser die Seite neu.
    expect(event.defaultPrevented).toBe(true)
    expect(api.create).toHaveBeenCalledWith('apikeys', {
      name: 'Kasse 1',
      description: 'Theke vorne',
      role: APIKEY_DEVICE_ROLES[0],
    })
  })

  it('leert das Formular beim Wechsel auf einen anderen Schlüssel', async () => {
    const { fixture, el, type } = await render()
    await type('apikeyName', 'Kasse 1')
    expect(fixture.componentInstance.isDirty()).toBe(true)

    fixture.componentRef.setInput('id', 'key-9')
    await fixture.whenStable()
    fixture.componentRef.setInput('id', 'new')
    await fixture.whenStable()

    expect(fixture.componentInstance.isDirty()).toBe(false)
    expect(el.querySelector<HTMLInputElement>('#apikeyName')!.value).toBe('')
  })
})
