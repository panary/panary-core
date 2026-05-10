// Migration: sync_outbox-Tabelle (M7.4)
// Edge-seitiger Ausgang fuer Push-Operationen (orders, order-interactions, working-times).
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('sync_outbox', table => {
    table.string('_id').primary()
    table.string('service').notNullable()
    table.string('op').notNullable() // create | patch | remove
    table.string('entityId').notNullable()
    table.text('payload').nullable() // JSON-String
    table.string('occurredAt').notNullable()
    table.string('syncSource').notNullable() // live | backfill
    table.string('status').notNullable().defaultTo('pending') // pending | in-flight | acked | rejected
    table.integer('attempts').notNullable().defaultTo(0)
    table.string('lastAttemptAt').nullable()
    table.string('syncedAt').nullable()
    table.text('lastError').nullable()
    table.string('createdAt').notNullable()
    table.string('updatedAt').notNullable()
  })

  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_sync_outbox_status" ON "sync_outbox" (status, attempts)',
  )
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_sync_outbox_service" ON "sync_outbox" (service, occurredAt)',
  )
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('sync_outbox')
}
