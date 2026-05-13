import type { Knex } from 'knex'

/**
 * Order.externalId hatte fuer Bestellungen keinen produktiven Use-Case
 * (anders als bei Stamm-Daten products/ingredients/customers, wo externalId
 * der kanonische Cross-DB-Sync-Identifier ist). Der Edge-Order-Service-Caller
 * setzte das Feld konstant auf `null`, der Cloud-Resolver generierte
 * faelschlicherweise eine uuidv7 (Copy-Paste-Pattern aus Stamm-Daten-Resolvern).
 *
 * Wir entfernen die Spalte aus der Edge-orders-Tabelle; das Schema in
 * `@panary-core/orders/domain` listet das Feld bereits nicht mehr.
 *
 * LineItem.externalId (im JSON-Blob `lineItems`) bleibt unangetastet — das
 * ist die Cross-Reference auf das verlinkte Produkt im Katalog.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('orders', table => {
    table.dropColumn('externalId')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('orders', table => {
    table.string('externalId').nullable()
  })
}
