import knexFactory, { type Knex } from 'knex'
import { describe, expect, it, onTestFinished } from 'vitest'

import { down, up } from '../../migrations/20261021120000_users_add_pos_handedness'

// Gegen eine echte In-Memory-SQLite: Bestandszeilen muessen die Migration ohne
// Wert ueberstehen (nicht gewaehlt = leere Spalte, kein erfundener Default).
const makeDb = async (): Promise<Knex> => {
  const db = knexFactory({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
  onTestFinished(() => db.destroy())
  await db.schema.createTable('users', table => {
    table.string('_id').primary()
    table.string('firstName')
  })
  await db('users').insert({ _id: 'u-bestand', firstName: 'Bestand' })
  return db
}

describe('20261021120000_users_add_pos_handedness', () => {
  it('legt die Spalte an, Bestandszeilen bleiben ohne Wert', async () => {
    const db = await makeDb()
    await up(db)

    expect(await db.schema.hasColumn('users', 'posHandedness')).toBe(true)
    expect(await db('users').where({ _id: 'u-bestand' }).first()).toEqual({
      _id: 'u-bestand',
      firstName: 'Bestand',
      posHandedness: null,
    })
  })

  it('speichert beide Werte', async () => {
    const db = await makeDb()
    await up(db)
    await db('users').insert([
      { _id: 'u-left', posHandedness: 'left' },
      { _id: 'u-right', posHandedness: 'right' },
    ])

    const rows = await db('users').whereIn('_id', ['u-left', 'u-right']).orderBy('_id').select('posHandedness')
    expect(rows).toEqual([{ posHandedness: 'left' }, { posHandedness: 'right' }])
  })

  it('ist wiederholbar und laesst sich zuruecknehmen', async () => {
    const db = await makeDb()
    await up(db)
    await up(db)
    expect(await db.schema.hasColumn('users', 'posHandedness')).toBe(true)

    await down(db)
    await down(db)
    expect(await db.schema.hasColumn('users', 'posHandedness')).toBe(false)
    expect(await db('users').count({ n: '*' })).toEqual([{ n: 1 }])
  })
})
