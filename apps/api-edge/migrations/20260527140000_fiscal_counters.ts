import type { Knex } from 'knex'

/**
 * Migration: fiscal-counters-Tabelle (lückenloser KassenSichV-Fiskal-Zähler).
 *
 * Umgebungs-lokal und NICHT gesynct: der Edge ist autoritativ für die Locations,
 * die er fiskalisch signiert. `_id` ist der zusammengesetzte Schlüssel
 * `${tenantId}:${locationId}` → genau ein Zähler-Datensatz je Location.
 * `lastValue` ist der zuletzt vergebene Wert; die nächste Vorgangsnummer ist
 * lastValue + 1 (Vergabe atomar über In-Process-Mutex im Service).
 *
 * Bewusst KEIN `_deletedAt` — der Zähler darf nie gelöscht/getombstoned werden
 * (eine Lücke wäre ein Compliance-Defekt). Tabellenname kebab-case → Indizes
 * mit gequoteten Identifiern.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('fiscal-counters', table => {
    table.string('_id').primary()
    table.string('tenantId').notNullable()
    table.string('locationId').notNullable()
    table.integer('lastValue').notNullable().defaultTo(0)
    table.string('createdAt').nullable()
    table.string('updatedAt').nullable()
  })

  await knex.raw(
    'CREATE INDEX IF NOT EXISTS "idx_fiscal-counters_tenant_location" ON "fiscal-counters" (tenantId, locationId)',
  )
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('fiscal-counters')
}
