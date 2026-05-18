// Migration: sync-outbox um Retry-/Conflict-Felder erweitern.
//
// Drei neue Spalten fuer das Sync-Hardening:
//   - nextAttemptAt: Exponential-Backoff-Steuerung. Worker zieht nur
//     Eintraege, deren nextAttemptAt <= now ODER NULL ist. NULL-Semantik =
//     "sofort faellig" → keine Backfill-UPDATE ueber bestehende Daten noetig.
//   - terminalAt: Zeitpunkt, an dem der Eintrag final als `rejected`
//     markiert wurde (entweder durch persistenten Cloud-Error oder durch
//     MAX_ATTEMPTS-Eskalation). Fuer Audit/Sortierung im Operator-UI.
//   - linkedConflictId: Cross-Referenz auf einen sync-conflicts-Eintrag,
//     der bei classification='conflict' oder MAX_ATTEMPTS-Eskalation
//     erzeugt wurde. Erlaubt im Operator-UI direkten Drill-Down.
//
// Index `idx_sync_outbox_status_next` ersetzt den alten Status-Index, damit
// der Worker-Query (status=pending UND nextAttemptAt<=now) optimal lookups
// machen kann.
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('sync-outbox', table => {
    table.string('nextAttemptAt').nullable()
    table.string('terminalAt').nullable()
    table.string('linkedConflictId').nullable()
  })

  // Index fuer den neuen Worker-Query. Alter Index bleibt (attempts ist nicht
  // mehr Teil des Queries, schadet aber nicht).
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_sync-outbox_status_next" ON "sync-outbox" (status, nextAttemptAt)',
  )
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP INDEX IF EXISTS "idx_sync-outbox_status_next"')
  await knex.schema.alterTable('sync-outbox', table => {
    table.dropColumn('linkedConflictId')
    table.dropColumn('terminalAt')
    table.dropColumn('nextAttemptAt')
  })
}
