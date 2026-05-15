import { FinancialsAggregate, sumChannels, sumPayments } from './financials'

// Rundungstoleranz für Geld-Invarianten — pro Steuerstufe kann ±1ct durch
// independent rounding entstehen. Bei N Steuerstufen → bis zu N ct Toleranz.
const TAX_ROUNDING_TOLERANCE_PER_RATE_CENTS = 1

export interface ValidationError {
  code:
    | 'financials.tax_split_mismatch'
    | 'financials.payments_mismatch'
    | 'financials.channels_mismatch'
  message: string
  expectedCents: number
  actualCents: number
  diffCents: number
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}

/**
 * Prüft die Pflicht-Invarianten eines Finanzaggregats:
 *
 *   1. Σ taxes.taxAmountCents + Σ taxes.netAmountCents === grossTotalCents
 *      (Steuersplit-Konsistenz, Rundungs-Toleranz: N × ±1ct)
 *
 *   2. Σ payments === grossTotalCents − tipsCents
 *      (Zahlungsarten decken den Tag — Trinkgeld separat, weil es kein Umsatz ist)
 *
 *   3. Σ channels === grossTotalCents
 *      (Channels decken den Tag genau einmal)
 *
 * Verwendet vom Persist-Step der Aggregation-Pipeline; bei Verletzung wird
 * der Tagesabschluss als `failed` markiert und ein konkretes Diff im
 * Audit-Trail abgelegt.
 */
export function validateFinancials(financials: FinancialsAggregate): ValidationResult {
  const errors: ValidationError[] = []

  // 1. Steuer-Split-Konsistenz
  if (financials.taxes.length > 0) {
    const taxSum = financials.taxes.reduce(
      (acc, t) => ({
        netCents: acc.netCents + t.netAmountCents,
        taxCents: acc.taxCents + t.taxAmountCents,
        grossCents: acc.grossCents + t.grossAmountCents,
      }),
      { netCents: 0, taxCents: 0, grossCents: 0 },
    )

    // Σ grossAmountCents pro Stufe muss === grossTotalCents (innerhalb Toleranz)
    const tolerance = TAX_ROUNDING_TOLERANCE_PER_RATE_CENTS * financials.taxes.length
    const grossDiff = Math.abs(taxSum.grossCents - financials.grossTotalCents)
    if (grossDiff > tolerance) {
      errors.push({
        code: 'financials.tax_split_mismatch',
        message: `Σ taxes.grossAmountCents (${taxSum.grossCents}) weicht von grossTotalCents (${financials.grossTotalCents}) ab — Diff ${grossDiff}ct, Toleranz ${tolerance}ct`,
        expectedCents: financials.grossTotalCents,
        actualCents: taxSum.grossCents,
        diffCents: grossDiff,
      })
    }

    // net + tax pro Stufe muss === gross pro Stufe (sollte aus Konstruktion gelten, sicherheitshalber)
    const netPlusTax = taxSum.netCents + taxSum.taxCents
    const netTaxDiff = Math.abs(netPlusTax - taxSum.grossCents)
    if (netTaxDiff > tolerance) {
      errors.push({
        code: 'financials.tax_split_mismatch',
        message: `Σ (net + tax) (${netPlusTax}) weicht von Σ gross (${taxSum.grossCents}) ab — Diff ${netTaxDiff}ct`,
        expectedCents: taxSum.grossCents,
        actualCents: netPlusTax,
        diffCents: netTaxDiff,
      })
    }
  }

  // 2. Σ payments === grossTotal − tips
  const paymentsSum = sumPayments(financials.payments)
  const expectedPayments = financials.grossTotalCents - financials.tipsCents
  const paymentsDiff = Math.abs(paymentsSum - expectedPayments)
  if (paymentsDiff > 0) {
    errors.push({
      code: 'financials.payments_mismatch',
      message: `Σ payments (${paymentsSum}) ≠ grossTotal − tips (${expectedPayments}) — Diff ${paymentsDiff}ct`,
      expectedCents: expectedPayments,
      actualCents: paymentsSum,
      diffCents: paymentsDiff,
    })
  }

  // 3. Σ channels === grossTotal
  const channelsSum = sumChannels(financials.channels)
  const channelsDiff = Math.abs(channelsSum - financials.grossTotalCents)
  if (channelsDiff > 0) {
    errors.push({
      code: 'financials.channels_mismatch',
      message: `Σ channels (${channelsSum}) ≠ grossTotal (${financials.grossTotalCents}) — Diff ${channelsDiff}ct`,
      expectedCents: financials.grossTotalCents,
      actualCents: channelsSum,
      diffCents: channelsDiff,
    })
  }

  return { valid: errors.length === 0, errors }
}
