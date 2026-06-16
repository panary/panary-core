import type { Knex } from 'knex'

/**
 * Migration: orders um `offlineCreated` (Boolean) + `provisionalSequenceNumber` (Integer).
 *
 * Connect-Tier-Offline-Marker (Offline-Cache Phase 4/5): vom POS bei Offline-Anlage
 * gesetzt. `offlineCreated` steuert den TSE-Skip im signOrderTseStart-Hook (kein
 * rückwirkendes Signieren, KassenSichV §146a); `provisionalSequenceNumber` bewahrt die
 * vorläufige Belegnummer. Die TypeBox-Schema-Felder existierten bereits, die SQLite-
 * Spalten fehlten → INSERT offline-erzeugter Orders beim Replay scheiterte mit
 * „no column offlineCreated" (500 → Outbox-Endlos-Retry). Beide nullable ohne Default —
 * bestehende/online Orders bleiben gültig (NULL). Gleiches Muster wie `tse`/`cashSessionId`.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('orders', table => {
    table.boolean('offlineCreated').nullable()
    table.integer('provisionalSequenceNumber').nullable()
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('orders', table => {
    table.dropColumn('offlineCreated')
    table.dropColumn('provisionalSequenceNumber')
  })
}
