import { describe, it, expect } from 'vitest'

import { buildInventorySnapshot, type BuildInventorySnapshotInput } from './inventory-snapshot'
import type { ConsumptionLine } from './cogs'

/**
 * Bestand-Snapshot-Mathematik.
 *
 * Formel (gegen Source verifiziert):
 *   theoreticalUsage       = consumption.quantityUsed + wasteRaw + wasteFinished
 *   calculatedClosingStock = openingStock + addedStock − theoreticalUsage
 *   varianceQuantity       = physicalStock − calculatedClosingStock  (nur falls gezaehlt)
 *   varianceValueCents     = multiplyCents(price, varianceQuantity)
 *
 * Die id-Liste ist die sortierte Union aller Input-Maps; eine Zutat, die nur
 * in Stock/Waste (nicht in consumption) vorkommt, zieht Name/Unit aus
 * ingredientMetadata.
 */

const ING_FLOUR = '00000000-0000-7000-8000-aaaaaaaaaa01'
const ING_TOMATO = '00000000-0000-7000-8000-aaaaaaaaaa02'
const ING_CHEESE = '00000000-0000-7000-8000-aaaaaaaaaa03'

function consumptionLine(partial: Partial<ConsumptionLine> & { ingredientId: string; quantityUsed: number }): ConsumptionLine {
  return {
    ingredientName: 'Zutat',
    unit: 'kg',
    ...partial,
  }
}

// Minimaler Input mit leeren Maps; Tests ueberschreiben gezielt einzelne Felder.
function makeInput(partial: Partial<BuildInventorySnapshotInput> = {}): BuildInventorySnapshotInput {
  return {
    consumption: [],
    openingStocks: new Map(),
    addedStocks: new Map(),
    wasteByIngredient: new Map(),
    ingredientPricing: new Map(),
    ...partial,
  }
}

