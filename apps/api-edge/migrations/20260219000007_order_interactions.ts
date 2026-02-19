import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('order-interactions', table => {
    table.string('_id').primary()

    table.string('tenantId').nullable()
    table.string('locationId').nullable()
    table.string('createdAt').nullable()
    table.string('updatedAt').nullable()

    table.string('type').notNullable()

    table.string('orderId').nullable()
    table.string('userId').notNullable()
    table.string('sessionId').nullable()
    table.string('businessDayId').nullable()
    table.string('businessDate').nullable()

    table.string('orderOpenedAt').notNullable()
    table.string('eventAt').notNullable()
    table.integer('eventOffsetMs').defaultTo(0)

    // Item-delete specific
    table.string('productId').nullable()
    table.integer('lineItemId').nullable()
    table.integer('deletedQuantity').nullable()

    // Cancel specific
    table.boolean('hadLineItems').nullable()
    table.integer('lineItemCountAtCancel').nullable()
    table.integer('totalQuantityAtCancel').nullable()
  })

  await knex.raw('CREATE INDEX IF NOT EXISTS "idx_order_interactions_tenant" ON "order-interactions" (tenantId)')
  await knex.raw('CREATE INDEX IF NOT EXISTS "idx_order_interactions_order" ON "order-interactions" (orderId)')
  await knex.raw('CREATE INDEX IF NOT EXISTS "idx_order_interactions_user" ON "order-interactions" (userId)')
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('order-interactions')
}
