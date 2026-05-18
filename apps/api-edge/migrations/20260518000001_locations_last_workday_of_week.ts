// Migration: locations.lastWorkdayOfWeek hinzufügen.
//
// Steuert das Wochen-Highlighting in der Cloud-Zeiterfassung. Werte folgen der
// JS Date.getDay()-Konvention (0=So, 1=Mo, …, 6=Sa). Default 5 (Freitag)
// entspricht dem DACH-Standard; Bestandskunden ohne expliziten Wert werden
// Frontend-seitig auf 5 zurückfallen, daher hier `nullable()` und kein
// DB-Default — neue Locations bekommen den Default über den Service-Resolver
// `locationDataResolver.lastWorkdayOfWeek`.

import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('locations', table => {
    table.integer('lastWorkdayOfWeek').nullable()
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('locations', table => {
    table.dropColumn('lastWorkdayOfWeek')
  })
}
