import { describe, expect, it, vi } from 'vitest'

import { isSyntheticSettlementScope, SETTLEMENT_SCOPE_MAX_LENGTH } from '@panary/orders/domain'

import { assignSettlementScope } from './assign-settlement-scope.hook'

vi.mock('@panary/shared-backend', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const run = async (data: unknown, params: Record<string, unknown> = {}) => {
  const context = { data, params, method: 'create', path: 'orders' } as never
  await assignSettlementScope()(context)
  return (context as { data: Record<string, unknown> }).data
}

describe('assignSettlementScope', () => {
  it('stempelt den Tischwert als Abrechnungskreis', async () => {
    const data = await run({ table: '3', locationId: 'loc', businessDayId: 'bd', dailySequenceNumber: 7 })
    expect(data['settlementScope']).toBe('3')
  })

  it('gibt zwei Bestellungen desselben Tisches denselben Kreis', async () => {
    const a = await run({ table: '3', locationId: 'loc', businessDayId: 'bd', dailySequenceNumber: 7 })
    const b = await run({ table: '3', locationId: 'loc', businessDayId: 'bd', dailySequenceNumber: 8 })
    expect(a['settlementScope']).toBe(b['settlementScope'])
  })

  it('setzt ohne Tisch einen erkennbar synthetischen Wert — nie leer, nie null', async () => {
    const data = await run({ locationId: 'loc', businessDayId: 'bd', dailySequenceNumber: 7 })
    expect(typeof data['settlementScope']).toBe('string')
    expect(isSyntheticSettlementScope(data['settlementScope'] as string)).toBe(true)
  })

  it('behandelt einen leeren Tischwert wie keinen Tisch', async () => {
    const data = await run({ table: '   ', locationId: 'loc', dailySequenceNumber: 7 })
    expect(isSyntheticSettlementScope(data['settlementScope'] as string)).toBe(true)
  })

  it('uebernimmt einen mitgeschickten Wert (Offline-Replay) unveraendert', async () => {
    const data = await run({ table: '3', settlementScope: 'auto:offline-1234abcd' })
    expect(data['settlementScope']).toBe('auto:offline-1234abcd')
  })

  it('kappt einen mitgeschickten Wert auf die DSFinV-K-Feldlaenge', async () => {
    const data = await run({ settlementScope: 'x'.repeat(200) })
    expect(data['settlementScope']).toHaveLength(SETTLEMENT_SCOPE_MAX_LENGTH)
  })

  it('faellt auf den Standort aus dem Token zurueck, wenn der Stempel ausblieb', async () => {
    const data = await run({ dailySequenceNumber: 7 }, { user: { locationId: 'aaaabbbbcccc' } })
    expect(data['settlementScope']).toContain('bbbbcccc')
  })

  it('blockiert nie — ein unbrauchbarer Body laeuft durch, statt zu werfen', async () => {
    // Ein Pflichtfeld mit serverseitigem Default ist ein Fiskal-Gate: Wirft der
    // Hook, nimmt die Kasse keine Bestellung mehr an. Hier steht deshalb
    // bewusst kein `expect(...).toThrow()`.
    await expect(run(null)).resolves.toBeNull()
    await expect(run(undefined)).resolves.toBeUndefined()
  })

  it('setzt auch dann einen gueltigen Wert, wenn die Ableitung wirft (fail-open)', async () => {
    // Ein Getter, der wirft, simuliert den Ausfall des Ableitungspfads. Der
    // Hook muss den Fehler schlucken und trotzdem einen Wert hinterlassen.
    const data: Record<string, unknown> = {}
    Object.defineProperty(data, 'table', {
      get() {
        throw new Error('Ableitung kaputt')
      },
      enumerable: true,
    })
    Object.defineProperty(data, '_id', { value: '01920000-0000-7000-8000-dddddddd4444', enumerable: true })

    const result = await run(data)
    expect(isSyntheticSettlementScope(result['settlementScope'] as string)).toBe(true)
    expect(result['settlementScope']).toContain('dddd4444')
  })
})
