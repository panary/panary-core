// core#1173: Der Produkt-Assistent läuft auf Signal Forms. Geprüft wird über das gerenderte Template der
// Eingabeschritte Name, Preis und eigenes Kürzel: Leere Eingaben sperren den Schritt, gültige landen im Produkt.
import { TestBed } from '@angular/core/testing'
import { describe, expect, it, vi } from 'vitest'

import { ApiService } from '../../core/api.service'
import { ProductWizardComponent } from './product-wizard'

async function render(step: number) {
  await TestBed.configureTestingModule({
    imports: [ProductWizardComponent],
    providers: [{ provide: ApiService, useValue: { find: vi.fn().mockResolvedValue({ data: [] }), create: vi.fn() } }],
  }).compileComponents()
  const fixture = TestBed.createComponent(ProductWizardComponent)
  fixture.componentInstance.currentStep.set(step)
  if (step === 6) fixture.componentInstance.showCustomAcronym.set(true)
  await fixture.whenStable()
  const el = fixture.nativeElement as HTMLElement
  async function type(field: HTMLInputElement, value: string) {
    field.value = value
    field.dispatchEvent(new Event('input'))
    await fixture.whenStable()
  }
  const arrow = () => [...el.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === '→')!
  return { fixture, el, type, arrow }
}

describe('ProductWizardComponent – Eingabeschritte', () => {
  it('Name: sperrt bei nur Leerzeichen und übernimmt den getippten per Enter', async () => {
    const { fixture, el, type, arrow } = await render(2)
    const name = el.querySelector<HTMLInputElement>('input[type="text"]')!
    await type(name, '  ')
    expect(arrow().disabled).toBe(true)

    await type(name, 'Cola')
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await fixture.whenStable()
    expect(fixture.componentInstance.form().name).toBe('Cola')
  })

  it('Preis: sperrt ein leeres Feld und übernimmt den getippten Preis', async () => {
    const { fixture, el, type, arrow } = await render(3)
    const price = el.querySelector<HTMLInputElement>('input[type="number"]')!
    await type(price, '')
    expect(arrow().disabled).toBe(true)

    await type(price, '2.5')
    arrow().click()
    await fixture.whenStable()
    expect(fixture.componentInstance.form().price).toBe(2.5)
  })

  it('Kürzel: sperrt ein leeres eigenes Kürzel und übernimmt das getippte', async () => {
    const { fixture, el, type, arrow } = await render(6)
    const acronym = el.querySelector<HTMLInputElement>('input[type="text"]')!
    expect(arrow().disabled).toBe(true)

    await type(acronym, 'K32')
    arrow().click()
    await fixture.whenStable()
    expect(fixture.componentInstance.form().acronym).toBe('K32')
  })
})
