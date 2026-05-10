// Migration: sync_*-Tabellen auf kebab-case umbenennen
// Service-Pfade nutzen 'sync-conflicts', 'sync-outbox', 'sync-cursor', die
// Migrations 20260502 hatten aber snake_case angelegt. Per Naming-Konvention
// (data-models.md) sind kebab-case Tabellen Pflicht.
import type { Knex } from 'knex'

const renames: { from: string; to: string }[] = [
  { from: 'sync_conflicts', to: 'sync-conflicts' },
  { from: 'sync_outbox', to: 'sync-outbox' },
  { from: 'sync_cursor', to: 'sync-cursor' },
]

export async function up(knex: Knex): Promise<void> {
  for (const { from, to } of renames) {
    const exists = await knex.schema.hasTable(from)
    if (!exists) continue
    const targetExists = await knex.schema.hasTable(to)
    if (targetExists) {
      await knex.schema.dropTable(from)
      continue
    }
    await knex.schema.renameTable(from, to)
  }

  await knex.schema.raw('DROP INDEX IF EXISTS "idx_sync_conflicts_tenant_status"')
  await knex.schema.raw('DROP INDEX IF EXISTS "idx_sync_conflicts_service"')
  await knex.schema.raw('DROP INDEX IF EXISTS "idx_sync_outbox_status"')
  await knex.schema.raw('DROP INDEX IF EXISTS "idx_sync_outbox_service"')

  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_sync-conflicts_tenant_status" ON "sync-conflicts" (tenantId, status)',
  )
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_sync-conflicts_service" ON "sync-conflicts" (service)',
  )
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_sync-outbox_status" ON "sync-outbox" (status, attempts)',
  )
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_sync-outbox_service" ON "sync-outbox" (service, occurredAt)',
  )
}

export async function down(knex: Knex): Promise<void> {
  for (const { from, to } of renames) {
    const exists = await knex.schema.hasTable(to)
    if (!exists) continue
    await knex.schema.renameTable(to, from)
  }
}
