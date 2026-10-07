import {
  effectiveLineItems,
  isUnstampedPaymentPlaceholder,
  lineItemGrossCents,
  Order,
  OrderLineItem,
} from '@panary/orders/domain'
import { toCents, sumCents } from './money'

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
// liegt deshalb in `@panary/orders/domain` und wird mit der Split-Sperre
// geteilt (#394) — zwei Fassungen liessen einen Zustand splittbar, den diese
// Funktion als autoritativ liest.

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

/**
 * Brutto-Summe einer Line-Items-Liste in Cents, inklusive Modifier und
 * Menü-Bestandteile — Zeile für Zeile über `lineItemGrossCents` aus
 * `@panary/orders/domain`.
 *
 * Single Source ist die Engine: Dieselbe Funktion speist POS-Anzeige, Bon,
 * `taxSnapshot` (`computeOrderTax`) und den Storefront-Warenkorb. Bis #634 stand
 * hier eine eigene Formel, die Modifier zusätzlich mit der Positionsmenge
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
