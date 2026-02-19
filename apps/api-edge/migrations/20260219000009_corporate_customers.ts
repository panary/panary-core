import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('corporate-customers', table => {
    table.string('_id').primary()

    table.string('tenantId').nullable()
    table.string('locationId').nullable()
    table.string('createdAt').nullable()
    table.string('updatedAt').nullable()

    table.string('name1').notNullable()
    table.string('name2').nullable()
    table.string('email').nullable()
    table.string('phone').nullable()
    table.string('status').nullable()
    table.string('languagePreference').nullable()
    table.text('notes').nullable()

    // Address (from baseCustomerSchema → addressSchema stored as JSON)
    table.text('address').nullable() // JSON object

    // Corporate-specific
    table.boolean('eInvoiceRequired').nullable()
    table.string('vatId').nullable()
    table.string('taxNumber').nullable()

    table.integer('ordersCount').defaultTo(0)
    table.string('image').nullable()
    table.string('favicon').nullable()

    table.text('discountDetails').nullable()  // JSON object
    table.text('invoices').defaultTo('[]')    // JSON array
  })

  await knex.raw('CREATE INDEX IF NOT EXISTS "idx_corp_cust_tenant" ON "corporate-customers" (tenantId)')
  await knex.raw('CREATE INDEX IF NOT EXISTS "idx_corp_cust_location" ON "corporate-customers" (tenantId, locationId)')
  await knex.raw('CREATE INDEX IF NOT EXISTS "idx_corp_cust_name" ON "corporate-customers" (name1)')
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('corporate-customers')
}
