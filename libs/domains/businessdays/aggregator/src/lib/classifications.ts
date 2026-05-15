import { Order, OrderStatus, PaymentState } from '@panary-core/orders/domain'

// Klassifizierer für Order-Aggregation.
//
// Marker-Konvention (aus Legacy-Order-Schema übernommen):
//   - Personalessen     → order.staffPaymentInfo ist gesetzt (truthy)
//   - Firmenkundenessen → order.customerPaymentInfo ist gesetzt
//   - Storno            → order.status === ABORTED ODER order.cancellation ist gesetzt
//   - Refund            → order.payment.state === REFUNDED
//
// Die "regulären Verkäufe" (Tagesumsatz Cash/Card) sind genau die Bestellungen,
// die KEIN staffPaymentInfo, KEIN customerPaymentInfo, NICHT ABORTED und NICHT
// REFUNDED haben. Diese Definition liegt im Dashboard-Code in panary-cloud
// (`dashboard.store.ts` Z.35-41) und MUSS hier identisch reproduziert werden.

export function isStaffMeal(order: Order): boolean {
  return order.staffPaymentInfo !== null && order.staffPaymentInfo !== undefined
}

export function isCorporateMeal(order: Order): boolean {
  return order.customerPaymentInfo !== null && order.customerPaymentInfo !== undefined
}

export function isCancelled(order: Order): boolean {
  if (order.status === OrderStatus.ABORTED) return true
  if (order.cancellation !== null && order.cancellation !== undefined) return true
  return false
}

export function isRefunded(order: Order): boolean {
  return order.payment?.state === PaymentState.REFUNDED
}

/**
 * Regulärer Verkauf = Cash/Card-Bestellung, die in den "normalen" Tagesumsatz fließt.
 * Schließt Personalessen, Firmenkundenessen, Stornos und Refunds aus.
 */
export function isRegularSale(order: Order): boolean {
  return !isStaffMeal(order) && !isCorporateMeal(order) && !isCancelled(order) && !isRefunded(order)
}

/**
 * Personalessen "bezahlt" = Mitarbeiter hat den Bon abgerechnet (z. B. Abzug vom Lohn).
 * Personalessen "unbezahlt" = Subvention bleibt offen — mindert den Anzeige-Netto.
 */
export function isStaffMealPaid(order: Order): boolean {
  return isStaffMeal(order) && order.staffPaymentInfo?.isPaid === true
}

export function isCorporateMealPaid(order: Order): boolean {
  return isCorporateMeal(order) && order.customerPaymentInfo?.isPaid === true
}
