import { describe, expect, it } from 'vitest'
import type { ProductSchema } from '@panary/products/domain'
import type { OrderLineItem } from '@panary/orders/data-access'
import { BundleFlow, BundleFlowCatalog } from './bundle-flow'

// Charakterisierungs-Specs: locken das aus order-dialog.component.ts extrahierte
// Verhalten (God-Component-Logik-Extraktion, Review-Stufe 3). Testdaten als
// Partial-Casts — die Klasse liest nur die hier gesetzten Felder.
const product = (p: Record<string, unknown>): ProductSchema => p as unknown as ProductSchema
const lineItem = (li: Record<string, unknown>): OrderLineItem => li as unknown as OrderLineItem

const catalog = (products: ProductSchema[] = []): BundleFlowCatalog => ({
  findProductById: id => products.find(p => p._id === id),
  findProductByExternalId: ext => products.find(p => p.externalId === ext),
  topicForProduct: () => 'Testgruppe',
})

describe('BundleFlow.isBundleProduct', () => {
  const flow = new BundleFlow(catalog())

  it('erkennt BUNDLE mit OptionGroups', () => {
    expect(flow.isBundleProduct(product({ productType: 'BUNDLE', optionGroups: [{ id: 'g1' }] }))).toBe(true)
  })

  it('BUNDLE ohne OptionGroups zählt nur mit Legacy-isMenu-Flag', () => {
    expect(flow.isBundleProduct(product({ productType: 'BUNDLE', optionGroups: [] }))).toBe(false)
    expect(flow.isBundleProduct(product({ productType: 'BUNDLE', isMenu: true }))).toBe(true)
  })

  it('normales PRODUCT ist kein Bundle', () => {
    expect(flow.isBundleProduct(product({ productType: 'PRODUCT' }))).toBe(false)
  })
})

describe('BundleFlow.getNextMandatoryGroup / pendingGroups / reset', () => {
  const bundle = product({
    productType: 'BUNDLE',
    optionGroups: [
      { id: 'optional-1', name: 'Dips', minSelections: 0 },
      { id: 'pflicht-1', name: 'Beilage', minSelections: 1 },
      { id: 'pflicht-2', name: 'Getränk', minSelections: 1 },
    ],
  })

  it('liefert Pflicht-Gruppen vor optionalen — unabhängig von der Array-Reihenfolge', () => {
    const flow = new BundleFlow(catalog())
    expect(flow.getNextMandatoryGroup(bundle)?.id).toBe('pflicht-1')
  })

  it('überspringt abgeschlossene Gruppen und fällt zuletzt auf optionale zurück', () => {
    const flow = new BundleFlow(catalog())
    flow.markCompleted('pflicht-1')
    expect(flow.getNextMandatoryGroup(bundle)?.id).toBe('pflicht-2')
    flow.markCompleted('pflicht-2')
    expect(flow.getNextMandatoryGroup(bundle)?.id).toBe('optional-1')
    flow.markCompleted('optional-1')
    expect(flow.getNextMandatoryGroup(bundle)).toBeNull()
  })

  it('reset() vergisst abgeschlossene Gruppen (neuer Bundle-Durchlauf)', () => {
    const flow = new BundleFlow(catalog())
    flow.markCompleted('pflicht-1')
    flow.reset()
    expect(flow.getNextMandatoryGroup(bundle)?.id).toBe('pflicht-1')
  })

  it('pendingGroups filtert abgeschlossene Gruppen', () => {
    const flow = new BundleFlow(catalog())
    flow.markCompleted('optional-1')
    expect(flow.pendingGroups(bundle).map(g => g.id)).toEqual(['pflicht-1', 'pflicht-2'])
  })

  it('Produkt ohne OptionGroups liefert null bzw. leere Liste', () => {
    const flow = new BundleFlow(catalog())
    expect(flow.getNextMandatoryGroup(product({}))).toBeNull()
    expect(flow.pendingGroups(product({}))).toEqual([])
  })
})

