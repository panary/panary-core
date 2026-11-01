import { isSyntheticSettlementScope } from './settlement-scope'

// Gruppierung der Liste „Offen" nach Abrechnungskreis (ADR 0063 Nr. 6, core#1141).
//
// Reine Funktion im Domain-Paket und nicht in der Komponente: Die Regel „welche
// Bestellungen bilden eine Karte" muss testbar sein, ohne eine Komponente zu rendern,
// und darf am POS nur einmal stehen. Summen bildet der Aufrufer — hier wird nie gerechnet.

/** Die Felder, aus denen die Gruppierung folgt. */
export type OpenOrderGroupInput = {
  _id: string
  table?: string | null
  settlementScope?: string | null
  recordingDate: string
}

/** Eine einzelne Karte: Bestellung ohne Tisch, mit synthetischem Kreis oder allein in ihrem Kreis. */
export type OpenOrderSingle<TOrder> = { kind: 'order'; key: string; order: TOrder }

/** Eine Kreis-Karte: mindestens zwei offene Bestellungen desselben Tisch-Kreises. */
export type OpenOrderCircle<TOrder> = {
  kind: 'circle'
  /** Der Abrechnungskreis, z. B. `4#1`. */
  key: string
  settlementScope: string
  /** Tischwert der ältesten Bestellung, für die Anzeige. */
  table: string
  /** Ältestes `recordingDate` im Kreis — „Zeit seit der ersten Bestellung". */
  firstRecordingDate: string
  /** Neueste zuerst, wie die Eingabe. */
  orders: TOrder[]
}

export type OpenOrderEntry<TOrder> = OpenOrderSingle<TOrder> | OpenOrderCircle<TOrder>

/**
 * Fasst offene Bestellungen zu einer Karte je Abrechnungskreis zusammen.
 *
 * - Nur Bestellungen MIT Tisch und echtem (nicht synthetischem) Kreis werden gruppiert. Ohne Tisch
 *   gibt es nichts zu gruppieren, jede Bestellung bleibt eine eigene Karte.
 * - Ein Kreis mit nur einer offenen Bestellung bleibt die gewohnte Einzelkarte.
 * - Die Reihenfolge folgt der Eingabe: Die Kreis-Karte steht an der Stelle ihrer ersten
 *   (= neuesten) Bestellung, die Eingabe ist also schon nach `recordingDate` absteigend sortiert.
 */
export function groupOpenOrdersBySettlementScope<TOrder extends OpenOrderGroupInput>(
  orders: ReadonlyArray<TOrder>,
): OpenOrderEntry<TOrder>[] {
  const byScope = new Map<string, TOrder[]>()
  for (const order of orders) {
    const scope = groupableScope(order)
    if (scope === null) continue
    const members = byScope.get(scope)
    if (members) members.push(order)
    else byScope.set(scope, [order])
  }

  const emitted = new Set<string>()
  const entries: OpenOrderEntry<TOrder>[] = []
  for (const order of orders) {
    const scope = groupableScope(order)
    const members = scope === null ? undefined : byScope.get(scope)
    if (scope === null || !members || members.length < 2) {
      entries.push({ kind: 'order', key: order._id, order })
      continue
    }
    if (emitted.has(scope)) continue
    emitted.add(scope)
    const oldest = members.reduce((a, b) => (Date.parse(b.recordingDate) < Date.parse(a.recordingDate) ? b : a))
    entries.push({
      kind: 'circle',
      key: scope,
      settlementScope: scope,
      table: (oldest.table ?? '').trim(),
      firstRecordingDate: oldest.recordingDate,
      orders: members,
    })
  }
  return entries
}

function groupableScope(order: OpenOrderGroupInput): string | null {
  const table = typeof order.table === 'string' ? order.table.trim() : ''
  const scope = order.settlementScope
  if (!table || typeof scope !== 'string' || !scope || isSyntheticSettlementScope(scope)) return null
  return scope
}
