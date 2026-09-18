// Migration: cloud-connection um die Fremd-Mandanten-Raste erweitern (#337).
//
// Der Pull-Apply erkennt seit #337, wenn ein aus der Cloud gepullter Record eine
// `tenantId` traegt, die nicht zu dem Mandanten passt, auf den dieser Edge gepairt
// ist. Der Record wird trotzdem geschrieben — der Pull-Cursor rueckt unabhaengig vom
// Apply-Ergebnis vor, ein abgelehnter Record kaeme nie wieder. Die Sichtung selbst
// muss deshalb hier ueberdauern, auch ueber Prozess-Neustarts.
//
// Gelesen wird die Raste vom Heartbeat, der sie an die Cloud meldet. Ohne diese drei
// Spalten gaebe es keinen Weg, auf dem der Befund je einen Menschen erreicht: der Edge
// hat kein externes Fehler-Reporting, und `sync-runs`/`bootstrap-reports` sind reine
// Edge-Tabellen ohne Cloud-Push.
//
// Bestandsrecords bekommen NULL bzw. 0 — „nie gesehen", der Normalfall. Die Raste wird
// beim Re-Pairing auf einen anderen Mandanten geleert (Restamp im Bootstrap-Runner),
// sonst meldete ein Edge nach einem legitimen Mandantenwechsel dauerhaft Fehlalarm.
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('cloud-connection', table => {
    table.string('foreignTenantRecordsAt').nullable()
    table.integer('foreignTenantRecordsCount').notNullable().defaultTo(0)
    table.string('foreignTenantRecordsLastTenantId').nullable()
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('cloud-connection', table => {
    table.dropColumn('foreignTenantRecordsAt')
    table.dropColumn('foreignTenantRecordsCount')
    table.dropColumn('foreignTenantRecordsLastTenantId')
  })
}
