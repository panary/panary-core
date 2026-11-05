// core#1173: Das Produktformular läuft auf Signal Forms, die Optionsgruppen als zweites Formular mit
// `applyEach`. Geprüft wird über das gerenderte Template: Pflichtfelder sperren das Speichern, eine Eingabe
// in einer Optionsgruppe landet im Patch, und Option hinzufügen/entfernen ersetzt die Gruppe unveränderlich.
import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { Router } from '@angular/router'
import { TranslateModule } from '@ngx-translate/core'
import { ConnectionService } from '@panary/shared/data-access'
import { describe, expect, it, vi } from 'vitest'

import { ApiService } from '../../core/api.service'
import { CloudManagedService } from '../../core/cloud-managed.service'
import { ProductFormComponent } from './product-form'

const PRODUCT = {
  _id: 'p-1',
  name: 'Burger-Menü',
  acronym: 'BM',
  price: 9.9,
  productType: 'BUNDLE',
  status: 'ACTIVE',
  optionGroups: [
    {
      id: 'og-1',
      name: 'Getränk',
      minSelections: 1,
      maxSelections: 1,
      freeQuantity: 0,
      options: [{ productId: 'cola', priceAdjustment: 0 }],
    },
  ],
}

async function render(id: string) {
  const api = {
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    get: vi.fn().mockResolvedValue(structuredClone(PRODUCT)),
    patch: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({ _id: 'p-new' }),
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
    imports: [ProductFormComponent, TranslateModule.forRoot()],
    providers: [
      CloudManagedService,
      { provide: ApiService, useValue: api },
      { provide: ConnectionService, useValue: connection },
      { provide: Router, useValue: { navigate: vi.fn() } },
    ],
  }).compileComponents()
  const fixture = TestBed.createComponent(ProductFormComponent)
  fixture.componentRef.setInput('id', id)
  // Zoneless wartet `whenStable` nicht auf die Mock-Promises der Ladekette.
  async function settle() {
    for (let i = 0; i < 3; i++) {
      await new Promise(resolve => setTimeout(resolve))
      await fixture.whenStable()
    }
  }
  await settle()
  const el = fixture.nativeElement as HTMLElement
  async function type(selector: string, value: string) {
    const field = el.querySelector<HTMLInputElement>(selector)!
    field.value = value
    field.dispatchEvent(new Event('input'))
    await fixture.whenStable()
  }
  async function submit() {
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await settle()
  }
  const saveButton = () => el.querySelector<HTMLButtonElement>('button[type="submit"]')!
  return { fixture, el, api, type, submit, saveButton }
}

describe('ProductFormComponent – Formular', () => {
  it('Neuanlage: sperrt ohne Name und Kürzel', async () => {
    const { type, saveButton } = await render('new')
    expect(saveButton().disabled).toBe(true)

    await type('#productName', 'Cola')
    expect(saveButton().disabled).toBe(true)

    await type('#productAcronym', 'CO')
    expect(saveButton().disabled).toBe(false)
  })

  it('sperrt einen leeren oder negativen Preis', async () => {
    const { type, saveButton } = await render('p-1')
    expect(saveButton().disabled).toBe(false)

    await type('#productPrice', '')
    expect(saveButton().disabled).toBe(true)

    await type('#productPrice', '-1')
    expect(saveButton().disabled).toBe(true)
  })

  it('meldet „Speichern und weiter" bei ungültigem Preis als gescheitert', async () => {
    const { fixture, type, api } = await render('p-1')
    await type('#productPrice', '')

    expect(await fixture.componentInstance.saveAndContinue()).toBe(false)
    expect(api.patch).not.toHaveBeenCalled()
  })

  it('sperrt eine Höchstauswahl unter 1 in einer Optionsgruppe', async () => {
    const { type, saveButton } = await render('p-1')
    await type('#optGroupMax-0', '0')
    expect(saveButton().disabled).toBe(true)
  })

  // core#1320: Der Name war mit „*“ beschriftet, sperrte aber nicht; beim Speichern fiel die Gruppe
  // dann samt ihrer Optionen still weg.
  it('sperrt eine Optionsgruppe mit leerem oder nur aus Leerzeichen bestehendem Namen', async () => {
    const { type, saveButton } = await render('p-1')
    expect(saveButton().disabled).toBe(false)

    await type('#optGroupName-0', '')
    expect(saveButton().disabled).toBe(true)

    await type('#optGroupName-0', '   ')
    expect(saveButton().disabled).toBe(true)

    await type('#optGroupName-0', 'Getränk')
    expect(saveButton().disabled).toBe(false)
  })

  it('verwirft eine neue, unbenannte Gruppe nicht still, sondern speichert gar nicht', async () => {
    const { fixture, api } = await render('p-1')
    fixture.componentInstance.addGroup()
    await fixture.whenStable()

    expect(await fixture.componentInstance.saveAndContinue()).toBe(false)
    expect(api.patch).not.toHaveBeenCalled()
  })

  it('schickt Änderungen aus Kopf und Optionsgruppe im Patch', async () => {
    const { type, submit, api } = await render('p-1')
    await type('#productName', 'Burger-Menü XL')
    await type('#optGroupName-0', 'Getränk (0,5 l)')
    await type('#optGroupMax-0', '2')
    await submit()

    const body = api.patch.mock.calls[0][2]
    expect(body.name).toBe('Burger-Menü XL')
    expect(body.optionGroups[0]).toEqual(
      expect.objectContaining({ id: 'og-1', name: 'Getränk (0,5 l)', minSelections: 1, maxSelections: 2 }),
    )
  })

  it('ersetzt die Gruppe beim Hinzufügen einer Option, statt sie zu mutieren', async () => {
    const { fixture } = await render('p-1')
    const component = fixture.componentInstance
    const before = component.optionGroups()[0]

    component.addOption(before)

    const after = component.optionGroups()[0]
    expect(after).not.toBe(before)
    expect(before.options).toHaveLength(1)
    expect(after.options).toHaveLength(2)
  })
})
