// Kassenabstimmung (Cash-Reconciliation) — nur bei `operationMode='pos-cashier'`.
//
// Formel:
//   expectedClosingFloat = openingFloat + cashSales + receivableSettlements
//                          − cashDrops − payouts
//   variance = countedClosingFloat − expectedClosingFloat
//
// Positive Variance = Überschuss (Kasse hat mehr drin als erwartet)
// Negative Variance = Fehlbetrag (es fehlt Geld in der Lade)

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
  // Vorzeichen: counted − expected. Kanonische Konvention seit
  // panary/panary-core#133 — branchenüblich (positiv = mehr Geld in der Lade
  // als erwartet) und deckungsgleich mit `cash-session.schema.ts`, dem
  // Cloud-Session-Hook `recompute-cash-session` und der Abstimmungs-Card.
  // Vorher rechnete diese Zeile als einzige Stelle die Gegenrichtung, was die
  // Cloud-UI einen Fehlbetrag als „Überschuss" melden ließ.
  //
  // Die Warnung des Vorgänger-Kommentars bleibt gültig und gilt jetzt in die
  // andere Richtung: Das Vorzeichen hier bestimmt das jeder gespeicherten
  // Kassendifferenz. Ein erneuter Dreh kehrt still den gesamten Bestand um und
  // ist ohne begleitende Re-Aggregation der Berichte nicht deploybar.
  const varianceCents = input.countedClosingFloatCents - expectedClosingFloatCents
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
