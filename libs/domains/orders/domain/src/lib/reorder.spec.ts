import { describe, expect, it } from 'vitest'
import { kasseReorderFor } from './reorder'

describe('kasseReorderFor (core#1140)', () => {
  it('nimmt Tisch und Kreis einer Tisch-Bestellung', () => {
    expect(kasseReorderFor({ table: '4', settlementScope: '4#2' })).toEqual({ table: '4', settlementScope: '4#2' })
  })

  it('nimmt auch einen alten Besuch-0-Kreis ohne Zähler', () => {
    expect(kasseReorderFor({ table: '4', settlementScope: '4' })).toEqual({ table: '4', settlementScope: '4' })
  })

  it('bietet ohne Tisch nichts an', () => {
    expect(kasseReorderFor({ table: '  ', settlementScope: '4#1' })).toBeNull()
    expect(kasseReorderFor({ settlementScope: '4#1' })).toBeNull()
  })

  it('bietet bei synthetischem oder fehlendem Kreis nichts an', () => {
    expect(kasseReorderFor({ table: '4', settlementScope: 'auto:0192-abc' })).toBeNull()
    expect(kasseReorderFor({ table: '4', settlementScope: null })).toBeNull()
  })
})
