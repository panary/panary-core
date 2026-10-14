import { describe, expect, it } from 'vitest'

import { isMergeableLine, isSplittableLine, lineConfigKey, mergeIdenticalLines, splitOffPieces } from './line-identity'
import type { OrderLineItem } from './order.schema'

/**
 * Use-Cases aus panary/panary-core#699 (Nummern wie im Issue). B = Burger 8,00,
 * K = Extra Käse +1,00, oK = Ohne Ketchup −0,30.
 */
const mod = (id: string, over: Partial<OrderLineItem['modifiers'][number]> = {}) =>
  ({
    _id: id,
    externalId: id,
    name: id,
    amount: 1,
    price: 1,
    topic: 'Extras',
    taxInside: 19,
    taxOutside: 7,
    recipeReferences: [],
    ingredientReferences: [],
    ...over,
  }) as OrderLineItem['modifiers'][number]

const burger = (over: Partial<OrderLineItem> = {}): OrderLineItem =>
  ({
    _id: `line-${Math.random()}`,
    externalId: 'burger',
    name: 'Burger',
    amount: 1,
    price: 8,
    taxInside: 19,
    taxOutside: 7,
    topic: 'Burger',
    productGroupExternalId: 'grp',
    bundleNumber: null,
    modifiers: [],
    recipeReferences: [],
    ingredientReferences: [],
    ...over,
  }) as OrderLineItem

const K = () => mod('kaese', { name: 'Käse' })
const oK = () => mod('ketchup', { name: 'Ohne Ketchup', price: -0.3, removesIngredientExternalId: 'ketchup' })

describe('lineConfigKey', () => {
  it('unterscheidet Zeilen mit und ohne Extra (Fall 2, 10)', () => {
    expect(lineConfigKey(burger())).not.toBe(lineConfigKey(burger({ modifiers: [K()] })))
  })

  it('ignoriert die Reihenfolge der Modifier (Fall 16)', () => {
    const bacon = () => mod('bacon', { price: 1.5 })
    expect(lineConfigKey(burger({ modifiers: [K(), bacon()] }))).toBe(
      lineConfigKey(burger({ modifiers: [bacon(), K()] })),
    )
  })

  it('summiert denselben Modifier aus zwei Einträgen (Fall 17)', () => {
    expect(lineConfigKey(burger({ modifiers: [K(), K()] }))).toBe(
      lineConfigKey(burger({ modifiers: [mod('kaese', { name: 'Käse', amount: 2 })] })),
    )
  })

  it('trennt einen kostenlosen vom kostenpflichtigen Treffer über den Preis (Fall 18)', () => {
    expect(lineConfigKey(burger({ modifiers: [K()] }))).not.toBe(
      lineConfigKey(burger({ modifiers: [mod('kaese', { price: 0 })] })),
    )
  })

  it('trennt Zeilen mit anderem Stückpreis (Fall 23)', () => {
    expect(lineConfigKey(burger({ price: 8 }))).not.toBe(lineConfigKey(burger({ price: 9 })))
  })

  it('unterscheidet Abwahl und Extra (Fall 4, 5)', () => {
    expect(lineConfigKey(burger({ modifiers: [oK()] }))).not.toBe(lineConfigKey(burger({ modifiers: [K()] })))
    expect(lineConfigKey(burger({ modifiers: [oK(), K()] }))).toBe(lineConfigKey(burger({ modifiers: [K(), oK()] })))
  })

  it('zählt den alten OHNE-Marker (amount −1) nicht als Modifier', () => {
    expect(lineConfigKey(burger({ modifiers: [mod('zwiebel', { amount: -1 })] }))).toBe(lineConfigKey(burger()))
  })

  it('trennt Zeilen über die Kombinationsgrenze (Fall 27) und nach Rabatt-Schlüssel (Fall 21)', () => {
    expect(lineConfigKey(burger({ bundleNumber: 1 }))).not.toBe(lineConfigKey(burger()))
    expect(lineConfigKey(burger(), 'p:rabatt:10')).not.toBe(lineConfigKey(burger()))
  })

  it('führt Menüs, Komponenten-Zeilen und Zeilen ohne Produkt nie zusammen (Fall 24, 25)', () => {
    expect(lineConfigKey(burger({ isMenu: true }))).toBeNull()
    expect(lineConfigKey(burger({ components: [mod('pommes')] as never }))).toBeNull()
    expect(lineConfigKey(burger({ menuSideDish: mod('pommes') as never }))).toBeNull()
    expect(lineConfigKey(burger({ externalId: '' }))).toBeNull()
    expect(isMergeableLine(burger())).toBe(true)
  })
})

