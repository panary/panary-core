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
 * Die Datei entstand **vor** dem Umbau und war auf unveraendertem
 * Produktionscode gruen (Commit „Regressions-Anker vor dem Forderungs-Umbau") —
 * ein Anker, der erst nach der Aenderung geschrieben wird, misst nichts. Der
 * Diff dieses Commits zeigt damit exakt, welche Zahlen der Umbau bewegt hat.
 *
 * Bewegt haben sich genau drei: `cashCents`, `receivablesCents` und
 * `displayNetRevenueCents`. Jede weitere Abweichung waere ein Fehler gewesen,
 * kein erwarteter Effekt — deshalb stehen `grossTotalCents`, `taxes`,
 * `channels`, `dineLocation`, `tipsCents`, `refunds*`, `voids*` und saemtliche
 * `mealSubsidies`-Zahlen hier unveraendert als harte Assertions.
 */
describe('Golden Numbers — gemischter Geschaeftstag', () => {
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

  describe('durch den Umbau bewegt — mit Begruendung je Zahl', () => {
    it('Bar-Umsatz enthaelt die offenen Forderungen nicht mehr', () => {
      // Vorher 7.850 ct. Davon waren 1.300 ct offene Personalessen und 2.640 ct
      // offenes Firmenkundenessen — Geld, das nie in der Lade lag, weil der POS
      // fuer angeschriebene Bons trotzdem eine CASH-Transaktion bucht.
      expect(financials.payments.cashCents).toBe(3910)
      expect(financials.payments.receivablesCents).toBe(3940)
    })

    it('Anzeige-Netto zieht die offenen Essen nicht mehr doppelt ab', () => {
      // Vorher 16.410 ct = (7.850 + 9.860) − 1.300. Der Abzug war noetig,
      // solange die offenen Essen in `cashCents` steckten. Jetzt sind sie dort
      // heraus, und ein zusaetzlicher Abzug waere eine zweite Kuerzung.
      expect(deriveDisplayNetRevenueCents(financials, meals)).toBe(13770)
      expect(deriveCashCardRevenueCents(financials)).toBe(13770)
    })

    it('Kassen-Soll trifft jetzt den tatsaechlichen Ladeninhalt', () => {
      // Die Lade enthaelt real 174,10 € (200,00 Wechselgeld + 39,10 Bar
      // − 50,00 Entnahme − 15,00 Auszahlung).
      const counted = 17410
      const cash = computeCashReconciliation({
        openingFloatCents: 20000,
        cashSalesCents: financials.payments.cashCents,
        cashDropsCents: 5000,
        payoutsCents: 1500,
        countedClosingFloatCents: counted,
      })
      expect(cash.expectedClosingFloatCents).toBe(17410)
      expect(cash.varianceCents).toBe(0)

      // Der Bestandsfehler in einer Zeile: mit dem alten Bar-Umsatz (7.850)
      // haette derselbe, korrekt gezaehlte Ladeninhalt eine Abweichung von
      // exakt den offenen Forderungen gemeldet.
      const vorher = computeCashReconciliation({
        openingFloatCents: 20000,
        cashSalesCents: 7850,
        cashDropsCents: 5000,
        payoutsCents: 1500,
        countedClosingFloatCents: counted,
      })
      expect(vorher.varianceCents).toBe(3940)
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

    it('offene Essen sind vollstaendig in den Forderungs-Bucket gewandert', () => {
      // `cashCents_alt === cashCents_neu + receivablesCents_neu` — der
      // Erhaltungssatz des Umbaus. Es ist kein Geld entstanden oder
      // verschwunden, es steht nur woanders.
      const offen = meals.staff.sumUnpaidCents + meals.corporate.sumUnpaidCents
      expect(offen).toBe(3940)
      expect(financials.payments.receivablesCents).toBe(offen)
      expect(financials.payments.cashCents + (financials.payments.receivablesCents ?? 0)).toBe(7850)
    })
  })
})
