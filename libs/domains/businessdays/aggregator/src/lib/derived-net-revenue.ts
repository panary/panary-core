import { FinancialsAggregate, sumPayments } from './financials'
import { MealSubsidiesAggregate } from './meal-subsidies'

/**
 * Betriebsmodus des Standorts. Bewusst als lokale String-Union deklariert statt
 * aus `@panary/locations/domain` importiert: der Import zoege einen
 * `external`-Eintrag plus Peer-Dependency nach sich, nur um zwei Literale zu
 * kennen.
 */
export type AggregationOperationMode = 'pos-cashier' | 'orders-only' | string

export interface DisplayNetRevenueOptions {
  operationMode?: AggregationOperationMode
}

/**
 * Reproduziert die "Tagesumsatz netto"-Anzeige des Dashboards.
 *
 * Drei Zweige, und die Reihenfolge ist die Aussage:
 *
 * 1. **`receivablesCents` fehlt** — ein Bericht aus der Zeit vor dem
 *    Forderungs-Bucket. Dann gilt die alte Formel unveraendert
 *    (`cash + card − offene Personalessen`), sonst aendern sich rueckwirkend
 *    Zahlen in bereits abgeschlossenen Berichten.
 *
 * 2. **`orders-only`** — in diesem Modus gibt es keinen Kassierpfad, `cash` und
 *    `card` sind fuer einen Tag mit Umsatz beide 0. `cash + card` waere hier
 *    also schlicht falsch; richtig ist alles Vereinnahmte abzueglich der
 *    offenen Forderungen.
 *
 * 3. **sonst** — `cash + card`. Der Abzug der offenen Personalessen entfaellt
 *    hier bewusst: sie stecken seit dem Forderungs-Umbau gar nicht mehr in
 *    `cashCents`. Ihn beizubehalten wuerde sie ein zweites Mal abziehen.
 */
export function deriveDisplayNetRevenueCents(
  financials: FinancialsAggregate,
  meals: MealSubsidiesAggregate,
  options?: DisplayNetRevenueOptions,
): number {
  const receivables = financials.payments.receivablesCents

  if (receivables === undefined) {
    const cashCardCents = financials.payments.cashCents + financials.payments.cardCents
    return cashCardCents - meals.staff.sumUnpaidCents
  }

  if (options?.operationMode === 'orders-only') {
    return sumPayments(financials.payments) - receivables
  }

  return financials.payments.cashCents + financials.payments.cardCents
}

/**
 * "Tagesumsatz gesamt" — wie im Dashboard "Tagesumsatz gesamt" angezeigt.
 *
 * Identisch zu `financials.grossTotalCents`, aber als named export für
 * Konsumenten, die nur diesen einen Wert brauchen ohne den vollen Aggregate.
 */
export function deriveTotalRevenueCents(financials: FinancialsAggregate): number {
  return financials.grossTotalCents
}

/**
 * "Tagesumsatz Cash/Card" — schließt Corporate-Bestellungen aus.
 * Identisch zur Dashboard-Formel `dailyNetRevenue` (vor Personalessen-Abzug).
 * Seit dem Forderungs-Umbau sind offene Essen hier ohnehin nicht mehr drin.
 */
export function deriveCashCardRevenueCents(financials: FinancialsAggregate): number {
  return financials.payments.cashCents + financials.payments.cardCents
}
