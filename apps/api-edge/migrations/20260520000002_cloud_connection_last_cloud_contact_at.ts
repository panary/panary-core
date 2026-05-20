// Migration: cloud-connection um `lastCloudContactAt` erweitern.
//
// „Cloud erreichbar"-Heartbeat, ENTKOPPELT vom Pull-Cursor
// `lastBusinessDaysPullAt`. Wird gesetzt, sobald Cloud-Kontakt bestaetigt ist:
// vom Realtime-Worker per 30s-Heartbeat waehrend aktiver Socket-Verbindung
// (lokaler Patch, kein HTTP) UND vom BusinessDays-Pull bei Erfolg. Der
// Offline-Banner (admin-client) nutzt dieses Feld statt des Pull-Cursors,
// damit er im Push-Modus (Pull nur als 5min-Safety-Net) nicht faelschlich
// „Cloud nicht erreichbar" zeigt.
//
// Nullable — bestehende Records bekommen NULL; der Banner behandelt fehlenden
// Wert als „nie kontaktiert" und zeigt sich erst nach dem ersten Heartbeat.
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('cloud-connection', table => {
    table.string('lastCloudContactAt').nullable()
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('cloud-connection', table => {
    table.dropColumn('lastCloudContactAt')
  })
}
