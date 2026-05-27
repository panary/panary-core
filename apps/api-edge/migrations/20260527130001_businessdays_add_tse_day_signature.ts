import type { Knex } from 'knex'

/**
 * Migration: businessdays um die TSE-Tagesabschluss-Signatur erweitern (flach).
 *
 * Gesetzt vom Edge beim Schließen des Geschäftstages (nur pos-cashier + aktive
 * TSE). Flache Spalten (kein JSON-Hook im businessdays-Service), analog reportId.
 * Alle nullable ohne Default — Bestandstage / orders-only / ohne TSE bleiben NULL.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('businessdays', table => {
    table.string('tseDayStatus').nullable()
    table.text('tseDaySignature').nullable()
    table.integer('tseDaySignatureCounter').nullable()
    table.boolean('tseDaySimulated').nullable()
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('businessdays', table => {
    table.dropColumn('tseDayStatus')
    table.dropColumn('tseDaySignature')
    table.dropColumn('tseDaySignatureCounter')
    table.dropColumn('tseDaySimulated')
  })
}
