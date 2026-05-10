// Migration: sync_cursor-Tabelle (M7.4)
// Edge-seitiger Cursor pro sync-faehigem Service (Pull-Wasserlinie etc.).
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('sync_cursor', table => {
    table.string('_id').primary() // Singleton 'cloud' bzw. service-Name
    table.string('service').notNullable()
    table.string('lastPullAt').nullable()
    table.string('lastPushAt').nullable()
    table.string('lastHeartbeatAt').nullable()
    table.float('lastClockSkewMs').nullable()
    table.text('lastError').nullable()
    table.string('lastBootstrapResumeToken').nullable()
    table.string('createdAt').notNullable()
    table.string('updatedAt').notNullable()
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('sync_cursor')
}
