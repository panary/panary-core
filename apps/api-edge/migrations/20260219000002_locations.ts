import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('locations', table => {
    table.string('_id').primary()

    table.string('tenantId').notNullable()
    table.string('createdAt').nullable()
    table.string('updatedAt').nullable()

    table.string('name').notNullable()

    // Complex objects stored as JSON text
    table.text('address').nullable()           // { street, city, postalCode, country }
    table.text('currentBusinessDay').nullable() // { businessDayId, date }
    table.text('settings').nullable()           // Full settings object

    table.string('email').nullable()
    table.string('phone').nullable()
    table.string('website').nullable()
    table.string('status').nullable().defaultTo('DRAFT')
  })

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_locations_tenant ON locations (tenantId)')
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('locations')
}
