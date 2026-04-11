import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  // Tabelle umbenennen: snake_case → kebab-case (Projekt-Konvention)
  await knex.schema.renameTable('pre_orders', 'pre-orders')

  // Alte Indizes entfernen (SQLite behält sie nach Rename bei, aber mit altem Namen)
  await knex.raw('DROP INDEX IF EXISTS idx_pre_orders_tenant')
  await knex.raw('DROP INDEX IF EXISTS idx_pre_orders_tenant_location')
  await knex.raw('DROP INDEX IF EXISTS idx_pre_orders_status')
  await knex.raw('DROP INDEX IF EXISTS idx_pre_orders_scheduled')

  // Indizes mit konsistentem Namen neu erstellen
  await knex.raw('CREATE INDEX IF NOT EXISTS "idx_pre-orders_tenant" ON "pre-orders" (tenantId)')
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS "idx_pre-orders_tenant_location" ON "pre-orders" (tenantId, locationId)',
  )
  await knex.raw('CREATE INDEX IF NOT EXISTS "idx_pre-orders_status" ON "pre-orders" (status)')
  await knex.raw('CREATE INDEX IF NOT EXISTS "idx_pre-orders_scheduled" ON "pre-orders" (scheduledFor)')
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.renameTable('pre-orders', 'pre_orders')

  await knex.raw('DROP INDEX IF EXISTS "idx_pre-orders_tenant"')
  await knex.raw('DROP INDEX IF EXISTS "idx_pre-orders_tenant_location"')
  await knex.raw('DROP INDEX IF EXISTS "idx_pre-orders_status"')
  await knex.raw('DROP INDEX IF EXISTS "idx_pre-orders_scheduled"')

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_pre_orders_tenant ON pre_orders (tenantId)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_pre_orders_tenant_location ON pre_orders (tenantId, locationId)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_pre_orders_status ON pre_orders (status)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_pre_orders_scheduled ON pre_orders (scheduledFor)')
}
