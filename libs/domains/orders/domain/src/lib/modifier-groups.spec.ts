import { describe, expect, it } from 'vitest'

import { groupModifiersByComponent, hasComponentModifiers } from './modifier-groups'
import type { LineComponent, OrderLineItem } from './order.schema'

const item = (externalId: string) => ({
  _id: externalId,
  externalId,
  name: externalId,
  amount: 1,
  price: 1,
  topic: '',
  taxInside: 19,
  taxOutside: 7,
  recipeReferences: [],
  ingredientReferences: [],
})

const mod = (name: string, componentExternalId?: string) =>
  ({ ...item(name), ...(componentExternalId ? { componentExternalId } : {}) }) as OrderLineItem['modifiers'][number]

const component = (externalId: string, role: LineComponent['role']): LineComponent => ({ ...item(externalId), role })

const names = (mods: { name: string }[]) => mods.map(m => m.name)

describe('groupModifiersByComponent (#1127)', () => {
  it('ordnet Modifier Beilage und Getränk zu, der Rest bleibt am Hauptartikel', () => {
    const groups = groupModifiersByComponent({
      menuSideDish: item('pommes'),
      menuDrink: item('cola'),
      modifiers: [mod('bacon'), mod('mayo', 'pommes'), mod('eis', 'cola'), mod('ketchup', 'pommes')],
    })
    expect(names(groups.main)).toEqual(['bacon'])
    expect(names(groups.sideDish)).toEqual(['mayo', 'ketchup'])
    expect(names(groups.drink)).toEqual(['eis'])
    expect(groups.components).toEqual([])
    expect(hasComponentModifiers(groups)).toBe(true)
  })

  it('lässt eine Bestandszeile ohne Zuordnung unverändert am Hauptartikel', () => {
    const groups = groupModifiersByComponent({
      menuSideDish: item('pommes'),
      modifiers: [mod('bacon'), mod('mayo')],
    })
    expect(names(groups.main)).toEqual(['bacon', 'mayo'])
    expect(hasComponentModifiers(groups)).toBe(false)
  })

  it('fällt bei einer unbekannten Referenz auf den Hauptartikel zurück', () => {
    const groups = groupModifiersByComponent({ menuSideDish: item('pommes'), modifiers: [mod('mayo', 'salat')] })
    expect(names(groups.main)).toEqual(['mayo'])
    expect(groups.sideDish).toEqual([])
  })

  it('löst Beilage zuerst über den Legacy-Slot auf, auch wenn sie in components[] steht (FIXED_PROPORTIONAL)', () => {
    const groups = groupModifiersByComponent({
      menuSideDish: item('pommes'),
      components: [component('pommes', 'side'), component('burger', 'main')],
      modifiers: [mod('mayo', 'pommes')],
    })
    expect(names(groups.sideDish)).toEqual(['mayo'])
    expect(groups.components).toEqual([])
  })

  it('gruppiert reine components[]-Komponenten in deren Reihenfolge', () => {
    const groups = groupModifiersByComponent({
      components: [component('salat', 'extra'), component('nuggets', 'side')],
      modifiers: [mod('dressing', 'salat'), mod('bbq', 'nuggets'), mod('senf', 'nuggets')],
    })
    expect(groups.components.map(g => [g.component.externalId, names(g.modifiers)])).toEqual([
      ['salat', ['dressing']],
      ['nuggets', ['bbq', 'senf']],
    ])
    expect(groups.main).toEqual([])
  })

  it('ordnet nie dem Hauptgericht aus components[] zu — das ist der Hauptartikel', () => {
    const groups = groupModifiersByComponent({
      components: [component('burger', 'main')],
      modifiers: [mod('bacon', 'burger')],
    })
    expect(names(groups.main)).toEqual(['bacon'])
    expect(groups.components).toEqual([])
  })

  it('zählt components[]-Modifier zum Hauptartikel, wenn der Leser components[] nicht ausgibt', () => {
    const groups = groupModifiersByComponent(
      {
        menuSideDish: item('pommes'),
        components: [component('salat', 'extra')],
        modifiers: [mod('bacon'), mod('dressing', 'salat'), mod('mayo', 'pommes')],
      },
      { components: false },
    )
    expect(names(groups.main)).toEqual(['bacon', 'dressing'])
    expect(names(groups.sideDish)).toEqual(['mayo'])
    expect(groups.components).toEqual([])
  })

  it('verliert keinen Modifier und kommt ohne Modifier-Array aus', () => {
    expect(groupModifiersByComponent({ modifiers: undefined as never })).toEqual({
      main: [],
      sideDish: [],
      drink: [],
      components: [],
    })
  })
})
