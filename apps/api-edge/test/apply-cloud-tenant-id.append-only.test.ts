// Fallmatrix fuer den Restamp (`applyCloudTenantId`) gegen eine VOLLSTAENDIG migrierte
// Wegwerf-SQLite — mit allen echten Triggern, insbesondere den Append-only-Waechtern von
// `order-references` und `audit-events`.
//
// Anlass (2026-10-13, v26.10.10, Kunden-Edge): Der Repair-Hook aus #677 rief den Restamp
// mit gleicher alter und neuer LocationId auf. Schritt 2 schrieb `locationId = X where
// locationId = X` auch in `order-references`, deren Trigger jedes UPDATE ablehnt — die
// Transaktion rollte zurueck, der Standort blieb unsichtbar (#681). Allgemeiner: Jeder
// Restamp mit echtem Wechsel scheiterte auf Edges mit Bestellreferenzen (#682). Die Specs
// zu #677 mockten `applyCloudTenantId` und konnten das nicht sehen — deshalb hier echte
// Migrationen statt nachgebauter Tabellen.
//
// Isolation (testing.md §10.1/§10.2): Das migrierte Schema entsteht einmal als Vorlage;
// jeder Test arbeitet auf einer eigenen KOPIE der Datei. So darf er auch NULL-Mandanten
// anlegen, ohne fremde Zeilen zu treffen.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import knexFactory, { type Knex } from 'knex'
import { uuidv7 } from 'uuidv7'

import type { Application } from '../src/declarations'
import { applyCloudTenantId } from '../src/utils/apply-cloud-tenant-id'

// Wie test/global-setup.ts: knex laedt die .ts-Migrationen per require.
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'panary-restamp-matrix-'))
  templateFile = path.join(tmpDir, 'template.sqlite')
  const db = knexFactory({ client: 'better-sqlite3', useNullAsDefault: true, connection: { filename: templateFile } })
  try {
    await db.migrate.latest({ directory: path.join(__dirname, '..', 'migrations'), loadExtensions: ['.ts', '.js'] })
  } finally {
    await db.destroy()
  }
}, 60_000)

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

/** Eigene Kopie der migrierten DB je Test, plus die Mini-App, die `applyCloudTenantId` braucht. */
const openEdgeDb = (): { knex: Knex; app: Application } => {
  const file = path.join(tmpDir, `edge-${++dbSeq}.sqlite`)
  fs.copyFileSync(templateFile, file)
  const knex = knexFactory({ client: 'better-sqlite3', useNullAsDefault: true, connection: { filename: file } })
  onTestFinished(() => knex.destroy())
  const app = {
    get: (key: string) => {
      if (key === 'sqliteClient') return knex
      if (key === 'sqlite') return { connection: { filename: file } }
      return undefined
    },
  } as unknown as Application
  return { knex, app }
}

interface Seeded {
  locationId: string
  productHome: string
  productGlobal: string
  user: string
  orderRef: string
  auditEvent: string
  foreignProduct: string
  foreignOrderRef: string
  otherLocationId: string
  foreignTenantId: string
}

/** Ein Edge-Bestand unter `tenantId`/`locationId`, dazu Zeilen eines dritten Mandanten. */
const seedEdge = async (knex: Knex, tenantId: string, locationId: string): Promise<Seeded> => {
  const s: Seeded = {
    locationId,
    productHome: uuidv7(),
    productGlobal: uuidv7(),
    user: uuidv7(),
    orderRef: uuidv7(),
    auditEvent: uuidv7(),
    foreignProduct: uuidv7(),
    foreignOrderRef: uuidv7(),
    otherLocationId: uuidv7(),
    foreignTenantId: uuidv7(),
  }
  await knex('locations').insert({
    _id: locationId,
    tenantId,
    name: 'Dahlerstraße',
    operationMode: 'pos-cashier',
    createdAt: NOW,
    updatedAt: NOW,
  })
  await knex('products').insert([
    { _id: s.productHome, tenantId, locationId, name: 'Brot', acronym: 'BR' },
    { _id: s.productGlobal, tenantId, locationId: null, name: 'Croissant', acronym: 'CR' },
    { _id: s.foreignProduct, tenantId: s.foreignTenantId, locationId, name: 'Fremd', acronym: 'FR' },
  ])
  await knex('users').insert({
    _id: s.user,
    tenantId,
    firstName: 'Resta',
    lastName: 'Stamp',
    role: 'tenant:staff',
    activeLocationId: locationId,
    allowedLocationIds: JSON.stringify([locationId, s.otherLocationId]),
  })
  const orderRef = (id: string, refTenant: string) => ({
    _id: id,
    tenantId: refTenant,
    locationId,
    refType: 'Storno',
    sourceOrderId: uuidv7(),
    targetOrderId: null,
    refDate: NOW,
    refLocationId: locationId,
    refBusinessDayId: null,
    createdAt: NOW,
    updatedAt: NOW,
  })
  await knex('order-references').insert([
    orderRef(s.orderRef, tenantId),
    orderRef(s.foreignOrderRef, s.foreignTenantId),
  ])
  await knex('audit-events').insert({
    _id: s.auditEvent,
    tenantId,
    locationId,
    occurredAt: NOW,
    action: 'order.storno',
    category: 'order',
    outcome: 'SUCCESS',
    severity: 'INFO',
    correlationId: uuidv7(),
    actor_userId: s.user,
    target_resource: 'orders',
    target_entityType: 'order',
    target_entityId: uuidv7(),
    actor: '{}',
    target: '{}',
    createdAt: NOW,
    updatedAt: NOW,
  })
  return s
}

