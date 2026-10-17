import { getOrderGrossCents, Order } from '@panary/orders/domain'
import { toCents } from './money'

// Die kanonische Brutto-Berechnung (`getOrderGrossCents`,
// `computeGrossFromLineItems`) liegt seit panary/panary-core#728 in
// `@panary/orders/domain` (`order-gross.ts`) — dort stempelt der Edge damit
// `grossCents` beim Schreiben. Hier nur noch re-exportiert, damit die
// Aufrufer in diesem Paket und in panary-cloud unveraendert bleiben.
export { computeGrossFromLineItems, getOrderGrossCents } from '@panary/orders/domain'

/** Netto-Cents einer Order — bevorzugt taxSnapshot, sonst aus Brutto rückgerechnet. */
export function getOrderNetCents(order: Order): number {
  if (order.taxSnapshot?.netto !== undefined && order.taxSnapshot?.netto !== null) {
    return toCents(order.taxSnapshot.netto)
  }
  // Ohne taxSnapshot kennen wir den Steuersplit nicht — Brutto = Netto als
  // Notfall-Fallback. Caller sollte das via aggregator.validations erkennen.
  return getOrderGrossCents(order)
}

/** Trinkgeld-Cents einer Order. */
export function getOrderTipCents(order: Order): number {
  return toCents(order.payment?.tipAmount ?? 0)
}
