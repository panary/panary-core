import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@panary/shared-backend', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

const isLocalRotationAllowed = vi.fn()
const shouldAutoRotate = vi.fn()
const hasActiveOrders = vi.fn()
const rotateBusinessDay = vi.fn()
vi.mock('./utils/business-day.utils', () => ({
  isLocalRotationAllowed: (...a: unknown[]) => isLocalRotationAllowed(...a),
  shouldAutoRotate: (...a: unknown[]) => shouldAutoRotate(...a),
  hasActiveOrders: (...a: unknown[]) => hasActiveOrders(...a),
  rotateBusinessDay: (...a: unknown[]) => rotateBusinessDay(...a),
}))

import { autoEnsureBusinessDay } from './bootstrap-business-day'

/**
 * Stub-App mit Knex-Doppel. `system.mode` wird bewusst mitgegeben, obwohl der
 * Boot-Pfad ihn nicht mehr auswerten darf — genau das prueft die Suite.
 */
function makeApp(opts: { systemMode?: string; locations?: Array<Record<string, unknown>> }): any {
  const rows = opts.locations ?? [{ _id: 'loc-1', tenantId: 't-1', currentBusinessDay: null }]
  const knex = vi.fn(() => ({ select: vi.fn().mockResolvedValue(rows) }))
  return {
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
})

describe('autoEnsureBusinessDay', () => {
  // Kern der Entkopplung: frueher hat `systemMode !== 'standalone'` hier hart
  // abgebrochen. Sobald der Modus aus dem Pairing abgeleitet wird, haette das
  // die Boot-Rotation auf jedem gepairten Edge stillgelegt — auch mit Override.
  it.each(['standalone', 'connected', 'cloud'])(
    'rotiert bei erlaubter lokaler Rotation, unabhängig vom systemMode (%s)',
    async systemMode => {
      isLocalRotationAllowed.mockResolvedValue(true)
      shouldAutoRotate.mockReturnValue(true)

      await autoEnsureBusinessDay(makeApp({ systemMode }))

      expect(rotateBusinessDay).toHaveBeenCalledTimes(1)
    },
  )

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
          { _id: 'loc-1', tenantId: 't-1', currentBusinessDay: JSON.stringify({ businessDayId: 'bd-old', date: '2026-05-01' }) },
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
          { _id: 'loc-1', tenantId: 't-1', currentBusinessDay: JSON.stringify({ businessDayId: 'bd-old', date: '2026-05-01' }) },
        ],
      }),
    )

    expect(shouldAutoRotate).toHaveBeenCalledWith({ businessDayId: 'bd-old', date: '2026-05-01' }, expect.any(String))
  })
})
