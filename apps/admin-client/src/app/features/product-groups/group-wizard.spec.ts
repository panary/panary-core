// core#1173: Der Gruppen-Assistent läuft auf Signal Forms. Geprüft wird über das gerenderte Template der
// beiden Eingabeschritte: Name (leer oder nur Leerzeichen sperrt „Weiter") und eigene MwSt.-Sätze (0–100).
import { TestBed } from '@angular/core/testing'
import { describe, expect, it, vi } from 'vitest'

import { ApiService } from '../../core/api.service'
import { GroupWizardComponent } from './group-wizard'

async function render(step: number) {
  await TestBed.configureTestingModule({
    imports: [GroupWizardComponent],
    providers: [{ provide: ApiService, useValue: { find: vi.fn().mockResolvedValue({ data: [] }), create: vi.fn() } }],
  }).compileComponents()
  const fixture = TestBed.createComponent(GroupWizardComponent)
  fixture.componentInstance.currentStep.set(step)
  if (step === 3) fixture.componentInstance.showCustomTax.set(true)
  await fixture.whenStable()
  const el = fixture.nativeElement as HTMLElement
  async function type(field: HTMLInputElement, value: string) {
    field.value = value
    field.dispatchEvent(new Event('input'))
    await fixture.whenStable()
  }
  const button = (text: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text)!
  return { fixture, el, type, button }
}

describe('GroupWizardComponent – Eingabeschritte', () => {
  it('Name: sperrt „Weiter" bei leerem Namen oder nur Leerzeichen und übernimmt den getippten', async () => {
    const { fixture, el, type, button } = await render(1)
    const name = el.querySelector<HTMLInputElement>('input[type="text"]')!
    expect(button('→').disabled).toBe(true)

    await type(name, '   ')
    expect(button('→').disabled).toBe(true)

    await type(name, 'Pizza')
    expect(button('→').disabled).toBe(false)
    expect(fixture.componentInstance.formData().name).toBe('Pizza')
  })

  it('MwSt.: sperrt „Übernehmen" über 100 % und übernimmt gültige Sätze', async () => {
    const { fixture, el, type, button } = await render(3)
    const vatIn = el.querySelector<HTMLInputElement>('#wizardVatIn')!
    await type(vatIn, '120')
    expect(button('Übernehmen').disabled).toBe(true)

    await type(vatIn, '10')
    button('Übernehmen').click()
    await fixture.whenStable()
    expect(fixture.componentInstance.formData().taxInside).toBe(10)
  })
})
