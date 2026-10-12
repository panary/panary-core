// Regression-Anker #664: Am 2026-10-08 verwarf der Bootstrap `pull-cloud-to-edge` den
// eigenen Standort beim Apply („validation failed") und meldete trotzdem `done`. Der Edge
// stand danach ohne Filiale da, die Kasse lud keinen Standort mehr.

import { describe, expect, it, vi } from 'vitest'

import type { CloudConnection } from '@panary/cloud-connection/domain'

import type { Application } from '../declarations'
import { assertOwnLocationPulled } from './assert-own-location-pulled'

vi.mock('@panary/shared-backend', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

const LOCATION_ID = '019eb340-ce0a-7472-a6fe-99eb1db7f902'

const makeApp = (existing: string[]) => {
  const get = vi.fn(async (id: string) => {
    if (existing.includes(id)) return { _id: id }
    throw Object.assign(new Error(`No record found for id '${id}'`), { name: 'NotFound' })
  })
  const app = { service: vi.fn(() => ({ get })) } as unknown as Application
  return { app, get }
}

const connectionWith = (fields: Partial<CloudConnection>): CloudConnection =>
  ({ _id: 'conn-1', tenantId: 'tenant-1', ...fields }) as CloudConnection

describe('assertOwnLocationPulled', () => {
  it('wirft, wenn der eigene Standort nach dem Pull fehlt', async () => {
    const { app } = makeApp([])
    await expect(assertOwnLocationPulled(app, connectionWith({ locationId: LOCATION_ID }))).rejects.toThrow(
      /eigene Standort/,
    )
  })

  it('laesst den Bootstrap weiterlaufen, wenn der Standort angelegt ist', async () => {
    const { app, get } = makeApp([LOCATION_ID])
    await expect(assertOwnLocationPulled(app, connectionWith({ locationId: LOCATION_ID }))).resolves.toBeUndefined()
    expect(get).toHaveBeenCalledWith(LOCATION_ID, expect.anything())
  })

  it('nimmt die Cloud-LocationId aus dem Preflight-Snapshot, wenn die Connection keine traegt', async () => {
    const { app, get } = makeApp([])
    const connection = connectionWith({
      locationId: null,
      preflightSnapshot: { cloudLocationId: LOCATION_ID } as CloudConnection['preflightSnapshot'],
    })
    await expect(assertOwnLocationPulled(app, connection)).rejects.toThrow(/eigene Standort/)
    expect(get).toHaveBeenCalledWith(LOCATION_ID, expect.anything())
  })

  it('reicht andere Lesefehler unveraendert durch', async () => {
    const get = vi.fn(async () => {
      throw Object.assign(new Error('SQLITE_BUSY: database is locked'), { name: 'GeneralError' })
    })
    const app = { service: vi.fn(() => ({ get })) } as unknown as Application
    await expect(assertOwnLocationPulled(app, connectionWith({ locationId: LOCATION_ID }))).rejects.toThrow(
      /SQLITE_BUSY/,
    )
  })

  it('prueft nichts ohne bekannte LocationId', async () => {
    const { app, get } = makeApp([])
    await expect(assertOwnLocationPulled(app, connectionWith({ locationId: null }))).resolves.toBeUndefined()
    expect(get).not.toHaveBeenCalled()
  })
})
