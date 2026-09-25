import type { Order } from './order.schema'
import { toCents } from './pricing/money'

// Traegt eine Bestellung ein Zahlungsergebnis? (panary/panary-core#394)
//
// Zwei Stellen muessen diese Frage GLEICH beantworten:
//
//   - `getOrderGrossCents` (`@panary/businessdays/aggregator`) liest
//     `payment.totalAmount` als Brutto des Vorgangs — VOR dem `taxSnapshot`,
//     ausser es ist der nie befuellte Platzhalter.
//   - `assertOrderIsSplittable` lehnt eine Bestellung mit Zahlungsergebnis ab.
//     Der Split laesst `payment` der Quelle stehen; eine Ableitung wie
//     `effectiveLineItems` gibt es dafuer nicht. Die Quelle zaehlte danach mit
//     dem vollen Vor-Split-Betrag und das Ziel mit seinem Anteil noch einmal.
//
// Pflegte jede Stelle ihre eigene Fassung, bliebe ein Zustand splittbar, den der
// Aggregator als autoritativ liest — derselbe stille Fehler in neuer Form. Die
// Erkennung liegt deshalb hier, beim Eigentuemer von `payment`, und nicht mehr
// im Aggregator.

/**
 * Erkennt einen Payment-Stempel, der nie befüllt wurde.
 *
 * `pre-orders.convert` legt (bzw. legte) die Order mit
 * `payment { state: PENDING, totalAmount: 0, tipAmount: 0, transactions: [] }`
 * an — ein Platzhalter, kein Zahlungsergebnis. Da `0 !== undefined && 0 !== null`
 * gewann dieser Platzhalter in der Prioritätsliste von `getOrderGrossCents`
 * gegen `taxSnapshot` UND gegen die lineItem-Summe: Die Order zählte mit
 * **0 EUR**, während der Wareneinsatz normal gerechnet wurde.
 *
 * Am Edge fiel das nicht auf, weil der POS beim Bezahlen ein echtes `payment`
 * schreibt und den Platzhalter überschreibt. In der Cloud passiert das nie,
 * wenn dort nicht kassiert wird (`orders-only`).
 *
 * Die Bedingung ist bewusst **eng** — genau die „nie angefasst"-Signatur:
 * Betrag 0 UND Status `pending` UND keine einzige Transaktion. Ein legitim mit
 * 0 EUR abgeschlossener Vorgang (100 % Rabatt, komplett gesponsertes
 * Personalessen) trägt `state: 'paid'` bzw. Transaktionen und bleibt damit
 * autoritativ. Das ist wichtig, weil der lineItem-Fallback **keine Rabatte
 * kennt** — er würde für so eine Order den vollen, unrabattierten Preis
 * liefern und damit einen schlimmeren Fehler erzeugen als den behobenen.
 */
export function isUnstampedPaymentPlaceholder(order: Pick<Order, 'payment'>): boolean {
  const payment = order.payment
  if (!payment) return false
  if (toCents(payment.totalAmount ?? 0) !== 0) return false
  if (payment.state !== undefined && payment.state !== 'pending') return false
  if (Array.isArray(payment.transactions) && payment.transactions.length > 0) return false
  return true
  // Bewusst KEINE zusätzliche Bedingung auf vorhandene `lineItems`: Der nächste
  // Schritt der Kette in `getOrderGrossCents` ist `taxSnapshot`, der ohne
  // Positionen auskommt. Fehlen beide, liefert `computeGrossFromLineItems([])`
  // ohnehin 0 — also derselbe Wert wie zuvor, kein Verhaltensunterschied.
}

/**
 * Traegt die Bestellung ein Zahlungsergebnis — `payment` gesetzt und NICHT der
 * Platzhalter?
 *
 * Bewusst die Umkehrung des Platzhalters und nicht „Betrag > 0": Auch ein mit
 * 0 EUR bezahlter Vorgang, eine Erstattung oder eine erfasste Transaktion ohne
 * Betrag sind Ergebnisse, die `getOrderGrossCents` als autoritativ liest. Jeder
 * solche Zustand muss am Split scheitern.
 */
export function hasStampedPayment(order: Pick<Order, 'payment'>): boolean {
  return order.payment !== null && order.payment !== undefined && !isUnstampedPaymentPlaceholder(order)
}
