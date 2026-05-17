// Migration: Tabelle `pending-local-overrides` für Emergency-Override-Patches.
//
// Wenn der Edge im Notfall-Modus (`cloud-connection.emergencyOverride=true`)
// lokale Drucker-Änderungen akzeptiert, landen die Patches NICHT in der
// Sync-Outbox (sonst würden sie beim Reconnect blind die Cloud-Werte
// überschreiben), sondern hier. Beim nächsten erfolgreichen Heartbeat ruft
// der Reconciliation-Flow `POST /sync/reconcile-overrides` auf der Cloud auf
// und entscheidet pro Eintrag: Edge gewinnt (kein Cloud-Konflikt) oder
// Eintrag landet in `sync-conflicts` für die manuelle Auflösung.

import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('pending-local-overrides', table => {
    table.string('_id').primary()
    table.string('tenantId').notNullable()
    table.string('locationId').notNullable()
    table.string('tableName').notNullable()
    table.string('recordId').notNullable()
    table.string('fieldPath').notNullable()
    table.text('oldValueJson').nullable()
    table.text('newValueJson').notNullable()
    table.string('changedAt').notNullable()
    table.string('changedBy').nullable()
    table.string('status').notNullable().defaultTo('PENDING_RECONCILE')
    table.string('createdAt').notNullable()
    table.string('updatedAt').notNullable()
    table.index(['tenantId', 'locationId', 'status'], 'idx_pending-local-overrides_status')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('pending-local-overrides')
}
