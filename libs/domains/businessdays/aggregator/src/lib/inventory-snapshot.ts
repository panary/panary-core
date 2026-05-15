import { multiplyCents } from './money'
import { ConsumptionLine } from './cogs'
import { WasteAggregate } from './waste'

/**
 * Bestand-Snapshot pro Zutat — beschreibt den theoretisch errechneten
 * Bestandsstand am Ende eines Geschäftstages.
 *
 * Formel:
 *   theoreticalUsage    = consumption (verkauft) + waste (raw + finished)
 *   calculatedClosing   = opening + addedStock − theoreticalUsage
 *   varianceQuantity    = physicalStock − calculatedClosing   (falls gemessen)
 *   varianceValueCents  = varianceQuantity × baseUnitPriceCents
 */
export interface InventorySnapshotLine {
  ingredientId: string
  ingredientName: string
  unit: string
  openingStock: number
  addedStock: number
  consumptionFromOrders: number
  wasteRaw: number
  wasteFinished: number
  theoreticalUsage: number
  calculatedClosingStock: number
  physicalStock?: number
  varianceQuantity?: number
  varianceValueCents?: number
  baseUnitPriceCents: number
}

export interface InventorySnapshot {
  lines: InventorySnapshotLine[]
}

export interface BuildInventorySnapshotInput {
  /** Verbrauch aus Bestellungen, ingredientId → quantity. */
  consumption: ReadonlyArray<ConsumptionLine>
  /** Opening-Stocks aus dem vorherigen Tagesabschluss-Report; default 0. */
  openingStocks: ReadonlyMap<string, number>
  /** Wareneingang am Tag (z. B. aus supplier-products receipts), ingredientId → quantity. */
  addedStocks: ReadonlyMap<string, number>
  /** Detaillierte Waste-Daten pro Zutat (raw und finished getrennt). */
  wasteByIngredient: ReadonlyMap<string, { rawQuantity: number; finishedQuantity: number }>
  /** Physische Zählungen pro Zutat — optional, nur wo manuell erfasst. */
  physicalCounts?: ReadonlyMap<string, number>
  /** Preise pro Basiseinheit für Varianz-Bewertung. */
  ingredientPricing: ReadonlyMap<string, number>
  /** Anzeige-Metadaten falls Zutat nur in Stock/Waste, nicht in Consumption auftaucht. */
  ingredientMetadata?: ReadonlyMap<string, { name: string; unit: string }>
}

/**
 * Erzeugt aus Verbrauch, Wareneingang, Waste und Zählungen einen
 * vollständigen Bestand-Snapshot. Unbekannte Zutaten (nur in einer Source
 * vorhanden) werden korrekt mit 0 für die anderen Sources behandelt.
 *
 * Auch `waste` aus `aggregateWriteOffs` (Cents) wird hier NICHT verwendet —
 * stattdessen muss der Caller die `wasteByIngredient`-Mengen (in Stück/Gewicht)
 * vorberechnen, weil Cents-Bewertung und Mengen-Bewertung getrennte Achsen sind.
 */
export function buildInventorySnapshot(input: BuildInventorySnapshotInput): InventorySnapshot {
  // Union aller bekannten ingredientIds, deterministisch sortiert
  const allIds = new Set<string>()
  for (const line of input.consumption) allIds.add(line.ingredientId)
  for (const id of input.openingStocks.keys()) allIds.add(id)
  for (const id of input.addedStocks.keys()) allIds.add(id)
  for (const id of input.wasteByIngredient.keys()) allIds.add(id)
  if (input.physicalCounts) for (const id of input.physicalCounts.keys()) allIds.add(id)
  const sortedIds = [...allIds].sort()

  const consumptionByIngredient = new Map<string, ConsumptionLine>()
  for (const line of input.consumption) consumptionByIngredient.set(line.ingredientId, line)

  const lines: InventorySnapshotLine[] = sortedIds.map(id => {
    const cons = consumptionByIngredient.get(id)
    const meta = input.ingredientMetadata?.get(id)
    const opening = input.openingStocks.get(id) ?? 0
    const added = input.addedStocks.get(id) ?? 0
    const consumption = cons?.quantityUsed ?? 0
    const waste = input.wasteByIngredient.get(id) ?? { rawQuantity: 0, finishedQuantity: 0 }
    const theoreticalUsage = consumption + waste.rawQuantity + waste.finishedQuantity
    const calculatedClosing = opening + added - theoreticalUsage
    const physical = input.physicalCounts?.get(id)
    const priceCents = input.ingredientPricing.get(id) ?? 0

    const line: InventorySnapshotLine = {
      ingredientId: id,
      ingredientName: cons?.ingredientName ?? meta?.name ?? '',
      unit: cons?.unit ?? meta?.unit ?? '',
      openingStock: opening,
      addedStock: added,
      consumptionFromOrders: consumption,
      wasteRaw: waste.rawQuantity,
      wasteFinished: waste.finishedQuantity,
      theoreticalUsage,
      calculatedClosingStock: calculatedClosing,
      baseUnitPriceCents: priceCents,
    }
    if (physical !== undefined) {
      line.physicalStock = physical
      line.varianceQuantity = physical - calculatedClosing
      line.varianceValueCents = multiplyCents(priceCents, line.varianceQuantity)
    }
    return line
  })

  return { lines }
}

/** Zur Erinnerung — Cents-Total der Waste-Aggregation, getrennt von Mengen-Snapshot. */
export function wasteFromAggregate(_aggregate: WasteAggregate): void {
  // Markiert, dass die Cents-Waste-Aggregation aus `aggregateWriteOffs()` und
  // die Mengen-Auflösung pro Zutat in `wasteByIngredient` GETRENNTE Inputs sind.
  // Konsumenten dieser Lib müssen beide aus den `write-offs`-Records aufbauen.
}
