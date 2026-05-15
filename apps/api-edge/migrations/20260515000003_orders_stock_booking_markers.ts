import type { Knex } from 'knex'

/**
 * Migration: orders um Stock-Buchungs-Marker erweitern.
 *
 * Hintergrund: Verkaufsverbrauch-Buchung (Variante A) — beim Status-Wechsel
 * auf PRODUCED/COMPLETED erzeugt der Cloud-Hook `order-stock-update.hook` ein
 * SALES_OUT-Inventory-Movement. Die drei Marker:
 *
 *   - stockBookedAt:     Idempotenz-Marker. Gesetzt nach erfolgreicher
 *                        SALES_OUT-Buchung. Doppel-Hook-Aufrufe sind No-Op.
 *   - stockMovementIds:  IDs der erzeugten Movements (Array, JSON-Blob in
 *                        SQLite). Wird beim Storno fuer Reverse-Lookup
 *                        verwendet.
 *   - stockReversedAt:   Marker nach erfolgreichem Reversal bei Storno
 *                        (Status → ABORTED). Verhindert Doppel-Reversal.
 *
 * Felder sind optional — Bestandsorders ohne diese Marker bleiben gueltig,
 * der Hook ueberspringt sie defensiv (kein Backfill).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('orders', table => {
    table.string('stockBookedAt').nullable()
    table.text('stockMovementIds').nullable()    // JSON-Array
    table.string('stockReversedAt').nullable()
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('orders', table => {
    table.dropColumn('stockBookedAt')
    table.dropColumn('stockMovementIds')
    table.dropColumn('stockReversedAt')
  })
}
