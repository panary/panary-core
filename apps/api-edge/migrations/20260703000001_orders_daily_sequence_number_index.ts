// Migration: Index fuer den dailySequenceNumber-Eindeutigkeitscheck beim Order-Create.
//
// assign-daily-sequence-number.ts prueft bei jedem Checkout intern
// `orders.find({ query: { dailySequenceNumber, $limit: 0 } })` — interner Call
// ohne Tenant-Filter → SQL `WHERE dailySequenceNumber = ?`. Ohne Index erzwingt
// das einen Full-Table-Scan pro Checkout (~18.000 Orders nach 12 Monaten auf
// einem Sunmi D3), und weil der Check unter einem modul-globalen Mutex laeuft,
// serialisiert die wachsende Latenz alle parallelen Checkouts.
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_orders_dailySequenceNumber ON orders (dailySequenceNumber)')
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_orders_dailySequenceNumber')
}
