import { describe, expect, it } from 'vitest'
import {
  BoardSelection,
  nextBoardSelection,
  previousBoardSelection,
  toggleCombinationSelection,
} from './board-selection'

// Charakterisierungs-Specs der aus order-dialog.component.ts extrahierten
// Blätter-Navigation (God-Component-Logik-Extraktion, Review-Stufe 3).
const none: BoardSelection = { productIndex: null, combinationIndex: [null, null] }
const productAt = (i: number): BoardSelection => ({ productIndex: i, combinationIndex: [null, null] })
const combinationAt = (i: number, article: number | null = null): BoardSelection => ({
  productIndex: null,
  combinationIndex: [i, article],
})

describe('nextBoardSelection', () => {
  it('bleibt ohne Artikel und Kombinationen unverändert', () => {
    expect(nextBoardSelection(none, { combinations: 0, lineItems: 0 })).toEqual(none)
  })

  it('startet bei Kombinationen, sonst bei Einzelartikeln', () => {
    expect(nextBoardSelection(none, { combinations: 2, lineItems: 3 })).toEqual(combinationAt(0))
    expect(nextBoardSelection(none, { combinations: 0, lineItems: 3 })).toEqual(productAt(0))
  })

  it('blättert durch Kombinationen und wechselt danach zu den Einzelartikeln', () => {
    expect(nextBoardSelection(combinationAt(0), { combinations: 2, lineItems: 3 })).toEqual(combinationAt(1))
    expect(nextBoardSelection(combinationAt(1), { combinations: 2, lineItems: 3 })).toEqual(productAt(0))
  })

  it('nach der letzten Kombination ohne Einzelartikel ist nichts ausgewählt', () => {
    expect(nextBoardSelection(combinationAt(1), { combinations: 2, lineItems: 0 })).toEqual(none)
  })

  it('blättert durch Einzelartikel und hebt nach dem letzten die Auswahl auf', () => {
    expect(nextBoardSelection(productAt(0), { combinations: 0, lineItems: 3 })).toEqual(productAt(1))
    expect(nextBoardSelection(productAt(2), { combinations: 2, lineItems: 3 })).toEqual(none)
  })

  it('behält den Artikel-Index innerhalb der Kombination beim Weiterblättern bei', () => {
    expect(nextBoardSelection(combinationAt(0, 1), { combinations: 3, lineItems: 0 })).toEqual(combinationAt(1, 1))
  })
})

describe('previousBoardSelection', () => {
  it('bleibt ohne Artikel und Kombinationen unverändert', () => {
    expect(previousBoardSelection(none, { combinations: 0, lineItems: 0 })).toEqual(none)
  })

  it('startet rückwärts beim letzten Einzelartikel, sonst bei der letzten Kombination', () => {
    expect(previousBoardSelection(none, { combinations: 2, lineItems: 3 })).toEqual(productAt(2))
    expect(previousBoardSelection(none, { combinations: 2, lineItems: 0 })).toEqual(combinationAt(1))
  })

  it('blättert rückwärts durch Kombinationen und hebt vor der ersten die Auswahl auf', () => {
    expect(previousBoardSelection(combinationAt(1), { combinations: 2, lineItems: 3 })).toEqual(combinationAt(0))
    expect(previousBoardSelection(combinationAt(0), { combinations: 2, lineItems: 3 })).toEqual(none)
  })

  it('wechselt vor dem ersten Einzelartikel zur letzten Kombination', () => {
    expect(previousBoardSelection(productAt(0), { combinations: 2, lineItems: 3 })).toEqual(combinationAt(1))
    expect(previousBoardSelection(productAt(0), { combinations: 0, lineItems: 3 })).toEqual(none)
    expect(previousBoardSelection(productAt(2), { combinations: 0, lineItems: 3 })).toEqual(productAt(1))
  })
})

describe('toggleCombinationSelection', () => {
  it('wählt eine Kombination aus und toggelt sie bei erneutem Klick ab', () => {
    expect(toggleCombinationSelection(none, 1, null)).toEqual(combinationAt(1))
    expect(toggleCombinationSelection(combinationAt(1), 1, null)).toEqual(none)
    expect(toggleCombinationSelection(combinationAt(1), 0, null)).toEqual(combinationAt(0))
  })

  it('wählt einen Artikel in der Kombination und toggelt ihn bei erneutem Klick ab', () => {
    expect(toggleCombinationSelection(none, 1, 2)).toEqual(combinationAt(1, 2))
    expect(toggleCombinationSelection(combinationAt(1, 2), 1, 2)).toEqual(combinationAt(1))
    expect(toggleCombinationSelection(combinationAt(1, 2), 1, 0)).toEqual(combinationAt(1, 0))
  })

  it('hebt eine Einzelartikel-Auswahl immer auf', () => {
    expect(toggleCombinationSelection(productAt(2), 0, null)).toEqual(combinationAt(0))
  })

  it('Klick auf die Kombination selbst lässt einen gemerkten Artikel-Index unangetastet', () => {
    // Charakterisierung des Bestandsverhaltens: nur combinationIndex[0] wird getoggelt.
    expect(toggleCombinationSelection(combinationAt(0, 1), 2, null)).toEqual(combinationAt(2, 1))
  })
})
