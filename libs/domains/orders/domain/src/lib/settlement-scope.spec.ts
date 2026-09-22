import { describe, expect, it } from 'vitest'

import {
  deriveSettlementScope,
  isSyntheticSettlementScope,
  SETTLEMENT_SCOPE_MAX_LENGTH,
  settlementScopeFromTable,
  SYNTHETIC_SETTLEMENT_SCOPE_PREFIX,
  syntheticSettlementScope,
} from './settlement-scope'

describe('settlementScopeFromTable', () => {
  it('uebernimmt den Tischwert unveraendert', () => {
    expect(settlementScopeFromTable('3')).toBe('3')
    expect(settlementScopeFromTable('Terrasse links')).toBe('Terrasse links')
  })

  it('trimmt, damit „3" und „3 " denselben Abrechnungskreis ergeben', () => {
    expect(settlementScopeFromTable('  3  ')).toBe('3')
  })

  it('meldet keinen Tisch, wenn keiner da ist', () => {
    expect(settlementScopeFromTable(null)).toBeNull()
    expect(settlementScopeFromTable(undefined)).toBeNull()
    expect(settlementScopeFromTable('')).toBeNull()
    expect(settlementScopeFromTable('   ')).toBeNull()
  })

  it('bleibt in der DSFinV-K-Feldlaenge', () => {
    const long = 'x'.repeat(120)
    expect(settlementScopeFromTable(long)).toHaveLength(SETTLEMENT_SCOPE_MAX_LENGTH)
  })
})

describe('syntheticSettlementScope', () => {
  const input = {
    locationId: '01920000-0000-7000-8000-aaaaaaaa1111',
    businessDayId: '01920000-0000-7000-8000-bbbbbbbb2222',
    dailySequenceNumber: 4711,
  }

  it('traegt das reservierte Praefix und ist damit als synthetisch erkennbar', () => {
    const scope = syntheticSettlementScope(input)
    expect(scope.startsWith(SYNTHETIC_SETTLEMENT_SCOPE_PREFIX)).toBe(true)
    expect(isSyntheticSettlementScope(scope)).toBe(true)
  })

  it('ist deterministisch — derselbe Vorgang ergibt denselben Kreis', () => {
    expect(syntheticSettlementScope(input)).toBe(syntheticSettlementScope(input))
  })

  it('trennt zwei Bestellungen desselben Tages', () => {
    expect(syntheticSettlementScope({ ...input, dailySequenceNumber: 4712 })).not.toBe(syntheticSettlementScope(input))
  })

  it('nutzt das ENDE der uuidv7, nicht den Zeitstempel-Anfang', () => {
    // Zwei Standorte, die in derselben Millisekunde angelegt wurden, teilen
    // sich den Anfang ihrer uuidv7. Der Anfang taugt deshalb nicht zur
    // Unterscheidung — genau das prueft dieser Test.
    const a = syntheticSettlementScope({ ...input, locationId: '01920000-0000-7000-8000-aaaaaaaa1111' })
    const b = syntheticSettlementScope({ ...input, locationId: '01920000-0000-7000-8000-aaaaaaaa2222' })
    expect(a).not.toBe(b)
  })

  it('faellt auf die Order-ID zurueck, wenn keine Vorgangsnummer vorliegt (Offline-Pfad)', () => {
    const scope = syntheticSettlementScope({
      locationId: input.locationId,
      orderId: '01920000-0000-7000-8000-cccccccc3333',
    })
    expect(scope).toContain('nobd')
    expect(scope).toContain('cccc3333')
  })

  it('liefert auch ohne jede Eingabe einen gueltigen Wert', () => {
    // Das Feld ist Pflicht — eine leere Eingabe darf keinen leeren Wert
    // ergeben, sonst scheitert die Validierung und die Kasse steht.
    const scope = syntheticSettlementScope({})
    expect(scope.length).toBeGreaterThan(0)
    expect(scope.length).toBeLessThanOrEqual(SETTLEMENT_SCOPE_MAX_LENGTH)
    expect(isSyntheticSettlementScope(scope)).toBe(true)
  })

  it('bleibt in der DSFinV-K-Feldlaenge', () => {
    const scope = syntheticSettlementScope({
      locationId: 'l'.repeat(200),
      businessDayId: 'b'.repeat(200),
      dailySequenceNumber: 999999999,
    })
    expect(scope.length).toBeLessThanOrEqual(SETTLEMENT_SCOPE_MAX_LENGTH)
  })
})

describe('deriveSettlementScope', () => {
  it('nimmt den Tisch, wenn es einen gibt', () => {
    expect(deriveSettlementScope({ table: '3', locationId: 'loc', dailySequenceNumber: 1 })).toBe('3')
  })

  it('gibt zwei Bestellungen desselben Tisches denselben Kreis — auch bei anderer Vorgangsnummer', () => {
    const a = deriveSettlementScope({ table: '3', locationId: 'loc', dailySequenceNumber: 1 })
    const b = deriveSettlementScope({ table: '3', locationId: 'loc', dailySequenceNumber: 2 })
    expect(a).toBe(b)
  })

  it('wird ohne Tisch synthetisch, nie leer', () => {
    const scope = deriveSettlementScope({ table: null, locationId: 'loc', dailySequenceNumber: 1 })
    expect(isSyntheticSettlementScope(scope)).toBe(true)
  })
})

describe('isSyntheticSettlementScope', () => {
  it('erkennt gewachsene Kreise als nicht-synthetisch', () => {
    expect(isSyntheticSettlementScope('3')).toBe(false)
    expect(isSyntheticSettlementScope('Terrasse')).toBe(false)
  })

  it('haelt Nicht-Werte aus', () => {
    expect(isSyntheticSettlementScope(null)).toBe(false)
    expect(isSyntheticSettlementScope(undefined)).toBe(false)
  })
})
