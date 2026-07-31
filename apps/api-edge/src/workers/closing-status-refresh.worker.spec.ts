// Regression-Anker fuer die Log-Disziplin und den Backoff des
// Closing-Status-Refresh-Workers.
//
// Ausloeser (2026-07-31): im lokalen Edge-Terminal lief alle 30s dieselbe Zeile
// `refreshedCount=5 transitionedCount=0` durch — sechs Geschaeftstage hingen
// seit zwei Monaten in `closing-requested`, weil die Cloud nie einen Report
// angelegt hatte. Der Worker pollte sie fuer immer weiter: pro Tag und Tick ein
// Cloud-Roundtrip, ohne dass sich je etwas aenderte.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@panary/shared-backend'

import { backoffTicks, createTickState, runTick, stuckForMs } from './closing-status-refresh.worker'

vi.mock('@panary/shared-backend', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

const config = { enabled: true, intervalMs: 30_000, jitterMs: 0, maxPerTick: 5 }

interface Row {
  _id: string
  status?: string
  tenantId?: string
  updatedAt?: string
}

const row = (over: Partial<Row> = {}): Row => ({
  _id: 'bd-1',
  status: 'closing-requested',
  tenantId: 't1',
  updatedAt: new Date().toISOString(),
  ...over,
})

/** Mock-App; `nextStatus` steuert, was refreshClosingStatus zurueckliefert. */
function makeApp(rows: Row[], nextStatus?: (id: string) => string | undefined) {
  const refreshCalls: string[] = []
  const app = {
    service: (path: string) => {
      if (path !== 'businessdays') throw new Error(`unexpected service ${path}`)
      return {
        find: async () => ({ data: rows }),
        refreshClosingStatus: async ({ businessDayId }: { businessDayId: string }) => {
          refreshCalls.push(businessDayId)
          return { _id: businessDayId, status: nextStatus?.(businessDayId) ?? 'closing-requested' }
        },
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test-Mock der Feathers-App.
  } as any
  return { app, refreshCalls }
}

describe('backoffTicks', () => {
  it('pollt die ersten zehn Versuche mit voller Frequenz', () => {
    // Ein normaler Abschluss ist in wenigen Minuten durch — der Backoff darf den
    // Fall, fuer den der Worker existiert, nicht ausbremsen.
    for (let n = 1; n <= 10; n++) expect(backoffTicks(n)).toBe(1)
  })

  it('waechst danach exponentiell und deckelt bei einer Stunde', () => {
    expect(backoffTicks(11)).toBe(2)
    expect(backoffTicks(12)).toBe(4)
    expect(backoffTicks(13)).toBe(8)
    expect(backoffTicks(50)).toBe(120)
  })
})

describe('stuckForMs', () => {
  it('rechnet die Verweildauer aus updatedAt', () => {
    const now = Date.parse('2026-07-31T00:00:00.000Z')
    expect(stuckForMs({ _id: 'x', updatedAt: '2026-07-30T00:00:00.000Z' }, now)).toBe(86_400_000)
  })

  it('liefert null bei fehlendem oder kaputtem Zeitstempel', () => {
    expect(stuckForMs({ _id: 'x' }, Date.now())).toBeNull()
    expect(stuckForMs({ _id: 'x', updatedAt: 'kein-datum' }, Date.now())).toBeNull()
  })
})

describe('runTick — Log-Disziplin', () => {
  beforeEach(() => vi.clearAllMocks())

  it('schweigt, wenn sich nichts geaendert hat', async () => {
    const { app } = makeApp([row()])
    await runTick(app, config, createTickState())
    expect(logger.info).not.toHaveBeenCalled()
  })

  it('loggt genau dann, wenn ein Tag den Status wechselt', async () => {
    const { app } = makeApp([row()], () => 'closed')
    await runTick(app, config, createTickState())

    expect(logger.info).toHaveBeenCalledTimes(1)
    expect(vi.mocked(logger.info).mock.calls[0][0]).toMatchObject({
      event: 'business_day.refresh.tick_done',
      transitionedCount: 1,
    })
  })

  it('schweigt auch bei leerer Trefferliste', async () => {
    const { app } = makeApp([])
    await runTick(app, config, createTickState())
    expect(logger.info).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })
})

describe('runTick — Backoff', () => {
  beforeEach(() => vi.clearAllMocks())

  it('drosselt einen Tag, der dauerhaft nicht aufloest', async () => {
    const { app, refreshCalls } = makeApp([row()])
    const state = createTickState()

    // 10 Ticks volle Frequenz, danach greift der Backoff (naechster Versuch
    // erst zwei Ticks spaeter).
    for (let i = 0; i < 12; i++) await runTick(app, config, state)

    expect(refreshCalls.length).toBe(11)
    expect(state.byDay.get('bd-1')?.attempts).toBe(11)
  })

  it('spart auf lange Sicht den Grossteil der Cloud-Roundtrips', async () => {
    const { app, refreshCalls } = makeApp([row()])
    const state = createTickState()

    for (let i = 0; i < 200; i++) await runTick(app, config, state)

    // Ohne Backoff waeren es 200 Roundtrips fuer einen Tag, der sich nie aendert.
    expect(refreshCalls.length).toBeLessThan(20)
  })

  it('setzt den Backoff zurueck, sobald ein Tag wieder lebt', async () => {
    let status = 'closing-requested'
    const { app } = makeApp([row()], () => status)
    const state = createTickState()

    for (let i = 0; i < 12; i++) await runTick(app, config, state)
    expect(state.byDay.get('bd-1')?.attempts).toBeGreaterThan(0)

    // Folgeschritt closing-requested → aggregating darf nicht in der langen
    // Wartezeit haengen bleiben.
    status = 'closing-aggregating'
    state.byDay.get('bd-1')!.nextTick = state.tick + 1
    await runTick(app, config, state)

    expect(state.byDay.get('bd-1')?.attempts).toBe(0)
  })

  it('raeumt Tage aus dem Register, die den Closing-Status verlassen haben', async () => {
    const rows = [row(), row({ _id: 'bd-2' })]
    const { app } = makeApp(rows)
    const state = createTickState()

    await runTick(app, config, state)
    expect(state.byDay.size).toBe(2)

    rows.splice(1, 1) // bd-2 ist durch → taucht im find nicht mehr auf
    await runTick(app, config, state)
    expect([...state.byDay.keys()]).toEqual(['bd-1'])
  })
})

describe('runTick — Haenger-Warnung', () => {
  beforeEach(() => vi.clearAllMocks())

  it('meldet einen lange haengenden Tag genau einmal', async () => {
    const alt = new Date(Date.now() - 48 * 3_600_000).toISOString()
    const { app } = makeApp([row({ updatedAt: alt })])
    const state = createTickState()

    for (let i = 0; i < 5; i++) await runTick(app, config, state)

    const stuckWarns = vi
      .mocked(logger.warn)
      .mock.calls.filter(c => (c[0] as { event?: string })?.event === 'business_day.refresh.stuck')
    expect(stuckWarns).toHaveLength(1)
    expect(stuckWarns[0][0]).toMatchObject({ businessDayId: 'bd-1', stuckForHours: 48 })
  })

  it('warnt nicht bei einem frisch angestossenen Abschluss', async () => {
    const { app } = makeApp([row()])
    await runTick(app, config, createTickState())
    expect(logger.warn).not.toHaveBeenCalled()
  })
})
