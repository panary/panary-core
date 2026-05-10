// Migration: `bootstrapReportId`-Spalte zu sync-runs hinzufuegen.
//
// Korrelation: alle sync-runs, die im Rahmen eines Bootstrap-Vorgangs laufen
// (Push/Pull/Reconcile), bekommen die ID des aktuellen Bootstrap-Reports.
// Dadurch kann der Report alle zugehoerigen Detail-Eintraege referenzieren
// und die UI die Sync-History pro Bootstrap aufschluesseln.
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('sync-runs', table => {
    table.string('bootstrapReportId').nullable()
  })
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_sync-runs_bootstrap" ON "sync-runs" (bootstrapReportId) WHERE bootstrapReportId IS NOT NULL',
  )
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('sync-runs', table => {
    table.dropColumn('bootstrapReportId')
  })
}
