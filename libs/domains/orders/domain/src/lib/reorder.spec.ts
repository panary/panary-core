import { describe, expect, it } from 'vitest'
import { KASSE_REORDER_STATE_KEY, kasseReorderFor, kasseReorderFromState } from './reorder'

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

describe('kasseReorderFromState (core#1140)', () => {
  it('liest die Vorbelegung unter ihrem Schlüssel', () => {
    const state = { navigationId: 3, [KASSE_REORDER_STATE_KEY]: { table: '4', settlementScope: '4#1' } }
    expect(kasseReorderFromState(state)).toEqual({ table: '4', settlementScope: '4#1' })
  })

  it('verwirft fehlenden, fremden und unvollständigen State', () => {
    expect(kasseReorderFromState(undefined)).toBeNull()
    expect(kasseReorderFromState({ navigationId: 1 })).toBeNull()
    expect(kasseReorderFromState({ [KASSE_REORDER_STATE_KEY]: { table: 4, settlementScope: '4#1' } })).toBeNull()
    expect(kasseReorderFromState({ [KASSE_REORDER_STATE_KEY]: { table: '4', settlementScope: 'auto:x' } })).toBeNull()
  })
})
