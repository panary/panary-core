// Integrationstest fuer den Pairing-Restamp (`applyCloudTenantId`, #59):
// beim Koppeln einer Edge-Installation an die Cloud wird die GESAMTE lokale
// SQLite auf die Cloud-tenantId/-locationId umgeschrieben.
//
// Teil 1 laeuft gegen die echte, migrierte Test-SQLite (globalSetup) — mit
// frischen uuidv7-Tenant-/Location-IDs, damit parallel laufende Testdateien
// nicht beruehrt werden (der Restamp filtert strikt auf `tenantId = old`).
// Teil 2 (Erst-Pairing, oldTenantId=null) laeuft bewusst gegen eine EIGENE
// Wegwerf-SQLite: `whereNull('tenantId')` wuerde sonst NULL-Tenant-Rows
// fremder, parallel laufender Tests mit umstempeln.
import assert from 'assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import knexFactory, { type Knex } from 'knex'
import { uuidv7 } from 'uuidv7'

import { app } from '../src/app'
import type { Application } from '../src/declarations'
import { applyCloudTenantId } from '../src/utils/apply-cloud-tenant-id'

const removeBackups = (sqliteFile: string): void => {
  const dir = path.dirname(sqliteFile)
  const base = path.basename(sqliteFile)
  for (const entry of fs.readdirSync(dir)) {
    if (entry.startsWith(`${base}.pre-pairing-`) && entry.endsWith('.bak')) {
      fs.rmSync(path.join(dir, entry), { force: true })
    }
  }
}

describe('applyCloudTenantId — Restamp gegen die migrierte Test-SQLite', () => {
  const knex = app.get('sqliteClient') as Knex
  const sqliteFile = path.resolve((app.get('sqlite') as { connection: { filename: string } }).connection.filename)

  const oldTenantId = uuidv7()
  const newTenantId = uuidv7()
  const foreignTenantId = uuidv7()
  const oldLocationId = uuidv7()
  const newLocationId = uuidv7()
  const otherLocationId = uuidv7()

  const ids = {
    productHome: uuidv7(),
    productGlobal: uuidv7(),
    productForeign: uuidv7(),
    user: uuidv7(),
    syncRun: uuidv7(),
  }
  const now = new Date().toISOString()

  beforeAll(async () => {
    // Seed direkt via Knex: applyCloudTenantId arbeitet selbst auf DB-Ebene
    // (sanktionierte Ausnahme der Adapter-API-Regel) — der Seed spiegelt das.
    await knex('locations').insert({
      _id: oldLocationId,
      tenantId: oldTenantId,
      name: 'Alte Filiale',
      operationMode: 'STANDARD',
      createdAt: now,
      updatedAt: now,
    })
    await knex('products').insert([
      { _id: ids.productHome, tenantId: oldTenantId, locationId: oldLocationId, name: 'Brot', acronym: 'BR' },
      { _id: ids.productGlobal, tenantId: oldTenantId, locationId: null, name: 'Croissant', acronym: 'CR' },
      // Kontrolle: fremder Tenant darf vom Restamp nicht beruehrt werden.
      { _id: ids.productForeign, tenantId: foreignTenantId, locationId: oldLocationId, name: 'Fremd', acronym: 'FR' },
    ])
    await knex('users').insert({
      _id: ids.user,
      tenantId: oldTenantId,
      firstName: 'Resta',
      lastName: 'Stamp',
      role: 'tenant:staff',
      activeLocationId: oldLocationId,
      allowedLocationIds: JSON.stringify([oldLocationId, otherLocationId]),
    })
    // Skip-Tabelle (RESTAMP_SKIP_TABLES): Diagnose-Historie behaelt die alte ID.
    await knex('sync-runs').insert({
      _id: ids.syncRun,
      tenantId: oldTenantId,
      phase: 'push',
      direction: 'edge-to-cloud',
      recordCount: 1,
      durationMs: 5,
      outcome: 'success',
      triggeredBy: 'scheduler',
      startedAt: now,
      finishedAt: now,
      createdAt: now,
      updatedAt: now,
    })
  })

  afterAll(async () => {
    await knex('products')
      .whereIn('_id', [ids.productHome, ids.productGlobal, ids.productForeign])
      .delete()
    await knex('users').where({ _id: ids.user }).delete()
    await knex('sync-runs').where({ _id: ids.syncRun }).delete()
    await knex('locations').whereIn('_id', [oldLocationId, newLocationId]).delete()
    removeBackups(sqliteFile)
  })

  it('stempelt Nicht-Skip-Tabellen um, laesst Skip-Tabellen und fremde Tenants unveraendert', async () => {
    const result = await applyCloudTenantId(app as unknown as Application, {
      oldTenantId,
      newTenantId,
      oldLocationId,
      newLocationId,
    })

    // Backup-Datei wurde vor dem Restamp angelegt
    assert.ok(result.backupPath, 'backupPath fehlt')
    assert.match(path.basename(result.backupPath as string), /\.pre-pairing-.+\.bak$/)
    assert.ok(fs.existsSync(result.backupPath as string), 'Backup-Datei existiert nicht')

    // Zaehler: 1 Location-Move + products(2) + users(1) + locations-tenantId(1)
    assert.strictEqual(result.updatedRows, 5)
    for (const table of ['locations', 'products', 'users']) {
      assert.ok(result.affectedTables.includes(table), `affectedTables ohne ${table}`)
    }
    assert.ok(!result.affectedTables.includes('sync-runs'), 'Skip-Tabelle in affectedTables')

    // locations: alte _id wurde durch die Cloud-locationId ersetzt (kein Geist-FK)
    const oldLocation = await knex('locations').where({ _id: oldLocationId }).first()
    const newLocation = await knex('locations').where({ _id: newLocationId }).first()
    assert.strictEqual(oldLocation, undefined)
    assert.strictEqual(newLocation?.tenantId, newTenantId)
    assert.strictEqual(newLocation?.name, 'Alte Filiale')

    // products: tenantId + locationId-FK umgestempelt; globales Produkt behaelt locationId null
    const productHome = await knex('products').where({ _id: ids.productHome }).first()
    assert.strictEqual(productHome?.tenantId, newTenantId)
    assert.strictEqual(productHome?.locationId, newLocationId)
    const productGlobal = await knex('products').where({ _id: ids.productGlobal }).first()
    assert.strictEqual(productGlobal?.tenantId, newTenantId)
    assert.strictEqual(productGlobal?.locationId, null)

    // Fremder Tenant: komplett unveraendert
    const productForeign = await knex('products').where({ _id: ids.productForeign }).first()
    assert.strictEqual(productForeign?.tenantId, foreignTenantId)
    assert.strictEqual(productForeign?.locationId, oldLocationId)

    // users: Single-Location-FK (`activeLocationId`) + JSON-Array (`allowedLocationIds`)
    const user = await knex('users').where({ _id: ids.user }).first()
    assert.strictEqual(user?.tenantId, newTenantId)
    assert.strictEqual(user?.activeLocationId, newLocationId)
    assert.deepStrictEqual(JSON.parse(user?.allowedLocationIds as string), [newLocationId, otherLocationId])

    // Skip-Tabelle: historische tenantId bleibt stehen
    const syncRun = await knex('sync-runs').where({ _id: ids.syncRun }).first()
    assert.strictEqual(syncRun?.tenantId, oldTenantId)
  })
})

