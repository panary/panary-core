import knexFactory, { type Knex } from 'knex'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  isSyntheticSettlementScope,
  SETTLEMENT_SCOPE_MAX_LENGTH,
  SYNTHETIC_SETTLEMENT_SCOPE_PREFIX,
} from '@panary/orders/domain'

import {
  BACKFILL_PREFIX,
  down,
  MAX_LENGTH,
  PLACEHOLDER,
  SYNTHETIC_PREFIX,
  up,
} from '../../migrations/20260922100000_orders_add_settlement_scope'

// Zwei Dinge, beide noetig:
//
//   1. Die Literale der Migration gegen die Domain-Konstanten. Die Migration
//      darf `@panary/orders/domain` zur Laufzeit NICHT importieren (Assets +
//      `--bundle=false`, Begruendung im Datei-Kopf) — also muss der Test die
//      Kopplung halten, sonst driften Praefix und Feldlaenge auseinander, ohne
//      dass irgendwo etwas rot wird.
//   2. Das tatsaechliche SQL gegen eine echte In-Memory-SQLite. `"table"` ist
//      ein SQL-Schluesselwort; ob die Quotierung stimmt, sieht man nur am Lauf.

const makeDb = async (withOrders = true): Promise<Knex> => {
  const db = knexFactory({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  })
  if (withOrders) {
    await db.schema.createTable('orders', t => {
      t.string('_id').primary()
      t.string('tenantId')
      t.string('locationId')
      t.string('table')
      t.string('status')
    })
  }
  return db
}

const rows = (db: Knex) => db('orders').select('_id', 'settlementScope').orderBy('_id')

describe('Migration orders_add_settlement_scope — Literale gegen die Domain', () => {
  it('spiegelt das synthetische Praefix', () => {
    expect(SYNTHETIC_PREFIX).toBe(SYNTHETIC_SETTLEMENT_SCOPE_PREFIX)
  })

  it('spiegelt die DSFinV-K-Feldlaenge', () => {
    expect(MAX_LENGTH).toBe(SETTLEMENT_SCOPE_MAX_LENGTH)
  })

  it('haelt Platzhalter und Backfill-Marker im synthetischen Namensraum', () => {
    expect(isSyntheticSettlementScope(PLACEHOLDER)).toBe(true)
    expect(isSyntheticSettlementScope(BACKFILL_PREFIX)).toBe(true)
  })
})

describe('Migration orders_add_settlement_scope — Backfill', () => {
  let db: Knex

  beforeEach(async () => {
    db = await makeDb()
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('uebernimmt den Tischwert und gibt zwei Bestellungen desselben Tisches denselben Kreis', async () => {
    await db('orders').insert([
      { _id: 'order-aaaaaaaaaaaa', table: '3' },
      { _id: 'order-bbbbbbbbbbbb', table: '3' },
      { _id: 'order-cccccccccccc', table: 'Terrasse' },
    ])

    await up(db)

    const result = Object.fromEntries((await rows(db)).map(r => [r._id, r.settlementScope]))
    expect(result['order-aaaaaaaaaaaa']).toBe('3')
    expect(result['order-bbbbbbbbbbbb']).toBe('3')
    expect(result['order-cccccccccccc']).toBe('Terrasse')
  })

  it('trimmt den Tischwert — „3" und „3 " duerfen nicht auseinanderfallen', async () => {
    await db('orders').insert([
      { _id: 'order-1', table: '3' },
      { _id: 'order-2', table: '  3  ' },
    ])

    await up(db)

    const result = await rows(db)
    expect(result[0].settlementScope).toBe(result[1].settlementScope)
  })

  it('gibt Bestellungen ohne Tisch je einen eigenen, erkennbar synthetischen Kreis', async () => {
    await db('orders').insert([
      { _id: 'order-dddddddddddd', table: null },
      { _id: 'order-eeeeeeeeeeee', table: '' },
      { _id: 'order-ffffffffffff', table: '   ' },
    ])

    await up(db)

    const result = await rows(db)
    for (const row of result) {
      expect(row.settlementScope.startsWith(BACKFILL_PREFIX)).toBe(true)
      expect(isSyntheticSettlementScope(row.settlementScope)).toBe(true)
    }
    expect(new Set(result.map(r => r.settlementScope)).size).toBe(3)
  })

  it('laesst keine Zeile ohne Wert und keine auf dem Platzhalter stehen', async () => {
    await db('orders').insert([
      { _id: 'order-1', table: '7' },
      { _id: 'order-2', table: null },
    ])

    await up(db)

    const leftovers = await db('orders').where('settlementScope', PLACEHOLDER).orWhereNull('settlementScope')
    expect(leftovers).toHaveLength(0)
  })

  it('kappt uebermaessig lange Tischwerte auf die DSFinV-K-Feldlaenge', async () => {
    await db('orders').insert([{ _id: 'order-1', table: 'x'.repeat(120) }])

    await up(db)

    const [row] = await rows(db)
    expect(row.settlementScope).toHaveLength(MAX_LENGTH)
  })

  it('ist wiederholbar — ein zweiter Lauf laesst die Werte unangetastet', async () => {
    await db('orders').insert([
      { _id: 'order-1', table: '3' },
      { _id: 'order-2', table: null },
    ])

    await up(db)
    const first = await rows(db)
    await up(db)
    const second = await rows(db)

    expect(second).toEqual(first)
  })

  it('setzt die Spalte NOT NULL — eine nullable Spalte kaeme als `null` im Sync-Push an', async () => {
    await up(db)
    await expect(db('orders').insert({ _id: 'order-1', settlementScope: null })).rejects.toThrow()
  })

  it('vergibt neuen Zeilen ohne eigenen Wert den Platzhalter statt NULL', async () => {
    await up(db)
    await db('orders').insert({ _id: 'order-1' })
    const [row] = await rows(db)
    expect(row.settlementScope).toBe(PLACEHOLDER)
  })

  it('laeuft auf einer DB ohne orders-Tabelle durch, statt zu werfen', async () => {
    const empty = await makeDb(false)
    await expect(up(empty)).resolves.toBeUndefined()
    await expect(down(empty)).resolves.toBeUndefined()
    await empty.destroy()
  })

  it('nimmt die Spalte per down() wieder zurueck', async () => {
    await up(db)
    expect(await db.schema.hasColumn('orders', 'settlementScope')).toBe(true)
    await down(db)
    expect(await db.schema.hasColumn('orders', 'settlementScope')).toBe(false)
  })
})
