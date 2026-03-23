// Migration: Apikeys-Tabelle an das aktuelle Schema anpassen
// Die ursprüngliche Migration (20260212193819) hatte nur id + text.
// Das Schema erwartet alle Felder für Device-API-Keys.
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  // Alte Tabelle komplett ersetzen — sie enthält nur ein Auto-Increment id + text
  await knex.schema.dropTableIfExists('apikeys')

  await knex.schema.createTable('apikeys', table => {
    table.string('_id').primary()
    table.string('tenantId').nullable()
    table.string('locationId').nullable()
    table.string('createdAt').nullable()
    table.string('updatedAt').nullable()

    table.string('apikey').notNullable()
    table.string('name').notNullable()
    table.string('deviceId').nullable()
    table.string('validUntil').nullable()
    table.string('createdBy').notNullable()
    table.string('role').notNullable()
    table.string('description').nullable()
    table.boolean('active').defaultTo(true)
    table.string('lastUsedAt').nullable()
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('apikeys')

  // Alte Struktur wiederherstellen
  await knex.schema.createTable('apikeys', table => {
    table.increments('id')
    table.string('text')
  })
}
