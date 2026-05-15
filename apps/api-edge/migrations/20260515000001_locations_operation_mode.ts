// Migration: locations.operationMode hinzufügen.
//
// Hintergrund: Tagesabschluss-Workflow unterscheidet zwei Modi pro Standort:
//   - 'orders-only'  → reines Bestellsystem; Tagesabschluss aggregiert nur
//                      Bestellungen + Wareneinsatz, kein Cash-Count, kein Z-Bon
//   - 'pos-cashier'  → vollwertige Kasse mit Kassenabstimmung und lückenloser
//                      Z-Bon-Nummer (KassenSichV-Schema-Stubs vorhanden)
//
// Default 'pos-cashier' für Bestandskunden — der häufigste Fall heute.

import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('locations', table => {
    table.string('operationMode').notNullable().defaultTo('pos-cashier')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('locations', table => {
    table.dropColumn('operationMode')
  })
}
