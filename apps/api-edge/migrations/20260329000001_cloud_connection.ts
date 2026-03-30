// Migration: Cloud-Connection-Tabelle erstellen
// Speichert die Verbindungsdaten zwischen Edge-Server und Cloud.
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('cloud-connection', table => {
    table.string('_id').primary()
    table.string('tenantId').nullable()
    table.string('locationId').nullable()
    table.string('createdAt').nullable()
    table.string('updatedAt').nullable()

    table.string('cloudUrl').notNullable()
    table.string('cloudToken').nullable()
    table.string('cloudEdgeId').nullable()
    table.string('pairingStatus').notNullable().defaultTo('disconnected')
    table.string('connectedAt').nullable()
    table.string('lastSyncAt').nullable()
    table.boolean('syncEnabled').defaultTo(false)
    table.string('errorMessage').nullable()
    table.string('edgeName').nullable()
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('cloud-connection')
}
