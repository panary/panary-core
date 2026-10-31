import '@angular/compiler'
import { describe, expect, it } from 'vitest'
import type { ModifierLineItem, OrderLineItem } from '@panary/orders/domain'
import { buildHistoryLineVm } from './history-line'

const SIDE = '01a19000-0000-7000-8000-000000000001'
const DRINK = '01a19000-0000-7000-8000-000000000002'

function mod(partial: Partial<ModifierLineItem>): ModifierLineItem {
  return { _id: 'm', name: 'Extra', price: 0, amount: 1, ...partial } as ModifierLineItem
}

function line(partial: Partial<OrderLineItem>): OrderLineItem {
  return { _id: 'l', name: 'Burger', price: 10, amount: 1, modifiers: [], ...partial } as OrderLineItem
}

// core#1235: Die Historie zeigt Extras bei der Komponente, zu der sie gehören (wie „Offen“ und Warenkorb).
describe('buildHistoryLineVm (core#1235)', () => {
  const menu = line({
    isMenu: true,
    menuSideDish: { externalId: SIDE, name: 'Pommes' },
    menuDrink: { externalId: DRINK, name: 'Cola' },
    modifiers: [
      mod({ _id: 'bacon', name: 'Bacon', price: 1 }),
      mod({ _id: 'mayo', name: 'Mayonaise', price: 0.7, componentExternalId: SIDE }),
      mod({ _id: 'zitrone', name: 'Zitrone', price: 0, componentExternalId: DRINK }),
    ],
  } as Partial<OrderLineItem>)

  it('ordnet Extras Hauptartikel, Beilage und Getränk zu', () => {
    const vm = buildHistoryLineVm(menu)
    expect(vm.modifiers.map(m => m.name)).toEqual(['Bacon'])
    expect(vm.sideDishModifiers.map(m => m.name)).toEqual(['Mayonaise'])
    expect(vm.drinkModifiers.map(m => m.name)).toEqual(['Zitrone'])
  })

  it('zeigt den gespeicherten Betrag, bei 0 keinen', () => {
    const vm = buildHistoryLineVm(menu)
    expect(vm.sideDishModifiers[0].price).toBe(0.7)
    expect(vm.drinkModifiers[0].price).toBeNull()
  })

  it('lässt Extras ohne Zuordnung am Hauptartikel (Bestandsbestellung)', () => {
    const vm = buildHistoryLineVm(line({ modifiers: [mod({ name: 'Mayonaise', price: 0.7 })] }))
    expect(vm.modifiers.map(m => m.name)).toEqual(['Mayonaise'])
    expect(vm.sideDishModifiers).toEqual([])
  })

  it('führt eine abgewählte Zutat und einen Minus-Marker als „ohne“, nicht als „+“', () => {
    const vm = buildHistoryLineVm(
      line({
        modifiers: [mod({ _id: 'a', name: 'Ohne Zwiebeln' }), mod({ _id: 'b', name: 'Käse', amount: -1 })],
      }),
    )
    expect(vm.modifiers.map(m => [m.kind, m.name])).toEqual([
      ['removed', 'Zwiebeln'],
      ['without', 'Käse'],
    ])
  })

  it('zeigt die Menge eines Extras (+ 2x Name) und bei Je-Stück-Modifiern für alle Stück', () => {
    expect(buildHistoryLineVm(line({ modifiers: [mod({ amount: 2 })] })).modifiers[0].amount).toBe(2)
    const perUnit = buildHistoryLineVm(
      line({ amount: 3, modifierScope: 'unit', modifiers: [mod({ amount: 1, price: 0.7 })] } as Partial<OrderLineItem>),
    )
    expect(perUnit.modifiers[0].amount).toBe(3)
    expect(perUnit.modifiers[0].price).toBeCloseTo(2.1)
  })
  it('lässt Extras einer reinen components[]-Komponente am Hauptartikel statt sie zu verlieren', () => {
    const X = '01a19000-0000-7000-8000-000000000003'
    const vm = buildHistoryLineVm(
      line({
        components: [{ externalId: X, role: 'side', name: 'Salat' }],
        modifiers: [mod({ name: 'Dressing', componentExternalId: X })],
      } as Partial<OrderLineItem>),
    )
    expect(vm.modifiers.map(m => m.name)).toEqual(['Dressing'])
  })

  it('zeigt den Betrag einer abgewählten Zutat mit Abzug, den eines Minus-Markers nicht', () => {
    const vm = buildHistoryLineVm(
      line({
        modifiers: [
          mod({ _id: 'a', name: 'Ohne Zwiebeln', price: -0.5 }),
          mod({ _id: 'b', name: 'Käse', amount: -1, price: 0.3 }),
        ],
      }),
    )
    expect(vm.modifiers[0].price).toBe(-0.5)
    expect(vm.modifiers[1].price).toBeNull()
    expect(vm.modifiers[1].amount).toBe(1)
  })
})
