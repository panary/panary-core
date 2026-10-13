// Regression-Anker #677: Nach „Alles aus der Cloud uebernehmen" legte der Start-Bootstrap eine
// Location mit erfundener tenantId an. Der Repair-Hook stempelte nur die LocationId um, die
// Zeile blieb fuer Admin und Kasse unsichtbar (Mandantenfilter), der Pull patchte sie „OK".

import { describe, expect, it, vi } from 'vitest'

import type { Application } from '../declarations'
import { applyCloudTenantId } from '../utils/apply-cloud-tenant-id'
import { runLocationRestampRepair } from './repair-location-restamp.worker'

vi.mock('@panary/shared-backend', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))
vi.mock('../utils/apply-cloud-tenant-id', () => ({
  applyCloudTenantId: vi.fn(async () => ({ backupPath: null, updatedRows: 1, affectedTables: ['locations'] })),
}))

const CLOUD_TENANT = '019eb340-ce0a-7472-a6fe-99eaac65c680'
const GHOST_TENANT = '01a1343d-4222-7f03-a6ac-1f096bbf8995'
const CLOUD_LOCATION = '019eb340-ce0a-7472-a6fe-99eb1db7f902'
const GHOST_LOCATION = '01a1343d-4223-7b2f-99db-d51832f3ebce'

const makeApp = (opts: { connection: Record<string, unknown>; locations: Array<Record<string, unknown>> }) => {
  const removedCursors: string[] = []
  const services: Record<string, unknown> = {
    'cloud-connection': { find: async () => [opts.connection] },
    locations: { find: async () => opts.locations },
    users: { find: async () => [] },
    'sync-cursor': {
      remove: async (id: string) => {
        removedCursors.push(id)
      },
    },
  }
  const app = { service: (name: string) => services[name] } as unknown as Application
  return { app, removedCursors }
}

const pairedConnection = (extra: Record<string, unknown> = {}) => ({
  bootstrapStatus: 'done',
  pairingStatus: 'connected',
  tenantId: CLOUD_TENANT,
  locationId: CLOUD_LOCATION,
  preflightSnapshot: { cloudLocationId: CLOUD_LOCATION, cloudTenantId: CLOUD_TENANT },
  ...extra,
})

const lastRestamp = () => {
  const calls = vi.mocked(applyCloudTenantId).mock.calls
  return calls[calls.length - 1]?.[1]
}

describe('runLocationRestampRepair', () => {
  it('stempelt den Mandanten um, wenn nur die tenantId vom Cloud-Mandanten abweicht', async () => {
    vi.mocked(applyCloudTenantId).mockClear()
    const { app, removedCursors } = makeApp({
      connection: pairedConnection(),
      locations: [{ _id: CLOUD_LOCATION, tenantId: GHOST_TENANT }],
    })
    await runLocationRestampRepair(app)
    expect(lastRestamp()).toEqual({
      oldTenantId: GHOST_TENANT,
      newTenantId: CLOUD_TENANT,
      oldLocationId: CLOUD_LOCATION,
      newLocationId: CLOUD_LOCATION,
    })
    expect(removedCursors).toEqual(['cloud:locations', 'cloud:opening-hour-exceptions'])
  })

  it('korrigiert LocationId und Mandant zusammen, wie nach dem Start-Bootstrap vom 2026-10-13', async () => {
    vi.mocked(applyCloudTenantId).mockClear()
    const { app } = makeApp({
      connection: pairedConnection(),
      locations: [{ _id: GHOST_LOCATION, tenantId: GHOST_TENANT }],
    })
    await runLocationRestampRepair(app)
    expect(lastRestamp()).toEqual({
      oldTenantId: GHOST_TENANT,
      newTenantId: CLOUD_TENANT,
      oldLocationId: GHOST_LOCATION,
      newLocationId: CLOUD_LOCATION,
    })
  })

  it('laesst den Mandanten stehen, wenn er schon stimmt (bisheriger LocationId-Repair)', async () => {
    vi.mocked(applyCloudTenantId).mockClear()
    const { app } = makeApp({
      connection: pairedConnection(),
      locations: [{ _id: GHOST_LOCATION, tenantId: CLOUD_TENANT }],
    })
    await runLocationRestampRepair(app)
    expect(lastRestamp()).toEqual({
      oldTenantId: CLOUD_TENANT,
      newTenantId: CLOUD_TENANT,
      oldLocationId: GHOST_LOCATION,
      newLocationId: CLOUD_LOCATION,
    })
  })

  it('tut nichts, wenn LocationId und Mandant zur Cloud passen', async () => {
    vi.mocked(applyCloudTenantId).mockClear()
    const { app, removedCursors } = makeApp({
      connection: pairedConnection(),
      locations: [{ _id: CLOUD_LOCATION, tenantId: CLOUD_TENANT }],
    })
    await runLocationRestampRepair(app)
    expect(applyCloudTenantId).not.toHaveBeenCalled()
    expect(removedCursors).toEqual([])
  })

  it('nimmt connection.tenantId, wenn der Snapshot keinen Cloud-Mandanten traegt', async () => {
    vi.mocked(applyCloudTenantId).mockClear()
    const { app } = makeApp({
      connection: pairedConnection({ preflightSnapshot: { cloudLocationId: CLOUD_LOCATION } }),
      locations: [{ _id: CLOUD_LOCATION, tenantId: GHOST_TENANT }],
    })
    await runLocationRestampRepair(app)
    expect(lastRestamp()?.newTenantId).toBe(CLOUD_TENANT)
  })

  it('repariert nichts an einem nicht gepairten Edge', async () => {
    vi.mocked(applyCloudTenantId).mockClear()
    const { app } = makeApp({
      connection: pairedConnection({ pairingStatus: 'disconnected' }),
      locations: [{ _id: CLOUD_LOCATION, tenantId: GHOST_TENANT }],
    })
    await runLocationRestampRepair(app)
    expect(applyCloudTenantId).not.toHaveBeenCalled()
  })
})
