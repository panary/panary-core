// Ende-zu-Ende: Repair-Hook + echter Restamp + vollstaendig migrierte SQLite (#681/#682).
//
// Die Unit-Spec des Hooks mockt `applyCloudTenantId` — genau dadurch blieb #681 unentdeckt:
// Der Hook rief den Restamp korrekt auf, der Restamp scheiterte am Append-only-Trigger, und
// der Hook fing den Fehler still als `sync.repair.failed`. Hier laeuft die ganze Kette gegen
// das echte Schema, mit den Zustaenden, die der Kunden-Edge am 2026-10-13 tatsaechlich hatte.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import knexFactory, { type Knex } from 'knex'
import { uuidv7 } from 'uuidv7'

import type { Application } from '../../src/declarations'
import { runLocationRestampRepair } from '../../src/workers/repair-location-restamp.worker'

const logged = vi.hoisted(() => ({ errors: [] as Array<Record<string, unknown>> }))
vi.mock('@panary/shared-backend', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn((entry: Record<string, unknown>) => logged.errors.push(entry)),
  },
}))

try {
  createRequire(__filename)('@swc-node/register')
} catch {
  // bereits registriert
}

const NOW = '2026-10-13T09:49:48.000Z'
let tmpDir: string
let templateFile: string
let dbSeq = 0

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'panary-repair-e2e-'))
  templateFile = path.join(tmpDir, 'template.sqlite')
  const db = knexFactory({ client: 'better-sqlite3', useNullAsDefault: true, connection: { filename: templateFile } })
  try {
    await db.migrate.latest({
      directory: path.join(__dirname, '..', '..', 'migrations'),
      loadExtensions: ['.ts', '.js'],
    })
  } finally {
    await db.destroy()
  }
}, 60_000)

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

/**
 * Mini-App ueber einer eigenen DB-Kopie: Die vier Services, die der Hook liest bzw.
 * schreibt, als duenne Knex-Huellen — dieselben Zeilen, die die echten Adapter liefern.
 */
const openEdge = (): { knex: Knex; app: Application } => {
  const file = path.join(tmpDir, `edge-${++dbSeq}.sqlite`)
  fs.copyFileSync(templateFile, file)
  const knex = knexFactory({ client: 'better-sqlite3', useNullAsDefault: true, connection: { filename: file } })
  onTestFinished(() => knex.destroy())
  const parseJson = (row: Record<string, unknown>) => ({
    ...row,
    preflightSnapshot:
      typeof row['preflightSnapshot'] === 'string' ? JSON.parse(row['preflightSnapshot'] as string) : null,
  })
  const services: Record<string, unknown> = {
    'cloud-connection': { find: async () => (await knex('cloud-connection').select()).map(parseJson) },
    locations: { find: async () => knex('locations').select('_id', 'tenantId') },
    users: { find: async () => knex('users').select('_id', 'activeLocationId') },
    'sync-cursor': { remove: async (id: string) => knex('sync-cursor').where({ _id: id }).delete() },
  }
  const app = {
    service: (name: string) => services[name],
    get: (key: string) => {
      if (key === 'sqliteClient') return knex
      if (key === 'sqlite') return { connection: { filename: file } }
      return undefined
    },
  } as unknown as Application
  return { knex, app }
}

const cursorRow = (service: string) => ({
  _id: `cloud:${service}`,
  service,
  lastPullAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
})

