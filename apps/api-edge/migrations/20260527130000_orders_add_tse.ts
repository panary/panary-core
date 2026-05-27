import type { Knex } from 'knex'

/**
 * Migration: orders um `tse` (JSON) erweitern.
 *
 * Eingebetteter TSE-Signatur-Snapshot (KassenSichV), gesetzt vom
 * signOrderTse*-Hook. Als TEXT/JSON gespeichert (via getJsonFieldHooks).
 * Nullable ohne Default — bestehende Orders + Standalone/orders-only + Modi
 * ohne aktive TSE bleiben gültig (NULL). Gleiches Muster wie cashSessionId.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('orders', table => {
    table.text('tse').nullable()
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('orders', table => {
    table.dropColumn('tse')
  })
}
