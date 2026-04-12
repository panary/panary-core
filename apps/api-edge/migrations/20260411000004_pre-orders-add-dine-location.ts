import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('pre-orders', table => {
    table.string('dineLocation').nullable().defaultTo('take-out')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('pre-orders', table => {
    table.dropColumn('dineLocation')
  })
}