const triggerSql = async (knex: Knex): Promise<Record<string, string>> => {
  const rows = (await knex('sqlite_master').select('name', 'sql').where({ type: 'trigger' })) as Array<{
    name: string
    sql: string
  }>
  return Object.fromEntries(rows.map(r => [r.name, r.sql]))
}

/** Die Append-only-Waechter muessen nach jedem Restamp — erfolgreich oder nicht — wieder greifen. */
const expectGuardsIntact = async (knex: Knex, orderRefId: string, auditEventId: string): Promise<void> => {
  await expect(knex('order-references').where({ _id: orderRefId }).update({ refType: 'Split' })).rejects.toThrow(
    /order-references ist append-only — UPDATE/,
  )
  await expect(knex('order-references').where({ _id: orderRefId }).delete()).rejects.toThrow(
    /order-references ist append-only — DELETE/,
  )
  await expect(knex('audit-events').where({ _id: auditEventId }).update({ action: 'x' })).rejects.toThrow(
    /audit-events ist append-only — UPDATE/,
  )
}

describe('applyCloudTenantId — Fallmatrix gegen die migrierte SQLite', () => {
  it('nur der Mandant wechselt (Repair nach #677): Restamp laeuft durch, Location-Spalten bleiben', async () => {
    const { knex, app } = openEdgeDb()
    const ghostTenant = uuidv7()
    const cloudTenant = uuidv7()
    const location = uuidv7()
    const s = await seedEdge(knex, ghostTenant, location)
    const triggersBefore = await triggerSql(knex)

    const result = await applyCloudTenantId(app, {
      oldTenantId: ghostTenant,
      newTenantId: cloudTenant,
      oldLocationId: location,
      newLocationId: location,
    })

    expect(result.affectedTables).toEqual(
      expect.arrayContaining(['locations', 'products', 'users', 'order-references']),
    )
    expect(await knex('locations').where({ _id: location }).first()).toMatchObject({ tenantId: cloudTenant })
    expect(await knex('products').where({ _id: s.productHome }).first()).toMatchObject({
      tenantId: cloudTenant,
      locationId: location,
    })
    expect(await knex('products').where({ _id: s.productGlobal }).first()).toMatchObject({
      tenantId: cloudTenant,
      locationId: null,
    })
    const user = await knex('users').where({ _id: s.user }).first()
    expect(user).toMatchObject({ tenantId: cloudTenant, activeLocationId: location })
    expect(JSON.parse(user.allowedLocationIds)).toEqual([location, s.otherLocationId])
    expect(await knex('order-references').where({ _id: s.orderRef }).first()).toMatchObject({
      tenantId: cloudTenant,
      locationId: location,
      refLocationId: location,
    })
    // Audit bleibt bewusst historisch (RESTAMP_SKIP_TABLES).
    expect(await knex('audit-events').where({ _id: s.auditEvent }).first()).toMatchObject({ tenantId: ghostTenant })
    // Dritter Mandant: unberuehrt.
    expect(await knex('products').where({ _id: s.foreignProduct }).first()).toMatchObject({
      tenantId: s.foreignTenantId,
    })
    expect(await knex('order-references').where({ _id: s.foreignOrderRef }).first()).toMatchObject({
      tenantId: s.foreignTenantId,
    })

    expect(await triggerSql(knex)).toEqual(triggersBefore)
    await expectGuardsIntact(knex, s.orderRef, s.auditEvent)
  })

  it('nur der Standort wechselt: Eigentuemer-Spalten folgen, die eingefrorene refLocationId nicht', async () => {
    const { knex, app } = openEdgeDb()
    const tenant = uuidv7()
    const oldLocation = uuidv7()
    const newLocation = uuidv7()
    const s = await seedEdge(knex, tenant, oldLocation)
    const triggersBefore = await triggerSql(knex)

    await applyCloudTenantId(app, {
      oldTenantId: tenant,
      newTenantId: tenant,
      oldLocationId: oldLocation,
      newLocationId: newLocation,
    })

    expect(await knex('locations').where({ _id: oldLocation }).first()).toBeUndefined()
    expect(await knex('locations').where({ _id: newLocation }).first()).toMatchObject({
      tenantId: tenant,
      name: 'Dahlerstraße',
    })
    expect(await knex('products').where({ _id: s.productHome }).first()).toMatchObject({ locationId: newLocation })
    const user = await knex('users').where({ _id: s.user }).first()
    expect(user).toMatchObject({ tenantId: tenant, activeLocationId: newLocation })
    expect(JSON.parse(user.allowedLocationIds)).toEqual([newLocation, s.otherLocationId])
    // DSFinV-K: `refLocationId` ist der Stand zum Zeitpunkt des Bezugs — eine Kopie, kein FK.
    expect(await knex('order-references').where({ _id: s.orderRef }).first()).toMatchObject({
      tenantId: tenant,
      locationId: newLocation,
      refLocationId: oldLocation,
    })
    expect(await knex('audit-events').where({ _id: s.auditEvent }).first()).toMatchObject({ locationId: oldLocation })
    // Der fremde Mandant teilt zufaellig die alte LocationId — er darf nicht mitwandern.
    expect(await knex('products').where({ _id: s.foreignProduct }).first()).toMatchObject({ locationId: oldLocation })
    expect(await knex('order-references').where({ _id: s.foreignOrderRef }).first()).toMatchObject({
      locationId: oldLocation,
    })

    expect(await triggerSql(knex)).toEqual(triggersBefore)
    await expectGuardsIntact(knex, s.orderRef, s.auditEvent)
  })

  it('Mandant und Standort wechseln (Pairing-Restamp): beides an allen Eigentuemer-Spalten', async () => {
    const { knex, app } = openEdgeDb()
    const edgeTenant = uuidv7()
    const cloudTenant = uuidv7()
    const edgeLocation = uuidv7()
    const cloudLocation = uuidv7()
    const s = await seedEdge(knex, edgeTenant, edgeLocation)
    const triggersBefore = await triggerSql(knex)

    await applyCloudTenantId(app, {
      oldTenantId: edgeTenant,
      newTenantId: cloudTenant,
      oldLocationId: edgeLocation,
      newLocationId: cloudLocation,
    })

    expect(await knex('locations').where({ _id: cloudLocation }).first()).toMatchObject({ tenantId: cloudTenant })
    expect(await knex('products').where({ _id: s.productHome }).first()).toMatchObject({
      tenantId: cloudTenant,
      locationId: cloudLocation,
    })
    expect(await knex('order-references').where({ _id: s.orderRef }).first()).toMatchObject({
      tenantId: cloudTenant,
      locationId: cloudLocation,
      refLocationId: edgeLocation,
    })
    expect(await knex('audit-events').where({ _id: s.auditEvent }).first()).toMatchObject({
      tenantId: edgeTenant,
      locationId: edgeLocation,
    })
    expect(await knex('order-references').where({ _id: s.foreignOrderRef }).first()).toMatchObject({
      tenantId: s.foreignTenantId,
      locationId: edgeLocation,
    })

    expect(await triggerSql(knex)).toEqual(triggersBefore)
    await expectGuardsIntact(knex, s.orderRef, s.auditEvent)
  })

  it('nichts wechselt: kein Schreibzugriff, keine Tabelle betroffen', async () => {
    const { knex, app } = openEdgeDb()
    const tenant = uuidv7()
    const location = uuidv7()
    const s = await seedEdge(knex, tenant, location)

    const result = await applyCloudTenantId(app, {
      oldTenantId: tenant,
      newTenantId: tenant,
      oldLocationId: location,
      newLocationId: location,
    })

    expect(result.updatedRows).toBe(0)
    expect(result.affectedTables).toEqual([])
    expect(await knex('order-references').where({ _id: s.orderRef }).first()).toMatchObject({
      tenantId: tenant,
      locationId: location,
    })
    await expectGuardsIntact(knex, s.orderRef, s.auditEvent)
  })

  it('Fehler mitten in der Transaktion: alles zurueck, auch die Append-only-Waechter', async () => {
    const { knex, app } = openEdgeDb()
    const edgeTenant = uuidv7()
    const cloudTenant = uuidv7()
    const edgeLocation = uuidv7()
    const cloudLocation = uuidv7()
    const s = await seedEdge(knex, edgeTenant, edgeLocation)
    // Wird nach `order-references` angelegt und deshalb auch nach ihr umgestempelt: Deren
    // Waechter ist in diesem Moment schon entfernt — der Rollback muss ihn zurueckbringen.
    // Gescheitert wird bewusst ueber eine CHECK-Constraint, nicht ueber einen Trigger.
    await knex.schema.raw(
      `CREATE TABLE "zz-restamp-check" (_id TEXT PRIMARY KEY, tenantId TEXT NOT NULL CHECK (tenantId <> '${cloudTenant}'))`,
    )
    await knex('zz-restamp-check').insert({ _id: 'c-1', tenantId: edgeTenant })
    const triggersBefore = await triggerSql(knex)

    await expect(
      applyCloudTenantId(app, {
        oldTenantId: edgeTenant,
        newTenantId: cloudTenant,
        oldLocationId: edgeLocation,
        newLocationId: cloudLocation,
      }),
    ).rejects.toThrow(/CHECK constraint failed/)

    expect(await knex('locations').where({ _id: edgeLocation }).first()).toMatchObject({ tenantId: edgeTenant })
    expect(await knex('locations').where({ _id: cloudLocation }).first()).toBeUndefined()
    expect(await knex('order-references').where({ _id: s.orderRef }).first()).toMatchObject({
      tenantId: edgeTenant,
      locationId: edgeLocation,
    })
    expect(await triggerSql(knex)).toEqual(triggersBefore)
    await expectGuardsIntact(knex, s.orderRef, s.auditEvent)
  })

  it('Erst-Pairing (oldTenantId null): nur mandantenlose Zeilen, Journal anderer Mandanten bleibt', async () => {
    const { knex, app } = openEdgeDb()
    const cloudTenant = uuidv7()
    const existingTenant = uuidv7()
    const location = uuidv7()
    const s = await seedEdge(knex, existingTenant, location)
    const unowned = uuidv7()
    await knex('products').insert({ _id: unowned, tenantId: null, locationId: null, name: 'Ohne', acronym: 'OH' })

    await applyCloudTenantId(app, { oldTenantId: null, newTenantId: cloudTenant })

    expect(await knex('products').where({ _id: unowned }).first()).toMatchObject({ tenantId: cloudTenant })
    expect(await knex('products').where({ _id: s.productHome }).first()).toMatchObject({ tenantId: existingTenant })
    expect(await knex('order-references').where({ _id: s.orderRef }).first()).toMatchObject({
      tenantId: existingTenant,
    })
    await expectGuardsIntact(knex, s.orderRef, s.auditEvent)
  })

  it('Pairing ohne bisherige Edge-Location (oldLocationId null): globale Zeilen bleiben global', async () => {
    const { knex, app } = openEdgeDb()
    const edgeTenant = uuidv7()
    const cloudTenant = uuidv7()
    const location = uuidv7()
    const s = await seedEdge(knex, edgeTenant, location)

    await applyCloudTenantId(app, {
      oldTenantId: edgeTenant,
      newTenantId: cloudTenant,
      oldLocationId: null,
      newLocationId: uuidv7(),
    })

    // `where locationId = null` wuerde Knex als `IS NULL` ausfuehren und jede globale Zeile
    // der neuen Filiale zuschlagen.
    expect(await knex('products').where({ _id: s.productGlobal }).first()).toMatchObject({
      tenantId: cloudTenant,
      locationId: null,
    })
    expect(await knex('products').where({ _id: s.productHome }).first()).toMatchObject({
      tenantId: cloudTenant,
      locationId: location,
    })
  })

  it('verweigert einen leeren Ziel-Mandanten, statt mandantenlose Zeilen auf "" zu stempeln', async () => {
    const { knex, app } = openEdgeDb()
    const unowned = uuidv7()
    await knex('products').insert({ _id: unowned, tenantId: null, locationId: null, name: 'Ohne', acronym: 'OH' })

    await expect(applyCloudTenantId(app, { oldTenantId: null, newTenantId: '' })).rejects.toThrow(/newTenantId/)

    expect(await knex('products').where({ _id: unowned }).first()).toMatchObject({ tenantId: null })
  })
})
