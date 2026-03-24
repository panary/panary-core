import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('businessdays', table => {
    table.string('_id').primary()

    table.string('tenantId').notNullable()
    table.string('locationId').nullable()
    table.string('date').notNullable()
    table.string('openedAt').notNullable()
    table.string('closedAt').nullable()
    table.boolean('isOpen').defaultTo(true)
    table.string('createdAt').nullable()
    table.string('updatedAt').nullable()
  })

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_businessdays_tenant ON businessdays (tenantId)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_businessdays_location ON businessdays (tenantId, locationId)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_businessdays_date ON businessdays (tenantId, locationId, date)')
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('businessdays')
}
