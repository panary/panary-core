import { beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@panary/shared-backend'

import { collectDeviceCountsForHeartbeat } from './heartbeat-device-counts'

vi.mock('@panary/shared-backend', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test-Mock der Feathers-App.
const makeApp = (find: (params: unknown) => unknown): any => ({
  service: (path: string) => {
    if (path !== 'device-connections') throw new Error(`unexpected service ${path}`)
    return { find }
  },
})

describe('collectDeviceCountsForHeartbeat', () => {
  beforeEach(() => vi.clearAllMocks())

  it('liefert die Zählwerte des device-connections-Service', async () => {
    const app = makeApp(async () => ({ online: 2, total: 3, connectedDeviceIds: ['a', 'b'] }))

    const counts = await collectDeviceCountsForHeartbeat(app, 't1')

    // connectedDeviceIds wird bewusst verworfen — die Cloud kann Edge-deviceIds
    // nicht auflösen, und eine Liste wäre eine unbegrenzt wachsende Nutzlast.
    expect(counts).toEqual({ online: 2, total: 3 })
  })

  it('ruft den Service intern und mit Tenant-Kontext auf', async () => {
    const find = vi.fn(async () => ({ online: 0, total: 0 }))
    await collectDeviceCountsForHeartbeat(makeApp(find), 't1')

    // provider: undefined ist Pflicht — sonst greifen authenticate/authorize
    // und der Worker bekäme 403 statt Zahlen.
    expect(find).toHaveBeenCalledWith({ provider: undefined, user: { tenantId: 't1' } })
  })

  it('liefert null ohne tenantId, ohne den Service anzufassen', async () => {
    const find = vi.fn()
    expect(await collectDeviceCountsForHeartbeat(makeApp(find), undefined)).toBeNull()
    expect(find).not.toHaveBeenCalled()
  })

  it('FAILURE-ISOLATION: wirft nie, sondern liefert null und loggt', async () => {
    // Der wichtigste Test dieser Datei. runHeartbeat trägt die Token-Rotation,
    // und drei Fehlschläge aktivieren den Notfall-Modus der Edge — eine
    // Telemetrie-Nebensache darf das niemals auslösen.
    const app = makeApp(async () => {
      throw new Error('SQLITE_BUSY')
    })

    await expect(collectDeviceCountsForHeartbeat(app, 't1')).resolves.toBeNull()
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'sync.heartbeat.device_counts_failed' }),
    )
  })

  it('liefert null bei unvollständiger Service-Antwort, statt einen halben Report zu senden', async () => {
    expect(
      await collectDeviceCountsForHeartbeat(
        makeApp(async () => ({ online: 2 })),
        't1',
      ),
    ).toBeNull()
    expect(
      await collectDeviceCountsForHeartbeat(
        makeApp(async () => undefined),
        't1',
      ),
    ).toBeNull()
  })
})
