/**
 * Auswahl-Navigation des Bestell-Boards als pure Übergangsfunktionen — aus
 * order-dialog.component.ts extrahiert (God-Component-Logik-Extraktion,
 * Review-Stufe 3). Die Komponente hält den Zustand weiter selbst und wendet
 * die hier berechneten Übergänge an.
 *
 * Auswahl-Modell: ENTWEDER ein Einzelartikel (`productIndex`) ODER eine
 * Kombination (`combinationIndex[0]`), optional mit Artikel darin
 * (`combinationIndex[1]`). Die Blätter-Reihenfolge ist: Kombinationen →
 * Einzelartikel → keine Auswahl → von vorn.
 */
export interface BoardSelection {
  productIndex: number | null
  combinationIndex: [number | null, number | null]
}

export interface BoardCounts {
  combinations: number
  lineItems: number
}

const clone = (selection: BoardSelection): BoardSelection => ({
  productIndex: selection.productIndex,
  combinationIndex: [selection.combinationIndex[0], selection.combinationIndex[1]],
})

/** Übergang für „vorwärts blättern" (Pfeil runter/weiter). */
export function nextBoardSelection(current: BoardSelection, counts: BoardCounts): BoardSelection {
  if (counts.combinations === 0 && counts.lineItems === 0) return clone(current)

  const next = clone(current)
  if (next.combinationIndex[0] === null && next.productIndex === null) {
    if (counts.combinations > 0) {
      next.combinationIndex = [0, null]
    } else {
      next.productIndex = 0
    }
    return next
  }
  if (next.combinationIndex[0] !== null) {
    if (next.combinationIndex[0] === counts.combinations - 1) {
      next.combinationIndex = [null, null]
      if (counts.lineItems > 0) {
        next.productIndex = 0
      }
    } else {
      next.combinationIndex[0] += 1
    }
    return next
  }
  if (next.productIndex !== null) {
    if (next.productIndex === counts.lineItems - 1) {
      next.productIndex = null
      next.combinationIndex = [null, null]
    } else {
      next.productIndex += 1
    }
  }
  return next
}

/** Übergang für „rückwärts blättern" (Pfeil hoch/zurück). */
export function previousBoardSelection(current: BoardSelection, counts: BoardCounts): BoardSelection {
  if (counts.combinations === 0 && counts.lineItems === 0) return clone(current)

  const previous = clone(current)
  if (previous.combinationIndex[0] === null && previous.productIndex === null) {
    if (counts.lineItems > 0) {
      previous.productIndex = counts.lineItems - 1
    } else {
      previous.combinationIndex = [counts.combinations - 1, null]
    }
    return previous
  }
  if (previous.combinationIndex[0] !== null) {
    if (previous.combinationIndex[0] === 0) {
      previous.combinationIndex = [null, null]
      previous.productIndex = null
    } else {
      previous.combinationIndex[0] -= 1
    }
    return previous
  }
  if (previous.productIndex !== null) {
    if (previous.productIndex === 0) {
      previous.productIndex = null
      if (counts.combinations > 0) {
        previous.combinationIndex = [counts.combinations - 1, null]
      }
    } else {
      previous.productIndex -= 1
    }
  }
  return previous
}

/**
 * Klick auf eine Kombination (`articleIndex === null`) toggelt deren Auswahl;
 * Klick auf einen Artikel darin wählt die Kombination fest und toggelt den
 * Artikel. Einzelartikel-Auswahl wird immer aufgehoben.
 */
export function toggleCombinationSelection(
  current: BoardSelection,
  combinationIndex: number,
  articleIndex: number | null,
): BoardSelection {
  const next = clone(current)
  next.productIndex = null
  if (articleIndex === null) {
    next.combinationIndex[0] =
      next.combinationIndex[0] === null || next.combinationIndex[0] !== combinationIndex ? combinationIndex : null
  } else {
    next.combinationIndex[0] = combinationIndex
    next.combinationIndex[1] =
      next.combinationIndex[1] === null || next.combinationIndex[1] !== articleIndex ? articleIndex : null
  }
  return next
}
