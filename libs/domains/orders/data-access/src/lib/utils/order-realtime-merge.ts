import { Order, OrderStatus } from '@panary/orders/domain'

/**
 * Reine Merge-Logik für Realtime-Events des Order-Sockets: statt pro Event einen
 * Voll-Reload (3 find-Calls + IndexedDB-replaceAll) auszulösen, wird der Event-Payload
 * direkt in die bestehende Orders-Liste gemerged. Neben der neuen Liste liefern die
 * Funktionen inkrementelle Count-Deltas, weil die Liste auf QUERY_LIMIT gedeckelt sein
 * kann und die Server-Counts (`$limit: 0`) daher nicht aus der Liste ableitbar sind.
 */
export interface OrderRealtimeMergeResult {
  /** Neue Liste (Kopie) — das Eingabe-Array wird nie mutiert. */
  orders: Order[]
  /** true, wenn sich die Liste gegenüber der Eingabe geändert hat. */
  changed: boolean
  /** Delta für die Gesamtzahl der Orders des aktuellen Geschäftstags. */
  totalDelta: number
  /** Delta für die Anzahl abgeschlossener Orders (Server-Query `status: COMPLETED`). */
  completedDelta: number
}

export type OrderRealtimeMergeFn = (
  current: readonly Order[],
  incoming: Order | Order[],
  businessDayId: string,
) => OrderRealtimeMergeResult

/** Spiegelt die Count-Query in `loadDocuments` (`status: COMPLETED`) — nicht `!== ACTIVE`. */
const isCompleted = (order: Order): boolean => order.status === OrderStatus.COMPLETED

/** Events können einzeln oder als Array kommen; Dokumente ohne `_id` sind nicht mergebar. */
function toRecords(incoming: Order | Order[]): Order[] {
  const records = Array.isArray(incoming) ? incoming : [incoming]
  return records.filter(record => typeof record?._id === 'string' && record._id.length > 0)
}

function upsertOrders(
  current: readonly Order[],
  incoming: Order | Order[],
  businessDayId: string,
  countInsertAsNew: boolean,
): OrderRealtimeMergeResult {
  const orders = current.slice()
  let changed = false
  let totalDelta = 0
  let completedDelta = 0

  for (const document of toRecords(incoming)) {
    const index = orders.findIndex(order => order._id === document._id)

    // Scope-Parität zum Voll-Reload: dessen Query filtert auf den aktuellen Geschäftstag.
    // Dokumente außerhalb fliegen aus Liste und Counts (z. B. Business-Day-Rotation).
    if (document.businessDayId !== businessDayId) {
      if (index !== -1) {
        const previous = orders[index]
        orders.splice(index, 1)
        changed = true
        totalDelta -= 1
        if (isCompleted(previous)) completedDelta -= 1
      }
      continue
    }

    if (index !== -1) {
      const previous = orders[index]
      orders[index] = document
      changed = true
      completedDelta += Number(isCompleted(document)) - Number(isCompleted(previous))
    } else {
      orders.push(document)
      changed = true
      // Nur `created` zählt neu: bei `updated` einer unbekannten Order (Liste gedeckelt
      // oder created-Event verpasst) war sie im Server-Count bereits enthalten.
      if (countInsertAsNew) {
        totalDelta += 1
        if (isCompleted(document)) completedDelta += 1
      }
    }
  }

  return { orders, changed, totalDelta, completedDelta }
}

export function applyOrderCreated(
  current: readonly Order[],
  incoming: Order | Order[],
  businessDayId: string,
): OrderRealtimeMergeResult {
  return upsertOrders(current, incoming, businessDayId, true)
}

export function applyOrderUpdated(
  current: readonly Order[],
  incoming: Order | Order[],
  businessDayId: string,
): OrderRealtimeMergeResult {
  return upsertOrders(current, incoming, businessDayId, false)
}

export function applyOrderRemoved(
  current: readonly Order[],
  incoming: Order | Order[],
  businessDayId: string,
): OrderRealtimeMergeResult {
  const orders = current.slice()
  let changed = false
  let totalDelta = 0
  let completedDelta = 0

  for (const document of toRecords(incoming)) {
    const index = orders.findIndex(order => order._id === document._id)

    if (index !== -1) {
      const previous = orders[index]
      orders.splice(index, 1)
      changed = true
      totalDelta -= 1
      if (isCompleted(previous)) completedDelta -= 1
    } else if (document.businessDayId === businessDayId) {
      // Nicht in der (ggf. gedeckelten) Liste, aber in den Server-Counts enthalten.
      totalDelta -= 1
      if (isCompleted(document)) completedDelta -= 1
    }
  }

  return { orders, changed, totalDelta, completedDelta }
}
