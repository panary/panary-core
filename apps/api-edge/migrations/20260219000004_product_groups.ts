import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('product-groups', table => {
    table.string('_id').primary()

    table.string('tenantId').nullable()
    table.string('locationId').nullable()
    table.string('createdAt').nullable()
    table.string('updatedAt').nullable()

    table.string('externalId').nullable()
    table.string('status').nullable().defaultTo('DRAFT')
    table.string('name').notNullable()
    table.string('acronym').nullable()
    table.string('color').notNullable()
    table.boolean('excluded').defaultTo(false)
    table.integer('index').defaultTo(0)
    table.float('taxInside').defaultTo(19)
    table.float('taxOutside').defaultTo(7)
  })

  await knex.raw('CREATE INDEX IF NOT EXISTS "idx_product_groups_tenant" ON "product-groups" (tenantId)')
  await knex.raw('CREATE INDEX IF NOT EXISTS "idx_product_groups_location" ON "product-groups" (tenantId, locationId)')
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('product-groups')
}
