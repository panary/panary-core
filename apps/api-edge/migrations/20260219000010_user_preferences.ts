import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('user-preferences', table => {
    table.string('_id').primary()

    table.string('tenantId').nullable()
    table.string('locationId').nullable()
    table.string('createdAt').nullable()
    table.string('updatedAt').nullable()

    table.string('userId').notNullable()
    table.string('key').notNullable()
    table.text('value').nullable()  // JSON: any value
  })

  await knex.raw('CREATE INDEX IF NOT EXISTS "idx_user_prefs_tenant" ON "user-preferences" (tenantId)')
  await knex.raw('CREATE INDEX IF NOT EXISTS "idx_user_prefs_user" ON "user-preferences" (userId)')
  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_prefs_user_key" ON "user-preferences" (userId, key)')
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('user-preferences')
}
