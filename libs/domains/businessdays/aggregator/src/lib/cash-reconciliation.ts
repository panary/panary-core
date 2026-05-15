// Kassenabstimmung (Cash-Reconciliation) — nur bei `operationMode='pos-cashier'`.
//
// Formel:
//   expectedClosingFloat = openingFloat + cashSales − cashDrops − payouts
//   variance = expectedClosingFloat − countedClosingFloat
//
// Positive Variance = Überschuss (Kasse hat mehr drin als erwartet)
// Negative Variance = Fehlbetrag

export interface CashReconciliationInput {
  openingFloatCents: number          // Wechselgeld bei Tageseröffnung
  cashSalesCents: number             // Σ Cash-Zahlungen (aus financials.payments.cashCents)
  cashDropsCents: number             // Zwischenentnahmen in den Safe
  payoutsCents: number               // Auszahlungen aus der Kasse (z. B. Lieferanten in bar)
  countedClosingFloatCents: number   // Physisch gezählter Endbestand
}

export interface CashReconciliationAggregate {
  openingFloatCents: number
  cashSalesCents: number
  cashDropsCents: number
  payoutsCents: number
  expectedClosingFloatCents: number
  countedClosingFloatCents: number
  varianceCents: number
}

export function computeCashReconciliation(input: CashReconciliationInput): CashReconciliationAggregate {
  const expectedClosingFloatCents =
    input.openingFloatCents + input.cashSalesCents - input.cashDropsCents - input.payoutsCents
  const varianceCents = expectedClosingFloatCents - input.countedClosingFloatCents
  return {
    openingFloatCents: input.openingFloatCents,
    cashSalesCents: input.cashSalesCents,
    cashDropsCents: input.cashDropsCents,
    payoutsCents: input.payoutsCents,
    expectedClosingFloatCents,
    countedClosingFloatCents: input.countedClosingFloatCents,
    varianceCents,
  }
}
