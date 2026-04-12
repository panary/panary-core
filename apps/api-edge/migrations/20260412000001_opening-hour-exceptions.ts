import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('opening-hour-exceptions', table => {
    table.string('_id').primary()

    table.string('tenantId').notNullable()
    table.string('locationId').nullable()
    table.string('createdAt').nullable()
    table.string('updatedAt').nullable()

    table.string('date').notNullable() // "YYYY-MM-DD"
    table.string('label').nullable()
    table.boolean('closed').notNullable().defaultTo(true)
    table.string('open').nullable() // "HH:mm"
    table.string('close').nullable() // "HH:mm"
  })

  await knex.raw('CREATE INDEX IF NOT EXISTS "idx_opening-hour-exceptions_tenant" ON "opening-hour-exceptions" (tenantId)')
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS "idx_opening-hour-exceptions_tenant_date" ON "opening-hour-exceptions" (tenantId, date)',
  )
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('opening-hour-exceptions')
}
