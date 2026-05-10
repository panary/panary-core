// Migration: sync-runs-Tabelle.
//
// Zweck: chronologische Persistenz aller fachlich relevanten Sync-Vorgaenge
// (Bootstrap, Push, Pull, Reconcile, Heartbeat-mit-Bedeutung). Wird vom Edge-
// Admin-Panel als History-Liste angezeigt.
//
// "Append-Telemetrie": kein SQLite-Trigger gegen UPDATE/DELETE — der
// 30-Tage-Cleanup-Worker (sync-runs-cleanup.worker.ts) braucht DELETE.
// Wer eine echte Audit-Trail braucht, sollte audit-events nehmen.
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('sync-runs', table => {
    table.string('_id').primary()
    table.string('tenantId').notNullable()

    table.string('phase').notNullable() // bootstrap | push | pull | heartbeat | reconcile
    table.string('direction').notNullable() // edge-to-cloud | cloud-to-edge
    table.string('service').nullable() // null bei aggregierten Phasen (heartbeat)
    table.integer('recordCount').notNullable().defaultTo(0)
    table.integer('accepted').nullable()
    table.integer('rejected').nullable()
    table.integer('archived').nullable()
    table.integer('durationMs').notNullable().defaultTo(0)
    table.string('outcome').notNullable() // success | partial | failure
    table.text('errorMessage').nullable()
    table.string('triggeredBy').notNullable() // bootstrap | scheduler | manual | startup

    table.string('startedAt').notNullable()
    table.string('finishedAt').notNullable()
    table.string('createdAt').notNullable()
    table.string('updatedAt').notNullable()
  })

  // Index fuer die Haupt-UI-Query: chronologisch absteigend pro Tenant
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_sync-runs_tenant_started" ON "sync-runs" (tenantId, startedAt DESC)',
  )
  // Index fuer den Cleanup-Worker (DELETE WHERE createdAt < threshold)
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_sync-runs_created" ON "sync-runs" (createdAt)',
  )
  // Index fuer Phase-Filter ("Nur Pulls" / "Nur Fehler")
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_sync-runs_tenant_phase_started" ON "sync-runs" (tenantId, phase, startedAt DESC)',
  )
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('sync-runs')
}
