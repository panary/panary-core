import type { Knex } from 'knex'

/**
 * Migration: orders um `appliedDiscounts` erweitern.
 *
 * Snapshot der auf die Order angewandten Rabatte (Order- und Positionsebene) als
 * JSON-Array (TEXT-Blob in SQLite). Additiv zum bestehenden `discount`-Feld:
 * ist `appliedDiscounts` gesetzt, ist es führend; sonst greift `discount`.
 *
 * Nullable ohne Default — bestehende Orders bleiben gültig (NULL → Legacy-Pfad).
 * Gleiches Muster wie `stockMovementIds`: der Edge serialisiert ungesetzte
 * nullable Spalten als `null`; das Order-Schema toleriert `Array | Null`.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('orders', table => {
    table.text('appliedDiscounts').nullable() // JSON-Array (AppliedDiscount[])
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('orders', table => {
    table.dropColumn('appliedDiscounts')
  })
}
