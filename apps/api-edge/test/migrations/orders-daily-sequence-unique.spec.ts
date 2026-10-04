import knexFactory, { type Knex } from 'knex'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  down,
  findDuplicateSequenceNumbers,
  INDEX_NAME,
  uniqueIndexSql,
  up,
} from '../../migrations/20261004100000_orders_daily_sequence_unique'

// Das SQL gegen eine echte In-Memory-SQLite: Ob der Teilindex mit Literal-Stichtag
// angelegt werden kann, Bestands-Duplikate uebersteht und neue Duplikate abweist,
// sieht man nur am Lauf (panary/panary-core#537).

const CUTOFF = '2026-10-04T10:00:00.000Z'
const BEFORE = '2026-10-03T09:22:00.000Z'
const AFTER = '2026-10-04T10:00:01.000Z'

const makeDb = async (): Promise<Knex> => {
  const db = knexFactory({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
  await db.schema.createTable('orders', t => {
    t.string('_id').primary()
    t.string('businessDayId')
    t.integer('dailySequenceNumber').defaultTo(0)
    t.string('createdAt')
  })
  return db
}

let seq = 0
const order = (businessDayId: string | null, dailySequenceNumber: number, createdAt: string) => ({
  _id: `order-${++seq}`,
  businessDayId,
  dailySequenceNumber,
  createdAt,
})

describe('Migration orders_daily_sequence_unique', () => {
  let db: Knex

  beforeEach(async () => {
    db = await makeDb()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await db.destroy()
  })

  it('legt den Index auch an, wenn der Bestand Duplikate traegt — und laesst sie stehen', async () => {
    await db('orders').insert([order('bd-1', 9221, BEFORE), order('bd-1', 9221, BEFORE), order('bd-1', 922, BEFORE)])

    await up(db, CUTOFF)

    expect(await db('orders').where({ dailySequenceNumber: 9221 }).count({ n: '*' })).toEqual([{ n: 2 }])
    const indexes = (await db.raw(`PRAGMA index_list('orders')`)) as Array<{ name: string; unique: number }>
    expect(indexes.find(i => i.name === INDEX_NAME)?.unique).toBe(1)
  })

  it('meldet die Bestands-Duplikate mit Anzahl', async () => {
    await db('orders').insert([order('bd-1', 9221, BEFORE), order('bd-1', 9221, BEFORE), order('bd-1', 9221, BEFORE)])

    await up(db, CUTOFF)

    expect(console.warn).toHaveBeenCalledTimes(1)
    const payload = JSON.parse((console.warn as unknown as { mock: { calls: string[][] } }).mock.calls[0][0])
    expect(payload).toMatchObject({ event: 'migration.orders_daily_sequence_duplicates', groups: 1, orders: 3 })
  })

  it('meldet nichts bei sauberem Bestand', async () => {
    await db('orders').insert([order('bd-1', 1, BEFORE), order('bd-1', 2, BEFORE), order('bd-2', 1, BEFORE)])

    await up(db, CUTOFF)

    expect(console.warn).not.toHaveBeenCalled()
  })

  it('weist ein neues Duplikat im selben Geschaeftstag ab', async () => {
    await up(db, CUTOFF)
    await db('orders').insert(order('bd-1', 1, AFTER))

    await expect(db('orders').insert(order('bd-1', 1, AFTER))).rejects.toThrow(/UNIQUE/)
  })

  it('erlaubt dieselbe Nummer in einem anderen Geschaeftstag', async () => {
    await up(db, CUTOFF)
    await db('orders').insert(order('bd-1', 1, AFTER))

    await expect(db('orders').insert(order('bd-2', 1, AFTER))).resolves.toBeDefined()
  })

  it('laesst Zeilen mit createdAt vor dem Stichtag durch (Altbestand)', async () => {
    await up(db, CUTOFF)
    await db('orders').insert(order('bd-1', 7, BEFORE))

    await expect(db('orders').insert(order('bd-1', 7, BEFORE))).resolves.toBeDefined()
  })

  it('ist idempotent und per down entfernbar', async () => {
    await up(db, CUTOFF)
    await up(db, CUTOFF)
    await down(db)

    const indexes = (await db.raw(`PRAGMA index_list('orders')`)) as Array<{ name: string }>
    expect(indexes.some(i => i.name === INDEX_NAME)).toBe(false)
  })

  it('findet Duplikate je Geschaeftstag, nicht ueber Tage hinweg', async () => {
    await db('orders').insert([
      order('bd-1', 5, BEFORE),
      order('bd-2', 5, BEFORE),
      order(null, 0, BEFORE),
      order(null, 0, BEFORE),
    ])

    expect(await findDuplicateSequenceNumbers(db)).toEqual([])
  })

  it('verweigert einen Stichtag ausserhalb des ISO-Formats', () => {
    expect(() => uniqueIndexSql("2026-10-04' OR 1=1 --")).toThrow(/Ungueltiger Stichtag/)
  })
})
