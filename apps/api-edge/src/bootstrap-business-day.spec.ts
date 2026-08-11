import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@panary/shared-backend', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

const isLocalRotationAllowed = vi.fn()
const shouldAutoRotate = vi.fn()
const hasActiveOrders = vi.fn()
const rotateBusinessDay = vi.fn()
const loadBusinessDayRuntime = vi.fn()
vi.mock('./utils/business-day.utils', () => ({
  isLocalRotationAllowed: (...a: unknown[]) => isLocalRotationAllowed(...a),
  shouldAutoRotate: (...a: unknown[]) => shouldAutoRotate(...a),
  hasActiveOrders: (...a: unknown[]) => hasActiveOrders(...a),
  rotateBusinessDay: (...a: unknown[]) => rotateBusinessDay(...a),
  loadBusinessDayRuntime: (...a: unknown[]) => loadBusinessDayRuntime(...a),
}))

import { autoEnsureBusinessDay } from './bootstrap-business-day'

/**
 * Stub-App mit Knex-Doppel. `system.mode` wird bewusst mitgegeben, obwohl der
 * Boot-Pfad ihn nicht mehr auswerten darf — genau das prueft die Suite.
 */
function makeApp(opts: { systemMode?: string; locations?: Array<Record<string, unknown>> }): any {
  const rows = opts.locations ?? [{ _id: 'loc-1', tenantId: 't-1', currentBusinessDay: null }]
  const select = vi.fn().mockResolvedValue(rows)
  const knex = vi.fn(() => ({ select }))
  return {
    __select: select,
    get: (key: string) => {
      if (key === 'system') return { mode: opts.systemMode ?? 'standalone' }
      if (key === 'sqliteClient') return knex
      return undefined
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  hasActiveOrders.mockResolvedValue(false)
  rotateBusinessDay.mockResolvedValue('bd-new')
  loadBusinessDayRuntime.mockResolvedValue({ openHours: 30 })
})

describe('autoEnsureBusinessDay', () => {
  // Kern der Entkopplung: frueher hat `systemMode !== 'standalone'` hier hart
  // abgebrochen. Sobald der Modus aus dem Pairing abgeleitet wird, haette das
  // die Boot-Rotation auf jedem gepairten Edge stillgelegt — auch mit Override.
  it.each(['standalone', 'connected'])(
    'rotiert bei erlaubter lokaler Rotation, unabhängig vom systemMode (%s)',
    async systemMode => {
      isLocalRotationAllowed.mockResolvedValue(true)
      shouldAutoRotate.mockReturnValue(true)

      await autoEnsureBusinessDay(makeApp({ systemMode }))

      expect(rotateBusinessDay).toHaveBeenCalledTimes(1)
    },
  )

  // Tier 1 hat keinen Edge-Lifecycle — dort pflegt die Cloud die Tage. Diese
  // eine Modus-Pruefung bleibt bewusst bestehen; sie beantwortet nicht „darf
  // lokal rotiert werden", sondern „gibt es hier ueberhaupt einen lokalen
  // Lifecycle".
  it('rotiert im konfigurierten cloud-Modus gar nicht, auch ohne Pairing', async () => {
    isLocalRotationAllowed.mockResolvedValue(true)
    shouldAutoRotate.mockReturnValue(true)

    await autoEnsureBusinessDay(makeApp({ systemMode: 'cloud' }))

    expect(rotateBusinessDay).not.toHaveBeenCalled()
    expect(isLocalRotationAllowed).not.toHaveBeenCalled()
  })

  it('überspringt die Rotation, wenn das Pairing sie verbietet', async () => {
    isLocalRotationAllowed.mockResolvedValue(false)
    shouldAutoRotate.mockReturnValue(true)

    await autoEnsureBusinessDay(makeApp({ systemMode: 'standalone' }))

    expect(rotateBusinessDay).not.toHaveBeenCalled()
  })

  it('rotiert nicht, wenn der Geschäftstag bereits aktuell ist', async () => {
    isLocalRotationAllowed.mockResolvedValue(true)
    shouldAutoRotate.mockReturnValue(false)

    await autoEnsureBusinessDay(makeApp({}))

    expect(rotateBusinessDay).not.toHaveBeenCalled()
  })

  it('überspringt eine Location mit aktiven Bestellungen im alten Geschäftstag', async () => {
    isLocalRotationAllowed.mockResolvedValue(true)
    shouldAutoRotate.mockReturnValue(true)
    hasActiveOrders.mockResolvedValue(true)

    await autoEnsureBusinessDay(
      makeApp({
        locations: [
          {
            _id: 'loc-1',
            tenantId: 't-1',
            currentBusinessDay: JSON.stringify({ businessDayId: 'bd-old', date: '2026-05-01' }),
          },
        ],
      }),
    )

    expect(rotateBusinessDay).not.toHaveBeenCalled()
  })

  it('parst currentBusinessDay aus dem SQLite-JSON-Text', async () => {
    isLocalRotationAllowed.mockResolvedValue(true)
    shouldAutoRotate.mockReturnValue(true)

    await autoEnsureBusinessDay(
      makeApp({
        locations: [
          {
            _id: 'loc-1',
            tenantId: 't-1',
            currentBusinessDay: JSON.stringify({ businessDayId: 'bd-old', date: '2026-05-01' }),
          },
        ],
      }),
    )

    expect(shouldAutoRotate).toHaveBeenCalledWith(
      { businessDayId: 'bd-old', date: '2026-05-01' },
      expect.any(String),
      30,
    )
  })

  // Der Mindest-Laufzeit-Guard entscheidet nur mit, wenn der Boot-Pfad die
  // Laufzeit auch beschafft — sonst rotierte er wieder allein am Kalendertag.
  it('reicht die Laufzeit des Geschäftstags an den Rotations-Guard durch', async () => {
    isLocalRotationAllowed.mockResolvedValue(true)
    shouldAutoRotate.mockReturnValue(false)
    loadBusinessDayRuntime.mockResolvedValue({ openHours: 6 })

    await autoEnsureBusinessDay(
      makeApp({
        locations: [
          {
            _id: 'loc-1',
            tenantId: 't-1',
            currentBusinessDay: JSON.stringify({ businessDayId: 'bd-night', date: '2026-07-29' }),
          },
        ],
      }),
    )

    expect(loadBusinessDayRuntime).toHaveBeenCalledWith(expect.anything(), 'bd-night')
    expect(shouldAutoRotate.mock.calls[0][2]).toBe(6)
  })

  // Ein verwaister Zeiger auf EINER Filiale darf den Lauf ueber alle uebrigen
  // nicht abbrechen — und die betroffene rotiert dann ohne Mindest-Laufzeit,
  // statt stehenzubleiben.
  it('bricht nicht ab, wenn der Geschäftstag einer Location nicht ladbar ist', async () => {
    isLocalRotationAllowed.mockResolvedValue(true)
    shouldAutoRotate.mockReturnValue(true)
    loadBusinessDayRuntime.mockRejectedValueOnce(new Error('No record found for id bd-weg'))

    await autoEnsureBusinessDay(
      makeApp({
        locations: [
          {
            _id: 'loc-kaputt',
            tenantId: 't-1',
            currentBusinessDay: JSON.stringify({ businessDayId: 'bd-weg', date: '2026-07-29' }),
          },
          { _id: 'loc-ok', tenantId: 't-1', currentBusinessDay: null },
        ],
      }),
    )

    expect(shouldAutoRotate.mock.calls[0][2]).toBeNull()
    expect(rotateBusinessDay).toHaveBeenCalledTimes(2)
  })

  it('lädt gar keine Laufzeit, wenn die Location noch keinen Geschäftstag hat', async () => {
    isLocalRotationAllowed.mockResolvedValue(true)
    shouldAutoRotate.mockReturnValue(true)

    await autoEnsureBusinessDay(makeApp({}))

    expect(loadBusinessDayRuntime).not.toHaveBeenCalled()
    expect(shouldAutoRotate.mock.calls[0][2]).toBeNull()
  })

  // Ohne `settings` in der Projektion bekaeme `businessDateForLocation` immer
  // `undefined` und faellt still auf Europe/Berlin zurueck — fuer jede Filiale
  // ausserhalb dieser Zone waere der Fix damit wirkungslos, ohne dass irgendetwas
  // auffiele. Die Spalte ist Teil des Vertrags, nicht Beiwerk.
  it('liest die settings-Spalte mit, damit die Zeitzone der Filiale ankommt', async () => {
    isLocalRotationAllowed.mockResolvedValue(true)
    shouldAutoRotate.mockReturnValue(false)
    const app = makeApp({})

    await autoEnsureBusinessDay(app)

    expect(app.__select).toHaveBeenCalledWith('_id', 'tenantId', 'currentBusinessDay', 'settings')
  })

  // Der Kern von #154 auf dem Boot-Pfad: `today` kommt aus der Zeitzone der
  // jeweiligen Filiale. Zwei Standorte mit unterschiedlicher Zone im selben Lauf
  // schliessen beide Fehlerbilder aus — ein UTC-Anker wie auch ein fest
  // verdrahteter Fallback lieferte fuer beide denselben Tag.
  it('leitet den Kalendertag pro Filiale aus deren Zeitzone ab', async () => {
    isLocalRotationAllowed.mockResolvedValue(true)
    shouldAutoRotate.mockReturnValue(false)
    // 29.07.2026 22:30 UTC — in Auckland (UTC+12) schon der 30., in Los Angeles
    // (UTC-7) noch der 29.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-29T22:30:00Z'))

    try {
      await autoEnsureBusinessDay(
        makeApp({
          locations: [
            {
              _id: 'loc-nz',
              tenantId: 't-1',
              currentBusinessDay: null,
              settings: JSON.stringify({ generalSettings: { timezone: 'Pacific/Auckland' } }),
            },
            {
              _id: 'loc-us',
              tenantId: 't-1',
              currentBusinessDay: null,
              settings: JSON.stringify({ generalSettings: { timezone: 'America/Los_Angeles' } }),
            },
          ],
        }),
      )
    } finally {
      vi.useRealTimers()
    }

    expect(shouldAutoRotate.mock.calls.map(call => call[1])).toEqual(['2026-07-30', '2026-07-29'])
  })

  it('kommt mit fehlenden oder kaputten settings aus (Fallback-Zone)', async () => {
    isLocalRotationAllowed.mockResolvedValue(true)
    shouldAutoRotate.mockReturnValue(false)

    await autoEnsureBusinessDay(
      makeApp({
        locations: [
          { _id: 'loc-1', tenantId: 't-1', currentBusinessDay: null, settings: null },
          { _id: 'loc-2', tenantId: 't-1', currentBusinessDay: null, settings: '{kein json' },
        ],
      }),
    )

    expect(shouldAutoRotate).toHaveBeenCalledTimes(2)
    for (const call of shouldAutoRotate.mock.calls) {
      expect(call[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
})
