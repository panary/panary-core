import type { Order, OrderLineItem } from './order.schema'
import { effectiveLineItems } from './effective-line-items'
import { isUnstampedPaymentPlaceholder } from './payment-stamp'
import { lineItemGrossCents } from './pricing/compute-order-tax'
import { sumCents, toCents } from './pricing/money'

// Kanonische Order-Total-Berechnung.
//
// Source of Truth-Priorität:
//   1. order.payment.totalAmount  → wenn gesetzt, ist das die autoritative Summe
//      (vom POS bei Bezahlung gestempelt, kein Float-Drift, da round-trip-fixed)
//   2. taxSnapshot.brutto         → wenn payment fehlt, aber Tax-Snapshot da ist
//   3. Σ lineItems (incl. Modifier, Menu-Items)  → letzter Fallback
//
// Der Legacy-Dashboard-Code (`dashboard.store.ts:123-130`) hatte einen
// Fallback `Σ price × amount`, der Modifier komplett ignorierte und Float-
// Multiplikation verwendete. Das produziert bis zu ±5 ct Drift pro Order und
// ist nicht KassenSichV-tauglich. Wir korrigieren das hier zentral.
//
// 🚨 Weil Priorität 1 vor dem Snapshot gewinnt, darf eine Bestellung mit
// Zahlungsergebnis nicht gesplittet werden: Der Split laesst `payment` der
// Quelle stehen, sie zaehlte danach mit dem vollen Vor-Split-Betrag. Die
// Erkennung des nie befuellten Platzhalters (`isUnstampedPaymentPlaceholder`)
// wird deshalb mit der Split-Sperre geteilt (#394) — zwei Fassungen liessen
// einen Zustand splittbar, den diese Funktion als autoritativ liest.
//
// Bis panary/panary-core#728 lag die Funktion im Reporting-Aggregator
// (`@panary/businessdays/aggregator`, der sie weiter re-exportiert). Der
// Edge-Orders-Service stempelt damit `grossCents` beim Schreiben, und den
// Aggregator darf er nicht importieren: Der haengt selbst an dieser Lib.

/** Gesamt-Cents einer Order. Idempotent, deterministisch, keine I/O. */
export function getOrderGrossCents(order: Order): number {
  // Primary: Payment-Snapshot — außer es ist der nie befüllte Platzhalter.
  if (
    order.payment?.totalAmount !== undefined &&
    order.payment?.totalAmount !== null &&
    !isUnstampedPaymentPlaceholder(order)
  ) {
    return toCents(order.payment.totalAmount)
  }

  // Secondary: Tax-Snapshot (vom POS pre-payment berechnet)
  if (order.taxSnapshot?.brutto !== undefined && order.taxSnapshot?.brutto !== null) {
    return toCents(order.taxSnapshot.brutto)
  }

  // Fallback: aus Line-Items rekonstruieren, inklusive Modifier und Menu-Items —
  // nach einem Split nur das, was der Vorgang noch traegt (#391).
  return computeGrossFromLineItems(effectiveLineItems(order))
}

/**
 * Brutto-Summe einer Line-Items-Liste in Cents, inklusive Modifier und
 * Menü-Bestandteile — Zeile für Zeile über `lineItemGrossCents`.
 *
 * Single Source ist die Engine: Dieselbe Funktion speist POS-Anzeige, Bon,
 * `taxSnapshot` (`computeOrderTax`) und den Storefront-Warenkorb. Bis #634 stand
 * im Aggregator eine eigene Formel, die Modifier zusätzlich mit der Positionsmenge
 * multiplizierte und HIGHEST-Gruppen selbst auswertete. Ein offener Bon zählte
 * dadurch im Tagesumsatz mehr, als seine Zwischensumme zeigte (Staging-Bon #930:
 * „Extra Gauda" bei Margherita × 2 zweimal). Keine eigene Rechnung mehr hier —
 * jede Abweichung wäre wieder ein zweiter Betrag für dieselbe Bestellung.
 *
 * Auch der Personalessen-Nachweis in panary-cloud (`meal-settlements/proof.ts`)
 * ruft diese Funktion und bekommt die Korrektur über den Pin-Bump.
 */
export function computeGrossFromLineItems(lineItems: OrderLineItem[]): number {
  return sumCents(lineItems.map(lineItemGrossCents))
}
