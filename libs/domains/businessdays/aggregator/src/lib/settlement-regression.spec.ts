import { describe, expect, it } from 'vitest'

import { computeCashReconciliation } from './cash-reconciliation'
import { deriveCashCardRevenueCents, deriveDisplayNetRevenueCents } from './derived-net-revenue'
import { aggregateFinancials, sumPayments } from './financials'
import { makeMixedDay } from './fixtures/orders.fixtures'
import { aggregateMealSubsidies } from './meal-subsidies'

/**
 * **Regressions-Anker fuer den Forderungs-Umbau (Core-Runde 2).**
 *
 * Der Umbau fuehrt einen `receivablesCents`-Bucket ein und nimmt offene
 * Personal-/Firmenkundenessen aus `cashCents` heraus. Das verschiebt
 * Berichtszahlen fuer **alle** Tenants ab dem Release — und panary-core hat
 * keinen Staging-Kanal, ein `v*`-Tag rollt binnen einer Stunde aus.
 *
 * Diese Datei nagelt deshalb das Verhalten **vor** dem Umbau fest. Sie ist
 * bewusst als erstes entstanden und muss auf **unveraendertem** Produktionscode
 * gruen sein — ein Anker, der erst nach der Aenderung geschrieben wird, misst
 * nichts.
 *
 * Beim Umbau duerfen sich genau drei Zahlen bewegen: `cashCents`,
 * `receivablesCents` und `displayNetRevenueCents`. Jede andere Abweichung ist
 * ein Fehler, kein erwarteter Effekt — deshalb stehen `grossTotalCents`,
 * `taxes`, `channels`, `dineLocation`, `tipsCents`, `refunds*`, `voids*` und
 * saemtliche `mealSubsidies`-Zahlen hier als harte Assertions.
 */
describe('Golden Numbers — gemischter Geschaeftstag (Stand vor dem Forderungs-Umbau)', () => {
  const orders = makeMixedDay()
  const financials = aggregateFinancials(orders)
  const meals = aggregateMealSubsidies(orders)

  describe('darf sich durch den Umbau NICHT aendern', () => {
    it('Brutto, Netto und Trinkgeld', () => {
      expect(financials.grossTotalCents).toBe(18660)
      expect(financials.netTotalCents).toBe(15982)
      expect(financials.tipsCents).toBe(110)
    })

    it('Steuersplit je Satz', () => {
      expect(financials.taxes).toEqual([
        { rate: 7, netAmountCents: 3000, taxAmountCents: 210, grossAmountCents: 3210 },
        { rate: 19, netAmountCents: 12982, taxAmountCents: 2468, grossAmountCents: 15450 },
      ])
    })

    it('Kanaele', () => {
      expect(financials.channels).toEqual({
        posCents: 13060,
        telephoneCents: 840,
        onlineCents: 4760,
        appCents: 0,
      })
    })

    it('Verzehrort', () => {
      expect(financials.dineLocation).toEqual({ dineInCents: 15450, takeOutCents: 3210 })
    })

    it('Stornos und Erstattungen', () => {
      expect(financials.voidsCount).toBe(1)
      expect(financials.voidsCents).toBe(990)
      expect(financials.refundsCount).toBe(1)
      expect(financials.refundsCents).toBe(1420)
    })

    it('Personalessen- und Firmenkunden-Aggregat', () => {
      // Diese Zahlen sind die fachliche Grundlage der Abrechnung. Wenn der
      // Umbau sie bewegt, hat er die Klassifikation angefasst statt nur die
      // Zahlart-Verteilung.
      expect(meals.staff).toEqual({ countPaid: 1, sumPaidCents: 450, countUnpaid: 2, sumUnpaidCents: 1300 })
      expect(meals.corporate).toEqual({ countPaid: 1, sumPaidCents: 1890, countUnpaid: 1, sumUnpaidCents: 2640 })
    })

    it('Karten-, Online- und Sonstige-Umsatz', () => {
      // Nur `cashCents` darf sich bewegen — die anderen drei Buckets nicht.
      expect(financials.payments.cardCents).toBe(9860)
      expect(financials.payments.onlineCents).toBe(0)
      expect(financials.payments.otherCents).toBe(840)
    })
  })

  describe('bewegt sich durch den Umbau — hier der Ausgangswert', () => {
    it('Bar-Umsatz enthaelt heute noch die offenen Forderungen', () => {
      // 78,50 € Bar, davon 13,00 € offene Personalessen und 26,40 € offenes
      // Firmenkundenessen. Nach dem Umbau muessen 39,40 € nach
      // `receivablesCents` wandern und `cashCents` auf 3.910 ct fallen.
      expect(financials.payments.cashCents).toBe(7850)
    })

    it('Anzeige-Netto', () => {
      expect(deriveDisplayNetRevenueCents(financials, meals)).toBe(16410)
      expect(deriveCashCardRevenueCents(financials)).toBe(17710)
    })

    it('Kassen-Soll', () => {
      const cash = computeCashReconciliation({
        openingFloatCents: 20000,
        cashSalesCents: financials.payments.cashCents,
        cashDropsCents: 5000,
        payoutsCents: 1500,
        countedClosingFloatCents: 21350,
      })
      // Soll = 200,00 + 78,50 − 50,00 − 15,00 = 213,50 €; gezaehlt exakt so viel.
      expect(cash.expectedClosingFloatCents).toBe(21350)
      expect(cash.varianceCents).toBe(0)
    })
  })

  describe('Erhaltungssaetze', () => {
    it('Σ Zahlarten === Brutto − Trinkgeld', () => {
      // Die Persist-Invariante aus validations.ts. Sie muss den Umbau
      // ueberleben: der Forderungs-Bucket verschiebt nur *innerhalb* der
      // Summe, er darf sie nicht veraendern.
      expect(sumPayments(financials.payments)).toBe(financials.grossTotalCents - financials.tipsCents)
      expect(sumPayments(financials.payments)).toBe(18550)
    })

    it('offene Essen sind heute vollstaendig im Bar-Umsatz enthalten', () => {
      // Der Ausgangsbefund in einer Zeile: genau diese 39,40 € sind der Grund,
      // warum der Kassensturz schon am Leistungstag zu hoch liegt.
      const offen = meals.staff.sumUnpaidCents + meals.corporate.sumUnpaidCents
      expect(offen).toBe(3940)
      expect(financials.payments.cashCents).toBeGreaterThanOrEqual(offen)
    })
  })
})
