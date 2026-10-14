import type { OrderLineItem } from './order.schema'

/**
 * Zeilenidentität einer Bestellposition (panary/panary-core#699).
 *
 * Eine Zeile trägt gleiche Stücke: „2× Burger + Käse" heißt zwei Burger, jeder mit Käse.
 * Zwei Zeilen mit demselben Schlüssel sind dieselbe Konfiguration und werden zu einer
 * zusammengeführt; eine Anpassung an einem Teil der Stücke spaltet sie auf. Ein Modifier
 * gilt dann je Stück (`modifierScope: 'unit'`, ADR 0056).
 *
 * Zum Schlüssel gehören, was den Preis oder die Ware des Stücks ändert:
 * - Produkt (`externalId`) und Stückpreis,
 * - die Kombination (`bundleNumber`) — über ihre Grenze wird nie zusammengeführt,
 * - die Modifier, normalisiert und sortiert: je Id, Preis, `topic`, `pricingMode` und
 *   abgewählter Zutat die summierte Menge. Die Reihenfolge der Eingabe zählt nicht, und
 *   derselbe Modifier zweimal mit Menge 1 ist dasselbe wie einmal mit Menge 2. Ein
 *   kostenloser Treffer (Freimenge, HIGHEST) unterscheidet sich vom kostenpflichtigen über
 *   den Preis.
 * - ein Rabatt-Schlüssel, den der Aufrufer liefert (der POS kennt die Positionsrabatte).
 *
 * Die Zeilen-`_id` gehört nicht dazu — sie ist die Identität der Zeile, nicht der Konfiguration.
 */

/** Zeilen, die nie zusammengeführt werden: Menüs mit Komponenten oder Legacy-Slots. */
export function isMergeableLine(line: OrderLineItem): boolean {
  if (!line.externalId) return false
  if (line.isMenu) return false
  if (Array.isArray(line.components) && line.components.length > 0) return false
  if (line.menuSideDish || line.menuDrink) return false
  return true
}

/**
 * Schlüssel der Konfiguration eines Stücks; `null`, wenn die Zeile nie zusammengeführt wird.
 * `discountKey`: leer ohne Positionsrabatt, sonst ein Schlüssel, der nur gleiche Rabatte
 * zusammenführt (ein Festbetrag gilt je Zeile und bekommt einen eindeutigen Schlüssel).
 */
export function lineConfigKey(line: OrderLineItem, discountKey = ''): string | null {
  if (!isMergeableLine(line)) return null
  const amounts = new Map<string, number>()
  for (const mod of line.modifiers ?? []) {
    if (!(mod.amount > 0)) continue
    const key = [
      mod._id,
      mod.price,
      mod.topic ?? '',
      mod.pricingMode ?? '',
      mod.removesIngredientExternalId ?? '',
    ].join('|')
    amounts.set(key, (amounts.get(key) ?? 0) + mod.amount)
  }
  const modifiers = [...amounts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, amount]) => `${key}×${amount}`)
  return [line.externalId, line.price, line.bundleNumber ?? '', discountKey, modifiers.join(';')].join('#')
}

/**
 * Spaltet `count` Stück von einer Zeile ab und gibt das neue Stück zurück — oder `null`,
 * wenn die Zeile nicht mehr Stück trägt (dann wird sie als Ganzes angepasst).
 * Mutiert die Ausgangszeile (Menge − count); Modifier werden tief kopiert, damit eine
 * Änderung am neuen Stück die alte Zeile nicht mitnimmt.
 */
export function splitOffPieces(line: OrderLineItem, count: number, newId: string): OrderLineItem | null {
  if (!(count > 0) || line.amount <= count) return null
  line.amount -= count
  return {
    ...line,
    _id: newId,
    amount: count,
    modifiers: (line.modifiers ?? []).map(mod => ({ ...mod })),
    modifierScope: 'unit',
  }
}

export interface MergeResult {
  lines: OrderLineItem[]
  /** Entfernte Zeile → die Zeile, in der sie aufgegangen ist. */
  mergedInto: Map<OrderLineItem, OrderLineItem>
}

/**
 * Führt Zeilen mit gleichem Schlüssel zusammen. Die zuerst stehende Zeile bleibt und
 * übernimmt die Menge der späteren; die Reihenfolge des Warenkorbs bleibt sonst erhalten.
 * Mutiert die verbleibenden Zeilen (Menge), gibt ein neues Array zurück.
 */
export function mergeIdenticalLines(
  lines: readonly OrderLineItem[],
  discountKeyOf: (line: OrderLineItem) => string = () => '',
): MergeResult {
  const byKey = new Map<string, OrderLineItem>()
  const mergedInto = new Map<OrderLineItem, OrderLineItem>()
  const out: OrderLineItem[] = []
  for (const line of lines) {
    const key = lineConfigKey(line, discountKeyOf(line))
    const survivor = key === null ? undefined : byKey.get(key)
    if (survivor) {
      survivor.amount += line.amount
      // Gleiche Stücke heißen: der Modifier gilt je Stück — auch für eine Bestandszeile.
      survivor.modifierScope = 'unit'
      mergedInto.set(line, survivor)
      continue
    }
    if (key !== null) byKey.set(key, line)
    out.push(line)
  }
  return { lines: out, mergedInto }
}
