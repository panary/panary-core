import type { Knex } from 'knex'

/**
 * Fuegt organizationName-Spalte zur locations-Tabelle hinzu.
 * Speichert den Geschaeftsnamen (Shop-Name) separat vom Standortnamen.
 * Wird vom organizations-Service als Organisations-Name verwendet.
 */
export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('locations', 'organizationName')
  if (!hasColumn) {
    await knex.schema.alterTable('locations', table => {
      table.string('organizationName').nullable()
    })
  }

  // Bestehende Locations ohne organizationName: name als Fallback setzen
  await knex('locations')
    .whereNull('organizationName')
    .update({ organizationName: knex.ref('name') })
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('locations', 'organizationName')
  if (hasColumn) {
    await knex.schema.alterTable('locations', table => {
      table.dropColumn('organizationName')
    })
  }
}
