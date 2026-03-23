export { taxSummarySchema, taxSummerySchema } from '@panary-core/orders/domain'
export type { TaxInfo } from '@panary-core/orders/domain'
export type { TaxInfo as TaxSummary } from '@panary-core/orders/domain'

export function getDefaultTaxSummary(): { taxes: { taxRate: number; amount: number; tax: number }[]; netto: number; brutto: number } {
  return {
    taxes: [],
    netto: 0,
    brutto: 0,
  }
}