describe('BundleFlow.applyHighestPricingToGroup', () => {
  const mods = () => [
    { _id: 'a', topic: 'Soßen', price: 2 },
    { _id: 'b', topic: 'Soßen', price: 3 },
    { _id: 'x', topic: 'Extras', price: 9 },
  ]
  const soßen = [
    product({ _id: 'a', price: 2 }),
    product({ _id: 'b', price: 3 }),
    product({ _id: 'c', price: 5 }),
  ]

  it('nur der höchste Katalog-Aufpreis der Gruppe bleibt wirksam, andere Topics unberührt', () => {
    const flow = new BundleFlow(catalog(soßen))
    const li = lineItem({ modifiers: mods() })
    flow.applyHighestPricingToGroup(li, 'Soßen', 0)
    expect(li.modifiers.map(m => m.price)).toEqual([0, 3, 9])
  })

  it('freeQuantity nullt die ersten N in Auswahl-Reihenfolge', () => {
    const flow = new BundleFlow(catalog(soßen))
    const li = lineItem({ modifiers: mods() })
    flow.applyHighestPricingToGroup(li, 'Soßen', 1)
    // a ist Freimenge → 0; b ist einziger kostenpflichtiger → behält 3
    expect(li.modifiers.map(m => m.price)).toEqual([0, 3, 9])
    flow.applyHighestPricingToGroup(li, 'Soßen', 2)
    expect(li.modifiers.map(m => m.price)).toEqual([0, 0, 9])
  })

  it('bepreist ein zuvor genulltes Item wieder, wenn sich der Sieger verschiebt (Katalog-Quelle)', () => {
    const flow = new BundleFlow(catalog(soßen))
    const li = lineItem({ modifiers: mods() })
    flow.applyHighestPricingToGroup(li, 'Soßen', 0) // a → 0, b → 3
    li.modifiers.push({ _id: 'c', topic: 'Soßen', price: 5 } as OrderLineItem['modifiers'][number])
    flow.applyHighestPricingToGroup(li, 'Soßen', 0)
    expect(li.modifiers.map(m => m.price)).toEqual([0, 0, 9, 5])
    li.modifiers.splice(3, 1) // c entfernt → b muss seinen Katalogpreis zurückbekommen
    flow.applyHighestPricingToGroup(li, 'Soßen', 0)
    expect(li.modifiers.map(m => m.price)).toEqual([0, 3, 9])
  })

  it('fällt auf den Item-Preis zurück, wenn der Katalog-Lookup fehlt', () => {
    const flow = new BundleFlow(catalog([]))
    const li = lineItem({ modifiers: [{ _id: 'a', topic: 'Soßen', price: 2 }, { _id: 'b', topic: 'Soßen', price: 3 }] })
    flow.applyHighestPricingToGroup(li, 'Soßen', 0)
    expect(li.modifiers.map(m => m.price)).toEqual([0, 3])
  })
})

describe('BundleFlow.roleFromGroupName', () => {
  const flow = new BundleFlow(catalog())

  it('mappt Gruppennamen auf Bon-Rollen', () => {
    expect(flow.roleFromGroupName('Beilagen')).toBe('side')
    expect(flow.roleFromGroupName('Side Dishes')).toBe('side')
    expect(flow.roleFromGroupName('Getränke')).toBe('drink')
    expect(flow.roleFromGroupName('Getraenke')).toBe('drink')
    expect(flow.roleFromGroupName('Soßen')).toBe('sauce')
    expect(flow.roleFromGroupName('Dips')).toBe('sauce')
    expect(flow.roleFromGroupName('Extras')).toBe('extra')
    expect(flow.roleFromGroupName('')).toBe('extra')
  })
})

describe('BundleFlow.toGenericLineItem / toComponent', () => {
  const flow = new BundleFlow(catalog())

  it('setzt Defaults (amount 1, Steuern 19/7) und topic aus dem Katalog', () => {
    const item = flow.toGenericLineItem(product({ _id: 'p1', name: 'Pommes', price: 3.5 }))
    expect(item).toMatchObject({ _id: 'p1', amount: 1, price: 3.5, taxInside: 19, taxOutside: 7, topic: 'Testgruppe' })
  })

  it('toComponent führt den vollen Normalpreis und die Gruppen-Rolle', () => {
    const component = flow.toComponent(product({ _id: 'p1', name: 'Cola', price: 2.5 }), {
      id: 'g-drinks',
      name: 'Getränke',
    })
    expect(component).toMatchObject({ price: 2.5, optionGroupId: 'g-drinks', role: 'drink' })
  })
})

describe('BundleFlow.finalizeFixedBundle', () => {
  const flow = new BundleFlow(catalog())

  it('lässt Nicht-FIXED_PROPORTIONAL-Zeilen unangetastet', () => {
    const li = lineItem({ modifiers: [] })
    flow.finalizeFixedBundle(li, product({ bundlePricingMode: 'ROLLUP', price: 10 }))
    expect(li.components).toBeUndefined()
  })

  it('ergänzt das Hauptgericht mit mainPrice-Gewicht an erster Stelle', () => {
    const li = lineItem({
      components: [{ _id: 's', name: 'Pommes', amount: 1, price: 2, role: 'side' }],
      modifiers: [],
    })
    flow.finalizeFixedBundle(li, product({ bundlePricingMode: 'FIXED_PROPORTIONAL', price: 10, mainPrice: 6 }))
    expect(li.components?.[0]).toMatchObject({ role: 'main', price: 6, topic: 'main' })
    expect(li.components).toHaveLength(2)
  })

  it('nutzt ohne mainPrice den Restbetrag (Festpreis − Σ Komponenten) und bleibt idempotent', () => {
    const li = lineItem({
      components: [
        { _id: 's', name: 'Pommes', amount: 1, price: 2, role: 'side' },
        { _id: 'd', name: 'Cola', amount: 1, price: 3, role: 'drink' },
      ],
      modifiers: [],
    })
    const bundle = product({ bundlePricingMode: 'FIXED_PROPORTIONAL', price: 10 })
    flow.finalizeFixedBundle(li, bundle)
    expect(li.components?.[0]).toMatchObject({ role: 'main', price: 5 })
    flow.finalizeFixedBundle(li, bundle)
    expect(li.components?.filter(c => c.role === 'main')).toHaveLength(1)
  })
})
