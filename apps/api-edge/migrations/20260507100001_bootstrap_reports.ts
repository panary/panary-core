// Migration: bootstrap-reports-Tabelle.
//
// Diagnose-Persistenz pro Pairing-Vorgang: Pre/Post-State, Restamp-Detail,
// sync-runs-Korrelation, Konsistenz-Check. Ohne diesen Report ist ein
// Pairing-Bug nur durch SQL-Forensik nachzuvollziehen.
//
// JSON-Felder werden als TEXT gespeichert und im Service via JSON.parse/
// JSON.stringify serialisiert (analog audit-events.metadata).
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('bootstrap-reports', table => {
    table.string('_id').primary()
    table.string('cloudConnectionId').notNullable()
    table.string('tenantId').nullable()

    table.string('startedAt').notNullable()
    table.string('completedAt').nullable()
    table.string('status').notNullable() // in-progress | done | failed
    table.string('direction').notNullable()
    table.text('errorMessage').nullable()

    // JSON-Spalten (TEXT)
    table.text('identity').notNullable() // { edgeTenantIdBefore, cloudTenantId, ... }
    table.text('preState').notNullable() // { locations: [...], counts: {...} }
    table.text('postState').nullable()
    table.text('restamp').nullable()
    table.text('syncRunIds').notNullable().defaultTo('[]')
    table.text('consistencyCheck').nullable()

    table.string('jsonExportPath').nullable() // gesetzt nach dumpToFile

    table.string('createdAt').notNullable()
    table.string('updatedAt').notNullable()
  })

  // Index fuer chronologische UI-Liste pro Tenant
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_bootstrap-reports_tenant_started" ON "bootstrap-reports" (tenantId, startedAt DESC)',
  )
  // Index fuer Connection-Filter (eine Connection kann mehrere Reports haben)
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_bootstrap-reports_connection" ON "bootstrap-reports" (cloudConnectionId)',
  )
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('bootstrap-reports')
}
