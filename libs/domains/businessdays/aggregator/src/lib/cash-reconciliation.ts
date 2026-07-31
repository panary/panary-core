// Kassenabstimmung (Cash-Reconciliation) — nur bei `operationMode='pos-cashier'`.
//
// Formel:
//   expectedClosingFloat = openingFloat + cashSales + receivableSettlements
//                          − cashDrops − payouts
//   variance = expectedClosingFloat − countedClosingFloat
//
// Positive Variance = Überschuss (Kasse hat mehr drin als erwartet)
// Negative Variance = Fehlbetrag

export interface CashReconciliationInput {
  openingFloatCents: number // Wechselgeld bei Tageseröffnung
  cashSalesCents: number // Σ Cash-Zahlungen (aus financials.payments.cashCents)
  cashDropsCents: number // Zwischenentnahmen in den Safe
  payoutsCents: number // Auszahlungen aus der Kasse (z. B. Lieferanten in bar)
  countedClosingFloatCents: number // Physisch gezählter Endbestand
  /**
   * Bar beglichene Forderungen aus der Sammelabrechnung (Personal-/
   * Firmenkundenessen). Term mit **Plus**: das Geld kommt am Zahltag in die
   * Lade, waehrend der Umsatz fiskalisch am Leistungstag steht.
   *
   * Optional — ohne Sammelabrechnung und in Alt-Berichten schlicht nicht
   * vorhanden, dann rechnet die Formel wie bisher.
   */
  receivableSettlementsCents?: number
}

export interface CashReconciliationAggregate {
  openingFloatCents: number
  cashSalesCents: number
  cashDropsCents: number
  payoutsCents: number
  expectedClosingFloatCents: number
  countedClosingFloatCents: number
  varianceCents: number
  receivableSettlementsCents: number
}

export function computeCashReconciliation(input: CashReconciliationInput): CashReconciliationAggregate {
  const receivableSettlementsCents = input.receivableSettlementsCents ?? 0
  const expectedClosingFloatCents =
    input.openingFloatCents +
    input.cashSalesCents +
    receivableSettlementsCents -
    input.cashDropsCents -
    input.payoutsCents
  // Vorzeichen der Abweichung bewusst UNVERAENDERT (expected − counted): es
  // haengt an Anzeige und Auswertung in Cloud und Edge. Wer es hier dreht,
  // dreht still jede bestehende Kassendifferenz um.
  const varianceCents = expectedClosingFloatCents - input.countedClosingFloatCents
  return {
    receivableSettlementsCents,
    openingFloatCents: input.openingFloatCents,
    cashSalesCents: input.cashSalesCents,
    cashDropsCents: input.cashDropsCents,
    payoutsCents: input.payoutsCents,
    expectedClosingFloatCents,
    countedClosingFloatCents: input.countedClosingFloatCents,
    varianceCents,
  }
}
