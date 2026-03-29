import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('pre_orders', table => {
    table.string('_id').primary()

    table.string('tenantId').notNullable()
    table.string('locationId').notNullable()
    table.string('createdAt').nullable()
    table.string('updatedAt').nullable()

    table.string('scheduledFor').notNullable()
    table.string('status').notNullable().defaultTo('pending')

    // Complex objects stored as JSON text
    table.text('customerContact').notNullable()
    table.text('lineItems').notNullable().defaultTo('[]')

    table.text('note').nullable()
    table.text('metadata').nullable()
    table.string('convertedOrderId').nullable()
  })

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_pre_orders_tenant ON pre_orders (tenantId)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_pre_orders_tenant_location ON pre_orders (tenantId, locationId)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_pre_orders_status ON pre_orders (status)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_pre_orders_scheduled ON pre_orders (scheduledFor)')
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('pre_orders')
}
