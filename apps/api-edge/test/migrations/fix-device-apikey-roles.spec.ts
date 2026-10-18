import knexFactory, { type Knex } from 'knex'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { UserSystemRole } from '@panary/users/domain'

import { ROLE_BY_DEVICE_TYPE, ROLE_DEVICE_POS, up } from '../../migrations/20261018120000_fix_device_apikey_roles'

// Zwei Dinge, beide noetig (Muster: reactivate-locked-out-owner.spec.ts):
//   1. Die Rollen-Literale der Migration gegen die Domain — die Migration darf
//      @panary/users/domain zur Laufzeit nicht importieren.
//   2. Das tatsaechliche SQL gegen eine echte In-Memory-SQLite, damit ein
//      Tippfehler im Subselect oder eine falsche Spalte auffaellt.

const makeDb = async (): Promise<Knex> => {
  const db = knexFactory({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
  await db.schema.createTable('devices', table => {
    table.string('_id').primary()
    table.string('deviceId')
    table.string('type')
  })
  await db.schema.createTable('apikeys', table => {
    table.string('_id').primary()
    table.string('deviceId')
    table.string('role')
    table.string('updatedAt')
  })
  return db
}

const roles = async (db: Knex): Promise<Record<string, string>> =>
  Object.fromEntries(
    (await db('apikeys').select('_id', 'role')).map((row: { _id: string; role: string }) => [row._id, row.role]),
  )

describe('Rollen-Literale gegen die Domain gelockt', () => {
  it('stimmen mit UserSystemRole ueberein', () => {
    expect(ROLE_DEVICE_POS).toBe(UserSystemRole.DEVICE_POS)
    expect(ROLE_BY_DEVICE_TYPE).toEqual({ kds: UserSystemRole.DEVICE_KDS, tablet: UserSystemRole.DEVICE_TABLET })
  })
})

describe('20261018120000_fix_device_apikey_roles', () => {
  let db: Knex

  beforeEach(async () => {
    db = await makeDb()
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('korrigiert nur device:pos-client an kds-/tablet-Geraeten', async () => {
    await db('devices').insert([
      // `_id` absichtlich verschieden von `deviceId` — wie in der Produktion.
      { _id: 'rec-kds', deviceId: 'dev-kds', type: 'kds' },
      { _id: 'rec-tab', deviceId: 'dev-tab', type: 'tablet' },
      { _id: 'rec-pos', deviceId: 'dev-pos', type: 'pos-counter' },
      { _id: 'rec-oth', deviceId: 'dev-oth', type: 'other' },
      { _id: 'rec-kds2', deviceId: 'dev-kds2', type: 'kds' },
    ])
    await db('apikeys').insert([
      { _id: 'k-kds', deviceId: 'dev-kds', role: 'device:pos-client', updatedAt: 'alt' },
      { _id: 'k-tab', deviceId: 'dev-tab', role: 'device:pos-client', updatedAt: 'alt' },
      { _id: 'k-pos', deviceId: 'dev-pos', role: 'device:pos-client', updatedAt: 'alt' },
      { _id: 'k-oth', deviceId: 'dev-oth', role: 'device:pos-client', updatedAt: 'alt' },
      // ausdruecklich anders gesetzte Rolle bleibt
      { _id: 'k-kds2', deviceId: 'dev-kds2', role: 'device:tablet', updatedAt: 'alt' },
      // Verwechslung `_id`/`deviceId` darf keinen Treffer erzeugen
      { _id: 'k-recid', deviceId: 'rec-kds', role: 'device:pos-client', updatedAt: 'alt' },
      // Integrations-Schluessel ohne Geraet
      { _id: 'k-int', deviceId: null, role: 'device:pos-client', updatedAt: 'alt' },
    ])

    await up(db)

    expect(await roles(db)).toEqual({
      'k-kds': 'device:kds',
      'k-tab': 'device:tablet',
      'k-pos': 'device:pos-client',
      'k-oth': 'device:pos-client',
      'k-kds2': 'device:tablet',
      'k-recid': 'device:pos-client',
      'k-int': 'device:pos-client',
    })
    const touched = await db('apikeys').whereNot('updatedAt', 'alt').pluck('_id')
    expect(touched.sort()).toEqual(['k-kds', 'k-tab'])
  })

  it('ohne Tabellen → kein Fehler', async () => {
    const empty = knexFactory({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    })
    await expect(up(empty)).resolves.toBeUndefined()
    await empty.destroy()
  })
})
