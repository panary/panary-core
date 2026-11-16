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

interface RenderOptions {
  product?: Record<string, unknown>
  /** Antwort von `find('products')`: der Katalog für den Options-Picker und die Steuerprüfung. */
  catalog?: Array<Record<string, unknown>>
  /** `settings.taxSettings` der einzigen Filiale; ohne Angabe gibt es keine Filiale. */
  taxSettings?: Record<string, { taxRate: number; name: string }>
}

async function render(id: string, options: RenderOptions = {}) {
  const catalog = options.catalog ?? []
  const api = {
    find: vi.fn().mockImplementation(async (path: string) => {
      if (path === 'products') return { data: catalog, total: catalog.length }
      if (path === 'locations' && options.taxSettings) {
        return { data: [{ _id: 'loc-1', settings: { taxSettings: options.taxSettings } }], total: 1 }
      }
      return { data: [], total: 0 }
    }),
    get: vi.fn().mockResolvedValue(structuredClone(options.product ?? PRODUCT)),
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

  it('zeigt am Feld und im Gruppenkopf, warum Speichern gesperrt ist', async () => {
    const { el, type } = await render('p-1')
    const hint = () => el.querySelector('[data-testid="opt-group-name-error-0"]')
    const header = () => el.querySelector('[data-testid="opt-group-title-0"]')!
    expect(hint()).toBeNull()
    expect(header().classList.contains('text-red-500')).toBe(false)

    await type('#optGroupName-0', ' ')
    expect(hint()?.textContent?.trim()).toBe('PRODUCTS.GROUP_NAME_REQUIRED')
    expect(header().classList.contains('text-red-500')).toBe(true)
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

  // core#1337: Ohne die neue ID blieb das Panel auf „Neu“ stehen, und das nächste Produkt hing an die Werte an.
  it('meldet nach dem Anlegen die neue ID an die Liste', async () => {
    const { fixture, api, type, submit } = await render('new')
    fixture.componentRef.setInput('panelMode', true)
    const emitted: unknown[] = []
    fixture.componentInstance.saved.subscribe(value => emitted.push(value))

    await type('#productName', 'Cola')
    await type('#productAcronym', 'CO')
    await type('#productPrice', '3')
    await submit()

    expect(api.create).toHaveBeenCalledTimes(1)
    expect(emitted).toEqual(['p-new'])
  })

  it('meldet beim Ändern eines bestehenden Produkts keine ID', async () => {
    const { fixture, submit } = await render('p-1')
    fixture.componentRef.setInput('panelMode', true)
    const emitted: unknown[] = []
    fixture.componentInstance.saved.subscribe(value => emitted.push(value))

    await submit()

    expect(emitted).toEqual([undefined])
  })
})

// core#1456: Dieselbe Prüfung wie im Cloud-Katalog (`checkMenuTax`), im Produktformular des Edge-Admins. Sie
// rechnet über den Formularstand und blockiert nie das Speichern.
describe('ProductFormComponent – Steuer-Hinweise (core#1456)', () => {
  const TAX_SETTINGS = { A: { taxRate: 19, name: 'Normal' }, B: { taxRate: 7, name: 'Ermäßigt' } }
  const CATALOG = [
    {
      _id: 'cola',
      name: 'Cola',
      acronym: 'CO',
      productType: 'PRODUCT',
      categoryIds: [],
      price: 0,
      taxInside: 19,
      taxOutside: 7,
    },
    {
      _id: 'kuchen',
      name: 'Kuchen',
      acronym: 'KU',
      productType: 'PRODUCT',
      categoryIds: [],
      price: 2,
      taxInside: 7,
      taxOutside: 7,
    },
  ]
  const menu = (groupName: string, productId: string) => ({
    ...PRODUCT,
    taxInside: 19,
    taxOutside: 7,
    optionGroups: [
      {
        id: 'og-1',
        name: groupName,
        minSelections: 1,
        maxSelections: 1,
        freeQuantity: 0,
        options: [{ productId, priceAdjustment: 0 }],
      },
    ],
  })
  const renderMenu = (groupName: string, productId: string) =>
    render('p-1', { product: menu(groupName, productId), catalog: CATALOG, taxSettings: TAX_SETTINGS })
  const hints = (el: HTMLElement) => el.querySelector('[data-testid="tax-hints"]')
  const hintCodes = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('[data-testid^="tax-hint-"]')).map(n => n.getAttribute('data-testid'))

  it('zeigt ohne Befund keinen Block', async () => {
    const { el } = await renderMenu('Getränk', 'cola')
    expect(hints(el)).toBeNull()
  })

  it('zeigt eine Warnung zum Extra mit abweichendem Satz, mit Gruppe, Option und Empfehlung', async () => {
    const { el } = await renderMenu('Extras', 'kuchen')
    expect(hints(el)).not.toBeNull()
    expect(hintCodes(el)).toEqual(['tax-hint-EXTRA_GROUP_RATE_DIFFERS'])
    const hint = el.querySelector('[data-testid="tax-hint-EXTRA_GROUP_RATE_DIFFERS"]')!
    expect(hint.getAttribute('data-severity')).toBe('warnung')
    // Ohne geladene Übersetzungen zeigt das Template die Schlüssel; die Namen reisen als Parameter mit.
    expect(hint.textContent).toContain('PRODUCTS.TAX_FINDING.EXTRA_GROUP_RATE_DIFFERS')
    expect(hint.textContent).toContain('PRODUCTS.TAX_RECOMMENDATION.GROUP_AS_SIDE_OR_DRINK')
  })

  it('nimmt den Block zurück, sobald die Gruppe zur Beilage wird, und bringt ihn mit dem Namen zurück', async () => {
    const { el, type } = await renderMenu('Extras', 'kuchen')
    expect(hints(el)).not.toBeNull()

    await type('#optGroupName-0', 'Beilage')
    expect(hints(el)).toBeNull()

    await type('#optGroupName-0', 'Extras')
    expect(hints(el)).not.toBeNull()
  })

  it('prüft den Satz des Menüs gegen die Filiale und reagiert auf die Eingabe', async () => {
    const { el, type } = await renderMenu('Getränk', 'cola')
    await type('#productTaxInside', '16')
    expect(hintCodes(el)).toContain('tax-hint-RATE_NOT_IN_LOCATION')

    await type('#productTaxInside', '19')
    expect(hints(el)).toBeNull()
  })

  it('lässt das Speichern trotz Warnung zu', async () => {
    const { el, saveButton, submit, api } = await renderMenu('Extras', 'kuchen')
    expect(hints(el)).not.toBeNull()
    expect(saveButton().disabled).toBe(false)

    await submit()
    expect(api.patch).toHaveBeenCalledTimes(1)
  })

  it('lässt Regel 5 ohne geladene Filiale aus, statt jeden Satz zu bemängeln', async () => {
    const { el } = await render('p-1', { product: menu('Getränk', 'cola'), catalog: CATALOG })
    expect(hints(el)).toBeNull()
  })
})
