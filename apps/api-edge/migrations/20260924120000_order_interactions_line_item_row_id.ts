// Migration: `lineItemRowId` an order-interactions (panary/panary-core#348).
//
// Echte Zeilen-ID (`lineItem._id`) fuer die Typen ab Phase 5 — Split und
// Umbuchung muessen eine Bestellzeile ueber Vorgangsgrenzen hinweg
// wiederfinden koennen.
//
// 🚨 Das bestehende `lineItemId` bleibt unveraendert ein ARRAY-INDEX (integer,
// ADR 0033). Es wird NICHT umgedeutet und nicht befuellt: Der Bestand ist nicht
// migriert, und eine stille Bedeutungsaenderung machte jede Auswertung ueber
// Altdaten falsch, ohne dass irgendwo ein Fehler auftauchte.
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order-interactions', table => {
    table.string('lineItemRowId').nullable()
  })

  // Tenant-prefixed wie alle Indizes dieser Tabelle: Jede Query laeuft ueber
  // tenantId (multiTenancy()-Hook).
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_order-interactions_tenant_line_item_row" ON "order-interactions" (tenantId, lineItemRowId)',
  )
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP INDEX IF EXISTS "idx_order-interactions_tenant_line_item_row"')
  await knex.schema.alterTable('order-interactions', table => {
    table.dropColumn('lineItemRowId')
  })
}
