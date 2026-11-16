// core#1173: Das Produktformular läuft auf Signal Forms, die Optionsgruppen als zweites Formular mit
// `applyEach`. Geprüft wird über das gerenderte Template: Pflichtfelder sperren das Speichern, eine Eingabe
// in einer Optionsgruppe landet im Patch, und Option hinzufügen/entfernen ersetzt die Gruppe unveränderlich.
import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { Router } from '@angular/router'
import { addFormats, Ajv } from '@feathersjs/schema'
import { TranslateModule } from '@ngx-translate/core'
import { productQuerySchema } from '@panary/products/domain'
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
  /** Antwort von `find('product-groups')`. */
  productGroups?: Array<Record<string, unknown>>
  /** `find('products')` scheitert, wie wenn der Edge die Anfrage mit 400 ablehnt (core#1485). */
  failCatalog?: boolean
}

async function render(id: string, options: RenderOptions = {}) {
  const catalog = options.catalog ?? []
  const api = {
    find: vi.fn().mockImplementation(async (path: string) => {
      if (path === 'products') {
        if (options.failCatalog) throw new Error('400 Bad Request')
        return { data: catalog, total: catalog.length }
      }
      if (path === 'product-groups' && options.productGroups) {
        return { data: options.productGroups, total: options.productGroups.length }
      }
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

// core#1459: Die Kasse liest `priceAdjustment` an Optionen nicht. Das Feld „+€“ ist aus dem Formular entfernt; ein
// gespeicherter Wert bleibt unsichtbar in den Daten und übersteht Laden und Speichern.
describe('ProductFormComponent – kein Aufpreis an Optionen (core#1459)', () => {
  const withAdjustment = (priceAdjustment: number) => ({
    ...PRODUCT,
    optionGroups: [{ ...PRODUCT.optionGroups[0], options: [{ productId: 'cola', priceAdjustment, isDefault: false }] }],
  })

  it('zeigt an den Optionen kein Aufpreis-Feld', async () => {
    const { el } = await render('p-1', { product: withAdjustment(0.6) })
    const row = el.querySelector('app-searchable-select')!.closest('div.flex')!
    expect(row.querySelector('input[type="number"]')).toBeNull()
    expect(row.textContent).not.toContain('+€')
  })

  it('speichert einen vorhandenen Aufpreis unverändert mit', async () => {
    const { type, submit, api } = await render('p-1', { product: withAdjustment(0.6) })
    await type('#optGroupName-0', 'Getränk (0,5 l)')
    await submit()

    expect(api.patch.mock.calls[0][2].optionGroups[0].options).toEqual([{ productId: 'cola', priceAdjustment: 0.6 }])
  })

  it('schreibt an einer neuen Option keinen Aufpreis', async () => {
    const { fixture, submit, api } = await render('p-1')
    const component = fixture.componentInstance
    component.addOption(component.optionGroups()[0])
    component.optionGroups.update(groups =>
      groups.map(g => ({
        ...g,
        options: g.options.map(o => (o.productId ? o : { ...o, productId: 'kuchen' })),
      })),
    )
    await submit()

    expect(api.patch.mock.calls[0][2].optionGroups[0].options).toEqual([{ productId: 'cola' }, { productId: 'kuchen' }])
  })

  it('überträgt beim Kopieren der Gruppen eines Produkts keinen Aufpreis', async () => {
    const { fixture, submit, api } = await render('p-1', { product: withAdjustment(1.5) })
    await fixture.componentInstance.copyGroupsFromProduct('p-1')
    await submit()

    const groups = api.patch.mock.calls[0][2].optionGroups
    expect(groups).toHaveLength(2)
    expect(groups[0].options).toEqual([{ productId: 'cola', priceAdjustment: 1.5 }])
    expect(groups[1].options).toEqual([{ productId: 'cola' }])
  })
})

// core#1461: Das Formular schrieb `optionGroups` aus den bekannten Feldern neu und verlor dabei `pricingMode`
// (Kasse: nur der teuerste Artikel zählt), `uiMode` und `priceOverride`. Es reicht alles durch, was es nicht kennt.
describe('ProductFormComponent – Gruppenfelder bleiben erhalten (core#1461)', () => {
  const EXTRAS = {
    ...PRODUCT,
    optionGroups: [
      {
        id: 'og-1',
        name: 'Bleche',
        minSelections: 1,
        maxSelections: 3,
        freeQuantity: 0,
        pricingMode: 'HIGHEST',
        uiMode: 'LIST',
        futureFlag: true,
        options: [
          { productId: 'cola', priceOverride: 3, futureOptionFlag: 'x' },
          { productId: 'kuchen', isDefault: true, priceAdjustment: 0.6 },
        ],
      },
    ],
  }

  it('schickt nach einer Namensänderung alle Felder der Gruppe und ihrer Optionen unverändert mit', async () => {
    const { type, submit, api } = await render('p-1', { product: EXTRAS })
    await type('#optGroupName-0', 'Pizzableche')
    await submit()

    expect(api.patch.mock.calls[0][2].optionGroups).toStrictEqual([
      {
        id: 'og-1',
        name: 'Pizzableche',
        minSelections: 1,
        maxSelections: 3,
        freeQuantity: 0,
        pricingMode: 'HIGHEST',
        uiMode: 'LIST',
        futureFlag: true,
        options: [
          { productId: 'cola', priceOverride: 3, futureOptionFlag: 'x' },
          { productId: 'kuchen', isDefault: true, priceAdjustment: 0.6 },
        ],
      },
    ])
  })

  it('erfindet an einer Gruppe ohne diese Felder keine', async () => {
    const { submit, api } = await render('p-1')
    await submit()

    const [group] = api.patch.mock.calls[0][2].optionGroups
    expect(group).not.toHaveProperty('pricingMode')
    expect(group).not.toHaveProperty('uiMode')
    expect(group.options[0]).not.toHaveProperty('priceOverride')
  })

  // Bleibt grün, auch wenn die Zusatzfelder aus dem Hash fielen: `objectHash` sieht verschachtelte Felder heute gar
  // nicht (core#1477). Der Test hält nur fest, dass die Zusatzfelder keine Dirty-Meldung auslösen.
  it('wertet ein Produkt unverändert geöffnet nicht als geändert', async () => {
    const { fixture } = await render('p-1', { product: EXTRAS })
    expect(fixture.componentInstance.isDirty()).toBe(false)
  })

  it('kopiert Preis- und Anzeigemodus der Quelle in eine neue Gruppe, aber keinen Preis an den Optionen', async () => {
    const { fixture, submit, api } = await render('p-1', { product: EXTRAS })
    await fixture.componentInstance.copyGroupsFromProduct('p-1')
    await submit()

    const [original, copy] = api.patch.mock.calls[0][2].optionGroups
    expect(copy.id).not.toBe(original.id)
    expect(copy).toEqual(expect.objectContaining({ pricingMode: 'HIGHEST', uiMode: 'LIST', name: 'Bleche' }))
    expect(copy.options[0]).not.toHaveProperty('priceOverride')
    expect(copy.options[0]).not.toHaveProperty('futureOptionFlag')
  })

  // Die Schlüssel des Formulars gelten, nicht die geladenen: ein abgehaktes „Standard“ und ein auf 0 gesetzter
  // Aufpreis dürfen nicht über die Grundlage zurückkehren.
  it('schreibt ein abgehaktes Standard und einen auf 0 gesetzten Aufpreis nicht wieder zurück', async () => {
    const { fixture, submit, api } = await render('p-1', { product: EXTRAS })
    fixture.componentInstance.optionGroups.update(groups =>
      groups.map(g => ({ ...g, options: g.options.map(o => ({ ...o, isDefault: false, priceAdjustment: 0 })) })),
    )
    await submit()

    const [, kuchen] = api.patch.mock.calls[0][2].optionGroups[0].options
    expect(kuchen).not.toHaveProperty('isDefault')
    expect(kuchen).not.toHaveProperty('priceAdjustment')
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

  // Ohne geladene Übersetzungen zeigt das Template nur Schlüssel; die aufgelösten Namen prüft die Ableitung selbst.
  it('löst Gruppe, Option und Satz für den Hinweistext auf', async () => {
    const { fixture, type } = await renderMenu('Extras', 'kuchen')
    expect(fixture.componentInstance.taxHints()).toEqual([
      expect.objectContaining({
        group: 'Extras',
        product: 'Kuchen',
        finding: expect.objectContaining({ code: 'EXTRA_GROUP_RATE_DIFFERS', groupId: 'og-1', productId: 'kuchen' }),
      }),
    ])

    await type('#productTaxInside', '16')
    const rate = fixture.componentInstance.taxHints().find(h => h.finding.code === 'RATE_NOT_IN_LOCATION')
    expect(rate).toEqual(
      expect.objectContaining({ product: 'Burger-Menü', group: '', finding: expect.objectContaining({ rate: 16 }) }),
    )
  })

  // Das Formular bearbeitet `mainPrice` und den Preismodus der Gruppen nicht; es muss die geladenen Werte behalten.
  describe('Festpreis-Menü', () => {
    const fixedMenu = (extra: Record<string, unknown>) => ({
      ...menu('Getränk', 'cola'),
      productType: 'BUNDLE',
      bundlePricingMode: 'FIXED_PROPORTIONAL',
      ...extra,
    })
    const codes = (fixture: { componentInstance: { taxHints: () => Array<{ finding: { code: string } }> } }) =>
      fixture.componentInstance.taxHints().map(h => h.finding.code)

    it('meldet ein Hauptgericht ohne Anteil, wenn mainPrice 0 geladen wurde', async () => {
      const { fixture } = await render('p-1', {
        product: fixedMenu({ mainPrice: 0 }),
        catalog: CATALOG,
        taxSettings: TAX_SETTINGS,
      })
      expect(codes(fixture)).toEqual(['MAIN_WITHOUT_SHARE'])
    })

    it('meldet den fehlenden mainPrice als Hinweis, solange der Festpreis nicht erreicht wird', async () => {
      const { fixture } = await render('p-1', {
        product: fixedMenu({}),
        catalog: CATALOG,
        taxSettings: TAX_SETTINGS,
      })
      expect(codes(fixture)).toEqual(['MAIN_PRICE_MISSING'])
    })

    it('prüft Regeln 3 und 4 nur bei Festpreis, nicht bei Rollup', async () => {
      const { fixture } = await render('p-1', {
        product: fixedMenu({ bundlePricingMode: 'ROLLUP', mainPrice: 0 }),
        catalog: CATALOG,
        taxSettings: TAX_SETTINGS,
      })
      expect(codes(fixture)).toEqual([])
    })

    it('behält den geladenen Preismodus der Gruppe: HIGHEST empfiehlt die eigene Gruppe statt Beilage/Getränk', async () => {
      const withMode = (pricingMode?: string) => {
        const m = menu('Extras', 'kuchen')
        return { ...m, optionGroups: [{ ...m.optionGroups[0], ...(pricingMode ? { pricingMode } : {}) }] }
      }
      const sum = await render('p-1', { product: withMode(), catalog: CATALOG, taxSettings: TAX_SETTINGS })
      expect(sum.fixture.componentInstance.taxHints()[0].finding.recommendation).toBe('GROUP_AS_SIDE_OR_DRINK')
      TestBed.resetTestingModule()
      const highest = await render('p-1', {
        product: withMode('HIGHEST'),
        catalog: CATALOG,
        taxSettings: TAX_SETTINGS,
      })
      expect(highest.fixture.componentInstance.taxHints()[0].finding.recommendation).toBe(
        'MOVE_OPTION_TO_OWN_SIDE_OR_DRINK_GROUP',
      )
    })
  })

  // Die Hinweise gelten Menüs. Ein einfaches Produkt mit fremdem Satz zeigt sie nicht.
  it('zeigt ohne Optionsgruppen keinen Block, auch bei einem Satz, den die Filiale nicht kennt', async () => {
    const { el } = await render('p-1', {
      product: { ...menu('Getränk', 'cola'), taxInside: 16, optionGroups: [] },
      catalog: CATALOG,
      taxSettings: TAX_SETTINGS,
    })
    expect(hints(el)).toBeNull()
  })

  it('lässt Regel 5 ohne geladene Filiale aus, statt jeden Satz zu bemängeln', async () => {
    const { el } = await render('p-1', { product: menu('Getränk', 'cola'), catalog: CATALOG })
    expect(hints(el)).toBeNull()
  })
})

describe('ProductFormComponent – Katalog laden (core#1485)', () => {
  const GROUPS = [{ _id: 'pg-1', name: 'Getränke' }]
  const MENU = {
    ...PRODUCT,
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

  // Der Edge validiert jede Anfrage gegen `productQuerySchema` (querySyntax, additionalProperties: false) und
  // lehnt ein unbekanntes `$select`-Feld mit 400 ab. Die Mocks der übrigen Specs sehen das nicht: Dieser Test
  // prüft die Anfrage des Formulars deshalb gegen dasselbe Schema und dieselbe AJV-Konfiguration wie der Edge.
  it('fragt `products` nur mit Feldern, die das Query-Schema des Edge kennt', async () => {
    const validate = addFormats(new Ajv({ coerceTypes: true }), ['uuid', 'date-time']).compile(productQuerySchema)
    const { api } = await render('p-1', { product: MENU })
    const queries = api.find.mock.calls.filter(([path]) => path === 'products').map(([, params]) => params)
    expect(queries.length).toBeGreaterThan(0)
    for (const query of queries) {
      expect(validate(query), JSON.stringify([query, validate.errors])).toBe(true)
    }
  })

  it('lädt die Produktgruppen weiter, wenn die Produktliste scheitert', async () => {
    const { fixture } = await render('p-1', { product: MENU, productGroups: GROUPS, failCatalog: true })
    expect(fixture.componentInstance.productGroups()).toEqual(GROUPS)
  })

  it('meldet den Ladefehler im Formular, statt jede Option als „nicht auflösbar“ zu melden', async () => {
    const { el } = await render('p-1', { product: MENU, failCatalog: true })
    expect(el.querySelector('[data-testid="catalog-load-failed"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="tax-hints"]')).toBeNull()
  })

  it('zeigt keinen Ladefehler, wenn die Produktliste kommt', async () => {
    const { el } = await render('p-1', { product: MENU })
    expect(el.querySelector('[data-testid="catalog-load-failed"]')).toBeNull()
  })
})
