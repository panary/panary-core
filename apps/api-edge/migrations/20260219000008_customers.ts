import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('customers', table => {
    table.string('_id').primary()

    table.string('tenantId').nullable()
    table.string('locationId').nullable()
    table.string('createdAt').nullable()
    table.string('updatedAt').nullable()

    table.string('name1').notNullable()
    table.string('name2').nullable()
    table.string('email').nullable()
    table.string('phone').nullable()

    // Address fields (flat)
    table.string('address1').nullable()
    table.string('address2').nullable()
    table.string('city').nullable()
    table.string('zipCode').nullable()
    table.string('province').nullable()
    table.string('country').nullable()
    table.string('countryCode').nullable()
    table.string('countryName').nullable()

    table.integer('ordersCount').defaultTo(0)
    table.string('image').nullable()
    table.string('favicon').nullable()

    table.text('discountDetails').nullable()   // JSON object
    table.text('invoices').defaultTo('[]')     // JSON array
  })

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers (tenantId)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_customers_location ON customers (tenantId, locationId)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_customers_name ON customers (name1)')
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('customers')
}
