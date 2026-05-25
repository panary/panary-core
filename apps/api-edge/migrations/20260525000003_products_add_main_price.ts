import type { Knex } from 'knex'

/**
 * Migration: products um `mainPrice` erweitern.
 *
 * Normalpreis des Hauptgerichts eines FIXED_PROPORTIONAL-Bundles (z.B. der
 * Hamburger separat 4,40 €). Gewicht der Marktwert-Verteilung des Festpreises
 * (`price`) über die Steuersätze. Nullable ohne Default — bestehende Produkte
 * bleiben gültig (NULL → Order-Writer trägt den Restbetrag als Hauptgewicht ein).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('products', table => {
    table.float('mainPrice').nullable()
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('products', table => {
    table.dropColumn('mainPrice')
  })
}