const seedCustomerEdge = async (
  knex: Knex,
  opts: { cloudTenant: string; cloudLocation: string; rowTenant: string; rowLocation: string },
): Promise<{ orderRef: string }> => {
  const cols = new Set(
    ((await knex.raw(`PRAGMA table_info("cloud-connection")`)) as Array<{ name: string }>).map(c => c.name),
  )
  const connection: Record<string, unknown> = {
    _id: uuidv7(),
    tenantId: opts.cloudTenant,
    locationId: opts.cloudLocation,
    pairingStatus: 'connected',
    bootstrapStatus: 'done',
    preflightSnapshot: JSON.stringify({ cloudLocationId: opts.cloudLocation, cloudTenantId: opts.cloudTenant }),
    cloudUrl: 'https://cloud.invalid',
    createdAt: NOW,
    updatedAt: NOW,
  }
  await knex('cloud-connection').insert(Object.fromEntries(Object.entries(connection).filter(([k]) => cols.has(k))))
  await knex('locations').insert({
    _id: opts.rowLocation,
    tenantId: opts.rowTenant,
    name: 'Dahlerstraße',
    organizationName: 'Köttersfritte Test',
    operationMode: 'pos-cashier',
    createdAt: NOW,
    updatedAt: NOW,
  })
  // Bestellreferenzen unter dem Cloud-Mandanten: Sie loesten am 2026-10-13 den Trigger aus.
  const orderRef = uuidv7()
  await knex('order-references').insert({
    _id: orderRef,
    tenantId: opts.cloudTenant,
    locationId: opts.cloudLocation,
    refType: 'Storno',
    sourceOrderId: uuidv7(),
    targetOrderId: null,
    refDate: NOW,
    refLocationId: opts.cloudLocation,
    refBusinessDayId: null,
    createdAt: NOW,
    updatedAt: NOW,
  })
  for (const service of ['locations', 'opening-hour-exceptions', 'products']) {
    await knex('sync-cursor').insert(cursorRow(service))
  }
  return { orderRef }
}

describe('Repair-Hook gegen die migrierte SQLite', () => {
  it('Kunden-Edge nach v26.10.10: richtige LocationId, fremder Mandant, Bestellreferenzen vorhanden', async () => {
    logged.errors.length = 0
    const { knex, app } = openEdge()
    const cloudTenant = uuidv7()
    const cloudLocation = uuidv7()
    const ghostTenant = uuidv7()
    const { orderRef } = await seedCustomerEdge(knex, {
      cloudTenant,
      cloudLocation,
      rowTenant: ghostTenant,
      rowLocation: cloudLocation,
    })

    await runLocationRestampRepair(app)

    expect(logged.errors).toEqual([])
    expect(await knex('locations').where({ _id: cloudLocation }).first()).toMatchObject({ tenantId: cloudTenant })
    expect(await knex('order-references').where({ _id: orderRef }).first()).toMatchObject({
      tenantId: cloudTenant,
      locationId: cloudLocation,
    })
    // Location-gebundene Cursor weg (naechster Pull holt voll), fremde bleiben.
    expect((await knex('sync-cursor').select('_id')).map(r => r._id)).toEqual(['cloud:products'])
  })

  it('Kunden-Edge am 2026-10-13 07:49: erfundene LocationId UND fremder Mandant', async () => {
    logged.errors.length = 0
    const { knex, app } = openEdge()
    const cloudTenant = uuidv7()
    const cloudLocation = uuidv7()
    const ghostTenant = uuidv7()
    const ghostLocation = uuidv7()
    const { orderRef } = await seedCustomerEdge(knex, {
      cloudTenant,
      cloudLocation,
      rowTenant: ghostTenant,
      rowLocation: ghostLocation,
    })

    await runLocationRestampRepair(app)

    expect(logged.errors).toEqual([])
    expect(await knex('locations').where({ _id: ghostLocation }).first()).toBeUndefined()
    expect(await knex('locations').where({ _id: cloudLocation }).first()).toMatchObject({ tenantId: cloudTenant })
    expect(await knex('order-references').where({ _id: orderRef }).first()).toMatchObject({ tenantId: cloudTenant })
  })

  it('ist idempotent: der zweite Start aendert nichts mehr', async () => {
    logged.errors.length = 0
    const { knex, app } = openEdge()
    const cloudTenant = uuidv7()
    const cloudLocation = uuidv7()
    await seedCustomerEdge(knex, {
      cloudTenant,
      cloudLocation,
      rowTenant: uuidv7(),
      rowLocation: cloudLocation,
    })

    await runLocationRestampRepair(app)
    await knex('sync-cursor').insert(cursorRow('locations'))
    await runLocationRestampRepair(app)

    expect(logged.errors).toEqual([])
    // Zweiter Lauf hat nichts zu reparieren und laesst den neuen Cursor stehen.
    expect(await knex('sync-cursor').where({ _id: 'cloud:locations' }).first()).toBeDefined()
  })
})
