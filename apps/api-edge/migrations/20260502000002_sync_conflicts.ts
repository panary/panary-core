// Migration: sync_conflicts-Tabelle (M7.2)
// Konflikte aus dem Pairing-Bootstrap (merge-by-external-id) landen hier
// und werden im Edge-Admin-UI vom User aufgeloest.
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('sync_conflicts', table => {
    table.string('_id').primary()
    table.string('tenantId').notNullable()
    table.string('locationId').nullable()
    table.string('createdAt').notNullable()
    table.string('updatedAt').notNullable()

    table.string('service').notNullable()
    table.string('edgeRecordId').notNullable()
    table.string('cloudRecordId').nullable()
    table.string('reason').notNullable()
    table.text('edgePayload').nullable() // JSON-String
    table.text('cloudPayload').nullable() // JSON-String
    table.string('status').notNullable().defaultTo('open')
    table.string('resolution').nullable()
    table.string('resolvedByUserId').nullable()
    table.string('resolvedAt').nullable()
  })

  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_sync_conflicts_tenant_status" ON "sync_conflicts" (tenantId, status)',
  )
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_sync_conflicts_service" ON "sync_conflicts" (service)',
  )
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('sync_conflicts')
}
