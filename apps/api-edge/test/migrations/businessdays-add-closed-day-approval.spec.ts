import knexFactory, { type Knex } from 'knex'
import { describe, expect, it, onTestFinished } from 'vitest'

import { down, up } from '../../migrations/20261027120000_businessdays_add_closed_day_approval'

const COLUMNS = ['openedOnClosedDayBy', 'openedOnClosedDayRole', 'openedOnClosedDayAt', 'openedOnClosedDayDate']

// Gegen eine echte In-Memory-SQLite: Bestandstage muessen die Migration ohne
// Freigabe ueberstehen (leer = keine Freigabe, kein erfundener Default).
const makeDb = async (): Promise<Knex> => {
  const db = knexFactory({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
  onTestFinished(() => db.destroy())
  await db.schema.createTable('businessdays', table => {
    table.string('_id').primary()
    table.string('date')
  })
  await db('businessdays').insert({ _id: 'bd-bestand', date: '2026-10-20' })
  return db
}

describe('20261027120000_businessdays_add_closed_day_approval', () => {
  it('legt die vier Spalten an, Bestandstage bleiben ohne Freigabe', async () => {
    const db = await makeDb()
    await up(db)

    for (const column of COLUMNS) expect(await db.schema.hasColumn('businessdays', column)).toBe(true)
    expect(await db('businessdays').where({ _id: 'bd-bestand' }).first()).toEqual({
      _id: 'bd-bestand',
      date: '2026-10-20',
      openedOnClosedDayBy: null,
      openedOnClosedDayRole: null,
      openedOnClosedDayAt: null,
      openedOnClosedDayDate: null,
    })
  })

  it('speichert einen Stempel', async () => {
    const db = await makeDb()
    await up(db)
    await db('businessdays').where({ _id: 'bd-bestand' }).update({
      openedOnClosedDayBy: 'u-1',
      openedOnClosedDayRole: 'tenant:owner',
      openedOnClosedDayAt: '2026-10-26T08:00:00.000Z',
      openedOnClosedDayDate: '2026-10-26',
    })
    expect(await db('businessdays').where({ _id: 'bd-bestand' }).first()).toMatchObject({
      openedOnClosedDayRole: 'tenant:owner',
      openedOnClosedDayDate: '2026-10-26',
    })
  })

  it('ist wiederholbar und laesst sich zuruecknehmen', async () => {
    const db = await makeDb()
    await up(db)
    await up(db)
    await down(db)
    await down(db)
    for (const column of COLUMNS) expect(await db.schema.hasColumn('businessdays', column)).toBe(false)
    expect(await db('businessdays').count({ n: '*' })).toEqual([{ n: 1 }])
  })
})
