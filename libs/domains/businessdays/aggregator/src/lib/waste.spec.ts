import { describe, it, expect } from 'vitest'
import { WriteOff, WriteOffReason, WasteType, WriteOffItemType } from '@panary-core/write-offs/domain'
import { aggregateWriteOffs } from './waste'

function makeWriteOff(opts: Partial<WriteOff> & { reason: WriteOff['reason']; totalCost: number; wasteType?: WriteOff['wasteType'] }): WriteOff {
  return {
    _id: 'wo-' + Math.random(),
    tenantId: 't1',
    locationId: 'l1',
    createdAt: '2026-05-15T10:00:00.000Z',
    updatedAt: '2026-05-15T10:00:00.000Z',
    businessDayId: 'bd1',
    itemType: WriteOffItemType.INGREDIENT,
    itemId: 'i1',
    itemName: 'Mehl',
    itemVersion: 1,
    quantity: 1,
    unit: 'kg',
    costPerUnit: opts.totalCost,
    totalCost: opts.totalCost,
    reason: opts.reason,
    wasteType: opts.wasteType,
    userId: 'u1',
    ...opts,
  } as WriteOff
}

describe('waste', () => {
  it('mappt WASTE/RAW auf rawCents', () => {
    const r = aggregateWriteOffs([
      makeWriteOff({ reason: WriteOffReason.WASTE, wasteType: WasteType.RAW, totalCost: 5 }),
    ])
    expect(r.rawCents).toBe(500)
    expect(r.finishedCents).toBe(0)
  })

  it('mappt WASTE/FINISHED auf finishedCents', () => {
    const r = aggregateWriteOffs([
      makeWriteOff({ reason: WriteOffReason.WASTE, wasteType: WasteType.FINISHED, totalCost: 3 }),
    ])
    expect(r.finishedCents).toBe(300)
  })

  it('mappt WASTE ohne wasteType auf finishedCents (Default)', () => {
    const r = aggregateWriteOffs([
      makeWriteOff({ reason: WriteOffReason.WASTE, totalCost: 2 }),
    ])
    expect(r.finishedCents).toBe(200)
  })

  it('mappt EMPLOYEE_MEAL auf employeeMealsCents', () => {
    const r = aggregateWriteOffs([
      makeWriteOff({ reason: WriteOffReason.EMPLOYEE_MEAL, totalCost: 4 }),
    ])
    expect(r.employeeMealsCents).toBe(400)
  })

  it('mappt PROMO und SAMPLE auf promotionsCents', () => {
    const r = aggregateWriteOffs([
      makeWriteOff({ reason: WriteOffReason.PROMO, totalCost: 1 }),
      makeWriteOff({ reason: WriteOffReason.SAMPLE, totalCost: 2 }),
    ])
    expect(r.promotionsCents).toBe(300)
  })

  it('totalCents === Σ aller Kategorien', () => {
    const r = aggregateWriteOffs([
      makeWriteOff({ reason: WriteOffReason.WASTE, wasteType: WasteType.RAW, totalCost: 1 }),
      makeWriteOff({ reason: WriteOffReason.WASTE, wasteType: WasteType.FINISHED, totalCost: 2 }),
      makeWriteOff({ reason: WriteOffReason.EMPLOYEE_MEAL, totalCost: 3 }),
      makeWriteOff({ reason: WriteOffReason.PROMO, totalCost: 4 }),
      makeWriteOff({ reason: WriteOffReason.THEFT, totalCost: 5 }),
    ])
    expect(r.totalCents).toBe(100 + 200 + 300 + 400 + 500)
  })

  it('leere Liste liefert ZERO', () => {
    const r = aggregateWriteOffs([])
    expect(r.totalCents).toBe(0)
  })
})