describe('applyCloudTenantId — Randfall Erst-Pairing (oldTenantId=null)', () => {
  let tmpDir: string
  let tmpFile: string
  let knex: Knex

  /** Mini-App: applyCloudTenantId braucht nur `sqliteClient` + `sqlite`-Config. */
  const miniApp = (withConfig: boolean): Application =>
    ({
      get: (key: string) => {
        if (key === 'sqliteClient') return knex
        if (key === 'sqlite' && withConfig) return { connection: { filename: tmpFile } }
        return undefined
      },
    }) as unknown as Application

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'panary-restamp-'))
    tmpFile = path.join(tmpDir, 'first-pairing.sqlite')
    knex = knexFactory({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: tmpFile },
    })
    await knex.schema.createTable('products', table => {
      table.string('_id').primary()
      table.string('tenantId').nullable()
      table.string('locationId').nullable()
      table.string('name')
    })
    // Namensgleich zur echten Skip-Tabelle — nur tenantId ist fuer den Test relevant.
    await knex.schema.createTable('sync-runs', table => {
      table.string('_id').primary()
      table.string('tenantId').nullable()
    })
  })

  afterAll(async () => {
    await knex.destroy()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('stempelt NUR tenantId=NULL-Rows und ueberspringt Skip-Tabellen', async () => {
    const newTenantId = uuidv7()
    const existingTenantId = uuidv7()
    await knex('products').insert([
      { _id: 'p-null-1', tenantId: null, name: 'Unbemannt 1' },
      { _id: 'p-null-2', tenantId: null, name: 'Unbemannt 2' },
      { _id: 'p-fremd', tenantId: existingTenantId, name: 'Bereits gestempelt' },
    ])
    await knex('sync-runs').insert({ _id: 'sr-null', tenantId: null })

    const result = await applyCloudTenantId(miniApp(true), {
      oldTenantId: null,
      newTenantId,
      // Erst-Pairing: es gibt noch keine Edge-locationId, die umgezogen werden muesste.
      oldLocationId: undefined,
      newLocationId: undefined,
    })

    assert.strictEqual(result.updatedRows, 2)
    assert.deepStrictEqual(result.affectedTables, ['products'])
    assert.ok(result.backupPath && fs.existsSync(result.backupPath), 'Backup fehlt beim Erst-Pairing')

    const rows = await knex('products').orderBy('_id')
    assert.deepStrictEqual(
      rows.map(row => [row._id, row.tenantId]),
      [
        ['p-fremd', existingTenantId],
        ['p-null-1', newTenantId],
        ['p-null-2', newTenantId],
      ],
    )
    const skipRow = await knex('sync-runs').where({ _id: 'sr-null' }).first()
    assert.strictEqual(skipRow?.tenantId, null)
  })

  it('ohne aufloesbare sqlite-Config wird kein Backup angelegt (backupPath=null)', async () => {
    const result = await applyCloudTenantId(miniApp(false), {
      oldTenantId: null,
      newTenantId: uuidv7(),
    })
    assert.strictEqual(result.backupPath, null)
  })
})
