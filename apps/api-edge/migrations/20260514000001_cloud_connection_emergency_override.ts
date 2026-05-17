// Migration: cloud-connection um Emergency-Override-Felder erweitern.
//
// Hintergrund: Wenn die Cloud unerreichbar ist, blockt der `cloudManaged()`-
// Hook am Edge alle Schreibzugriffe auf Standort-Stammdaten. Im Notfall
// (Cloud-Ausfall + dringende Drucker-Anpassung vor Ort) wird nach
// `EMERGENCY_OVERRIDE_AFTER_MS` (5 min) ohne erfolgreichen Heartbeat ODER
// nach 3 konsekutiven Heartbeat-Fehlern der Notfall-Modus aktiviert. Der Hook
// lässt dann selektiv `printSettings`-Patches durch.
//
// Edge-only: Diese Felder werden NICHT zur Cloud synct (multiTenancy + Sync-
// Outbox ignoriert die `cloud-connection`-Tabelle generell).

import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('cloud-connection', table => {
    table.boolean('emergencyOverride').notNullable().defaultTo(false)
    table.string('emergencyOverrideSince').nullable()
    table.string('lastHeartbeatOk').nullable()
    table.integer('consecutiveHeartbeatFailures').notNullable().defaultTo(0)
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('cloud-connection', table => {
    table.dropColumn('emergencyOverride')
    table.dropColumn('emergencyOverrideSince')
    table.dropColumn('lastHeartbeatOk')
    table.dropColumn('consecutiveHeartbeatFailures')
  })
}
