import type { Knex } from 'knex'

// panary/panary-core#1166: Standard-Bestellart je Terminal. Plain-Text-Spalte
// ('pos' | 'telephone'), BEWUSST ohne DB-Default und ohne Backfill: `NULL` heisst
// „kein Standard", das Terminal verhaelt sich wie bisher (Kanal des Standort-
// operationMode). Die Umsetzung NULL → Fallback lebt an einer Stelle
// (defaultOrderChannel in order-channel.ts).
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('devices', table => {
    table.text('defaultOrderChannel').nullable()
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('devices', table => {
    table.dropColumn('defaultOrderChannel')
  })
}
