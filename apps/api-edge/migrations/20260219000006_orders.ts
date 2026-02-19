import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('orders', table => {
    table.string('_id').primary()

    table.string('tenantId').nullable()
    table.string('locationId').nullable()
    table.string('createdAt').nullable()
    table.string('updatedAt').nullable()

    table.string('externalId').nullable()
    table.string('status').notNullable().defaultTo('active')
    table.string('businessDayId').nullable()
    table.string('orderChannel').notNullable()
    table.integer('dailySequenceNumber').defaultTo(0)
    table.string('dineLocation').notNullable()
    table.string('recordingDate').notNullable()

    // Complex nested objects / arrays stored as JSON text
    table.text('lineItems').defaultTo('[]')
    table.text('cancellation').nullable()
    table.text('customerPaymentInfo').nullable()
    table.text('discount').nullable()
    table.text('staffPaymentInfo').nullable()
    table.text('taxSnapshot').nullable()
    table.text('creationContext').nullable()
    table.text('payment').nullable()

    // Simple fields
    table.boolean('isFinished').defaultTo(false)
    table.integer('pager').nullable()
    table.integer('estimatedDuration').defaultTo(0)
    table.integer('remainingTime').defaultTo(0)
    table.string('targetCompletionAt').nullable()
    table.string('table').nullable()
  })

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders (tenantId)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_orders_location ON orders (tenantId, locationId)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_orders_businessday ON orders (businessDayId)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_orders_recording ON orders (recordingDate)')
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('orders')
}
