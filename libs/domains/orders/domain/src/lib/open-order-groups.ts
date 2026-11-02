import { OrderStatus } from './order.schema'
import { sumCents, toCents } from './pricing/money'
import { isSyntheticSettlementScope } from './settlement-scope'

// Gruppierung der Liste „Offen" nach Abrechnungskreis (ADR 0063 Nr. 6, core#1141).
//
// Reine Funktion im Domain-Paket und nicht in der Komponente: Die Regel „welche
// Bestellungen bilden eine Karte" muss testbar sein, ohne eine Komponente zu rendern,
// und darf am POS nur einmal stehen. Beträge liefert der Aufrufer je Bestellung (Engine), hier wird nur addiert.

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
    // Ungültiges Datum (NaN) verliert jeden Vergleich und verdrängt so nie eine gültige Bestellung
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

/**
 * Summe einer Kreis-Karte in Cent, oder `null`, wenn sie nicht gezeigt werden darf.
 *
 * `totalOf` liefert den Betrag je Bestellung aus derselben Engine wie die Einzelkarte; diese Funktion addiert
 * nur, in Cent. Ein Personalessen im Kreis verbirgt die Summe (`null`), wie die Einzelkarte: Die Rabattsätze sind
 * pro Mitarbeiter verschieden und sollen am Terminal nicht ablesbar sein.
 */
export function openOrderCircleTotalCents<TOrder extends { staffPaymentInfo?: unknown }>(
  orders: ReadonlyArray<TOrder>,
  totalOf: (order: TOrder) => number,
): number | null {
  if (orders.some(order => !!order.staffPaymentInfo)) return null
  return sumCents(orders.map(order => toCents(totalOf(order))))
}

/** Eine Bestellung im Zahlablauf „Tisch kassieren“: ID und Betrag in Cent, aus derselben Engine wie die Karte. */
export type TableCheckoutItem = { orderId: string; totalCents: number }

/**
 * Zahlliste für „Tisch kassieren“ (ADR 0063 Nr. 5, core#1142): die offenen Bestellungen einer Kreis-Karte, die älteste
 * zuerst, je mit ihrem Betrag in Cent. Die Summe für den Gast ist `sumCents` über genau diese Beträge, und dieselben
 * Beträge gehen je Bestellung in die Zahlung. Zwei getrennte Rechnungen wichen sonst um einen Cent voneinander ab.
 *
 * `null`, wenn der Kreis nicht als Ganzes kassiert werden kann:
 * - leer: nichts zu kassieren,
 * - mit Personalessen: Es wird über die Abrechnung beglichen, nicht an der Theke, und sein Betrag bleibt am Terminal
 *   verborgen (wie in `openOrderCircleTotalCents`). Die übrigen Bestellungen kassiert man dann einzeln.
 */
export function tableCheckoutPlan<TOrder extends OpenOrderGroupInput & { staffPaymentInfo?: unknown }>(
  orders: ReadonlyArray<TOrder>,
  totalOf: (order: TOrder) => number,
): TableCheckoutItem[] | null {
  if (orders.length === 0 || orders.some(order => !!order.staffPaymentInfo)) return null
  return [...orders]
    .sort((a, b) => {
      const at = Date.parse(a.recordingDate)
      const bt = Date.parse(b.recordingDate)
      if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt
      return a._id < b._id ? -1 : a._id > b._id ? 1 : 0
    })
    .map(order => ({ orderId: order._id, totalCents: toCents(totalOf(order)) }))
}

/**
 * Wie viele Bestellungen eines Kreises sind am selben Geschäftstag schon kassiert (`completed`)? Nach einem
 * abgebrochenen „Tisch kassieren“ zeigt die Kreis-Karte so den gezahlten Teil neben dem offenen (core#1142).
 *
 * Nur `completed`: Storniert (`aborted`) und nicht abgeholt (`unclaimed`) schließen einen Kreis zwar auch, gezahlt
 * ist dort aber nichts. Der Geschäftstag gehört dazu, weil ein Kreis eines alten Clients nur das Tisch-Label ist
 * und sich sonst mit dem Vortag mischte.
 */
export function settledOrdersInCircle(
  orders: ReadonlyArray<{ status?: string | null; settlementScope?: string | null; businessDayId?: string | null }>,
  circle: { settlementScope: string; businessDayId?: string | null },
): number {
  return orders.filter(
    order =>
      order.status === OrderStatus.COMPLETED &&
      order.settlementScope === circle.settlementScope &&
      (order.businessDayId ?? null) === (circle.businessDayId ?? null),
  ).length
}
