import { Order } from '@panary-core/orders/domain'
import { isCancelled } from './classifications'
import { getOrderGrossCents } from './order-total'

export interface CancellationsAggregate {
  count: number
  sumCents: number
}

/**
 * Aggregiert Stornos (ABORTED + `order.cancellation`-Felder).
 *
 * Dashboard-konform (`dashboard.store.ts:93-102`). Unterscheidet sich von
 * `financials.voidsCount` insofern, als dass die hier zurückgegebene Summe
 * den vollen Brutto-Wert der stornierten Bons enthält — Identisch zu
 * `financials.voidsCents`, aber als separates KPI für Anzeige.
 */
export function aggregateCancellations(orders: ReadonlyArray<Order>): CancellationsAggregate {
  let count = 0
  let sumCents = 0

  for (const order of orders) {
    if (!isCancelled(order)) continue
    count++
    sumCents += getOrderGrossCents(order)
  }

  return { count, sumCents }
}
