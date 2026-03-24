import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('working-times', table => {
    table.string('_id').primary()

    table.string('tenantId').notNullable()
    table.string('locationId').nullable()
    table.string('userId').notNullable()

    table.string('businessDay').nullable()

    table.text('breaks').defaultTo('[]')

    table.string('checkinDate').notNullable()
    table.string('checkoutDate').nullable()
    table.string('originCheckinDate').notNullable()
    table.string('originCheckoutDate').nullable()

    table.string('updatedBy').nullable()
    table.string('createdAt').nullable()
    table.string('updatedAt').nullable()
  })

  await knex.raw('CREATE INDEX IF NOT EXISTS "idx_wt_tenant" ON "working-times" (tenantId)')
  await knex.raw('CREATE INDEX IF NOT EXISTS "idx_wt_tenant_location" ON "working-times" (tenantId, locationId)')
  await knex.raw('CREATE INDEX IF NOT EXISTS "idx_wt_user" ON "working-times" (userId)')
  await knex.raw('CREATE INDEX IF NOT EXISTS "idx_wt_businessday" ON "working-times" (tenantId, businessDay)')
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('working-times')
}