describe('buildInventorySnapshot — Bestand-Snapshot-Mathematik', () => {
  it('(a) nur Verbrauch: calculatedClosing = −consumption, kein Waste, kein Stock', () => {
    const snap = buildInventorySnapshot(
      makeInput({
        consumption: [consumptionLine({ ingredientId: ING_FLOUR, quantityUsed: 3, ingredientName: 'Mehl', unit: 'kg' })],
      }),
    )
    expect(snap.lines).toHaveLength(1)
    const line = snap.lines[0]
    expect(line.ingredientName).toBe('Mehl')
    expect(line.unit).toBe('kg')
    expect(line.consumptionFromOrders).toBe(3)
    expect(line.wasteRaw).toBe(0)
    expect(line.wasteFinished).toBe(0)
    expect(line.theoreticalUsage).toBe(3)
    expect(line.calculatedClosingStock).toBe(0 + 0 - 3)
    expect(line.physicalStock).toBeUndefined()
  })

  it('(b) opening + added − consumption − waste(raw+finished)', () => {
    const snap = buildInventorySnapshot(
      makeInput({
        consumption: [consumptionLine({ ingredientId: ING_FLOUR, quantityUsed: 2 })],
        openingStocks: new Map([[ING_FLOUR, 10]]),
        addedStocks: new Map([[ING_FLOUR, 5]]),
        wasteByIngredient: new Map([[ING_FLOUR, { rawQuantity: 1, finishedQuantity: 0.5 }]]),
      }),
    )
    const line = snap.lines[0]
    // theoreticalUsage = 2 + 1 + 0.5 = 3.5
    expect(line.theoreticalUsage).toBeCloseTo(3.5, 9)
    expect(line.wasteRaw).toBe(1)
    expect(line.wasteFinished).toBe(0.5)
    // closing = 10 + 5 − 3.5 = 11.5
    expect(line.calculatedClosingStock).toBeCloseTo(11.5, 9)
  })

  it('(c) Varianz positiv + negativ inkl. Bewertung', () => {
    const snap = buildInventorySnapshot(
      makeInput({
        consumption: [
          consumptionLine({ ingredientId: ING_FLOUR, quantityUsed: 2 }),
          consumptionLine({ ingredientId: ING_TOMATO, quantityUsed: 1 }),
        ],
        openingStocks: new Map([
          [ING_FLOUR, 10],
          [ING_TOMATO, 4],
        ]),
        // FLOUR: physisch mehr als errechnet → positive Varianz
        // TOMATO: physisch weniger → negative Varianz (Schwund)
        physicalCounts: new Map([
          [ING_FLOUR, 9],
          [ING_TOMATO, 2],
        ]),
        ingredientPricing: new Map([
          [ING_FLOUR, 150], // 150 ct
          [ING_TOMATO, 250],
        ]),
      }),
    )
    const byId = new Map(snap.lines.map(l => [l.ingredientId, l]))

    const flour = byId.get(ING_FLOUR)!
    // closing = 10 − 2 = 8; physical 9 → variance +1; value 150 × 1 = 150
    expect(flour.calculatedClosingStock).toBe(8)
    expect(flour.physicalStock).toBe(9)
    expect(flour.varianceQuantity).toBe(1)
    expect(flour.varianceValueCents).toBe(150)

    const tomato = byId.get(ING_TOMATO)!
    // closing = 4 − 1 = 3; physical 2 → variance −1; value 250 × −1 = −250
    expect(tomato.calculatedClosingStock).toBe(3)
    expect(tomato.varianceQuantity).toBe(-1)
    expect(tomato.varianceValueCents).toBe(-250)
  })

  it('(d) Zutat nur in openingStocks (nicht in consumption) erscheint korrekt', () => {
    const snap = buildInventorySnapshot(
      makeInput({
        openingStocks: new Map([[ING_FLOUR, 7]]),
        ingredientMetadata: new Map([[ING_FLOUR, { name: 'Mehl', unit: 'kg' }]]),
      }),
    )
    const line = snap.lines[0]
    expect(line.ingredientId).toBe(ING_FLOUR)
    expect(line.openingStock).toBe(7)
    expect(line.consumptionFromOrders).toBe(0)
    // closing = 7 + 0 − 0 = 7
    expect(line.calculatedClosingStock).toBe(7)
    expect(line.ingredientName).toBe('Mehl')
    expect(line.unit).toBe('kg')
  })

  it('(e) Zutat nur in wasteByIngredient zieht Name/Unit aus ingredientMetadata', () => {
    const snap = buildInventorySnapshot(
      makeInput({
        wasteByIngredient: new Map([[ING_CHEESE, { rawQuantity: 0.2, finishedQuantity: 0.3 }]]),
        ingredientMetadata: new Map([[ING_CHEESE, { name: 'Kaese', unit: 'kg' }]]),
      }),
    )
    const line = snap.lines[0]
    expect(line.ingredientName).toBe('Kaese')
    expect(line.unit).toBe('kg')
    expect(line.wasteRaw).toBe(0.2)
    expect(line.wasteFinished).toBe(0.3)
    // theoreticalUsage = 0 + 0.2 + 0.3 = 0.5; closing = 0 − 0.5 = −0.5
    expect(line.theoreticalUsage).toBeCloseTo(0.5, 9)
    expect(line.calculatedClosingStock).toBeCloseTo(-0.5, 9)
  })

  it('(e2) ohne Metadata bleiben Name/Unit leere Strings', () => {
    const snap = buildInventorySnapshot(
      makeInput({
        wasteByIngredient: new Map([[ING_CHEESE, { rawQuantity: 1, finishedQuantity: 0 }]]),
      }),
    )
    expect(snap.lines[0].ingredientName).toBe('')
    expect(snap.lines[0].unit).toBe('')
  })

  it('(f) Zeilen sind deterministisch nach ingredientId sortiert (Union aller Sources)', () => {
    const snap = buildInventorySnapshot(
      makeInput({
        consumption: [consumptionLine({ ingredientId: ING_CHEESE, quantityUsed: 1 })],
        openingStocks: new Map([[ING_FLOUR, 1]]),
        addedStocks: new Map([[ING_TOMATO, 1]]),
        physicalCounts: new Map([[ING_TOMATO, 1]]),
      }),
    )
    const ids = snap.lines.map(l => l.ingredientId)
    expect(ids).toEqual([ING_FLOUR, ING_TOMATO, ING_CHEESE])
    expect(ids).toEqual([...ids].sort())
  })

  it('(g) ohne physicalCounts: keine Varianz-Felder gesetzt', () => {
    const snap = buildInventorySnapshot(
      makeInput({
        consumption: [consumptionLine({ ingredientId: ING_FLOUR, quantityUsed: 1 })],
        openingStocks: new Map([[ING_FLOUR, 5]]),
      }),
    )
    const line = snap.lines[0]
    expect(line.physicalStock).toBeUndefined()
    expect(line.varianceQuantity).toBeUndefined()
    expect(line.varianceValueCents).toBeUndefined()
  })

  it('(g2) physicalCount = 0 erzeugt Varianz-Felder (0 ist ein gueltiger Zaehlwert)', () => {
    const snap = buildInventorySnapshot(
      makeInput({
        openingStocks: new Map([[ING_FLOUR, 5]]),
        physicalCounts: new Map([[ING_FLOUR, 0]]),
      }),
    )
    const line = snap.lines[0]
    // closing = 5; physical 0 → variance −5
    expect(line.physicalStock).toBe(0)
    expect(line.varianceQuantity).toBe(-5)
  })

  it('(h) Preis 0 → varianceValueCents 0, Varianzmenge bleibt erhalten', () => {
    const snap = buildInventorySnapshot(
      makeInput({
        openingStocks: new Map([[ING_FLOUR, 5]]),
        physicalCounts: new Map([[ING_FLOUR, 3]]),
        // kein Preis hinterlegt → default 0
      }),
    )
    const line = snap.lines[0]
    expect(line.baseUnitPriceCents).toBe(0)
    expect(line.varianceQuantity).toBe(-2)
    // VERHALTEN: multiplyCents(0, -2) = Math.round(0 × -2) = Math.round(-0) = -0.
    // Der Wert ist betragsmaessig 0, aber JS unterscheidet -0 von +0 (Object.is).
    // toBeCloseTo behandelt beide gleich — kein Fehlbetrag, nur ein Vorzeichen-
    // Artefakt der Float-Multiplikation. Wer das Vorzeichen rendert, sollte es
    // normalisieren (z. B. `value + 0`).
    expect(line.varianceValueCents).toBeCloseTo(0, 9)
  })
})
