import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('products', table => {
    table.string('_id').primary()

    table.string('tenantId').nullable()
    table.string('locationId').nullable()
    table.string('createdAt').nullable()
    table.string('updatedAt').nullable()

    table.string('externalId').nullable()
    table.string('name').notNullable()
    table.string('acronym').notNullable()
    table.text('description').nullable()
    table.string('status').nullable().defaultTo('DRAFT')
    table.string('productType').nullable()

    // Categorization
    table.text('categoryIds').defaultTo('[]')  // JSON array of UUIDs

    // Pricing
    table.float('price').defaultTo(0)
    table.float('taxInside').defaultTo(0)
    table.float('taxOutside').defaultTo(0)
    table.string('bundlePricingMode').nullable()

    // Complex nested objects
    table.text('optionGroups').nullable()   // JSON array
    table.text('availability').nullable()  // JSON object
    table.text('ui').nullable()            // JSON object

    // Flags
    table.boolean('isInvalid').defaultTo(false)
    table.integer('productionTime').nullable()
    table.text('recipeReferences').nullable() // JSON array
  })

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_products_tenant ON products (tenantId)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_products_location ON products (tenantId, locationId)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_products_status ON products (status)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_products_external ON products (externalId)')
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('products')
}
