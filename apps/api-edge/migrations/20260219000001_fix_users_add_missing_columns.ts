import type { Knex } from 'knex'

/**
 * Adds columns that were missing from the initial users migration.
 * Without these columns, the admin bootstrap fails with
 * "table users has no column named firstName".
 *
 * Uses hasColumn guards so this migration is safe on both
 * existing DBs (adds the missing columns) and fresh installs
 * (the updated original migration already includes them → no-op).
 */
export async function up(knex: Knex): Promise<void> {
  const hasFirstName      = await knex.schema.hasColumn('users', 'firstName')
  const hasLastName       = await knex.schema.hasColumn('users', 'lastName')
  const hasActiveLocation = await knex.schema.hasColumn('users', 'activeLocationId')
  const hasStampingId     = await knex.schema.hasColumn('users', 'stampingId')

  if (!hasFirstName || !hasLastName || !hasActiveLocation || !hasStampingId) {
    await knex.schema.alterTable('users', table => {
      if (!hasFirstName)      table.string('firstName').defaultTo('')
      if (!hasLastName)       table.string('lastName').defaultTo('')
      if (!hasActiveLocation) table.string('activeLocationId').nullable()
      if (!hasStampingId)     table.string('stampingId').nullable()
    })
  }
}

export async function down(knex: Knex): Promise<void> {
  // SQLite supports DROP COLUMN since version 3.35 (2021).
  // If running an older SQLite, comment these out.
  await knex.schema.alterTable('users', table => {
    table.dropColumn('firstName')
    table.dropColumn('lastName')
    table.dropColumn('activeLocationId')
    table.dropColumn('stampingId')
  })
}
