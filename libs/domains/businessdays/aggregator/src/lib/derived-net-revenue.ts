import { FinancialsAggregate } from './financials'
import { MealSubsidiesAggregate } from './meal-subsidies'

/**
 * Reproduziert die "Tagesumsatz netto"-Anzeige des Dashboards exakt.
 *
 * Legacy-Formel (`business-day-info.component.ts:110` in panary-cloud):
 *   netRevenue = dailyNetRevenue − staffMeals.sumUnpaid
 *
 * Übersetzt auf neue Datenstruktur:
 *   dailyNetRevenue = Cash- + Card-Umsatz aus regulären Verkäufen
 *                   = financials.payments.cashCents + .cardCents
 *                     (Corporate landet nicht in cash/card,
 *                      Refunds/Stornos sind aus financials ausgeschlossen)
 *
 * Wichtig: Diese Funktion bildet die *Anzeige-Sicht* ab. Sie ist NICHT
 * identisch zum fiskalen Brutto-Netto-Split (`financials.netTotalCents`),
 * sondern beantwortet die Frage "Wieviel Geld liegt nach dem Tag in der
 * Kasse?" abzüglich noch offener Personalessen-Subventionen.
 */
export function deriveDisplayNetRevenueCents(
  financials: FinancialsAggregate,
  meals: MealSubsidiesAggregate,
): number {
  const cashCardCents = financials.payments.cashCents + financials.payments.cardCents
  return cashCardCents - meals.staff.sumUnpaidCents
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
 */
export function deriveCashCardRevenueCents(financials: FinancialsAggregate): number {
  return financials.payments.cashCents + financials.payments.cardCents
}
