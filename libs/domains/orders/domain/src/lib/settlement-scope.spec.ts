import { describe, expect, it } from 'vitest'

import {
  deriveSettlementScope,
  isSettlementScopeOpen,
  isSyntheticSettlementScope,
  parseVisitSettlementScope,
  SETTLEMENT_SCOPE_MAX_LENGTH,
  settlementScopeFromTable,
  SYNTHETIC_SETTLEMENT_SCOPE_PREFIX,
  syntheticSettlementScope,
  visitSettlementScope,
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
  it('nimmt den Tisch mit Besuch, wenn es einen gibt', () => {
    expect(deriveSettlementScope({ table: '3', locationId: 'loc', dailySequenceNumber: 1 })).toBe('3#1')
  })

  it('setzt einen offenen Besuch des Tisches fort', () => {
    const scope = deriveSettlementScope({
      table: '3',
      dailySequenceNumber: 2,
      tableOrders: [{ settlementScope: '3#1', status: 'active' }],
    })
    expect(scope).toBe('3#1')
  })

  it('faellt synthetisch zurueck, wenn `<Label>#<n>` nicht in 50 Zeichen passt — nie gekuerzt', () => {
    const scope = deriveSettlementScope({ table: 'x'.repeat(49), locationId: 'loc', dailySequenceNumber: 1 })
    expect(isSyntheticSettlementScope(scope)).toBe(true)
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

describe('visitSettlementScope', () => {
  it('beginnt am unbesuchten Tisch mit Besuch 1', () => {
    expect(visitSettlementScope('4')).toBe('4#1')
    expect(visitSettlementScope('  4 ', [])).toBe('4#1')
  })

  it('haengt eine Nachbestellung an den offenen Besuch', () => {
    expect(visitSettlementScope('4', [{ settlementScope: '4#1', status: 'production' }])).toBe('4#1')
  })

  it('eroeffnet nach einem geschlossenen Besuch den naechsten', () => {
    const orders = [
      { settlementScope: '4#1', status: 'completed' },
      { settlementScope: '4#1', status: 'aborted' },
    ]
    expect(visitSettlementScope('4', orders)).toBe('4#2')
  })

  it('zaehlt `unclaimed` als geschlossen', () => {
    expect(visitSettlementScope('4', [{ settlementScope: '4#1', status: 'unclaimed' }])).toBe('4#2')
  })

  it('nimmt bei mehreren offenen Besuchen den hoechsten', () => {
    const orders = [
      { settlementScope: '4#1', status: 'active' },
      { settlementScope: '4#3', status: 'produced' },
      { settlementScope: '4#2', status: 'completed' },
    ]
    expect(visitSettlementScope('4', orders)).toBe('4#3')
  })

  it('zaehlt den Kreis eines alten Clients (nur Label) als Besuch 0 und setzt ihn nicht fort', () => {
    expect(visitSettlementScope('4', [{ settlementScope: '4', status: 'active' }])).toBe('4#1')
  })

  it('ignoriert Kreise anderer Tische und synthetische Kreise', () => {
    const orders = [
      { settlementScope: '14#5', status: 'active' },
      { settlementScope: 'auto:x-y-1', status: 'active' },
    ]
    expect(visitSettlementScope('4', orders)).toBe('4#1')
  })

  it('verkraftet ein Label, das selbst `#<Zahl>` enthaelt', () => {
    expect(visitSettlementScope('Bar#2', [{ settlementScope: 'Bar#2#1', status: 'completed' }])).toBe('Bar#2#2')
  })

  it('liefert genau bis 50 Zeichen einen Kreis, darueber null', () => {
    expect(visitSettlementScope('x'.repeat(48))).toHaveLength(SETTLEMENT_SCOPE_MAX_LENGTH)
    expect(visitSettlementScope('x'.repeat(49))).toBeNull()
  })

  it('meldet ohne Tisch null', () => {
    expect(visitSettlementScope(null)).toBeNull()
    expect(visitSettlementScope('   ')).toBeNull()
  })
})

describe('parseVisitSettlementScope', () => {
  it('zerlegt `<Label>#<n>`', () => {
    expect(parseVisitSettlementScope('4#12')).toEqual({ label: '4', visit: 12 })
  })

  it('erkennt Kreise ohne Besuch nicht als Besuch', () => {
    expect(parseVisitSettlementScope('4')).toBeNull()
    expect(parseVisitSettlementScope('4#0')).toBeNull()
    expect(parseVisitSettlementScope('#3')).toBeNull()
    expect(parseVisitSettlementScope('auto:abc#3')).toBeNull()
    expect(parseVisitSettlementScope(null)).toBeNull()
  })
})

describe('isSettlementScopeOpen', () => {
  it('ist offen, solange eine Bestellung des Kreises nicht terminal ist', () => {
    const orders = [
      { settlementScope: '4#1', status: 'completed' },
      { settlementScope: '4#1', status: 'produced' },
    ]
    expect(isSettlementScopeOpen('4#1', orders)).toBe(true)
  })

  it('ist geschlossen, wenn alle Bestellungen terminal sind — oder es keine gibt', () => {
    expect(isSettlementScopeOpen('4#1', [{ settlementScope: '4#1', status: 'completed' }])).toBe(false)
    expect(isSettlementScopeOpen('4#1', [{ settlementScope: '4#2', status: 'active' }])).toBe(false)
    expect(isSettlementScopeOpen('4#1', [])).toBe(false)
  })
})