describe('splitOffPieces', () => {
  it('spaltet ein Stück ab und lässt die Restzeile mit Menge − 1 stehen (Fall 2)', () => {
    const line = burger({ amount: 2, modifierScope: 'unit' })
    const piece = splitOffPieces(line, 1, 'neu')
    expect(line.amount).toBe(1)
    expect(piece).toMatchObject({ _id: 'neu', amount: 1, externalId: 'burger', modifierScope: 'unit' })
  })

  it('kopiert die Modifier tief — eine Änderung am Stück trifft die Restzeile nicht', () => {
    const line = burger({ amount: 3, modifiers: [K()], modifierScope: 'unit' })
    const piece = splitOffPieces(line, 1, 'neu') as OrderLineItem
    piece.modifiers[0].amount = 2
    piece.modifiers.push(oK())
    expect(line.modifiers).toEqual([K()])
  })

  it('spaltet nicht, wenn die Zeile nicht mehr Stück trägt', () => {
    const line = burger({ amount: 1 })
    expect(splitOffPieces(line, 1, 'neu')).toBeNull()
    expect(line.amount).toBe(1)
    expect(splitOffPieces(burger({ amount: 2 }), 0, 'neu')).toBeNull()
  })
})

describe('mergeIdenticalLines', () => {
  it('führt gleiche Konfigurationen zusammen und behält die vordere Zeile (Fall 3)', () => {
    const a = burger({ modifiers: [K()] })
    const other = burger({ amount: 1 })
    const b = burger({ modifiers: [K()] })
    const { lines, mergedInto } = mergeIdenticalLines([a, other, b])
    expect(lines).toEqual([a, other])
    expect(a.amount).toBe(2)
    expect(a.modifierScope).toBe('unit')
    expect(mergedInto.get(b)).toBe(a)
  })

  it('führt nach dem Entfernen eines Extras wieder zusammen (Fall 9)', () => {
    const a = burger()
    const b = burger({ modifiers: [] })
    expect(mergeIdenticalLines([a, b]).lines).toEqual([a])
    expect(a.amount).toBe(2)
  })

  it('lässt verschiedene Konfigurationen, Menüs und Rabatt-Unterschiede getrennt', () => {
    const a = burger({ modifiers: [K()] })
    const b = burger()
    const m1 = burger({ isMenu: true })
    const m2 = burger({ isMenu: true })
    const r = burger()
    const discount = new Map([[r, 'f:eigen']])
    const { lines } = mergeIdenticalLines([a, b, m1, m2, r], line => discount.get(line) ?? '')
    expect(lines).toEqual([a, b, m1, m2, r])
    expect(b.amount).toBe(1)
  })
})

describe('Zählweise und Menüs (Review #699)', () => {
  it('führt eine Bestandszeile („je Zeile") nicht mit einer neuen („je Stück") zusammen, wenn Modifier dran sind', () => {
    expect(lineConfigKey(burger({ modifiers: [K()] }))).not.toBe(
      lineConfigKey(burger({ modifiers: [K()], modifierScope: 'unit' })),
    )
    // Ohne Modifier ist die Zählweise egal.
    expect(lineConfigKey(burger())).toBe(lineConfigKey(burger({ modifierScope: 'unit' })))
  })

  it('spaltet eine Bestandszeile mit Modifiern nicht auf — die Summe änderte sich', () => {
    const line = burger({ amount: 2, modifiers: [K()] })
    expect(isSplittableLine(line)).toBe(false)
    expect(splitOffPieces(line, 1, 'neu')).toBeNull()
    expect(line.amount).toBe(2)
  })

  it('spaltet Menüs auf und kopiert ihre Bestandteile tief (D6)', () => {
    const line = burger({
      amount: 2,
      isMenu: true,
      components: [mod('pommes')] as never,
      menuDrink: mod('cola') as never,
    })
    expect(isSplittableLine(line)).toBe(true)
    const piece = splitOffPieces(line, 1, 'neu') as OrderLineItem
    ;(piece.components as Array<{ amount: number }>)[0].amount = 5
    ;(piece.menuDrink as { amount: number }).amount = 5
    expect((line.components as Array<{ amount: number }>)[0].amount).toBe(1)
    expect((line.menuDrink as { amount: number }).amount).toBe(1)
  })
})
