import { describe, expect, it, vi } from 'vitest'

import { isSyntheticSettlementScope, SETTLEMENT_SCOPE_MAX_LENGTH } from '@panary/orders/domain'

import { assignSettlementScope } from './assign-settlement-scope.hook'

vi.mock('@panary/shared-backend', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const run = async (data: unknown, params: Record<string, unknown> = {}, app?: unknown) => {
  const context = { data, params, app, method: 'create', path: 'orders' } as never
  await assignSettlementScope()(context)
  return (context as { data: Record<string, unknown> }).data
}

const TENANT = '01920000-0000-7000-8000-aaaaaaaa0001'
const OPERATOR = '01920000-0000-7000-8000-bbbbbbbb0002'

/** Fake-App je Test: `orders.find` liefert `tableOrders`, `users.get` den Bediener. */
const fakeApp = (tableOrders: unknown[], operatorTenant: string | null = TENANT) => {
  const find = vi.fn(async () => tableOrders)
  const get = vi.fn(async () => {
    if (operatorTenant === null) throw new Error('nicht gefunden')
    return { tenantId: operatorTenant }
  })
  const app = { service: (path: string) => (path === 'orders' ? { find } : { get }) }
  return { app, find, get }
}

const tableOrder = (extra: Record<string, unknown> = {}) => ({
  table: '4',
  tenantId: TENANT,
  locationId: 'loc',
  businessDayId: 'bd',
  dailySequenceNumber: 9,
  creationContext: { createdBy: OPERATOR },
  recordingDate: '2026-10-28T10:00:00.000Z',
  ...extra,
})

describe('assignSettlementScope', () => {
  it('stempelt den Tischwert mit Besuch als Abrechnungskreis', async () => {
    const data = await run({ table: '3', locationId: 'loc', businessDayId: 'bd', dailySequenceNumber: 7 })
    expect(data['settlementScope']).toBe('3#1')
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

  it('uebernimmt einen Wert ohne Besuch (alter Client) unveraendert, ohne nachzuschlagen', async () => {
    const { app, find } = fakeApp([{ settlementScope: '4', status: 'completed' }])
    const data = await run(tableOrder({ settlementScope: '4' }), {}, app)
    expect(data['settlementScope']).toBe('4')
    expect(find).not.toHaveBeenCalled()
  })

  it('setzt einen offenen Besuch fort', async () => {
    const { app } = fakeApp([{ settlementScope: '4#1', status: 'active' }])
    const data = await run(tableOrder(), {}, app)
    expect(data['settlementScope']).toBe('4#1')
  })

  it('eroeffnet nach einem kassierten Besuch den naechsten', async () => {
    const { app } = fakeApp([{ settlementScope: '4#1', status: 'completed' }])
    const data = await run(tableOrder(), {}, app)
    expect(data['settlementScope']).toBe('4#2')
  })

  it('liest die Kreise mit Mandant, Standort und Geschaeftstag, intern und ungepaged', async () => {
    const { app, find } = fakeApp([])
    await run(tableOrder({ settlementScope: '4#1' }), {}, app)
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: undefined,
        paginate: false,
        query: expect.objectContaining({
          tenantId: TENANT,
          locationId: 'loc',
          businessDayId: 'bd',
          $or: [{ table: '4' }, { settlementScope: '4#1' }],
        }),
      }),
    )
  })

  it('behaelt einen mitgeschickten Besuch, der offen ist', async () => {
    const { app } = fakeApp([{ settlementScope: '4#1', status: 'produced' }])
    const params: Record<string, unknown> = {}
    const data = await run(tableOrder({ settlementScope: '4#1' }), params, app)
    expect(data['settlementScope']).toBe('4#1')
    expect(params['orderInteractions']).toBeUndefined()
  })

  it('behaelt einen mitgeschickten Besuch, den der Edge noch nicht kennt', async () => {
    const { app } = fakeApp([{ settlementScope: '4#1', status: 'completed' }])
    const data = await run(tableOrder({ settlementScope: '4#2' }), {}, app)
    expect(data['settlementScope']).toBe('4#2')
  })

  it('ordnet eine Bestellung fuer einen geschlossenen Besuch dem naechsten zu und vermerkt es im Journal', async () => {
    const { app } = fakeApp([{ settlementScope: '4#1', status: 'completed' }])
    const params: Record<string, unknown> = {}
    const data = await run(tableOrder({ settlementScope: '4#1' }), params, app)

    expect(data['settlementScope']).toBe('4#2')
    expect(params['orderInteractions']).toEqual([
      expect.objectContaining({
        type: 'settlement-scope-reassigned',
        userId: OPERATOR,
        businessDayId: 'bd',
        tenantId: TENANT,
        orderOpenedAt: '2026-10-28T10:00:00.000Z',
      }),
    ])
  })

  it('haengt die Umsetzung an einen schon offenen Folgebesuch', async () => {
    const { app } = fakeApp([
      { settlementScope: '4#1', status: 'completed' },
      { settlementScope: '4#2', status: 'active' },
    ])
    const data = await run(tableOrder({ settlementScope: '4#1' }), {}, app)
    expect(data['settlementScope']).toBe('4#2')
  })

  it('laesst einem Split den Kreis seiner Quelle, auch wenn der Besuch geschlossen ist', async () => {
    const { app, find } = fakeApp([{ settlementScope: '4#1', status: 'unclaimed' }])
    const params: Record<string, unknown> = { inheritSettlementScope: true }
    const data = await run(tableOrder({ settlementScope: '4#1' }), params, app)
    expect(data['settlementScope']).toBe('4#1')
    expect(find).not.toHaveBeenCalled()
    expect(params['orderInteractions']).toBeUndefined()
  })

  it('schreibt keinen Journal-Eintrag, wenn der Bediener nicht zum Mandanten gehoert', async () => {
    const { app } = fakeApp([{ settlementScope: '4#1', status: 'completed' }], '01920000-0000-7000-8000-cccccccc0003')
    const params: Record<string, unknown> = {}
    const data = await run(tableOrder({ settlementScope: '4#1' }), params, app)
    expect(data['settlementScope']).toBe('4#2')
    expect(params['orderInteractions']).toBeUndefined()
  })

  it('haengt den Journal-Eintrag an mitgeschickte Interaktionen an, statt sie zu ersetzen', async () => {
    const { app } = fakeApp([{ settlementScope: '4#1', status: 'completed' }])
    const params: Record<string, unknown> = { orderInteractions: [{ type: 'item-delete' }] }
    await run(tableOrder({ settlementScope: '4#1' }), params, app)
    expect((params['orderInteractions'] as unknown[]).map(i => (i as { type: string }).type)).toEqual([
      'item-delete',
      'settlement-scope-reassigned',
    ])
  })

  it('faellt bei einem zu langen Label synthetisch zurueck, statt zu kuerzen', async () => {
    const { app } = fakeApp([])
    const data = await run(tableOrder({ table: 'x'.repeat(49) }), {}, app)
    expect(isSyntheticSettlementScope(data['settlementScope'] as string)).toBe(true)
  })

  it('blockiert nicht, wenn das Nachschlagen scheitert — der mitgeschickte Besuch gilt', async () => {
    const app = {
      service: () => ({
        find: async () => {
          throw new Error('SQLite weg')
        },
      }),
    }
    const data = await run(tableOrder({ settlementScope: '4#1' }), {}, app)
    expect(data['settlementScope']).toBe('4#1')
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
