import { WriteOff, WriteOffReason, WasteType } from '@panary-core/write-offs/domain'
import { toCents } from './money'

export interface WasteAggregate {
  rawCents: number          // Zutaten verdorben (Back-of-House)
  finishedCents: number     // Fertigprodukt vernichtet (Front-of-House)
  employeeMealsCents: number  // Mitarbeiterverpflegung als Write-Off gebucht
  promotionsCents: number     // Promotion / Sample / Gratis-Gabe
  otherCents: number          // Restkategorien (transfer, theft, quality_check, mistake)
  totalCents: number          // Σ aller Kategorien
}

const ZERO_WASTE: WasteAggregate = Object.freeze({
  rawCents: 0,
  finishedCents: 0,
  employeeMealsCents: 0,
  promotionsCents: 0,
  otherCents: 0,
  totalCents: 0,
})

/**
 * Aggregiert Write-Offs eines Geschäftstages nach Kategorien.
 *
 * Mapping:
 *   reason=WASTE + wasteType=RAW       → rawCents
 *   reason=WASTE + wasteType=FINISHED  → finishedCents
 *   reason=WASTE ohne wasteType        → finishedCents (konservativer Default,
 *                                         da Front-of-House häufiger gemeldet)
 *   reason=EMPLOYEE_MEAL                → employeeMealsCents
 *   reason=PROMO | SAMPLE               → promotionsCents
 *   reason=TRANSFER|THEFT|QUALITY_CHECK|MISTAKE → otherCents
 *
 * totalCents = Σ aller Kategorien — Validierung gegen Σ writeOff.totalCost.
 */
export function aggregateWriteOffs(writeOffs: ReadonlyArray<WriteOff>): WasteAggregate {
  if (writeOffs.length === 0) return { ...ZERO_WASTE }

  let rawCents = 0
  let finishedCents = 0
  let employeeMealsCents = 0
  let promotionsCents = 0
  let otherCents = 0

  for (const wo of writeOffs) {
    const cost = toCents(wo.totalCost)
    switch (wo.reason) {
      case WriteOffReason.WASTE:
        if (wo.wasteType === WasteType.RAW) rawCents += cost
        else finishedCents += cost
        break
      case WriteOffReason.EMPLOYEE_MEAL:
        employeeMealsCents += cost
        break
      case WriteOffReason.PROMO:
      case WriteOffReason.SAMPLE:
        promotionsCents += cost
        break
      default:
        otherCents += cost
    }
  }

  return {
    rawCents,
    finishedCents,
    employeeMealsCents,
    promotionsCents,
    otherCents,
    totalCents: rawCents + finishedCents + employeeMealsCents + promotionsCents + otherCents,
  }
}
