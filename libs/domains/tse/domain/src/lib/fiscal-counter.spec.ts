import { describe, expect, it } from 'vitest'

import { fiscalCounterId, nextFiscalCounterValue } from './fiscal-counter.schema'

describe('fiscalCounterId', () => {
  it('setzt tenantId und locationId zu einem deterministischen Schlüssel zusammen', () => {
    expect(fiscalCounterId('t1', 'loc1')).toBe('t1:loc1')
  })

  it('ist stabil (gleiche Eingabe → gleicher Schlüssel)', () => {
    expect(fiscalCounterId('t1', 'loc1')).toBe(fiscalCounterId('t1', 'loc1'))
  })

  it('trennt Locations innerhalb desselben Tenants', () => {
    expect(fiscalCounterId('t1', 'loc1')).not.toBe(fiscalCounterId('t1', 'loc2'))
  })
})

describe('nextFiscalCounterValue', () => {
  it('startet bei 1, wenn noch kein Wert existiert (undefined)', () => {
    expect(nextFiscalCounterValue(undefined)).toBe(1)
  })

  it('inkrementiert lückenlos um genau 1', () => {
    expect(nextFiscalCounterValue(0)).toBe(1)
    expect(nextFiscalCounterValue(1)).toBe(2)
    expect(nextFiscalCounterValue(41)).toBe(42)
  })

  it('ist monoton steigend über eine Sequenz', () => {
    let last = 0
    const issued: number[] = []
    for (let i = 0; i < 5; i++) {
      last = nextFiscalCounterValue(last)
      issued.push(last)
    }
    expect(issued).toEqual([1, 2, 3, 4, 5])
  })
})
