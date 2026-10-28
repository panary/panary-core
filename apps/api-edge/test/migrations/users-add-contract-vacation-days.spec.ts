import knexFactory, { type Knex } from 'knex'
import { describe, expect, it, onTestFinished } from 'vitest'

import { down, up } from '../../migrations/20261028120000_users_add_contract_vacation_days'

// Gegen eine echte In-Memory-SQLite (panary/panary-core#1180): Bestandszeilen ueberstehen die Migration leer,
// beide Spalten nehmen ihre Werte auf, und der Pull-Apply findet sie.
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

describe('20261028120000_users_add_contract_vacation_days', () => {
  it('legt beide Spalten an, Bestandszeilen bleiben ohne Wert', async () => {
    const db = await makeDb()
    await up(db)

    expect(await db('users').where({ _id: 'u-bestand' }).first()).toEqual({
      _id: 'u-bestand',
      firstName: 'Bestand',
      vacationDaysPerYear: null,
      contract: null,
    })
  })

  it('speichert Anspruch und Vertrag als JSON-Text', async () => {
    const db = await makeDb()
    await up(db)
    const contract = JSON.stringify({ contractType: 'FULLTIME', hoursPerWeek: 40 })
    await db('users').insert({ _id: 'u-neu', vacationDaysPerYear: 28.5, contract })

    expect(await db('users').where({ _id: 'u-neu' }).first()).toEqual({
      _id: 'u-neu',
      firstName: null,
      vacationDaysPerYear: 28.5,
      contract,
    })
  })

  it('ist wiederholbar und laesst sich zuruecknehmen', async () => {
    const db = await makeDb()
    await up(db)
    await up(db)
    await down(db)
    await down(db)

    expect(await db.schema.hasColumn('users', 'vacationDaysPerYear')).toBe(false)
    expect(await db.schema.hasColumn('users', 'contract')).toBe(false)
    expect(await db('users').count({ n: '*' })).toEqual([{ n: 1 }])
  })
})
