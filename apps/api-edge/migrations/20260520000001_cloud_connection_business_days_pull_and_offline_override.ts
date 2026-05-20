// Migration: cloud-connection um zwei Felder fuer das business-days-Cloud-
// Managed-Setup erweitern (siehe Plan vom 2026-05-19 Spätabend).
//
// - `lastBusinessDaysPullAt`: ISO-8601-String. Wird vom neuen
//   `cloud-pull-business-days.worker.ts` nach jedem erfolgreichen Pull
//   als `since`-Cursor gespeichert.
// - `offlineOverrideActiveUntil`: ISO-8601-String. Vom Operator manuell
//   im Admin-Client gesetzt (Default `now + 2h`), wenn der Connected-Edge
//   Cloud-Verbindung verloren hat aber weiter arbeiten muss. Beim
//   naechsten erfolgreichen Pull-Tick automatisch auf `null` resettet.
//
// Beide Spalten sind nullable — bestehende cloud-connection-Records
// bekommen `NULL` als Default und die Worker behandeln das als „kein
// Cursor / kein aktiver Override" (saubere Backward-Compat ohne Backfill).
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('cloud-connection', table => {
    table.string('lastBusinessDaysPullAt').nullable()
    table.string('offlineOverrideActiveUntil').nullable()
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('cloud-connection', table => {
    table.dropColumn('lastBusinessDaysPullAt')
    table.dropColumn('offlineOverrideActiveUntil')
  })
}
