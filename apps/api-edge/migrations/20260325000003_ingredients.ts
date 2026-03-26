import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('ingredients', table => {
    table.string('_id').primary()

    table.string('tenantId').notNullable()
    table.string('locationId').nullable()
    table.string('createdAt').nullable()
    table.string('updatedAt').nullable()

    table.string('externalId').nullable()
    table.string('status').nullable().defaultTo('DRAFT')
    table.string('name').notNullable()
    table.string('manufacturer').nullable()
    table.string('category').nullable()
    table.string('basicUnit').notNullable()
    table.float('basicUnitPrice').defaultTo(0)
    table.float('packagingUnit').defaultTo(0)
    table.float('packagingUnitPrice').defaultTo(0)
    table.float('cartonUnit').defaultTo(0)
    table.float('cartonUnitPrice').defaultTo(0)
    table.boolean('onlyOutsideConsumption').defaultTo(false)
  })

  await knex.raw('CREATE INDEX IF NOT EXISTS "idx_ingredients_tenant" ON "ingredients" (tenantId)')
  await knex.raw('CREATE INDEX IF NOT EXISTS "idx_ingredients_tenant_location" ON "ingredients" (tenantId, locationId)')
  await knex.raw(
    'CREATE UNIQUE INDEX IF NOT EXISTS "idx_ingredients_tenant_external_unique" ON "ingredients" (tenantId, externalId) WHERE externalId IS NOT NULL',
  )
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('ingredients')
}
