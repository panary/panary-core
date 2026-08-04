import { Order, OrderStatus, PaymentState } from '@panary/orders/domain'

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

/**
 * Sicht auf den Abrechnungsstand, die der Aufrufer mitgibt.
 *
 * Die Abrechnung lebt als eigenes Dokument in der Cloud (`meal-settlements`);
 * die Order selbst wird nie gepatcht (ADR 0001 §3 + 90-Tage-Backfill des
 * Edge-Bootstraps). Der Aggregator kann den Stand also nicht aus der Order
 * lesen — er bekommt ihn hereingereicht.
 */
export interface SettlementView {
  /** IDs der Bestellungen, die durch einen gueltigen Beleg abgerechnet sind. */
  settledOrderIds: ReadonlySet<string>
}

export interface OrderAggregationOptions {
  settlements?: SettlementView
  /**
   * Betriebsart des Geschaeftstags (Snapshot, nicht der aktuelle Standort).
   *
   * `'orders-only'` bedeutet: An diesem Standort wird ueber Panary **nicht
   * kassiert** — das System laeuft als Bestellsystem neben einer Fremdkasse.
   * Steuer-Split und Zahlungsarten-Aufteilung entstehen dort gar nicht erst:
   * Ein zweiter USt-Split neben der gemeldeten Fremdkasse ist das Kernmerkmal
   * eines Kassenabschlusses, und ein Zahlungsarten-Bild ohne erfasste
   * Zahlungen ist eine Nullaussage im Gewand eines Datums.
   *
   * Fehlt die Option, gilt Kassenbetrieb — Bestandsaufrufer bleiben unveraendert.
   * Siehe panary-cloud `docs/adr/0036-bestellbetrieb-und-kassenmeldung.md`.
   */
  operationMode?: 'orders-only' | 'pos-cashier'
}

/** Laeuft der Geschaeftstag ohne Kassiervorgang in Panary? */
export function isOrdersOnly(options?: OrderAggregationOptions): boolean {
  return options?.operationMode === 'orders-only'
}

/**
 * Ist dieses Essen abgerechnet?
 *
 * **Ohne View** gilt das heutige Boolean-Verhalten (`isPaid === true`) — so
 * bleiben Bestandsberichte und Aufrufer ohne Settlement-Daten unveraendert.
 *
 * **Mit leerer View** heisst es „Information liegt vor, nichts ist abgerechnet"
 * — ein anderer Zustand als „keine Information". Beide bleiben unterscheidbar,
 * damit ein vergessener Parameter nie stillschweigend alles auf „offen" kippt.
 *
 * Das Legacy-Feld schlaegt die View: ein historisch auf `true` gesetztes
 * `isPaid` bleibt abgerechnet, auch wenn es dafuer keinen Beleg gibt.
 */
export function isMealSettled(order: Order, view?: SettlementView): boolean {
  if (isStaffMealPaid(order) || isCorporateMealPaid(order)) return true
  if (!view) return false
  return view.settledOrderIds.has(order._id)
}

/**
 * Offene Forderung = angeschriebenes Essen ohne Abrechnung.
 *
 * Genau diese Bestellungen duerfen nicht als Bareinnahme gelten: der POS bucht
 * fuer sie zwar eine CASH-Transaktion, aber es liegt kein Geld in der Lade.
 */
export function isOpenReceivable(order: Order, view?: SettlementView): boolean {
  if (!isStaffMeal(order) && !isCorporateMeal(order)) return false
  if (isCancelled(order) || isRefunded(order)) return false
  return !isMealSettled(order, view)
}
